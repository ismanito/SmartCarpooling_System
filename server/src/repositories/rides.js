const { pool } = require('../db/pool');
const { settingsFromRows } = require('../lib/matching');

// ---------------------------------------------------------------- settings

async function loadMatchSettings(db = pool) {
  const { rows } = await db.query('SELECT setting_key, setting_value FROM system_settings');
  return settingsFromRows(rows);
}

// ---------------------------------------------------------------- shared SQL

const point = (latParam, lngParam) => `ST_SetSRID(ST_MakePoint($${lngParam}, $${latParam}), 4326)::geography`;

const OFFER_COLUMNS = `o.offer_id, o.driver_id, o.vehicle_id, o.origin_name, o.destination_name, o.depart_at,
  o.seats_total, o.seats_available, o.route_km, o.status, o.created_at,
  ST_Y(o.origin::geometry) AS origin_lat, ST_X(o.origin::geometry) AS origin_lng,
  ST_Y(o.destination::geometry) AS destination_lat, ST_X(o.destination::geometry) AS destination_lng`;

const REQUEST_COLUMNS = `r.request_id, r.rider_id, r.origin_name, r.destination_name, r.depart_at,
  r.seats_needed, r.status, r.created_at,
  ST_Distance(r.origin, r.destination) / 1000.0 AS trip_km`;

// ---------------------------------------------------------------- offers

async function createOffer(db, driverId, { vehicleId, origin, destination, departAt, seats, routeKm }) {
  const { rows } = await db.query(
    `INSERT INTO ride_offers (driver_id, vehicle_id, origin_name, origin, destination_name, destination,
                              depart_at, seats_total, seats_available, route_km)
     VALUES ($1, $2, $3, ${point(4, 5)}, $6, ${point(7, 8)}, $9, $10, $10, $11)
     RETURNING offer_id`,
    [driverId, vehicleId, origin.name, origin.lat, origin.lng, destination.name, destination.lat, destination.lng, departAt, seats, routeKm],
  );
  return findOffer(db, rows[0].offer_id);
}

/** Offer with its vehicle and driver; `forUpdate` locks the offer row. */
async function findOffer(db, offerId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${OFFER_COLUMNS},
            v.make_model, v.plate_number, v.colour,
            u.full_name AS driver_name, u.phone_number AS driver_phone, u.avg_rating AS driver_rating
       FROM ride_offers o
       JOIN vehicles v ON v.vehicle_id = o.vehicle_id
       JOIN users u ON u.user_id = o.driver_id
      WHERE o.offer_id = $1${forUpdate ? ' FOR UPDATE OF o' : ''}`,
    [offerId],
  );
  return rows[0] || null;
}

/** The driver's offers that are still upcoming (or departed within the last day). */
async function listOffersByDriver(driverId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${OFFER_COLUMNS}, v.make_model, v.plate_number, v.colour
       FROM ride_offers o JOIN vehicles v ON v.vehicle_id = o.vehicle_id
      WHERE o.driver_id = $1 AND o.depart_at > now() - interval '14 days'
      ORDER BY o.status <> 'open', o.depart_at`,
    [driverId],
  );
  return rows;
}

async function setOfferStatus(db, offerId, status) {
  await db.query('UPDATE ride_offers SET status = $2 WHERE offer_id = $1', [offerId, status]);
}

async function changeSeats(db, offerId, delta) {
  await db.query('UPDATE ride_offers SET seats_available = seats_available + $2 WHERE offer_id = $1', [offerId, delta]);
}

async function countActiveOffersForVehicle(db, vehicleId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM ride_offers WHERE vehicle_id = $1 AND status = 'open' AND depart_at > now()`,
    [vehicleId],
  );
  return rows[0].n;
}

// ---------------------------------------------------------------- requests

async function createRequest(db, riderId, { origin, destination, departAt, seats }) {
  const { rows } = await db.query(
    `INSERT INTO ride_requests (rider_id, origin_name, origin, destination_name, destination, depart_at, seats_needed)
     VALUES ($1, $2, ${point(3, 4)}, $5, ${point(6, 7)}, $8, $9)
     RETURNING request_id`,
    [riderId, origin.name, origin.lat, origin.lng, destination.name, destination.lat, destination.lng, departAt, seats],
  );
  return findRequest(db, rows[0].request_id);
}

async function findRequest(db, requestId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${REQUEST_COLUMNS}, u.full_name AS rider_name, u.phone_number AS rider_phone, u.faculty AS rider_faculty,
            u.avg_rating AS rider_rating
       FROM ride_requests r JOIN users u ON u.user_id = r.rider_id
      WHERE r.request_id = $1${forUpdate ? ' FOR UPDATE OF r' : ''}`,
    [requestId],
  );
  return rows[0] || null;
}

