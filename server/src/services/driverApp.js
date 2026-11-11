/** The driver side of Ride Now: going online and offline, sharing position, and the driver's own screens. */
const { pool, withTransaction } = require('../db/pool');
const { errors } = require('../lib/errors');
const { appendAudit } = require('./audit');
const dispatch = require('./dispatch');
const verification = require('./verification');
const rideOps = require('./rideOps');
const realtime = require('./realtime');

const STALE_SECONDS = 180;

/** Anyone, student, staff or external, may drive once their verification is approved. */
function canDrive(user) {
  return user.driverStatus === 'approved';
}

async function goOnline({ user, lat, lng, selfieCheckId, ip }) {
  return withTransaction(async (client) => {
    // Approved, every paper still valid, and the vehicle that was verified. Otherwise: no.
    const v = await verification.assertCanDrive(client, user.userId);
    if (await verification.selfieRequired(client, user.userId, selfieCheckId)) {
      throw errors.conflict('SELFIE_REQUIRED', 'Take a quick selfie to go online.');
    }
    const { rows } = await client.query('SELECT vehicle_id, make_model, seat_capacity FROM vehicles WHERE vehicle_id = $1 AND owner_id = $2', [v.vehicle_id, user.userId]);
    const vehicle = rows[0];
    if (!vehicle) throw errors.conflict('NO_VEHICLE', 'Your verified vehicle is missing. Update your verification.');
    const { rows: cur } = await client.query('SELECT active_ride_id FROM driver_status WHERE driver_id = $1 FOR UPDATE', [user.userId]);
    if (cur[0]?.active_ride_id) throw errors.conflict('ON_A_RIDE', 'You are on a ride.');
    await client.query(
      `INSERT INTO driver_status (driver_id, vehicle_id, is_online, current_location, seats_free, online_since, last_seen_at)
       VALUES ($1, $2, true, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, now(), now())
       ON CONFLICT (driver_id) DO UPDATE
         SET vehicle_id = EXCLUDED.vehicle_id, is_online = true, current_location = EXCLUDED.current_location,
             seats_free = EXCLUDED.seats_free, online_since = now(), last_seen_at = now()`,
      [user.userId, vehicle.vehicle_id, lat, lng, vehicle.seat_capacity],
    );
    // Only the time and the vehicle are recorded, never where the driver was.
    await appendAudit(client, { userId: user.userId, action: 'driver.online', entity: 'driver_status', entityId: user.userId, ipAddress: ip, details: { driver_id: user.userId, vehicle_id: vehicle.vehicle_id } });
    return { vehicle: { vehicleId: vehicle.vehicle_id, makeModel: vehicle.make_model }, seatsFree: vehicle.seat_capacity };
  });
}

async function goOffline({ userId, reason = 'driver', ip }) {
  const { rows } = await pool.query('SELECT active_ride_id, is_online FROM driver_status WHERE driver_id = $1', [userId]);
  if (rows[0]?.active_ride_id) throw errors.conflict('ON_A_RIDE', 'Finish your ride before you go offline.');
  // An offer they have not answered is handed to the next driver.
  await pool.query(`UPDATE dispatch_offers SET expires_at = now() WHERE driver_id = $1 AND response IS NULL`, [userId]);
  await dispatch.sweepExpiredOffers();
  await withTransaction(async (client) => {
    const { rows: cur } = await client.query('SELECT is_online FROM driver_status WHERE driver_id = $1 FOR UPDATE', [userId]);
    if (!cur[0]?.is_online) return;
    await client.query('UPDATE driver_status SET is_online = false, current_location = NULL, heading = NULL WHERE driver_id = $1', [userId]);
    await appendAudit(client, { userId, action: 'driver.offline', entity: 'driver_status', entityId: userId, ipAddress: ip, details: { driver_id: userId, reason } });
  });
}

/** Keeps only the latest position. Riders in the driver's ride are pushed the new position straight away. */
async function updateLocation({ userId, lat, lng, heading }) {
  const { rows } = await pool.query(
    `UPDATE driver_status SET current_location = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, heading = $4, last_seen_at = now()
      WHERE driver_id = $1 AND is_online RETURNING active_ride_id`,
    [userId, lat, lng, heading ?? null],
  );
  if (!rows[0]) throw errors.conflict('NOT_ONLINE', 'Go online first.');
  if (rows[0].active_ride_id) {
    const { rows: riders } = await pool.query(`SELECT rider_id FROM trip_requests WHERE ride_id = $1 AND status IN ('assigned', 'picked_up')`, [rows[0].active_ride_id]);
    for (const r of riders) realtime.emitToUser(r.rider_id, 'ride:location', { rideId: rows[0].active_ride_id, lat, lng, heading: heading ?? null });
  }
}

