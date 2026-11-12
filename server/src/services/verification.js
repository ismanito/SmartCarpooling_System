/**
 * Driver verification: the wizard's server side, the admin review, document access, staying verified,
 * and the check that decides who may go online. Every action is written to the audit log (never the file contents).
 */
const crypto = require('node:crypto');
const { pool, withTransaction } = require('../db/pool');
const { config } = require('../config/env');
const { errors } = require('../lib/errors');
const rules = require('../lib/verification');
const files = require('../lib/files');
const { appendAudit } = require('./audit');
const { notify, notifyMany, adminIds } = require('./notify');
const { provider } = require('./storage');

const RECHECK_GRACE_DAYS = 14;
const REJECTED_RETENTION_DAYS = 30;
const SELFIE_CHECK_VALID_MINUTES = 10;

// ---------------------------------------------------------------- settings

async function loadSettings(db = pool) {
  const { rows } = await db.query(
    `SELECT setting_key, setting_value FROM system_settings WHERE setting_key = ANY($1)`,
    [['external_drivers_enabled', 'min_licence_years', 'expiry_warning_days', 'recheck_months', 'doc_retention_days', 'auto_suspend_rating', 'auto_suspend_min_ratings', 'auto_suspend_incidents', 'random_selfie_check_percent']],
  );
  const m = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  const num = (k, d) => (Number.isFinite(Number(m[k])) ? Number(m[k]) : d);
  return {
    externalEnabled: m.external_drivers_enabled === 'true',
    minLicenceYears: num('min_licence_years', 1),
    warningDays: num('expiry_warning_days', 14),
    recheckMonths: num('recheck_months', 6),
    retentionDays: num('doc_retention_days', 30),
    autoSuspendRating: num('auto_suspend_rating', 3.5),
    autoSuspendMinRatings: num('auto_suspend_min_ratings', 5),
    autoSuspendIncidents: num('auto_suspend_incidents', 2),
    selfiePercent: num('random_selfie_check_percent', 10),
  };
}

// ---------------------------------------------------------------- reading

