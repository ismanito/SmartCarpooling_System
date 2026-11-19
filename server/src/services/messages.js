// Messages between a driver and a rider during a ride. Only those two can read a thread.
const { pool } = require('../db/pool');
const { errors } = require('../lib/errors');
const realtime = require('./realtime');

const CLOSED_AFTER_MIN = 120; // a finished ride stays open for messages for two hours (for lost items, a late payment, thanks)

/** Works out which thread this person may use, or throws "not found". */
async function thread({ rideId, userId, riderId }) {
  const { rows } = await pool.query('SELECT ride_id, driver_id, status, completed_at FROM rides WHERE ride_id = $1', [rideId]);
  const ride = rows[0];
  if (!ride) throw errors.notFound('Ride not found.');
  let rider;
  if (ride.driver_id === userId) {
    if (!riderId) throw errors.badRequest('VALIDATION_ERROR', 'Say which rider you are messaging.');
    rider = riderId;
  } else {
    rider = userId;
  }
  const { rows: ok } = await pool.query(`SELECT 1 FROM trip_requests WHERE ride_id = $1 AND rider_id = $2 AND status IN ('assigned', 'picked_up', 'completed')`, [rideId, rider]);
  if (!ok[0]) throw errors.notFound('Ride not found.');
  const other = ride.driver_id === userId ? rider : ride.driver_id;
  const finishedAt = ride.completed_at ? new Date(ride.completed_at).getTime() : null;
  const open = ride.status !== 'cancelled' && (finishedAt === null || Date.now() - finishedAt < CLOSED_AFTER_MIN * 60_000);
  return { ride, rider, other, isDriver: ride.driver_id === userId, open };
}

async function list({ rideId, userId, riderId, markRead = false }) {
  const t = await thread({ rideId, userId, riderId });
  if (markRead) {
    await pool.query('UPDATE ride_messages SET read_at = now() WHERE ride_id = $1 AND rider_id = $2 AND sender_id <> $3 AND read_at IS NULL', [rideId, t.rider, userId]);
  }
  const { rows } = await pool.query(
    `SELECT message_id, sender_id, body, created_at, read_at FROM ride_messages WHERE ride_id = $1 AND rider_id = $2 ORDER BY created_at DESC LIMIT 100`,
    [rideId, t.rider],
  );
  return {
    open: t.open,
    messages: rows.reverse().map((m) => ({ messageId: m.message_id, mine: m.sender_id === userId, body: m.body, at: m.created_at, read: Boolean(m.read_at) })),
  };
}

async function send({ rideId, userId, riderId, body }) {
  const t = await thread({ rideId, userId, riderId });
  if (!t.open) throw errors.conflict('CHAT_CLOSED', 'This ride is over, so messages are closed.');
  const text = String(body).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!text) throw errors.badRequest('VALIDATION_ERROR', 'Write a message first.');
  const { rows } = await pool.query(
    'INSERT INTO ride_messages (ride_id, rider_id, sender_id, body) VALUES ($1, $2, $3, $4) RETURNING message_id, created_at',
    [rideId, t.rider, userId, text],
  );
  realtime.emitToUser(t.other, 'message:new', { rideId, riderId: t.rider });
  return { messageId: rows[0].message_id, mine: true, body: text, at: rows[0].created_at, read: false };
}

/** Unread counts for the screen's badge: a rider has one thread per ride, a driver one per rider. */
async function unread({ rideId, userId }) {
  const { rows } = await pool.query(
    `SELECT m.rider_id, count(*)::int AS n FROM ride_messages m JOIN rides r ON r.ride_id = m.ride_id
      WHERE m.ride_id = $1 AND m.sender_id <> $2 AND m.read_at IS NULL AND (r.driver_id = $2 OR m.rider_id = $2)
      GROUP BY m.rider_id`,
    [rideId, userId],
  );
  return { total: rows.reduce((s, r) => s + r.n, 0), byRider: Object.fromEntries(rows.map((r) => [r.rider_id, r.n])) };
}

module.exports = { list, send, unread };