/** Drivers who stopped reporting (phone off, app closed) are taken offline so nobody is offered to them. */
async function dropStaleDrivers() {
  const { rows } = await pool.query(
    `SELECT driver_id FROM driver_status WHERE is_online AND active_ride_id IS NULL AND last_seen_at < now() - make_interval(secs => $1)`,
    [STALE_SECONDS],
  );
  for (const r of rows) await goOffline({ userId: r.driver_id, reason: 'timeout' }).catch(() => {});
  return rows.length;
}

/** Everything the driver screen needs in one call. */
async function state(user) {
  const { rows } = await pool.query(
    `SELECT ds.is_online, ds.seats_free, ds.active_ride_id, ds.online_since, v.vehicle_id, v.make_model, v.plate_number, v.colour, v.seat_capacity
       FROM driver_status ds LEFT JOIN vehicles v ON v.vehicle_id = ds.vehicle_id WHERE ds.driver_id = $1`,
    [user.userId],
  );
  const ds = rows[0];
  const { rows: veh } = await pool.query('SELECT vehicle_id, make_model, plate_number, colour, seat_capacity FROM vehicles WHERE owner_id = $1 ORDER BY created_at', [user.userId]);

  let offer = null;
  const { rows: pending } = await pool.query(
    `SELECT o.offer_id, o.request_id, o.expires_at, o.pickup_eta_min, o.extra_minutes, o.pooled FROM dispatch_offers o
      WHERE o.driver_id = $1 AND o.response IS NULL AND o.expires_at > now() ORDER BY o.sent_at DESC LIMIT 1`,
    [user.userId],
  );
  if (pending[0]) {
    const request = await dispatch.findRequest(pool, pending[0].request_id);
    const { rows: rider } = await pool.query('SELECT full_name, avg_rating, is_verified FROM users WHERE user_id = $1', [request.rider_id]);
    offer = {
      ...dispatch.offerPayload(pending[0], request),
      rider: { firstName: rider[0].full_name.split(' ')[0], rating: Number(rider[0].avg_rating), verified: rider[0].is_verified },
      seats: request.seats,
    };
  }

  const { rows: stats } = await pool.query(
    `SELECT count(*) FILTER (WHERE response = 'accepted')::int AS accepted, count(*) FILTER (WHERE response = 'declined')::int AS declined,
            count(*) FILTER (WHERE response = 'expired')::int AS expired FROM dispatch_offers WHERE driver_id = $1`,
    [user.userId],
  );
  const { rows: money } = await pool.query(
    `SELECT COALESCE(sum(s.amount_kes), 0)::int AS shared_kes, count(DISTINCT r.ride_id)::int AS rides
       FROM rides r LEFT JOIN ride_shares s ON s.ride_id = r.ride_id WHERE r.driver_id = $1 AND r.status = 'completed'`,
    [user.userId],
  );
  const settings = await dispatch.loadSettings();
  return {
    noShowWaitS: settings.noShowWaitS,
    canDrive: canDrive(user),
    isOnline: Boolean(ds?.is_online),
    seatsFree: ds?.seats_free ?? 0,
    vehicle: ds?.vehicle_id ? { vehicleId: ds.vehicle_id, makeModel: ds.make_model, plateNumber: ds.plate_number, colour: ds.colour, seatCapacity: ds.seat_capacity } : null,
    vehicles: veh.map((v) => ({ vehicleId: v.vehicle_id, makeModel: v.make_model, plateNumber: v.plate_number, colour: v.colour, seatCapacity: v.seat_capacity })),
    ride: ds?.active_ride_id ? await rideOps.liveView({ rideId: ds.active_ride_id, userId: user.userId }) : null,
    offer,
    stats: stats[0], // shown to the driver only, and never used to penalise anyone
    totals: { sharedKes: money[0].shared_kes, rides: money[0].rides },
  };
}