async function findRow(db, driverId, { forUpdate = false } = {}) {
  const { rows } = await db.query(`SELECT * FROM driver_verifications WHERE driver_id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [driverId]);
  return rows[0] || null;
}

async function listDocs(db, driverId) {
  const { rows } = await db.query(
    `SELECT doc_id, doc_type, mime_type, size_bytes, sha256, captured_live, uploaded_at, deleted_at, deleted_reason
       FROM verification_documents WHERE driver_id = $1 AND doc_type <> 'selfie_recheck' ORDER BY uploaded_at`,
    [driverId],
  );
  return rows;
}

const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** A row as the API shows it. Dates are plain dates; hashes and storage keys never leave the server. */
function toApi(v) {
  if (!v) return null;
  const d = (x) => (x ? (x instanceof Date ? dateOnly(x) : String(x).slice(0, 10)) : null);
  return {
    driverType: v.driver_type,
    typeLabel: rules.TYPE_LABEL[v.driver_type],
    status: v.status,
    consent: Boolean(v.consent_at),
    publicPhotoConsent: v.public_photo_consent,
    qrToken: v.status === 'approved' ? v.qr_token : null,
    idExpiry: d(v.id_expiry),
    nationalIdLast4: v.national_id_last4,
    licenceNumber: v.licence_number,
    licenceHolderName: v.licence_holder_name,
    licenceExpiry: d(v.licence_expiry),
    licenceHeldSince: d(v.licence_held_since),
    insuranceProvider: v.insurance_provider,
    insurancePolicyNo: v.insurance_policy_no,
    insuranceExpiry: d(v.insurance_expiry),
    insuranceCoversPassengers: v.insurance_covers_passengers,
    vehicleId: v.vehicle_id,
    ownerRelationship: v.owner_relationship,
    goodConductIssued: d(v.good_conduct_issued),
    psvBadgeNo: v.psv_badge_no,
    psvBadgeExpiry: d(v.psv_badge_expiry),
    inspectionDate: d(v.inspection_date),
    inspectedBy: v.inspected_by,
    inPersonCheckedAt: d(v.in_person_checked_at),
    inPersonOfficer: v.in_person_officer,
    submittedAt: v.submitted_at,
    reviewedAt: v.reviewed_at,
    approvedAt: v.approved_at,
    rejectionReason: v.rejection_reason,
    suspendedReason: v.suspended_reason,
    nextRecheckAt: v.next_recheck_at,
    recheckState: v.recheck_state,
    recheckGraceUntil: v.recheck_grace_until,
  };
}

/** The driver's own view: status, what they entered, what is uploaded and what is still missing. */
async function ownView(user) {
  const v = await findRow(pool, user.userId);
  const s = await loadSettings();
  if (!v) return { started: false, externalEnabled: s.externalEnabled, minLicenceYears: s.minLicenceYears, retentionDays: s.retentionDays };
  const docs = await listDocs(pool, user.userId);
  const active = docs.filter((x) => !x.deleted_at);
  return {
    started: true,
    ...toApi(v),
    externalEnabled: s.externalEnabled,
    minLicenceYears: s.minLicenceYears,
    retentionDays: s.retentionDays,
    requiredDocs: rules.requiredDocs(v.driver_type, v.owner_relationship),
    uploaded: active.map((x) => ({ docType: x.doc_type, uploadedAt: x.uploaded_at, sizeBytes: x.size_bytes, capturedLive: x.captured_live })),
    missing: rules.missingForSubmit(v, docs, { minLicenceYears: s.minLicenceYears }),
    expiring: rules.expiringItems(v, new Date(), s.warningDays),
  };
}

// ---------------------------------------------------------------- the driver's side

const editable = (v) => ['not_started', 'rejected', 'expired'].includes(v.status);
const recheckOpen = (v) => v.status === 'approved' && v.recheck_state === 'due';

async function start({ user, driverType, consent, publicPhotoConsent = false, ip }) {
  if (!consent) throw errors.badRequest('CONSENT_REQUIRED', 'Please read and agree to the consent notice first.');
  const s = await loadSettings();
  const email = user.profile.university_email;
  const domain = email.slice(email.lastIndexOf('@') + 1);
  if (user.role === 'admin') throw errors.forbidden('FORBIDDEN_ROLE', 'Administrators cannot become drivers.');

  if (driverType === 'external') {
    if (!s.externalEnabled) throw errors.forbidden('EXTERNAL_DISABLED', 'Applications from external drivers are not open yet.');
  } else {
    const wanted = driverType === 'staff' ? 'staff' : 'student';
    const okDomain = config.allowedEmailDomains.includes(domain);
    if (user.role !== 'student' || !okDomain) {
      throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [{ field: 'driverType', message: `A ${wanted} driver needs a ${wanted} account with a university email address.` }]);
    }
    if (user.profile.person_type !== wanted) {
      throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [{ field: 'driverType', message: `Your account is a ${user.profile.person_type} account, so choose "${user.profile.person_type} driver".` }]);
    }
  }

  return withTransaction(async (client) => {
    const cur = await findRow(client, user.userId, { forUpdate: true });
    if (cur && !editable(cur)) throw errors.conflict('ALREADY_STARTED', `Your verification is ${cur.status.replace('_', ' ')}.`);
    if (!cur) {
      await client.query('INSERT INTO driver_verifications (driver_id, driver_type, consent_at, public_photo_consent) VALUES ($1, $2, now(), $3)', [user.userId, driverType, publicPhotoConsent]);
    } else {
      await client.query('UPDATE driver_verifications SET driver_type = $2, consent_at = now(), public_photo_consent = $3 WHERE driver_id = $1', [user.userId, driverType, publicPhotoConsent]);
    }
    await appendAudit(client, { userId: user.userId, action: 'verification.start', entity: 'driver_verification', entityId: user.userId, ipAddress: ip, details: { driver_id: user.userId, driver_type: driverType } });
  });
}

const DETAIL_COLUMNS = {
  licenceNumber: 'licence_number',
  licenceHolderName: 'licence_holder_name',
  licenceExpiry: 'licence_expiry',
  licenceHeldSince: 'licence_held_since',
  insuranceProvider: 'insurance_provider',
  insurancePolicyNo: 'insurance_policy_no',
  insuranceExpiry: 'insurance_expiry',
  insuranceCoversPassengers: 'insurance_covers_passengers',
  vehicleId: 'vehicle_id',
  ownerRelationship: 'owner_relationship',
  idExpiry: 'id_expiry',
  goodConductIssued: 'good_conduct_issued',
  psvBadgeNo: 'psv_badge_no',
  psvBadgeExpiry: 'psv_badge_expiry',
  inspectionDate: 'inspection_date',
  inspectedBy: 'inspected_by',
};
// A rider-side recheck may only touch the papers that can run out.
const RECHECK_FIELDS = new Set(['licenceNumber', 'licenceExpiry', 'insuranceProvider', 'insurancePolicyNo', 'insuranceExpiry', 'insuranceCoversPassengers']);

async function saveDetails({ user, details, ip }) {
  return withTransaction(async (client) => {
    const v = await findRow(client, user.userId, { forUpdate: true });
    if (!v) throw errors.conflict('NOT_STARTED', 'Start your verification first.');
    if (!editable(v) && !recheckOpen(v)) throw errors.conflict('LOCKED', `Your details cannot be changed while your verification is ${v.status.replace('_', ' ')}.`);

    const sets = [];
    const values = [user.userId];
    for (const [key, column] of Object.entries(DETAIL_COLUMNS)) {
      if (details[key] === undefined) continue;
      if (recheckOpen(v) && !RECHECK_FIELDS.has(key)) continue;
      values.push(details[key]);
      sets.push(`${column} = $${values.length}`);
    }
    if (details.vehicleId) {
      const { rows } = await client.query('SELECT 1 FROM vehicles WHERE vehicle_id = $1 AND owner_id = $2', [details.vehicleId, user.userId]);
      if (!rows[0]) throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [{ field: 'vehicleId', message: 'Choose one of your registered vehicles' }]);
    }
    // The full national ID number is read here and thrown away. Only the last four characters are kept.
    if (details.nationalId !== undefined) {
      const last4 = String(details.nationalId).replace(/[^0-9A-Za-z]/g, '').slice(-4);
      values.push(last4);
      sets.push(`national_id_last4 = $${values.length}`);
    }
    if (sets.length > 0) await client.query(`UPDATE driver_verifications SET ${sets.join(', ')} WHERE driver_id = $1`, values);
    await appendAudit(client, { userId: user.userId, action: 'verification.details', entity: 'driver_verification', entityId: user.userId, ipAddress: ip, details: { driver_id: user.userId, fields: Object.keys(details) } });
  });
}

const LIVE_ONLY = new Set(['selfie', 'selfie_head_turn']);
const RECHECK_DOCS = new Set(['licence_front', 'licence_back', 'insurance', 'selfie', 'selfie_head_turn']);

/** Checks and stores one uploaded file: real type, size, no hidden location data, hashed, audited. */
async function uploadDoc({ user, docType, buffer, capturedLive = false, ip }) {
  if (!buffer || buffer.length === 0) throw errors.badRequest('VALIDATION_ERROR', 'Choose a file to upload.');
  if (buffer.length > files.MAX_BYTES) throw errors.badRequest('FILE_TOO_LARGE', 'That file is over 5 MB.');
  const mime = files.sniffType(buffer);
  if (!mime || !files.ALLOWED.includes(mime)) throw errors.badRequest('FILE_TYPE', 'Only JPG, PNG and PDF files are accepted.');
  if (LIVE_ONLY.has(docType) && !capturedLive) throw errors.badRequest('LIVE_CAPTURE_REQUIRED', 'Take this photo with the camera, not from your files.');
  if (LIVE_ONLY.has(docType) && mime === 'application/pdf') throw errors.badRequest('FILE_TYPE', 'A selfie must be a photo.');

  const clean = files.stripMetadata(buffer, mime);
  const hash = files.sha256(clean);

  return withTransaction(async (client) => {
    const v = await findRow(client, user.userId, { forUpdate: true });
    if (!v) throw errors.conflict('NOT_STARTED', 'Start your verification first.');
    if (!editable(v) && !recheckOpen(v)) throw errors.conflict('LOCKED', 'Your documents cannot be changed while your verification is being reviewed.');
    if (!rules.requiredDocs(v.driver_type, 'parent').concat(['logbook', 'owner_letter']).includes(docType)) {
      throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [{ field: 'docType', message: `A ${v.driver_type} driver does not upload this document` }]);
    }
    if (recheckOpen(v) && !RECHECK_DOCS.has(docType)) throw errors.conflict('LOCKED', 'Only your licence, insurance and selfie are re-checked.');

    const key = `${user.userId}/${docType}-${crypto.randomUUID()}`;
    await provider().put(key, clean);
    const { rows: old } = await client.query('SELECT doc_id, storage_key FROM verification_documents WHERE driver_id = $1 AND doc_type = $2 AND deleted_at IS NULL', [user.userId, docType]);
    for (const o of old) {
      await client.query(`UPDATE verification_documents SET deleted_at = now(), deleted_reason = 'replaced' WHERE doc_id = $1`, [o.doc_id]);
      await provider().delete(o.storage_key);
    }
    const { rows } = await client.query(
      `INSERT INTO verification_documents (driver_id, doc_type, storage_key, mime_type, size_bytes, sha256, captured_live)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING doc_id`,
      [user.userId, docType, key, mime, clean.length, hash, capturedLive],
    );
    // The type and hash go in the log, never the contents.
    await appendAudit(client, { userId: user.userId, action: 'verification.doc_uploaded', entity: 'verification_document', entityId: rows[0].doc_id, ipAddress: ip, details: { driver_id: user.userId, doc_type: docType, sha256: hash } });
    return { docId: rows[0].doc_id, docType, sizeBytes: clean.length, sha256Prefix: hash.slice(0, 12) };
  });
}

async function submit({ user, ip }) {
  const s = await loadSettings();
  return withTransaction(async (client) => {
    const v = await findRow(client, user.userId, { forUpdate: true });
    if (!v) throw errors.conflict('NOT_STARTED', 'Start your verification first.');
    const isRecheck = recheckOpen(v);
    if (!editable(v) && !isRecheck) throw errors.conflict('LOCKED', `Your verification is already ${v.status.replace('_', ' ')}.`);
    if (!isRecheck && !rules.canTransition(v.status, 'pending_review')) throw errors.conflict('LOCKED', 'This cannot be submitted now.');

    const docs = await listDocs(client, user.userId);
    const missing = rules.missingForSubmit(v, docs, { minLicenceYears: s.minLicenceYears });
    if (missing.length > 0) throw errors.badRequest('VERIFICATION_INCOMPLETE', 'Some things are missing.', missing.map((m) => ({ field: 'submit', message: m })));

    if (isRecheck) {
      await client.query(`UPDATE driver_verifications SET recheck_state = 'submitted', submitted_at = now() WHERE driver_id = $1`, [user.userId]);
    } else {
      await client.query(`UPDATE driver_verifications SET status = 'pending_review', submitted_at = now(), rejection_reason = NULL WHERE driver_id = $1`, [user.userId]);
    }
    await appendAudit(client, { userId: user.userId, action: isRecheck ? 'verification.recheck_submit' : 'verification.submit', entity: 'driver_verification', entityId: user.userId, ipAddress: ip, details: { driver_id: user.userId, driver_type: v.driver_type } });
    await notifyMany(client, await adminIds(client), {
      type: 'verification.submitted',
      message: `${user.profile.full_name} sent a ${v.driver_type} driver ${isRecheck ? 're-check' : 'verification'} for review.`,
      link: '/admin?tab=verification',
      email: true,
    });
  });
}

// ---------------------------------------------------------------- the admin's side

const queueColumns = `v.driver_id, v.driver_type, v.status, v.submitted_at, v.recheck_state, u.full_name, u.university_email,
  round(EXTRACT(EPOCH FROM (now() - v.submitted_at)) / 3600)::int AS waiting_hours`;

async function queue(status) {
  const { rows } = await pool.query(
    `SELECT ${queueColumns} FROM driver_verifications v JOIN users u ON u.user_id = v.driver_id
      WHERE ($1::text IS NULL AND (v.status = 'pending_review' OR v.recheck_state = 'submitted'))
         OR ($1::text IS NOT NULL AND v.status = $1)
      ORDER BY v.submitted_at NULLS LAST`,
    [status || null],
  );
  return rows.map((r) => ({
    driverId: r.driver_id,
    name: r.full_name,
    email: r.university_email,
    driverType: r.driver_type,
    typeLabel: rules.TYPE_LABEL[r.driver_type],
    status: r.status,
    recheck: r.recheck_state === 'submitted',
    submittedAt: r.submitted_at,
    waitingHours: r.waiting_hours,
  }));
}

async function latestChecks(db, driverId) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (item) item, result, note, created_at, reviewer_id FROM verification_checks WHERE driver_id = $1 ORDER BY item, created_at DESC`,
    [driverId],
  );
  return rows;
}