async function listRequestsByRider(riderId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${REQUEST_COLUMNS}
       FROM ride_requests r
      WHERE r.rider_id = $1 AND r.depart_at > now() - interval '14 days'
      ORDER BY r.status IN ('cancelled', 'completed'), r.depart_at`,
    [riderId],
  );
  return rows;
}

async function setRequestStatus(db, requestId, status) {
  await db.query('UPDATE ride_requests SET status = $2 WHERE request_id = $1', [requestId, status]);
}

// ---------------------------------------------------------------- candidate pairs (coarse PostGIS filter)

const PAIR_SELECT = `
  ST_Distance(o.origin, r.origin) / 1000.0           AS pickup_km,
  ST_Distance(o.destination, r.destination) / 1000.0 AS dropoff_km,
  EXTRACT(EPOCH FROM (o.depart_at - r.depart_at)) / 60.0 AS time_diff_min,
  ST_Distance(r.origin, r.destination) / 1000.0      AS rider_km,
  ST_Distance(o.origin, o.destination) / 1000.0      AS driver_km`;

const PAIR_WHERE = `
      o.status = 'open' AND r.status = 'open' AND u.status = 'active'
  AND (u.role <> 'driver' OR EXISTS (SELECT 1 FROM driver_applications da WHERE da.user_id = u.user_id AND da.status = 'approved'))
  AND o.depart_at > now() AND r.depart_at > now()
  AND o.driver_id <> r.rider_id
  AND o.seats_available >= r.seats_needed
  AND ST_DWithin(o.origin, r.origin, $2 * 1000)
  AND ST_DWithin(o.destination, r.destination, $2 * 1000)
  AND abs(EXTRACT(EPOCH FROM (o.depart_at - r.depart_at))) <= $3 * 60
  AND NOT EXISTS (SELECT 1 FROM bookings b
                   WHERE b.offer_id = o.offer_id AND b.request_id = r.request_id
                     AND b.status IN ('pending', 'accepted', 'declined'))`;

/** Open offers that could carry this request. */
async function candidateOffersForRequest(requestId, settings, db = pool) {
  const { rows } = await db.query(
    `SELECT ${OFFER_COLUMNS}, ${PAIR_SELECT},
            v.make_model, v.plate_number, v.colour,
            u.full_name AS driver_name, u.avg_rating AS driver_rating
       FROM ride_requests r
       JOIN ride_offers o ON true
       JOIN vehicles v ON v.vehicle_id = o.vehicle_id
       JOIN users u ON u.user_id = o.driver_id
      WHERE r.request_id = $1 AND ${PAIR_WHERE}
      LIMIT 100`,
    [requestId, settings.searchRadiusKm, settings.timeWindowMin],
  );
  return rows;
}

/** Open requests this offer could carry. */
async function candidateRequestsForOffer(offerId, settings, db = pool) {
  const { rows } = await db.query(
    `SELECT ${REQUEST_COLUMNS}, ${PAIR_SELECT},
            u.full_name AS rider_name, u.faculty AS rider_faculty, u.avg_rating AS rider_rating
       FROM ride_offers o
       JOIN ride_requests r ON true
       JOIN users u ON u.user_id = r.rider_id
      WHERE o.offer_id = $1 AND ${PAIR_WHERE}
      LIMIT 100`,
    [offerId, settings.searchRadiusKm, settings.timeWindowMin],
  );
  return rows;
}

/** Distances/time for one specific pair, ignoring status filters (the caller checks those). */
async function pairMetrics(db, offerId, requestId) {
  const { rows } = await db.query(
    `SELECT ${PAIR_SELECT} FROM ride_offers o, ride_requests r WHERE o.offer_id = $1 AND r.request_id = $2`,
    [offerId, requestId],
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------- bookings

const BOOKING_COLUMNS = 'booking_id, offer_id, request_id, initiated_by, seats, score, status, responded_at, created_at';

async function createBooking(db, { offerId, requestId, initiatedBy, seats, score }) {
  const { rows } = await db.query(
    `INSERT INTO bookings (offer_id, request_id, initiated_by, seats, score)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${BOOKING_COLUMNS}`,
    [offerId, requestId, initiatedBy, seats, score],
  );
  return rows[0];
}

async function findBooking(db, bookingId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE booking_id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [bookingId],
  );
  return rows[0] || null;
}

async function setBookingStatus(db, bookingId, status) {
  const { rows } = await db.query(
    `UPDATE bookings SET status = $2, responded_at = now() WHERE booking_id = $1 RETURNING ${BOOKING_COLUMNS}`,
    [bookingId, status],
  );
  return rows[0];
}

/** Live bookings on an offer or request, locked so status changes stay consistent. */
async function activeBookings(db, { offerId, requestId }) {
  const { rows } = await db.query(
    `SELECT ${BOOKING_COLUMNS} FROM bookings
      WHERE ${offerId ? 'offer_id' : 'request_id'} = $1 AND status IN ('pending', 'accepted')
      FOR UPDATE`,
    [offerId || requestId],
  );
  return rows;
}

/** Bookings on the driver's offers, with the rider's side of the trip. */
async function bookingsForOffers(offerIds, raterId, db = pool) {
  if (offerIds.length === 0) return [];
  const { rows } = await db.query(
    `SELECT b.booking_id, b.offer_id, b.request_id, b.initiated_by, b.seats, b.score, b.status, b.created_at,
            (SELECT x.stars FROM ratings x WHERE x.booking_id = b.booking_id AND x.rater_id = $2) AS my_stars,
            r.origin_name, r.destination_name, r.depart_at,
            u.full_name AS rider_name, u.faculty AS rider_faculty, u.phone_number AS rider_phone, u.avg_rating AS rider_rating
       FROM bookings b
       JOIN ride_requests r ON r.request_id = b.request_id
       JOIN users u ON u.user_id = r.rider_id
      WHERE b.offer_id = ANY($1::uuid[])
      ORDER BY b.created_at DESC`,
    [offerIds, raterId],
  );
  return rows;
}

/** Bookings on the rider's requests, with the driver's side of the trip. */
async function bookingsForRequests(requestIds, raterId, db = pool) {
  if (requestIds.length === 0) return [];
  const { rows } = await db.query(
    `SELECT b.booking_id, b.offer_id, b.request_id, b.initiated_by, b.seats, b.score, b.status, b.created_at,
            (SELECT x.stars FROM ratings x WHERE x.booking_id = b.booking_id AND x.rater_id = $2) AS my_stars,
            o.status AS offer_status, o.origin_name, o.destination_name, o.depart_at, o.route_km, o.seats_total,
            v.make_model, v.plate_number, v.colour,
            u.full_name AS driver_name, u.phone_number AS driver_phone, u.avg_rating AS driver_rating
       FROM bookings b
       JOIN ride_offers o ON o.offer_id = b.offer_id
       JOIN vehicles v ON v.vehicle_id = o.vehicle_id
       JOIN users u ON u.user_id = o.driver_id
      WHERE b.request_id = ANY($1::uuid[])
      ORDER BY b.created_at DESC`,
    [requestIds, raterId],
  );
  return rows;
}

/** Saves one rating and refreshes the rated person's average. */
async function addRating(db, { bookingId, raterId, rateeId, stars, comment, tags = [] }) {
  await db.query(
    'INSERT INTO ratings (booking_id, rater_id, ratee_id, stars, comment, tags) VALUES ($1, $2, $3, $4, $5, $6)',
    [bookingId, raterId, rateeId, stars, comment || null, tags || []],
  );
  await db.query(
    `UPDATE users SET avg_rating = (SELECT round(avg(stars), 1) FROM ratings WHERE ratee_id = $1) WHERE user_id = $1`,
    [rateeId],
  );
}

module.exports = {
  addRating,
  loadMatchSettings,
  createOffer,
  findOffer,
  listOffersByDriver,
  setOfferStatus,
  changeSeats,
  countActiveOffersForVehicle,
  createRequest,
  findRequest,
  listRequestsByRider,
  setRequestStatus,
  candidateOffersForRequest,
  candidateRequestsForOffer,
  pairMetrics,
  createBooking,
  findBooking,
  setBookingStatus,
  activeBookings,
  bookingsForOffers,
  bookingsForRequests,
};
