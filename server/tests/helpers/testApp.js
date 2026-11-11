const request = require('supertest');
const { createApp } = require('../../src/app');
const { pool } = require('../../src/db/pool');
const { tokenFor, fakeVerifyIdToken } = require('./fakeAuth');

const app = createApp({ verifyIdToken: fakeVerifyIdToken });
const api = () => request(app);

/** Empties users, vehicles and the audit log. The audit trigger is lifted only inside this transaction. */
async function resetDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_truncate');
    await client.query('TRUNCATE audit_log RESTART IDENTITY');
    await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_truncate');
    await client.query(`UPDATE system_settings SET setting_value = 'false' WHERE setting_key = 'external_drivers_enabled'`);
    await client.query(`UPDATE system_settings SET setting_value = '0' WHERE setting_key = 'random_selfie_check_percent'`); // tests turn it up when they need it
    await client.query('DELETE FROM users'); // cascades to vehicles, rides and bookings; settings keep their rows
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

let counter = 0;

/** Signs up a student through the real API and returns their token and profile. */
async function createStudent(overrides = {}) {
  counter += 1;
  const uid = overrides.uid || `uid-${counter}-${Date.now()}`;
  const email = overrides.email || `student${counter}@usiu.ac.ke`;
  const token = tokenFor({ uid, email });
  const res = await api()
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({ fullName: overrides.fullName || `Student ${counter}`, phoneNumber: '0712345678', faculty: 'School of Science and Technology' });
  if (res.status !== 201) throw new Error(`createStudent failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token, uid, email, user: res.body.user };
}

async function createAdmin() {
  const admin = await createStudent();
  await pool.query(`UPDATE users SET role = 'admin' WHERE user_id = $1`, [admin.user.userId]);
  return admin;
}

/**
 * Makes someone a verified driver for tests: an approved verification with valid papers and their first vehicle.
 * Real approval goes through the wizard and the admin review (see verification.test.js).
 */
async function approveAsDriver(userId, { type = 'student', externalEnabled = false } = {}) {
  const { rows: veh } = await pool.query('SELECT vehicle_id FROM vehicles WHERE owner_id = $1 ORDER BY created_at LIMIT 1', [userId]);
  await pool.query(
    `INSERT INTO driver_verifications (driver_id, driver_type, status, consent_at, licence_number, licence_holder_name, licence_expiry, licence_held_since,
        insurance_provider, insurance_policy_no, insurance_expiry, insurance_covers_passengers, vehicle_id, owner_relationship, psv_badge_expiry, approved_at, next_recheck_at)
     VALUES ($1, $2, 'approved', now(), 'DL-123456', 'Test Driver', '2030-01-01', '2015-01-01', 'Jubilee', 'P-1', '2030-01-01', true, $3, 'self',
        CASE WHEN $2 = 'external' THEN DATE '2030-01-01' END, now(), now() + interval '6 months')
     ON CONFLICT (driver_id) DO UPDATE SET status = 'approved', vehicle_id = EXCLUDED.vehicle_id, licence_expiry = '2030-01-01', insurance_expiry = '2030-01-01',
        driver_type = EXCLUDED.driver_type, psv_badge_expiry = EXCLUDED.psv_badge_expiry, approved_at = now()`,
    [userId, type, veh[0]?.vehicle_id ?? null],
  );
  if (externalEnabled) await pool.query(`UPDATE system_settings SET setting_value = 'true' WHERE setting_key = 'external_drivers_enabled'`);
}

/** The rider has confirmed the driver and car (the app asks before pick-up). */
const confirmRider = (requestId) => pool.query('UPDATE trip_requests SET rider_confirmed_driver_at = now() WHERE request_id = $1', [requestId]);

async function createSeniorAdmin() {
  const admin = await createAdmin();
  await pool.query(`UPDATE users SET admin_level = 'senior_admin' WHERE user_id = $1`, [admin.user.userId]);
  return admin;
}

async function auditRows() {
  const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY audit_id');
  return rows;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { app, api, pool, resetDb, createStudent, createAdmin, createSeniorAdmin, approveAsDriver, confirmRider, auditRows, auth, tokenFor };
