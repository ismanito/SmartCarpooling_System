const crypto = require('node:crypto');
const { pool } = require('../db/pool');
const { errors } = require('../lib/errors');
const { canonicalJson } = require('../lib/canonicalJson');
const { appendAudit, verifyAuditChain } = require('./audit');
const { notify } = require('./notify');

/**
 * Suspends or reinstates someone. Suspending also withdraws their pending requests (the matcher
 * already skips suspended people, and the API refuses their token), and they are emailed.
 */
async function setUserStatus(db, { adminId, userId, status, ip }) {
  const { rows } = await db.query(
    'UPDATE users SET status = $2 WHERE user_id = $1 RETURNING user_id, university_email, role, status',
    [userId, status],
  );
  const user = rows[0];
  if (!user) throw errors.notFound('User not found.');

  let withdrawn = 0;
  if (status === 'suspended') {
    const res = await db.query(
      `UPDATE bookings SET status = 'cancelled', responded_at = now()
        WHERE status = 'pending'
          AND (offer_id IN (SELECT offer_id FROM ride_offers WHERE driver_id = $1)
            OR request_id IN (SELECT request_id FROM ride_requests WHERE rider_id = $1))`,
      [userId],
    );
    withdrawn = res.rowCount;
  }
  await appendAudit(db, {
    userId: adminId,
    action: status === 'suspended' ? 'user.suspend' : 'user.reactivate',
    entity: 'user',
    entityId: user.user_id,
    ipAddress: ip,
    details: { email: user.university_email, pending_requests_cancelled: withdrawn },
  });
  await notify(db, {
    userId: user.user_id,
    type: status === 'suspended' ? 'account.suspended' : 'account.reinstated',
    message: status === 'suspended' ? 'Your RideMate account has been suspended. Contact the RideMate team if you think this is a mistake.' : 'Your RideMate account is active again.',
    email: true,
  });
  return user;
}

const REPORT_SELECT = `
  i.report_id, i.category, i.description, i.status, i.decision, i.admin_notes, i.created_at, i.reviewed_at, i.booking_id,
  b.offer_id, rep.user_id AS reporter_id, rep.full_name AS reporter_name, rep.university_email AS reporter_email,
  tgt.user_id AS reported_id, tgt.full_name AS reported_name, tgt.university_email AS reported_email, tgt.status AS reported_status`;
const REPORT_FROM = `
  FROM incident_reports i
  JOIN bookings b ON b.booking_id = i.booking_id
  JOIN users rep ON rep.user_id = i.reporter_id
  JOIN users tgt ON tgt.user_id = i.reported_user_id`;

const summary = (r) => ({
  reportId: r.report_id,
  category: r.category,
  description: r.description,
  status: r.status,
  decision: r.decision,
  adminNotes: r.admin_notes,
  createdAt: r.created_at,
  reviewedAt: r.reviewed_at,
  rideId: r.offer_id,
  bookingId: r.booking_id,
  reporter: { userId: r.reporter_id, fullName: r.reporter_name, email: r.reporter_email },
  reported: { userId: r.reported_id, fullName: r.reported_name, email: r.reported_email, status: r.reported_status },
});

async function list(status, db = pool) {
  const { rows } = await db.query(
    `SELECT ${REPORT_SELECT} ${REPORT_FROM} WHERE ($1::text IS NULL OR i.status = $1) ORDER BY i.created_at DESC LIMIT 200`,
    [status],
  );
  return rows.map(summary);
}

/** Audit rows that mention this report or its ride, oldest first. */
async function linkedAudit(db, reportId, bookingId, offerId) {
  const { rows } = await db.query(
    `SELECT audit_id, user_id, action, entity, entity_id, host(ip_address) AS ip_address, details, created_at, prev_hash, entry_hash
       FROM audit_log
      WHERE (entity = 'incident_report' AND entity_id = $1)
         OR details->>'report_id' = $1
         OR (entity = 'booking' AND entity_id = $2)
         OR details->>'booking_id' = $2
         OR (entity = 'ride_offer' AND entity_id = $3)
         OR details->>'offer_id' = $3
      ORDER BY audit_id`,
    [reportId, bookingId, offerId],
  );
  return rows.map((a) => ({
    auditId: Number(a.audit_id),
    userId: a.user_id,
    action: a.action,
    entity: a.entity,
    entityId: a.entity_id,
    ipAddress: a.ip_address,
    details: a.details,
    createdAt: new Date(a.created_at).toISOString(),
    prevHash: a.prev_hash,
    entryHash: a.entry_hash,
  }));
}