async function flagsFor(db, v, user, settings) {
  const { rows: reused } = await db.query(
    `SELECT DISTINCT u.full_name FROM verification_documents d JOIN users u ON u.user_id = d.driver_id
      WHERE d.driver_id <> $1 AND d.sha256 IN (SELECT sha256 FROM verification_documents WHERE driver_id = $1 AND deleted_at IS NULL)`,
    [v.driver_id],
  );
  let plateTakenBy = null;
  if (v.vehicle_id) {
    const { rows } = await db.query(
      `SELECT u.full_name FROM vehicles mine JOIN vehicles other ON other.plate_number = mine.plate_number AND other.owner_id <> mine.owner_id
         JOIN users u ON u.user_id = other.owner_id WHERE mine.vehicle_id = $1 LIMIT 1`,
      [v.vehicle_id],
    );
    plateTakenBy = rows[0]?.full_name ?? null;
  }
  return rules.reviewFlags(v, { accountName: user.full_name, hashReusedBy: reused.map((r) => r.full_name), plateTakenBy }, { warningDays: settings.warningDays, minLicenceYears: settings.minLicenceYears });
}

async function detail(driverId) {
  const v = await findRow(pool, driverId);
  if (!v) throw errors.notFound('Verification not found.');
  const { rows: u } = await pool.query('SELECT user_id, full_name, university_email, phone_number, avg_rating FROM users WHERE user_id = $1', [driverId]);
  const { rows: veh } = v.vehicle_id ? await pool.query('SELECT make_model, plate_number, colour, seat_capacity FROM vehicles WHERE vehicle_id = $1', [v.vehicle_id]) : { rows: [] };
  const s = await loadSettings();
  const docs = await listDocs(pool, driverId);
  const checks = await latestChecks(pool, driverId);
  return {
    driver: { userId: u[0].user_id, name: u[0].full_name, email: u[0].university_email, phone: u[0].phone_number, rating: Number(u[0].avg_rating) },
    verification: toApi(v),
    vehicle: veh[0] ? { makeModel: veh[0].make_model, plateNumber: veh[0].plate_number, colour: veh[0].colour, seats: veh[0].seat_capacity } : null,
    documents: docs.map((d) => ({ docId: d.doc_id, docType: d.doc_type, mimeType: d.mime_type, sizeBytes: d.size_bytes, sha256Prefix: d.sha256.slice(0, 12), capturedLive: d.captured_live, uploadedAt: d.uploaded_at, deleted: Boolean(d.deleted_at), deletedReason: d.deleted_reason })),
    flags: await flagsFor(pool, v, u[0], s),
    checklist: rules.checklistFor(v.driver_type).map((item) => {
      const c = checks.find((x) => x.item === item);
      return { item, result: c?.result ?? null, note: c?.note ?? null, at: c?.created_at ?? null };
    }),
    missing: rules.missingForSubmit(v, docs, { minLicenceYears: s.minLicenceYears }),
    needsSeniorAdmin: v.driver_type === 'external',
  };
}

