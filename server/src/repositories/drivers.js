const { pool } = require('../db/pool');

async function createApplication(db, userId, { licenceNumber, idNumber, about }) {
  const { rows } = await db.query(
    `INSERT INTO driver_applications (user_id, licence_number, id_number, about)
     VALUES ($1, $2, $3, $4) RETURNING application_id`,
    [userId, licenceNumber, idNumber, about || null],
  );
  return rows[0];
}

const SELECT = `
  a.application_id, a.user_id, a.licence_number, a.id_number, a.about, a.status, a.admin_notes, a.reviewed_at, a.created_at,
  u.full_name, u.university_email AS email, u.phone_number, u.status AS account_status`;

const toApi = (a) => ({
  applicationId: a.application_id,
  userId: a.user_id,
  fullName: a.full_name,
  email: a.email,
  phoneNumber: a.phone_number,
  accountStatus: a.account_status,
  licenceNumber: a.licence_number,
  idNumber: a.id_number,
  about: a.about,
  status: a.status,
  adminNotes: a.admin_notes,
  reviewedAt: a.reviewed_at,
  createdAt: a.created_at,
});

async function findByUser(userId, db = pool) {
  const { rows } = await db.query(`SELECT ${SELECT} FROM driver_applications a JOIN users u ON u.user_id = a.user_id WHERE a.user_id = $1`, [userId]);
  return rows[0] ? toApi(rows[0]) : null;
}

async function list(status, db = pool) {
  const { rows } = await db.query(
    `SELECT ${SELECT} FROM driver_applications a JOIN users u ON u.user_id = a.user_id
      WHERE ($1::text IS NULL OR a.status = $1) ORDER BY (a.status = 'pending') DESC, a.created_at DESC LIMIT 200`,
    [status],
  );
  return rows.map(toApi);
}

/** Locks an application so two admins cannot decide it at once. */
async function findForUpdate(db, applicationId) {
  const { rows } = await db.query('SELECT * FROM driver_applications WHERE application_id = $1 FOR UPDATE', [applicationId]);
  return rows[0] || null;
}

async function decide(db, applicationId, { status, notes, adminId }) {
  await db.query(
    `UPDATE driver_applications SET status = $2, admin_notes = $3, reviewed_by = $4, reviewed_at = now() WHERE application_id = $1`,
    [applicationId, status, notes || null, adminId],
  );
}

/** A rejected driver may fix their details and apply again. */
async function resubmit(db, userId, { licenceNumber, idNumber, about }) {
  const { rows } = await db.query(
    `UPDATE driver_applications
        SET licence_number = $2, id_number = $3, about = $4, status = 'pending', admin_notes = NULL, reviewed_by = NULL, reviewed_at = NULL
      WHERE user_id = $1 AND status = 'rejected' RETURNING application_id`,
    [userId, licenceNumber, idNumber, about || null],
  );
  return rows[0] || null;
}

module.exports = { createApplication, findByUser, list, findForUpdate, decide, resubmit };
