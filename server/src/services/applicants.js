// External driver applications: people with no RideMate account yet who apply to drive.
// They get a reference code (shown once, kept by them) that lets them fill in and track the application.
const crypto = require('node:crypto');
const { pool, withTransaction } = require('../db/pool');
const { errors } = require('../lib/errors');
const { emailKind } = require('../lib/emailDomain');
const { appendAudit } = require('./audit');

const PLACEHOLDER = 'applicant:';
const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newToken = () => `RM-${crypto.randomBytes(10).toString('hex').toUpperCase().match(/.{5}/g).join('-')}`;

async function externalOpen(db = pool) {
  const { rows } = await db.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'external_drivers_enabled'`);
  return rows[0]?.setting_value === 'true';
}

/** Starts an application. Returns the reference code, which is not stored in plain text anywhere. */
async function create({ email, fullName, phoneNumber, config, ip }) {
  const address = String(email).trim().toLowerCase();
  if (emailKind(address, config) !== 'driver') {
    throw errors.badRequest('NOT_EXTERNAL', 'University email addresses are for students and staff: sign up for a student or staff account instead. Use a personal email to apply as an external driver.');
  }
  if (!(await externalOpen())) throw errors.forbidden('EXTERNAL_CLOSED', 'Applications from external drivers are closed right now.');
  const token = newToken();
  return withTransaction(async (client) => {
    const { rows: taken } = await client.query('SELECT user_id, firebase_uid FROM users WHERE university_email = $1', [address]);
    if (taken[0]) {
      throw errors.conflict(
        taken[0].firebase_uid.startsWith(PLACEHOLDER) ? 'APPLICATION_EXISTS' : 'EMAIL_TAKEN',
        taken[0].firebase_uid.startsWith(PLACEHOLDER) ? 'You have already applied with this email. Enter your reference code to continue.' : 'This email already has a RideMate account. Log in instead.',
      );
    }
    const { rows } = await client.query(
      `INSERT INTO users (firebase_uid, university_email, full_name, phone_number, faculty, role, person_type, is_verified)
       VALUES ($1, $2, $3, $4, 'Driver', 'driver', 'student', false) RETURNING user_id`,
      [`${PLACEHOLDER}${crypto.randomUUID()}`, address, fullName, phoneNumber],
    );
    const userId = rows[0].user_id;
    await client.query(`INSERT INTO driver_verifications (driver_id, driver_type) VALUES ($1, 'external')`, [userId]);
    await client.query('INSERT INTO driver_applicants (user_id, token_hash) VALUES ($1, $2)', [userId, hash(token)]);
    await appendAudit(client, { userId, action: 'applicant.create', entity: 'user', entityId: userId, ipAddress: ip, details: { email_domain: address.slice(address.lastIndexOf('@') + 1) } });
    return { token };
  });
}

/** The unclaimed applicant behind a reference code, or null. */
async function byToken(token, db = pool) {
  if (!token) return null;
  const { rows } = await db.query(
    `SELECT u.user_id, u.role, u.university_email, u.full_name, u.phone_number FROM driver_applicants a JOIN users u ON u.user_id = a.user_id
     WHERE a.token_hash = $1 AND a.claimed_at IS NULL AND u.firebase_uid LIKE 'applicant:%'`,
    [hash(String(token).trim().toUpperCase())],
  );
  return rows[0] || null;
}

/** Where an email's application stands: 'none', or the verification status of its unclaimed applicant. */
async function statusForEmail(email, db = pool) {
  const { rows } = await db.query(
    `SELECT v.status FROM driver_applicants a JOIN users u ON u.user_id = a.user_id JOIN driver_verifications v ON v.driver_id = a.user_id
     WHERE u.university_email = $1 AND a.claimed_at IS NULL`,
    [String(email).toLowerCase()],
  );
  return rows[0]?.status || 'none';
}

/** The approved application for this email, if one is waiting to be turned into an account. */
async function approvedFor(email, db = pool) {
  return (await statusForEmail(email, db)) === 'approved';
}

/** Turns the approved application into the real account: the new sign-in id replaces the placeholder. */
async function claim(client, { email, firebaseUid, fullName, phoneNumber }) {
  const { rows } = await client.query(
    `UPDATE users u SET firebase_uid = $1, full_name = $2, phone_number = $3, is_verified = true
     FROM driver_applicants a
     WHERE a.user_id = u.user_id AND u.university_email = $4 AND a.claimed_at IS NULL AND u.firebase_uid LIKE 'applicant:%'
     RETURNING u.user_id`,
    [firebaseUid, fullName, phoneNumber, String(email).toLowerCase()],
  );
  if (!rows[0]) return null;
  await client.query('UPDATE driver_applicants SET claimed_at = now() WHERE user_id = $1', [rows[0].user_id]);
  await appendAudit(client, { userId: rows[0].user_id, action: 'applicant.claim', entity: 'user', entityId: rows[0].user_id, details: { firebase_uid: firebaseUid } });
  return rows[0].user_id;
}

module.exports = { create, byToken, statusForEmail, approvedFor, claim, PLACEHOLDER };