async function recordCheck({ admin, driverId, item, result, note, ip }) {
  return withTransaction(async (client) => {
    const v = await findRow(client, driverId, { forUpdate: true });
    if (!v) throw errors.notFound('Verification not found.');
    if (v.status !== 'pending_review' && v.recheck_state !== 'submitted') throw errors.conflict('NOT_PENDING', 'This driver is not waiting for review.');
    if (!rules.checklistFor(v.driver_type).includes(item)) throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [{ field: 'item', message: 'Not an item on this checklist' }]);
    await client.query('INSERT INTO verification_checks (driver_id, reviewer_id, item, result, note) VALUES ($1, $2, $3, $4, $5)', [driverId, admin.userId, item, result, note || null]);
    await appendAudit(client, { userId: admin.userId, action: 'verification.check', entity: 'driver_verification', entityId: driverId, ipAddress: ip, details: { driver_id: driverId, item, result } });
  });
}

/** The in-person check at campus security: who did it and when. Required for external drivers. */
async function recordInPerson({ admin, driverId, date, officer, ip }) {
  return withTransaction(async (client) => {
    const v = await findRow(client, driverId, { forUpdate: true });
    if (!v) throw errors.notFound('Verification not found.');
    await client.query('UPDATE driver_verifications SET in_person_checked_at = $2, in_person_officer = $3 WHERE driver_id = $1', [driverId, date, officer]);
    await appendAudit(client, { userId: admin.userId, action: 'verification.in_person', entity: 'driver_verification', entityId: driverId, ipAddress: ip, details: { driver_id: driverId, officer, date } });
  });
}

