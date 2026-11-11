const { pool } = require('../db/pool');

const COLUMNS = `user_id, firebase_uid, full_name, university_email, phone_number, faculty,
                 role, person_type, is_verified, status, avg_rating, created_at, updated_at,
                 (SELECT d.status FROM driver_applications d WHERE d.user_id = users.user_id) AS driver_status`;

async function findByFirebaseUid(firebaseUid, db = pool) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM users WHERE firebase_uid = $1`, [firebaseUid]);
  return rows[0] || null;
}

async function findById(userId, db = pool, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM users WHERE user_id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  return rows[0] || null;
}

async function relinkByEmail(firebaseUid, email, db = pool) {
  const { rows } = await db.query(
    `UPDATE users SET firebase_uid = $1 WHERE university_email = $2 RETURNING ${COLUMNS}`,
    [firebaseUid, email],
  );
  return rows[0] || null;
}

async function markVerified(userId, db = pool) {
  const { rows } = await db.query(
    `UPDATE users SET is_verified = true WHERE user_id = $1 RETURNING ${COLUMNS}`,
    [userId],
  );
  return rows[0];
}

async function create(db, { firebaseUid, email, fullName, phoneNumber, faculty, role = 'student', personType = 'student' }) {
  const { rows } = await db.query(
    `INSERT INTO users (firebase_uid, university_email, full_name, phone_number, faculty, role, person_type, is_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true)
     RETURNING ${COLUMNS}`,
    [firebaseUid, email, fullName, phoneNumber, faculty, role, personType],
  );
  return rows[0];
}

// Whitelist of API field → column. Only these can ever be written by PUT /users/me.
const UPDATABLE = { fullName: 'full_name', phoneNumber: 'phone_number', faculty: 'faculty' };

async function updateProfile(db, userId, changes) {
  const sets = [];
  const values = [];
  for (const [field, column] of Object.entries(UPDATABLE)) {
    if (changes[field] !== undefined) {
      values.push(changes[field]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  values.push(userId);
  const { rows } = await db.query(
    `UPDATE users SET ${sets.join(', ')} WHERE user_id = $${values.length} RETURNING ${COLUMNS}`,
    values,
  );
  return rows[0];
}

/** Row → API shape (camelCase, no firebase_uid). */
function toApi(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    fullName: row.full_name,
    universityEmail: row.university_email,
    phoneNumber: row.phone_number,
    faculty: row.faculty,
    role: row.role,
    personType: row.person_type,
    isVerified: row.is_verified,
    status: row.status,
    driverStatus: row.driver_status || null,
    avgRating: row.avg_rating,
    createdAt: row.created_at,
  };
}

module.exports = {
  relinkByEmail, findByFirebaseUid, findById, markVerified, create, updateProfile, toApi, UPDATABLE };