async function detail(reportId, db = pool) {
  const { rows } = await db.query(`SELECT ${REPORT_SELECT} ${REPORT_FROM} WHERE i.report_id = $1`, [reportId]);
  if (!rows[0]) return null;
  const report = summary(rows[0]);
  const [{ rows: ride }, { rows: previous }, audit, chain] = await Promise.all([
    db.query(
      `SELECT o.origin_name, o.destination_name, o.depart_at, o.status, d.full_name AS driver_name
         FROM ride_offers o JOIN users d ON d.user_id = o.driver_id WHERE o.offer_id = $1`,
      [report.rideId],
    ),
    db.query(
      `SELECT report_id, category, status, decision, created_at FROM incident_reports
        WHERE reported_user_id = $1 AND report_id <> $2 ORDER BY created_at DESC LIMIT 20`,
      [report.reported.userId, reportId],
    ),
    linkedAudit(db, reportId, report.bookingId, report.rideId),
    verifyAuditChain(db),
  ]);
  return {
    ...report,
    ride: ride[0]
      ? { origin: ride[0].origin_name, destination: ride[0].destination_name, departAt: ride[0].depart_at, status: ride[0].status, driver: ride[0].driver_name }
      : null,
    previousReports: previous.map((p) => ({ reportId: p.report_id, category: p.category, status: p.status, decision: p.decision, createdAt: p.created_at })),
    auditTrail: audit,
    integrity: { valid: chain.valid, checked: chain.checked, firstBroken: chain.firstBroken },
  };
}

/** Records the admin's decision, closes the report and tells the people involved. */
async function decide(db, { adminId, reportId, decision, notes, ip }) {
  const { rows } = await db.query('SELECT * FROM incident_reports WHERE report_id = $1 FOR UPDATE', [reportId]);
  const report = rows[0];
  if (!report) throw errors.notFound('Report not found.');
  if (report.status === 'closed') throw errors.conflict('REPORT_CLOSED', 'This report already has a decision.');
  if (decision === 'suspended' && report.reported_user_id === adminId) throw errors.conflict('CANNOT_CHANGE_SELF', 'You cannot suspend your own account.');

  await db.query(
    `UPDATE incident_reports SET status = 'closed', decision = $2, admin_notes = $3, reviewed_by = $4, reviewed_at = now() WHERE report_id = $1`,
    [reportId, decision, notes || null, adminId],
  );
  const { rows: ride } = await db.query('SELECT offer_id FROM bookings WHERE booking_id = $1', [report.booking_id]);
  await appendAudit(db, {
    userId: adminId,
    action: 'incident.decision',
    entity: 'incident_report',
    entityId: reportId,
    ipAddress: ip,
    details: {
      report_id: reportId,
      booking_id: report.booking_id,
      ride_id: ride[0].offer_id,
      reporter_id: report.reporter_id,
      reported_user_id: report.reported_user_id,
      decision,
    },
  });
  if (decision === 'suspended') await setUserStatus(db, { adminId, userId: report.reported_user_id, status: 'suspended', ip });
  if (decision === 'warning') {
    await notify(db, { userId: report.reported_user_id, type: 'incident.warning', message: 'RideMate reviewed a safety report about you and is issuing a warning. Please follow the community rules.', email: true });
  }
  await notify(db, { userId: report.reporter_id, type: 'incident.closed', message: 'The RideMate team reviewed your safety report and closed it. Thank you for telling us.' });
}

/** Everything related to a report, hashed so it can be handed to university security and checked later. */
async function evidence(reportId, db = pool) {
  const d = await detail(reportId, db);
  if (!d) return null;
  const payload = {
    generatedAt: new Date().toISOString(),
    report: {
      reportId: d.reportId,
      category: d.category,
      description: d.description,
      status: d.status,
      decision: d.decision,
      createdAt: new Date(d.createdAt).toISOString(),
      rideId: d.rideId,
      bookingId: d.bookingId,
      reporterId: d.reporter.userId,
      reportedUserId: d.reported.userId,
    },
    chainCheck: d.integrity,
    auditEntries: d.auditTrail,
  };
  const sha256 = crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex');
  return { sha256, body: JSON.stringify({ payload, sha256 }, null, 2) };
}

module.exports = { setUserStatus, list, detail, decide, evidence };