async function approve({ admin, driverId, ip }) {
  const s = await loadSettings();
  const out = await withTransaction(async (client) => {
    const v = await findRow(client, driverId, { forUpdate: true });
    if (!v) throw errors.notFound('Verification not found.');
    const isRecheck = v.status === 'approved' && v.recheck_state === 'submitted';
    if (v.status !== 'pending_review' && !isRecheck) throw errors.conflict('NOT_PENDING', 'This driver is not waiting for review.');

    if (v.driver_type === 'external') {
      if (admin.adminLevel !== 'senior_admin') throw errors.forbidden('SENIOR_ADMIN_REQUIRED', 'External drivers can only be approved by a senior administrator.');
      if (!s.externalEnabled) throw errors.forbidden('EXTERNAL_DISABLED', 'The external driver track is switched off.');
      if (!v.in_person_checked_at) throw errors.conflict('IN_PERSON_REQUIRED', 'Record the in-person check at campus security first.');
    }
    const docs = await listDocs(client, driverId);
    const missing = rules.missingForSubmit(v, docs, { minLicenceYears: s.minLicenceYears });
    if (missing.length > 0) throw errors.conflict('VERIFICATION_INCOMPLETE', `Not complete: ${missing[0]}.`, missing.map((m) => ({ field: 'approve', message: m })));

    // A re-check needs fresh decisions: results from before the driver re-submitted do not count.
    const checks = (await latestChecks(client, driverId)).filter((c) => !isRecheck || new Date(c.created_at) >= new Date(v.submitted_at));
    const latest = Object.fromEntries(checks.map((c) => [c.item, c.result]));
    const required = isRecheck ? ['identity_matches_selfie', 'licence_valid', 'insurance_valid'] : rules.checklistFor(v.driver_type);
    const failed = required.filter((i) => latest[i] !== 'pass');
    if (failed.length > 0) throw errors.conflict('CHECKLIST_INCOMPLETE', `Every checklist item must pass first. Still open: ${failed.join(', ')}.`, failed.map((f) => ({ field: f, message: 'Not marked as passed' })));

    const next = rules.addMonths(new Date(), s.recheckMonths);
    await client.query(
      `UPDATE driver_verifications SET status = 'approved', approved_at = COALESCE(approved_at, now()), reviewed_by = $2, reviewed_at = now(), rejection_reason = NULL,
              next_recheck_at = $3, recheck_state = 'none', recheck_grace_until = NULL, reminders_sent = '{}'::jsonb WHERE driver_id = $1`,
      [driverId, admin.userId, next],
    );
    await appendAudit(client, { userId: admin.userId, action: isRecheck ? 'verification.recheck_approve' : 'verification.approve', entity: 'driver_verification', entityId: driverId, ipAddress: ip, details: { driver_id: driverId, driver_type: v.driver_type } });
    const unclaimed = (await client.query('SELECT 1 FROM driver_applicants WHERE user_id = $1 AND claimed_at IS NULL', [driverId])).rowCount > 0;
    await notify(client, {
      userId: driverId,
      type: 'verification.approved',
      message: isRecheck ? 'Your re-check was approved. You stay verified.' : unclaimed ? 'Your driver application was approved. Create your RideMate driver account with this same email address to start driving.' : 'You are now a Verified Driver. You can go online and take ride requests.',
      link: unclaimed ? '/signup/driver' : '/drive/dashboard',
      email: true,
    });
    return { type: v.driver_type };
  });
  return out;
}

async function reject({ admin, driverId, reason, ip }) {
  if (!reason || reason.trim().length < 5) throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [{ field: 'reason', message: 'Write the reason (at least 5 characters). The driver sees it.' }]);
  return withTransaction(async (client) => {
    const v = await findRow(client, driverId, { forUpdate: true });
    if (!v) throw errors.notFound('Verification not found.');
    const isRecheck = v.status === 'approved' && v.recheck_state === 'submitted';
    if (v.status !== 'pending_review' && !isRecheck) throw errors.conflict('NOT_PENDING', 'This driver is not waiting for review.');
    if (isRecheck) {
      await client.query(`UPDATE driver_verifications SET recheck_state = 'due', rejection_reason = $2, reviewed_by = $3, reviewed_at = now() WHERE driver_id = $1`, [driverId, reason.trim(), admin.userId]);
    } else {
      await client.query(`UPDATE driver_verifications SET status = 'rejected', rejection_reason = $2, reviewed_by = $3, reviewed_at = now() WHERE driver_id = $1`, [driverId, reason.trim(), admin.userId]);
    }
    await appendAudit(client, { userId: admin.userId, action: 'verification.reject', entity: 'driver_verification', entityId: driverId, ipAddress: ip, details: { driver_id: driverId, reason: reason.trim() } });
    await notify(client, { userId: driverId, type: 'verification.rejected', message: `Your driver verification was not approved. Reason: ${reason.trim()} You can fix it and send it again.`, link: '/', email: true });
  });
}

/** Takes a driver offline straight away. Used by suspension and expiry. */
async function forceOffline(client, driverId) {
  await client.query('UPDATE driver_status SET is_online = false, current_location = NULL, heading = NULL WHERE driver_id = $1', [driverId]);
  await client.query(`UPDATE dispatch_offers SET expires_at = now() WHERE driver_id = $1 AND response IS NULL`, [driverId]);
}

