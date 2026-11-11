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

async function auditRows() {
  const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY audit_id');
  return rows;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { app, api, pool, resetDb, createStudent, createAdmin, auditRows, auth, tokenFor };
