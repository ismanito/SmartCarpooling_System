const { pool } = require('../db/pool');

/** Creates the fare for a newly accepted booking, with the rider as the only payer. */
async function createForBooking(db, { bookingId, riderId, amountKes }) {
  const { rows } = await db.query(
    `INSERT INTO payments (booking_id, amount_kes) VALUES ($1, $2)
     ON CONFLICT (booking_id) DO UPDATE SET status = 'pending', amount_kes = EXCLUDED.amount_kes
     RETURNING payment_id`,
    [bookingId, amountKes],
  );
  const paymentId = rows[0].payment_id;
  await db.query('DELETE FROM payment_shares WHERE payment_id = $1', [paymentId]);
  await db.query('INSERT INTO payment_shares (payment_id, payer_id, amount_kes) VALUES ($1, $2, $3)', [paymentId, riderId, amountKes]);
  return paymentId;
}

/**
 * When a trip finishes the fare is recalculated from who was really on board. Fares that are still unpaid
 * are re-split among the same payers; anything already (part-)paid is left alone.
 */
async function refare(db, bookingId, amountKes) {
  if (!(amountKes > 0)) return;
  const { rows } = await db.query(
    `SELECT p.payment_id, p.status FROM payments p WHERE p.booking_id = $1 FOR UPDATE OF p`,
    [bookingId],
  );
  const payment = rows[0];
  if (!payment || payment.status !== 'pending') return;
  if ((await countPaidShares(db, payment.payment_id)) > 0) return;
  const { rows: payers } = await db.query(
    `SELECT s.payer_id FROM payment_shares s
       JOIN payments p ON p.payment_id = s.payment_id
       JOIN bookings b ON b.booking_id = p.booking_id
       JOIN ride_requests r ON r.request_id = b.request_id
      WHERE s.payment_id = $1 ORDER BY (s.payer_id = r.rider_id) DESC, s.created_at, s.share_id`,
    [payment.payment_id],
  );
  if (payers.length === 0 || amountKes < payers.length) return;
  const { splitEvenly } = require('../lib/payments');
  const amounts = splitEvenly(amountKes, payers.length);
  await db.query('UPDATE payments SET amount_kes = $2 WHERE payment_id = $1', [payment.payment_id, amountKes]);
  await replaceShares(db, payment.payment_id, payers.map((x, i) => ({ payerId: x.payer_id, amountKes: amounts[i] })));
}

/** A cancelled booking cancels its fare; anything already paid is marked refunded. */
async function cancelForBooking(db, bookingId) {
  const { rows } = await db.query(`UPDATE payments SET status = 'cancelled' WHERE booking_id = $1 RETURNING payment_id`, [bookingId]);
  if (!rows[0]) return;
  await db.query(
    `UPDATE payment_shares SET status = CASE WHEN status = 'paid' THEN 'refunded' ELSE 'cancelled' END
      WHERE payment_id = $1 AND status IN ('pending', 'paid')`,
    [rows[0].payment_id],
  );
}

const PAYMENT_SELECT = `
  p.payment_id, p.booking_id, p.amount_kes, p.status, p.created_at,
  b.seats, o.offer_id, o.status AS offer_status, o.origin_name, o.destination_name, o.depart_at,
  r.rider_id, rider.full_name AS rider_name, driver.user_id AS driver_id, driver.full_name AS driver_name,
  COALESCE((SELECT sum(s.amount_kes) FROM payment_shares s WHERE s.payment_id = p.payment_id AND s.status = 'paid'), 0)::int AS paid_kes`;

const PAYMENT_FROM = `
  FROM payments p
  JOIN bookings b ON b.booking_id = p.booking_id
  JOIN ride_offers o ON o.offer_id = b.offer_id
  JOIN ride_requests r ON r.request_id = b.request_id
  JOIN users rider ON rider.user_id = r.rider_id
  JOIN users driver ON driver.user_id = o.driver_id`;

/** Fares the user is part of: ones they booked, or ones where a friend asked them to chip in. */
async function listForPayer(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${PAYMENT_SELECT} ${PAYMENT_FROM}
      WHERE (r.rider_id = $1 OR EXISTS (SELECT 1 FROM payment_shares s WHERE s.payment_id = p.payment_id AND s.payer_id = $1))
        AND p.created_at > now() - interval '60 days'
      ORDER BY o.depart_at DESC`,
    [userId],
  );
  return rows;
}

/** Fares on the driver's own trips. */
async function listForDriver(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${PAYMENT_SELECT} ${PAYMENT_FROM} WHERE o.driver_id = $1 ORDER BY o.depart_at DESC LIMIT 200`,
    [userId],
  );
  return rows;
}