async function suspend({ admin, driverId, reason, auto = false, ip }) {
  if (!reason || reason.trim().length < 5) throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [{ field: 'reason', message: 'Write the reason (at least 5 characters).' }]);
  const done = await withTransaction(async (client) => {
    const v = await findRow(client, driverId, { forUpdate: true });
    if (!v) throw errors.notFound('Verification not found.');
    if (!rules.canTransition(v.status, 'suspended')) throw errors.conflict('NOT_APPROVED', 'Only an approved driver can be suspended.');
    await client.query(`UPDATE driver_verifications SET status = 'suspended', suspended_reason = $2, suspended_at = now() WHERE driver_id = $1`, [driverId, reason.trim()]);
    await forceOffline(client, driverId);
    await appendAudit(client, { userId: auto ? null : admin.userId, action: auto ? 'verification.auto_suspend' : 'verification.suspend', entity: 'driver_verification', entityId: driverId, ipAddress: ip, details: { driver_id: driverId, reason: reason.trim() } });
    await notify(client, { userId: driverId, type: 'verification.suspended', message: `Your driver status was suspended. Reason: ${reason.trim()}`, link: '/', email: true });
    if (auto) {
      await notifyMany(client, await adminIds(client), { type: 'verification.auto_suspended', message: `A driver was suspended automatically (${reason.trim()}). Please review the case.`, link: `/admin?tab=verification&driver=${driverId}`, email: true });
    }
    return true;
  });
  require('./dispatch').sweepExpiredOffers().catch(() => {});
  return done;
}

async function reinstate({ admin, driverId, ip }) {
  return withTransaction(async (client) => {
    const v = await findRow(client, driverId, { forUpdate: true });
    if (!v) throw errors.notFound('Verification not found.');
    if (v.status !== 'suspended') throw errors.conflict('NOT_SUSPENDED', 'This driver is not suspended.');
    const gone = rules.expiredItems(v, new Date());
    const status = gone.length > 0 ? 'expired' : 'approved';
    await client.query(`UPDATE driver_verifications SET status = $2, suspended_reason = NULL WHERE driver_id = $1`, [driverId, status]);
    await appendAudit(client, { userId: admin.userId, action: 'verification.reinstate', entity: 'driver_verification', entityId: driverId, ipAddress: ip, details: { driver_id: driverId, result: status } });
    await notify(client, { userId: driverId, type: 'verification.reinstated', message: status === 'approved' ? 'Your driver status was restored.' : 'Your suspension was lifted, but a document has expired. Update it to drive again.', link: '/', email: true });
    return status;
  });
}

// ---------------------------------------------------------------- documents

/** An admin asks to see a file: logged by name, and the link works for 5 minutes. */
async function documentUrl({ admin, docId, ip }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT doc_id, driver_id, doc_type, deleted_at FROM verification_documents WHERE doc_id = $1', [docId]);
    const d = rows[0];
    if (!d) throw errors.notFound('Document not found.');
    if (d.deleted_at) throw errors.conflict('DOC_DELETED', 'This file was deleted under the retention rule. Its hash is kept.');
    await appendAudit(client, { userId: admin.userId, action: 'verification.doc_viewed', entity: 'verification_document', entityId: docId, ipAddress: ip, details: { doc_id: docId, driver_id: d.driver_id, doc_type: d.doc_type, viewer_id: admin.userId } });
    return provider().signedUrl(docId, admin.userId);
  });
}

/** Serves a file for a valid signed link, and for nobody else. */
async function serveDocument(docId, query) {
  if (!provider().verify(docId, query)) throw errors.forbidden('LINK_INVALID', 'This link has expired or is not valid.');
  const { rows } = await pool.query('SELECT storage_key, mime_type, deleted_at FROM verification_documents WHERE doc_id = $1', [docId]);
  if (!rows[0] || rows[0].deleted_at) throw errors.notFound('Document not found.');
  return { buffer: await provider().read(rows[0].storage_key), mime: rows[0].mime_type };
}

// ---------------------------------------------------------------- who may drive right now

async function findForDriving(db, driverId) {
  const { rows } = await db.query('SELECT * FROM driver_verifications WHERE driver_id = $1', [driverId]);
  return rows[0] || null;
}

/** Throws unless the driver is approved with valid papers. Returns the verified vehicle. */
async function assertCanDrive(db, driverId, now = new Date()) {
  const v = await findForDriving(db, driverId);
  const s = await loadSettings(db);
  const r = rules.driveEligibility(v, { now, externalEnabled: s.externalEnabled });
  if (!r.ok) {
    const messages = {
      not_verified: 'Become a verified driver first.',
      not_started: 'Finish your driver verification first.',
      pending_review: 'Your verification is still being reviewed.',
      rejected: 'Your verification was not approved. Fix it and send it again.',
      expired: 'Your driver verification has expired. Update your documents.',
      suspended: 'Your driver status is suspended.',
      external_disabled: 'External drivers are not accepted right now.',
      no_vehicle: 'Choose a vehicle in your verification first.',
    };
    throw errors.forbidden('DRIVER_NOT_VERIFIED', messages[r.reason] || `A document has expired (${r.reason.replace('_', ' ')}). Update it to drive again.`, [{ field: 'reason', message: r.reason }]);
  }
  return v;
}

/** A random share of go-online attempts need a quick live selfie first. */
async function selfieRequired(db, driverId, selfieCheckId) {
  const s = await loadSettings(db);
  if (selfieCheckId) {
    const { rows } = await db.query(
      `UPDATE selfie_checks SET used_at = now() WHERE check_id = $1 AND driver_id = $2 AND used_at IS NULL AND created_at > now() - make_interval(mins => $3) RETURNING check_id`,
      [selfieCheckId, driverId, SELFIE_CHECK_VALID_MINUTES],
    );
    if (rows[0]) return false;
  }
  return Math.random() * 100 < s.selfiePercent;
}

