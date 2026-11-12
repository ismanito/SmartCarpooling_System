// Creates (or refreshes) named demo accounts in Firebase and the database. Safe to run again.
// Usage: npm --prefix server run demo-accounts
// Needs FIREBASE_WEB_API_KEY in server/.env (the same value as VITE_FIREBASE_API_KEY in client/.env).
const { config } = require('../src/config/env');
const { pool } = require('../src/db/pool');

const PASSWORD = 'Demo-Pass-123';
const DOMAIN = 'demo.ridemate.test';

const ACCOUNTS = [
  { name: 'Grace Wanjiru', email: `grace.wanjiru@${DOMAIN}`, phone: '+254700100001', faculty: 'Business', role: 'student', personType: 'student' },
  { name: 'Kevin Omondi', email: `kevin.omondi@${DOMAIN}`, phone: '+254700100002', faculty: 'Engineering', role: 'student', personType: 'student' },
  { name: 'Faith Njeri', email: `faith.njeri@${DOMAIN}`, phone: '+254700100003', faculty: 'Administration', role: 'student', personType: 'staff' },
  // A student who is also a verified driver: Driver mode appears in their menu.
  { name: 'Dan Mwangi', email: `dan.mwangi@${DOMAIN}`, phone: '+254700100004', faculty: 'Computing', role: 'student', personType: 'student', drive: { type: 'student', car: ['Toyota Axio', 'KDM244Z', 'White', 4] } },
  // Driver-portal accounts.
  { name: 'Amina Hassan', email: `amina.hassan@${DOMAIN}`, phone: '+254700100005', faculty: 'Staff', role: 'driver', personType: 'staff', drive: { type: 'staff', car: ['Mazda Demio', 'KDG118B', 'Red', 4] } },
  { name: 'Brian Otieno', email: `brian.otieno@${DOMAIN}`, phone: '+254700100006', faculty: 'External', role: 'driver', personType: 'student', drive: { type: 'external', car: ['Toyota Fielder', 'KDK905C', 'Silver', 4] } },
];

async function identity(path, body) {
  const key = process.env.FIREBASE_WEB_API_KEY;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${path}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, returnSecureToken: true }),
  });
  return { ok: res.ok, data: await res.json() };
}

async function firebaseUid(email) {
  const created = await identity('signUp', { email, password: PASSWORD });
  if (created.ok) return created.data;
  if (created.data?.error?.message !== 'EMAIL_EXISTS') throw new Error(`${email}: ${created.data?.error?.message}`);
  const signedIn = await identity('signInWithPassword', { email, password: PASSWORD });
  if (!signedIn.ok) throw new Error(`${email} already exists in Firebase with a different password`);
  return signedIn.data;
}

async function main() {
  if (!process.env.FIREBASE_WEB_API_KEY) throw new Error('Set FIREBASE_WEB_API_KEY in server/.env');
  if (config.firebase.useEmulator) throw new Error('This script is for live Firebase; the emulator is on.');
  for (const a of ACCOUNTS) {
    const { localId: uid, idToken } = await firebaseUid(a.email);
    // Marks the email verified in Firebase (demo domains only; the API must be running).
    if (!process.env.DEMO_DB_ONLY) {
    const v = await fetch(`${process.env.API_URL || 'http://localhost:4000'}/api/auth/demo-verify`, { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } });
    if (!v.ok) throw new Error(`${a.email}: demo-verify failed (${v.status}). Is the API running and DEMO_EMAIL_DOMAINS set?`);
    }
    const { rows } = await pool.query(
      `INSERT INTO users (firebase_uid, university_email, full_name, phone_number, faculty, role, person_type, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (university_email) DO UPDATE SET firebase_uid = EXCLUDED.firebase_uid, full_name = EXCLUDED.full_name, role = EXCLUDED.role,
         person_type = EXCLUDED.person_type, is_verified = true, status = 'active'
       RETURNING user_id`,
      [uid, a.email, a.name, a.phone, a.faculty, a.role, a.personType],
    );
    const userId = rows[0].user_id;
    if (a.drive) {
      const [makeModel, plate, colour, seats] = a.drive.car;
      const { rows: v } = await pool.query(
        `INSERT INTO vehicles (owner_id, make_model, plate_number, colour, seat_capacity) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (plate_number) DO UPDATE SET owner_id = EXCLUDED.owner_id RETURNING vehicle_id`,
        [userId, makeModel, plate, colour, seats],
      );
      await pool.query(
        `INSERT INTO driver_verifications (driver_id, driver_type, status, consent_at, licence_number, licence_holder_name, licence_expiry, licence_held_since,
            insurance_provider, insurance_policy_no, insurance_expiry, insurance_covers_passengers, vehicle_id, owner_relationship, psv_badge_expiry, approved_at, next_recheck_at)
         VALUES ($1, $2, 'approved', now(), $3, $4, now() + interval '3 years', now() - interval '5 years', 'Jubilee Insurance', $5, now() + interval '1 year', true, $6, 'self',
            CASE WHEN $2 = 'external' THEN (now() + interval '1 year')::date END, now(), now() + interval '6 months')
         ON CONFLICT (driver_id) DO UPDATE SET status = 'approved', vehicle_id = EXCLUDED.vehicle_id, licence_expiry = EXCLUDED.licence_expiry,
            insurance_expiry = EXCLUDED.insurance_expiry, psv_badge_expiry = EXCLUDED.psv_badge_expiry, approved_at = now(), next_recheck_at = EXCLUDED.next_recheck_at`,
        [userId, a.drive.type, `DL-${plate.replace(/\s/g, '')}`, a.name, `POL-${plate.replace(/\s/g, '')}`, v[0].vehicle_id],
      );
    }
    console.log(`${a.role.padEnd(8)} ${a.name.padEnd(14)} ${a.email}`);
  }
  await pool.query(`UPDATE system_settings SET setting_value = 'true' WHERE setting_key = 'external_drivers_enabled'`);
  console.log(`\nPassword for all: ${PASSWORD}`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