/** The driver's home: this week at a glance, money still to collect, and recent rides. */
async function dashboard(userId) {
  const { rows: week } = await pool.query(
    `SELECT count(DISTINCT r.ride_id)::int AS rides, count(s.share_id)::int AS riders,
            COALESCE(sum(s.amount_kes), 0)::int AS shared_kes,
            COALESCE(sum(s.amount_kes) FILTER (WHERE s.status = 'paid'), 0)::int AS paid_kes,
            COALESCE(sum(s.amount_kes) FILTER (WHERE s.status = 'pending'), 0)::int AS pending_kes
       FROM rides r LEFT JOIN ride_shares s ON s.ride_id = r.ride_id
      WHERE r.driver_id = $1 AND r.status = 'completed' AND r.completed_at > now() - interval '7 days'`,
    [userId],
  );
  const { rows: collect } = await pool.query(
    `SELECT s.share_id, s.amount_kes, s.ride_id, u.full_name AS rider_name, r.completed_at,
            (SELECT t.dropoff_label FROM trip_requests t WHERE t.request_id = s.request_id) AS dropoff
       FROM ride_shares s JOIN rides r ON r.ride_id = s.ride_id JOIN users u ON u.user_id = s.rider_id
      WHERE r.driver_id = $1 AND s.status = 'pending' AND s.amount_kes > 0 ORDER BY r.completed_at DESC LIMIT 20`,
    [userId],
  );
  const { rows: rating } = await pool.query(
    `SELECT u.avg_rating, (SELECT count(*)::int FROM ratings x WHERE x.ratee_id = u.user_id) AS n FROM users u WHERE u.user_id = $1`,
    [userId],
  );
  const { rows: answers } = await pool.query(
    `SELECT count(*) FILTER (WHERE response = 'accepted')::int AS accepted, count(*) FILTER (WHERE response = 'declined')::int AS declined,
            count(*) FILTER (WHERE response = 'expired')::int AS expired FROM dispatch_offers WHERE driver_id = $1`,
    [userId],
  );
  const { rows: online } = await pool.query('SELECT is_online, active_ride_id FROM driver_status WHERE driver_id = $1', [userId]);
  const h = await history(userId);
  const w = week[0];
  return {
    week: { rides: w.rides, riders: w.riders, sharedKes: w.shared_kes, paidKes: w.paid_kes, pendingKes: w.pending_kes },
    rating: { average: Number(rating[0].avg_rating), count: rating[0].n },
    answers: answers[0],
    isOnline: Boolean(online[0]?.is_online),
    onARide: Boolean(online[0]?.active_ride_id),
    toCollect: collect.map((c) => ({ shareId: c.share_id, amountKes: c.amount_kes, rideId: c.ride_id, riderName: c.rider_name, at: c.completed_at, dropoff: c.dropoff })),
    recent: h.rides.slice(0, 5),
  };
}

async function history(userId) {
  const { rows } = await pool.query(
    `SELECT r.ride_id, r.status, r.completed_at, r.created_at, r.total_km, r.total_cost_kes,
            (SELECT count(*)::int FROM ride_shares s WHERE s.ride_id = r.ride_id) AS riders,
            (SELECT COALESCE(sum(amount_kes), 0)::int FROM ride_shares s WHERE s.ride_id = r.ride_id AND s.status = 'paid') AS paid_kes,
            (SELECT string_agg(DISTINCT t.dropoff_label, ', ') FROM trip_requests t WHERE t.ride_id = r.ride_id) AS places
       FROM rides r WHERE r.driver_id = $1 AND r.status IN ('completed', 'cancelled') ORDER BY r.created_at DESC LIMIT 50`,
    [userId],
  );
  const { rows: ratings } = await pool.query(
    `SELECT stars, tags, comment, created_at FROM ratings WHERE ratee_id = $1 ORDER BY created_at DESC LIMIT 30`,
    [userId],
  );
  return {
    rides: rows.map((r) => ({ rideId: r.ride_id, status: r.status, at: r.completed_at || r.created_at, totalKm: r.total_km, totalKes: r.total_cost_kes, riders: r.riders, paidKes: r.paid_kes, places: r.places })),
    ratings: ratings.map((r) => ({ stars: r.stars, tags: r.tags, comment: r.comment, at: r.created_at })),
  };
}

module.exports = { canDrive, goOnline, goOffline, updateLocation, dropStaleDrivers, state, dashboard, history };