async function submitRecheckSelfie({ user, buffer, ip }) {
  const mime = files.sniffType(buffer);
  if (!mime || mime === 'application/pdf') throw errors.badRequest('FILE_TYPE', 'A selfie must be a JPG or PNG photo.');
  if (buffer.length > files.MAX_BYTES) throw errors.badRequest('FILE_TOO_LARGE', 'That file is over 5 MB.');
  const clean = files.stripMetadata(buffer, mime);
  const hash = files.sha256(clean);
  return withTransaction(async (client) => {
    const key = `${user.userId}/selfie_recheck-${crypto.randomUUID()}`;
    await provider().put(key, clean);
    const { rows } = await client.query(
      `INSERT INTO verification_documents (driver_id, doc_type, storage_key, mime_type, size_bytes, sha256, captured_live) VALUES ($1, 'selfie_recheck', $2, $3, $4, $5, true) RETURNING doc_id`,
      [user.userId, key, mime, clean.length, hash],
    );
    const { rows: c } = await client.query('INSERT INTO selfie_checks (driver_id, doc_id) VALUES ($1, $2) RETURNING check_id', [user.userId, rows[0].doc_id]);
    await appendAudit(client, { userId: user.userId, action: 'verification.selfie_recheck', entity: 'selfie_check', entityId: c[0].check_id, ipAddress: ip, details: { driver_id: user.userId, doc_id: rows[0].doc_id, sha256: hash } });
    return { checkId: c[0].check_id };
  });
}

async function listSelfieChecks(status) {
  const { rows } = await pool.query(
    `SELECT c.check_id, c.status, c.created_at, c.doc_id, u.full_name, u.user_id,
            (SELECT d.doc_id FROM verification_documents d WHERE d.driver_id = c.driver_id AND d.doc_type = 'selfie' AND d.deleted_at IS NULL) AS original_doc
       FROM selfie_checks c JOIN users u ON u.user_id = c.driver_id WHERE ($1::text IS NULL OR c.status = $1) ORDER BY c.created_at DESC LIMIT 100`,
    [status || null],
  );
  return rows.map((r) => ({ checkId: r.check_id, status: r.status, createdAt: r.created_at, docId: r.doc_id, originalDocId: r.original_doc, driverId: r.user_id, name: r.full_name }));
}

async function reviewSelfieCheck({ admin, checkId, status, ip }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('UPDATE selfie_checks SET status = $2, reviewed_by = $3 WHERE check_id = $1 RETURNING driver_id', [checkId, status, admin.userId]);
    if (!rows[0]) throw errors.notFound('Check not found.');
    await appendAudit(client, { userId: admin.userId, action: `verification.selfie_${status}`, entity: 'selfie_check', entityId: checkId, ipAddress: ip, details: { check_id: checkId, driver_id: rows[0].driver_id } });
  });
}

// ---------------------------------------------------------------- the public "Verified driver" page

async function publicDriver(token) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { verified: false };
  const { rows } = await pool.query(
    `SELECT v.status, v.driver_type, v.public_photo_consent, u.full_name, veh.plate_number, veh.make_model, veh.colour,
            (SELECT d.doc_id FROM verification_documents d WHERE d.driver_id = v.driver_id AND d.doc_type = 'selfie' AND d.deleted_at IS NULL) AS photo_doc
       FROM driver_verifications v JOIN users u ON u.user_id = v.driver_id LEFT JOIN vehicles veh ON veh.vehicle_id = v.vehicle_id WHERE v.qr_token = $1`,
    [token],
  );
  const r = rows[0];
  if (!r || r.status !== 'approved') return { verified: false };
  const out = { verified: true, firstName: r.full_name.split(' ')[0], typeLabel: rules.TYPE_LABEL[r.driver_type], plateNumber: r.plate_number, car: `${r.colour} ${r.make_model}` };
  // The photo is shown only if the driver agreed, and only through a 5-minute link.
  if (r.public_photo_consent && r.photo_doc) out.photoUrl = provider().signedUrl(r.photo_doc, 'public').url;
  return out;
}

// ---------------------------------------------------------------- staying verified

async function suspendIfUnsafe(driverId) {
  const s = await loadSettings();
  const { rows } = await pool.query(
    `SELECT v.status, u.avg_rating, (SELECT count(*)::int FROM ratings x WHERE x.ratee_id = u.user_id) AS n,
            (SELECT count(*)::int FROM incident_reports i WHERE i.reported_user_id = u.user_id AND i.status <> 'closed') AS incidents
       FROM driver_verifications v JOIN users u ON u.user_id = v.driver_id WHERE v.driver_id = $1`,
    [driverId],
  );
  const r = rows[0];
  if (!r || r.status !== 'approved') return false;
  let reason = null;
  if (r.n >= s.autoSuspendMinRatings && Number(r.avg_rating) < s.autoSuspendRating) reason = `Average rating ${Number(r.avg_rating).toFixed(1)} is below ${s.autoSuspendRating} after ${r.n} ratings.`;
  else if (r.incidents >= s.autoSuspendIncidents) reason = `${r.incidents} open incident reports.`;
  if (!reason) return false;
  await suspend({ admin: null, driverId, reason, auto: true }).catch(() => {});
  return true;
}