async function sharesFor(paymentIds, db = pool) {
  if (paymentIds.length === 0) return [];
  const { rows } = await db.query(
    `SELECT s.share_id, s.payment_id, s.payer_id, s.amount_kes, s.status, s.method, s.paid_at, u.full_name AS payer_name, u.university_email AS payer_email
       FROM payment_shares s JOIN users u ON u.user_id = s.payer_id
      WHERE s.payment_id = ANY($1::uuid[])
      ORDER BY s.created_at, s.share_id`,
    [paymentIds],
  );
  return rows;
}

/** Locks the fare for a booking so a split and a payment cannot race each other. */
async function findByBookingForUpdate(db, bookingId) {
  const { rows } = await db.query(
    `SELECT p.payment_id, p.amount_kes, p.status, r.rider_id
       FROM payments p JOIN bookings b ON b.booking_id = p.booking_id JOIN ride_requests r ON r.request_id = b.request_id
      WHERE p.booking_id = $1 FOR UPDATE OF p`,
    [bookingId],
  );
  return rows[0] || null;
}

async function replaceShares(db, paymentId, shares) {
  await db.query('DELETE FROM payment_shares WHERE payment_id = $1', [paymentId]);
  for (const s of shares) {
    await db.query('INSERT INTO payment_shares (payment_id, payer_id, amount_kes) VALUES ($1, $2, $3)', [paymentId, s.payerId, s.amountKes]);
  }
}

async function countPaidShares(db, paymentId) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM payment_shares WHERE payment_id = $1 AND status = 'paid'`, [paymentId]);
  return rows[0].n;
}

async function findShareForUpdate(db, shareId) {
  const { rows } = await db.query(
    `SELECT s.share_id, s.payment_id, s.payer_id, s.amount_kes, s.status, p.status AS payment_status, o.driver_id
       FROM payment_shares s
       JOIN payments p ON p.payment_id = s.payment_id
       JOIN bookings b ON b.booking_id = p.booking_id
       JOIN ride_offers o ON o.offer_id = b.offer_id
      WHERE s.share_id = $1 FOR UPDATE OF p, s`,
    [shareId],
  );
  return rows[0] || null;
}

async function markSharePaid(db, shareId, { method, reference, settledBy = null }) {
  const { rows } = await db.query(
    `UPDATE payment_shares SET status = 'paid', method = $2, reference = $3, paid_at = now(), settled_by = $4
      WHERE share_id = $1 RETURNING payment_id`,
    [shareId, method, reference || null, settledBy],
  );
  const paymentId = rows[0].payment_id;
  await db.query(
    `UPDATE payments SET status = 'paid'
      WHERE payment_id = $1 AND NOT EXISTS (SELECT 1 FROM payment_shares WHERE payment_id = $1 AND status = 'pending')`,
    [paymentId],
  );
  return paymentId;
}

/** Active students by email, for inviting people to chip in. */
async function findStudentsByEmail(db, emails) {
  const { rows } = await db.query(
    `SELECT user_id, university_email FROM users WHERE university_email = ANY($1::text[]) AND role = 'student' AND status = 'active'`,
    [emails],
  );
  return rows;
}

// ---------------------------------------------------------------- admin

async function adminSummary(db = pool) {
  const { rows } = await db.query(`
    SELECT COALESCE(sum(amount_kes) FILTER (WHERE status <> 'cancelled'), 0)::int AS billed_kes,
           count(*) FILTER (WHERE status <> 'cancelled')::int AS fares,
           count(*) FILTER (WHERE status = 'pending')::int AS unpaid_fares,
           (SELECT COALESCE(sum(amount_kes), 0)::int FROM payment_shares WHERE status = 'paid') AS collected_kes
      FROM payments`);
  const r = rows[0];
  return {
    billedKes: r.billed_kes,
    collectedKes: r.collected_kes,
    outstandingKes: Math.max(0, r.billed_kes - r.collected_kes),
    fares: r.fares,
    unpaidFares: r.unpaid_fares,
  };
}

async function adminRecent(limit = 50, db = pool) {
  const { rows } = await db.query(`SELECT ${PAYMENT_SELECT} ${PAYMENT_FROM} ORDER BY p.created_at DESC LIMIT $1`, [limit]);
  return rows;
}

module.exports = {
  refare,
  createForBooking,
  cancelForBooking,
  listForPayer,
  listForDriver,
  sharesFor,
  findByBookingForUpdate,
  replaceShares,
  countPaidShares,
  findShareForUpdate,
  markSharePaid,
  findStudentsByEmail,
  adminSummary,
  adminRecent,
};
