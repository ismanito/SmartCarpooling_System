const { pool } = require('../db/pool');

const COLUMNS = 'vehicle_id, owner_id, make_model, plate_number, colour, seat_capacity, created_at, updated_at';

async function listByOwner(ownerId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM vehicles WHERE owner_id = $1 ORDER BY created_at`,
    [ownerId],
  );
  return rows;
}

/** Returns the vehicle only if it belongs to ownerId (row-locked when inside a transaction). */
async function findOwned(db, vehicleId, ownerId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM vehicles WHERE vehicle_id = $1 AND owner_id = $2 FOR UPDATE`,
    [vehicleId, ownerId],
  );
  return rows[0] || null;
}

async function create(db, ownerId, { makeModel, plateNumber, colour, seatCapacity }) {
  const { rows } = await db.query(
    `INSERT INTO vehicles (owner_id, make_model, plate_number, colour, seat_capacity)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [ownerId, makeModel, plateNumber, colour, seatCapacity],
  );
  return rows[0];
}

const UPDATABLE = {
  makeModel: 'make_model',
  plateNumber: 'plate_number',
  colour: 'colour',
  seatCapacity: 'seat_capacity',
};

async function update(db, vehicleId, ownerId, changes) {
  const sets = [];
  const values = [];
  for (const [field, column] of Object.entries(UPDATABLE)) {
    if (changes[field] !== undefined) {
      values.push(changes[field]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  values.push(vehicleId, ownerId);
  const { rows } = await db.query(
    `UPDATE vehicles SET ${sets.join(', ')}
      WHERE vehicle_id = $${values.length - 1} AND owner_id = $${values.length}
      RETURNING ${COLUMNS}`,
    values,
  );
  return rows[0] || null;
}

async function remove(db, vehicleId, ownerId) {
  const { rowCount } = await db.query('DELETE FROM vehicles WHERE vehicle_id = $1 AND owner_id = $2', [vehicleId, ownerId]);
  return rowCount === 1;
}

function toApi(row) {
  return {
    vehicleId: row.vehicle_id,
    ownerId: row.owner_id,
    makeModel: row.make_model,
    plateNumber: row.plate_number,
    colour: row.colour,
    seatCapacity: row.seat_capacity,
    createdAt: row.created_at,
  };
}

module.exports = { listByOwner, findOwned, create, update, remove, toApi, UPDATABLE };