async function expireDriver(client, v, items) {
  await client.query(`UPDATE driver_verifications SET status = 'expired' WHERE driver_id = $1`, [v.driver_id]);
  await forceOffline(client, v.driver_id);
  await appendAudit(client, { userId: null, action: 'verification.expire', entity: 'driver_verification', entityId: v.driver_id, details: { driver_id: v.driver_id, items } });
  await notify(client, { userId: v.driver_id, type: 'verification.expired', message: `Your driver verification has expired (${items.join(', ').replace(/_/g, ' ')}). Update your documents to drive again.`, link: '/', email: true });
}

/**
 * The daily jobs: expire what ran out, remind before it does, ask for re-checks, delete old files, and suspend
 * drivers whose ratings or incident reports cross the limits. Safe to run as often as you like.
 */
async function runJobs(now = new Date()) {
  const s = await loadSettings();
  const out = { expired: 0, reminded: 0, rechecksDue: 0, filesDeleted: 0, suspended: 0 };

  // 1. Expiry: a paper ran out, a university ID or email stopped working, or the re-check grace period ended.
  const { rows: approved } = await pool.query(
    `SELECT v.*, u.university_email FROM driver_verifications v JOIN users u ON u.user_id = v.driver_id WHERE v.status = 'approved'`,
  );
  for (const v of approved) {
    const items = rules.expiredItems(v, now);
    if (v.driver_type !== 'external') {
      const email = v.university_email;
      if (!config.allowedEmailDomains.includes(email.slice(email.lastIndexOf('@') + 1))) items.push('university_email');
    }
    if (v.recheck_state === 'due' && v.recheck_grace_until && new Date(v.recheck_grace_until) < now) items.push('recheck');
    if (items.length > 0) {
      await withTransaction((c) => expireDriver(c, v, items));
      out.expired += 1;
    }
  }
  require('./dispatch').sweepExpiredOffers().catch(() => {});

  // 2. Reminders, once per item and date.
  const { rows: still } = await pool.query(`SELECT * FROM driver_verifications WHERE status = 'approved'`);
  for (const v of still) {
    const sent = { ...(v.reminders_sent || {}) };
    let changed = false;
    for (const { item, date } of rules.expiringItems(v, now, s.warningDays)) {
      if (sent[item] === date) continue;
      await withTransaction((c) => notify(c, { userId: v.driver_id, type: 'verification.expiring', message: `Your ${item.replace('_', ' ')} runs out on ${date}. Update it so you can keep driving.`, link: '/', email: true }));
      sent[item] = date;
      changed = true;
      out.reminded += 1;
    }
    if (changed) await pool.query('UPDATE driver_verifications SET reminders_sent = $2 WHERE driver_id = $1', [v.driver_id, JSON.stringify(sent)]);
  }

  // 3. Re-checks come due every few months, with a grace period during which the driver stays approved.
  const { rows: due } = await pool.query(`SELECT driver_id FROM driver_verifications WHERE status = 'approved' AND recheck_state = 'none' AND next_recheck_at <= $1`, [now]);
  for (const d of due) {
    await withTransaction(async (c) => {
      await c.query(`UPDATE driver_verifications SET recheck_state = 'due', recheck_grace_until = $2 WHERE driver_id = $1`, [d.driver_id, rules.addDays(now, RECHECK_GRACE_DAYS)]);
      await appendAudit(c, { userId: null, action: 'verification.recheck_due', entity: 'driver_verification', entityId: d.driver_id, details: { driver_id: d.driver_id, grace_days: RECHECK_GRACE_DAYS } });
      await notify(c, { userId: d.driver_id, type: 'verification.recheck', message: `Time for your periodic re-check. Upload your licence, insurance and a selfie within ${RECHECK_GRACE_DAYS} days. You can keep driving meanwhile.`, link: '/', email: true });
    });
    out.rechecksDue += 1;
  }

  // 4. Retention: delete the files, keep the hashes, dates and checklist results.
  const { rows: old } = await pool.query(
    `SELECT d.doc_id, d.driver_id, d.storage_key, v.status FROM verification_documents d JOIN driver_verifications v ON v.driver_id = d.driver_id
      WHERE d.deleted_at IS NULL AND (
            (v.status = 'approved' AND v.approved_at + make_interval(days => $1) <= $3 AND d.doc_type <> 'selfie_recheck')
         OR (v.status = 'rejected' AND v.reviewed_at + make_interval(days => $2) <= $3)
         OR (d.doc_type = 'selfie_recheck' AND d.uploaded_at + make_interval(days => $2) <= $3))`,
    [s.retentionDays, REJECTED_RETENTION_DAYS, now],
  );
  for (const d of old) {
    await provider().delete(d.storage_key);
    await pool.query(`UPDATE verification_documents SET deleted_at = $2, deleted_reason = 'retention' WHERE doc_id = $1`, [d.doc_id, now]);
    out.filesDeleted += 1;
  }
  const drivers = [...new Set(old.map((d) => d.driver_id))];
  for (const id of drivers) {
    await withTransaction((c) => appendAudit(c, { userId: null, action: 'verification.retention', entity: 'driver_verification', entityId: id, details: { driver_id: id, files: old.filter((d) => d.driver_id === id).length } }));
  }

  // 5. Automatic suspension.
  for (const v of still) if (await suspendIfUnsafe(v.driver_id)) out.suspended += 1;
  return out;
}

module.exports = {
  loadSettings, findRow, ownView, toApi, start, saveDetails, uploadDoc, submit,
  queue, detail, recordCheck, recordInPerson, approve, reject, suspend, reinstate,
  documentUrl, serveDocument, assertCanDrive, selfieRequired, submitRecheckSelfie, listSelfieChecks, reviewSelfieCheck,
  publicDriver, suspendIfUnsafe, runJobs, forceOffline,
};
