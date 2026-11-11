/**
 * What happens during a ride: arriving, picking up, dropping off, no-shows, finishing, fare shares, the live view,
 * ratings and SOS. Every action is checked against who is allowed to do it and written to the audit log.
 */
const { pool, withTransaction } = require('../db/pool');
const { errors, PG } = require('../lib/errors');
const { routeKm } = require('../lib/places');
const { calculateLegFares } = require('../lib/fare');
const { appendAudit } = require('./audit');
const { notify, notifyMany, adminIds } = require('./notify');
const { zoneNames } = require('./zones');
const realtime = require('./realtime');
const dispatch = require('./dispatch');
const verification = require('./verification');

const STOP_COLUMNS = `s.stop_id, s.request_id, s.kind, s.label, s.sequence, s.eta, s.arrived_at, s.done_at, s.no_show,
  ST_Y(s.point::geometry) AS lat, ST_X(s.point::geometry) AS lng`;

/** Locks the ride, checks the caller is its driver, and returns it. */
async function lockOwnRide(client, rideId, driverId) {
  const { rows } = await client.query('SELECT * FROM rides WHERE ride_id = $1 FOR UPDATE', [rideId]);
  const ride = rows[0];
  if (!ride || ride.driver_id !== driverId) throw errors.notFound('Ride not found.');
  if (['completed', 'cancelled'].includes(ride.status)) throw errors.conflict('RIDE_OVER', `This ride is already ${ride.status}.`);
  return ride;
}

async function lockStop(client, rideId, stopId) {
  const { rows } = await client.query(`SELECT ${STOP_COLUMNS} FROM ride_stops s WHERE s.stop_id = $1 AND s.ride_id = $2 FOR UPDATE`, [stopId, rideId]);
  if (!rows[0]) throw errors.notFound('Stop not found.');
  return rows[0];
}

async function riderOf(client, requestId) {
  return dispatch.findRequest(client, requestId, { forUpdate: true });
}

// ---------------------------------------------------------------- stops

async function arrived({ rideId, stopId, driverId, ip }) {
  const request = await withTransaction(async (client) => {
    await lockOwnRide(client, rideId, driverId);
    const stop = await lockStop(client, rideId, stopId);
    if (stop.done_at) throw errors.conflict('STOP_DONE', 'This stop is already done.');
    if (!stop.arrived_at) await client.query('UPDATE ride_stops SET arrived_at = now() WHERE stop_id = $1', [stopId]);
    const request = await riderOf(client, stop.request_id);
    await appendAudit(client, { userId: driverId, action: 'ride.arrived', entity: 'ride_stop', entityId: stopId, ipAddress: ip, details: { ride_id: rideId, stop_id: stopId, request_id: stop.request_id, kind: stop.kind } });
    if (stop.kind === 'pickup') {
      await notify(client, { userId: request.rider_id, type: 'ride.arrived', message: 'Your driver has arrived at the pick-up point.', link: '/' });
    }
    return request;
  });
  await withTransaction((c) => dispatch.pingRide(c, rideId));
  void request;
}

/** Fare shares for the stretch of road a rider was actually in the car, split with everyone else aboard. */
async function legsSoFar(db, rideId) {
  const { rows } = await db.query(
    `SELECT ${STOP_COLUMNS}, r.seats FROM ride_stops s JOIN trip_requests r ON r.request_id = s.request_id
      WHERE s.ride_id = $1 AND s.done_at IS NOT NULL ORDER BY s.done_at, s.sequence`,
    [rideId],
  );
  const aboard = new Map(); // request id -> seats
  const legs = [];
  let prev = null;
  for (const stop of rows) {
    const here = { lat: stop.lat, lng: stop.lng };
    if (prev) {
      const riderIds = [];
      for (const [id, seats] of aboard) for (let i = 0; i < seats; i += 1) riderIds.push(id); // 2 seats pay twice
      legs.push({ km: routeKm(prev, here), riderIds });
    }
    if (stop.kind === 'pickup' && !stop.no_show) aboard.set(stop.request_id, stop.seats);
    if (stop.kind === 'dropoff') aboard.delete(stop.request_id);
    prev = here;
  }
  return legs;
}

async function done({ rideId, stopId, driverId, ip }) {
  const info = await withTransaction(async (client) => {
    const ride = await lockOwnRide(client, rideId, driverId);
    const stop = await lockStop(client, rideId, stopId);
    if (stop.done_at) throw errors.conflict('STOP_DONE', 'This stop is already done.');
    const request = await riderOf(client, stop.request_id);

    if (stop.kind === 'pickup' && !request.rider_confirmed_driver_at) {
      throw errors.conflict('RIDER_NOT_CONFIRMED', 'Wait for the rider to confirm they are getting into the right car.');
    }
    if (stop.kind === 'dropoff') {
      const { rows } = await client.query(`SELECT 1 FROM ride_stops WHERE ride_id = $1 AND request_id = $2 AND kind = 'pickup' AND done_at IS NOT NULL AND NOT no_show`, [rideId, stop.request_id]);
      if (rows.length === 0) throw errors.conflict('NOT_PICKED_UP', 'This rider has not been picked up yet.');
    }
    await client.query('UPDATE ride_stops SET done_at = now(), arrived_at = COALESCE(arrived_at, now()) WHERE stop_id = $1', [stopId]);

    let share = null;
    if (stop.kind === 'pickup') {
      await client.query(`UPDATE trip_requests SET status = 'picked_up' WHERE request_id = $1`, [request.request_id]);
      if (ride.status === 'heading_to_pickup') await client.query(`UPDATE rides SET status = 'in_progress', started_at = now() WHERE ride_id = $1`, [rideId]);
      await notify(client, { userId: request.rider_id, type: 'ride.started', message: 'You are on your way. Enjoy the ride.', link: '/' });
    } else {
      const s = await dispatch.loadSettings(client);
      const legs = await legsSoFar(client, rideId);
      const fare = calculateLegFares(legs, s.fuelRate, s.rounding);
      share = fare.shares[request.request_id] ?? 0;
      await client.query(`UPDATE trip_requests SET status = 'completed' WHERE request_id = $1`, [request.request_id]);
      await client.query(
        `INSERT INTO ride_shares (ride_id, request_id, rider_id, amount_kes) VALUES ($1, $2, $3, $4) ON CONFLICT (ride_id, request_id) DO NOTHING`,
        [rideId, request.request_id, request.rider_id, share],
      );
      await notify(client, {
        userId: request.rider_id,
        type: 'ride.dropped_off',
        message: `You have arrived. Your share is KES ${share}. Pay your driver, then rate the ride.`,
        link: '/',
        email: true,
      });
    }
    await appendAudit(client, {
      userId: driverId,
      action: stop.kind === 'pickup' ? 'ride.picked_up' : 'ride.dropped_off',
      entity: 'ride_stop',
      entityId: stopId,
      ipAddress: ip,
      details: { ride_id: rideId, stop_id: stopId, request_id: request.request_id, rider_id: request.rider_id, ...(share !== null ? { share_kes: share } : {}) },
    });
    return { request, share };
  });
  realtime.emitToUser(info.request.rider_id, 'request:update', { requestId: info.request.request_id, status: info.share !== null ? 'completed' : 'picked_up' });
  await withTransaction((c) => dispatch.pingRide(c, rideId));
  return { shareKes: info.share };
}

/** After the wait is over, the driver can release the seat and move on. */
async function noShow({ rideId, stopId, driverId, ip }) {
  const request = await withTransaction(async (client) => {
    await lockOwnRide(client, rideId, driverId);
    const stop = await lockStop(client, rideId, stopId);
    if (stop.kind !== 'pickup' || stop.done_at) throw errors.conflict('NOT_A_PICKUP', 'Only a waiting pick-up can be marked as a no-show.');
    const s = await dispatch.loadSettings(client);
    if (!stop.arrived_at) throw errors.conflict('NOT_ARRIVED', 'Tap Arrived first. The wait starts then.');
    const waited = (Date.now() - new Date(stop.arrived_at).getTime()) / 1000;
    if (waited < s.noShowWaitS) {
      throw errors.conflict('TOO_EARLY', `Wait ${Math.ceil((s.noShowWaitS - waited) / 60)} more minute(s) before marking a no-show.`);
    }
    const req = await riderOf(client, stop.request_id);
    await client.query('UPDATE ride_stops SET done_at = now(), no_show = true WHERE stop_id = $1', [stopId]);
    await dispatch.lockDriver(client, driverId);
    await dispatch.releaseFromRide(client, req);
    await client.query(`UPDATE trip_requests SET status = 'cancelled', cancel_reason = 'no_show' WHERE request_id = $1`, [req.request_id]);
    await appendAudit(client, { userId: driverId, action: 'ride.no_show', entity: 'ride_stop', entityId: stopId, ipAddress: ip, details: { ride_id: rideId, stop_id: stopId, request_id: req.request_id, rider_id: req.rider_id } });
    await notify(client, { userId: req.rider_id, type: 'ride.no_show', message: 'Your driver waited at the pick-up point and could not find you, so the ride was cancelled.', link: '/', email: true });
    return req;
  });
  realtime.emitToUser(request.rider_id, 'request:update', { requestId: request.request_id, status: 'cancelled' });
  await withTransaction((c) => dispatch.pingRide(c, rideId));
}

// ---------------------------------------------------------------- the rider checks the driver

/**
 * Before the ride starts the rider confirms "this is my driver and car". If it does not match, the ride is cancelled
 * for them and an incident report opens by itself, so the team can look into it.
 */
async function confirmDriver({ rideId, riderId, matches, ip }) {
  const out = await withTransaction(async (client) => {
    const { rows: mine } = await client.query(`SELECT request_id FROM trip_requests WHERE ride_id = $1 AND rider_id = $2 AND status = 'assigned'`, [rideId, riderId]);
    if (!mine[0]) throw errors.notFound('Ride not found.');
    const request = await dispatch.findRequest(client, mine[0].request_id, { forUpdate: true });
    if (request.status !== 'assigned') throw errors.conflict('NOT_WAITING', 'This ride is already under way.');
    const { rows: ride } = await client.query('SELECT driver_id FROM rides WHERE ride_id = $1', [rideId]);
    const driverId = ride[0].driver_id;

    if (matches) {
      await client.query('UPDATE trip_requests SET rider_confirmed_driver_at = now() WHERE request_id = $1', [request.request_id]);
      await appendAudit(client, { userId: riderId, action: 'ride.driver_confirmed', entity: 'ride', entityId: rideId, ipAddress: ip, details: { ride_id: rideId, request_id: request.request_id, driver_id: driverId } });
      return { matches: true, driverId };
    }

    await dispatch.lockDriver(client, driverId);
    await dispatch.releaseFromRide(client, request);
    await client.query(`UPDATE trip_requests SET status = 'cancelled', cancel_reason = 'driver_mismatch' WHERE request_id = $1`, [request.request_id]);
    const { rows: report } = await client.query(
      `INSERT INTO incident_reports (reporter_id, reported_user_id, ride_id, category, description)
       VALUES ($1, $2, $3, 'driver_mismatch', 'The rider said the driver or car did not match what the app showed, and cancelled before getting in.') RETURNING report_id`,
      [riderId, driverId, rideId],
    );
    await appendAudit(client, {
      userId: riderId,
      action: 'incident.report',
      entity: 'incident_report',
      entityId: report[0].report_id,
      ipAddress: ip,
      details: { report_id: report[0].report_id, ride_id: rideId, reporter_id: riderId, reported_user_id: driverId, category: 'driver_mismatch' },
    });
    await appendAudit(client, { userId: riderId, action: 'ride.driver_mismatch', entity: 'ride', entityId: rideId, ipAddress: ip, details: { ride_id: rideId, request_id: request.request_id, driver_id: driverId, report_id: report[0].report_id } });
    await notify(client, { userId: driverId, type: 'ride.cancelled', message: 'The rider cancelled because they could not match you or your car to the app. The team will look into it.', link: '/drive' });
    await notifyMany(client, await adminIds(client), { type: 'incident.new', message: 'A rider said the driver or car did not match. A report was opened automatically.', link: `/admin?tab=incidents&id=${report[0].report_id}`, email: true });
    return { matches: false, driverId, requestId: request.request_id };
  });
  realtime.emitToUser(riderId, 'request:update', { requestId: out.requestId, status: out.matches ? 'assigned' : 'cancelled' });
  await withTransaction((c) => dispatch.pingRide(c, rideId));
  if (!out.matches) await verification.suspendIfUnsafe(out.driverId); // repeated reports can suspend a driver
  return { matches: out.matches };
}

// ---------------------------------------------------------------- finishing

async function completeRide({ rideId, driverId, ip }) {
  const result = await withTransaction(async (client) => {
    const ride = await lockOwnRide(client, rideId, driverId);
    const left = await dispatch.remainingStops(client, rideId);
    if (left.length > 0) throw errors.conflict('STOPS_PENDING', 'Finish every pick-up and drop-off first.');
    const { rows: dropped } = await client.query(`SELECT 1 FROM ride_stops WHERE ride_id = $1 AND kind = 'dropoff' AND done_at IS NOT NULL LIMIT 1`, [rideId]);
    if (dropped.length === 0) throw errors.conflict('NOTHING_TO_COMPLETE', 'Nobody was dropped off on this ride.');

    const s = await dispatch.loadSettings(client);
    const legs = await legsSoFar(client, rideId);
    const fare = calculateLegFares(legs, s.fuelRate, s.rounding);
    const { rows: paid } = await client.query('SELECT COALESCE(sum(amount_kes), 0)::int AS total FROM ride_shares WHERE ride_id = $1', [rideId]);
    const totalKes = Math.max(fare.totalKes, paid[0].total);
    const totalKm = Math.round(legs.reduce((n, l) => n + l.km, 0) * 100) / 100;

    await client.query(`UPDATE rides SET status = 'completed', completed_at = now(), total_km = $2, total_cost_kes = $3 WHERE ride_id = $1`, [rideId, totalKm, totalKes]);
    await client.query(
      `UPDATE driver_status SET active_ride_id = NULL, seats_free = (SELECT seat_capacity FROM vehicles WHERE vehicle_id = driver_status.vehicle_id) WHERE driver_id = $1`,
      [driverId],
    );
    const { rows: riders } = await client.query(`SELECT DISTINCT rider_id FROM trip_requests WHERE ride_id = $1 AND status = 'completed'`, [rideId]);
    await appendAudit(client, { userId: driverId, action: 'ride.complete', entity: 'ride', entityId: rideId, ipAddress: ip, details: { ride_id: rideId, total_km: totalKm, total_kes: totalKes, riders: riders.length, commission_kes: 0 } });
    await notifyMany(client, riders.map((r) => r.rider_id), { type: 'ride.completed', message: 'Your ride is complete. Please rate your driver.', link: '/' });
    return { ride, totalKes, totalKm, riders };
  });
  for (const r of result.riders) realtime.emitToUser(r.rider_id, 'ride:update', { rideId, status: 'completed' });
  realtime.emitToUser(driverId, 'ride:update', { rideId, status: 'completed' });
  return { totalKes: result.totalKes, totalKm: result.totalKm };
}

async function settleShare({ shareId, driverId, ip }) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT s.share_id, s.status, s.amount_kes, s.rider_id, r.driver_id FROM ride_shares s JOIN rides r ON r.ride_id = s.ride_id WHERE s.share_id = $1 FOR UPDATE OF s`,
      [shareId],
    );
    const share = rows[0];
    if (!share || share.driver_id !== driverId) throw errors.notFound('Payment not found.');
    if (share.status === 'paid') throw errors.conflict('SHARE_CLOSED', 'This share is already paid.');
    await client.query(`UPDATE ride_shares SET status = 'paid', method = 'cash', paid_at = now(), settled_by = $2 WHERE share_id = $1`, [shareId, driverId]);
    await appendAudit(client, { userId: driverId, action: 'payment.settle', entity: 'ride_share', entityId: shareId, ipAddress: ip, details: { share_id: shareId, amount_kes: share.amount_kes, rider_id: share.rider_id } });
    await notify(client, { userId: share.rider_id, type: 'payment.settled', message: `Your driver confirmed your KES ${share.amount_kes} share as paid.`, link: '/' });
  });
}

// ---------------------------------------------------------------- live view

/** Everyone in the ride: the driver, and riders still assigned or in the car. */
async function loadParticipants(db, rideId) {
  const { rows } = await db.query(
    `SELECT u.user_id, u.full_name, u.phone_number, u.avg_rating, 'driver' AS role, NULL::uuid AS request_id, 1 AS seats, NULL AS status
       FROM rides r JOIN users u ON u.user_id = r.driver_id WHERE r.ride_id = $1
     UNION ALL
     SELECT u.user_id, u.full_name, u.phone_number, u.avg_rating, 'rider', t.request_id, t.seats, t.status
       FROM trip_requests t JOIN users u ON u.user_id = t.rider_id WHERE t.ride_id = $1 AND t.status IN ('assigned', 'picked_up', 'completed')`,
    [rideId],
  );
  return rows;
}

/**
 * The ride as the caller may see it. The driver sees everything. A rider sees their own stops, only the area
 * other riders are going to, and the driver's position only until they have been dropped off.
 */
async function liveView({ rideId, userId }) {
  const { rows: rideRows } = await pool.query(
    `SELECT r.ride_id, r.status, r.total_km, r.total_cost_kes, r.driver_id, v.make_model, v.plate_number, v.colour,
            ds.is_online, ST_Y(ds.current_location::geometry) AS lat, ST_X(ds.current_location::geometry) AS lng, ds.heading, ds.last_seen_at
       FROM rides r LEFT JOIN vehicles v ON v.vehicle_id = r.vehicle_id LEFT JOIN driver_status ds ON ds.driver_id = r.driver_id
      WHERE r.ride_id = $1`,
    [rideId],
  );
  const ride = rideRows[0];
  if (!ride) throw errors.notFound('Ride not found.');
  const people = await loadParticipants(pool, rideId);
  const me = people.find((p) => p.user_id === userId);
  if (!me) throw errors.notFound('Ride not found.');
  const isDriver = me.role === 'driver';
  const myStatus = me.status;
  const zones = await zoneNames();
  const driver = people.find((p) => p.role === 'driver');
  const { rows: dtype } = await pool.query('SELECT driver_type FROM driver_verifications WHERE driver_id = $1', [driver.user_id]);

  const { rows: stopRows } = await pool.query(`SELECT ${STOP_COLUMNS} FROM ride_stops s WHERE s.ride_id = $1 ORDER BY s.sequence`, [rideId]);
  const { rows: reqRows } = await pool.query(`SELECT request_id, dropoff_zone, pickup_label, dropoff_label, rider_confirmed_driver_at FROM trip_requests WHERE ride_id = $1`, [rideId]);
  const reqById = new Map(reqRows.map((r) => [r.request_id, r]));
  const personByRequest = new Map(people.filter((p) => p.request_id).map((p) => [p.request_id, p]));

  const canSeeCar = isDriver ? ride.status !== 'completed' && ride.status !== 'cancelled' : ['assigned', 'picked_up'].includes(myStatus) && !['completed', 'cancelled'].includes(ride.status);
  const stops = stopRows
    .filter((s) => isDriver || s.request_id === me.request_id || !s.done_at)
    .map((s) => {
      const mine = s.request_id === me.request_id;
      const who = personByRequest.get(s.request_id);
      return {
        stopId: s.stop_id,
        kind: s.kind,
        sequence: s.sequence,
        eta: s.eta,
        arrivedAt: s.arrived_at,
        doneAt: s.done_at,
        noShow: s.no_show,
        mine,
        // Other riders appear only as an area, never as a place or a name.
        label: isDriver || mine ? s.label : zones.get(reqById.get(s.request_id)?.dropoff_zone) || 'Nearby',
        lat: isDriver || mine ? s.lat : undefined,
        lng: isDriver || mine ? s.lng : undefined,
        requestId: isDriver ? s.request_id : undefined,
        riderConfirmed: isDriver && s.kind === 'pickup' ? Boolean(reqById.get(s.request_id)?.rider_confirmed_driver_at) : undefined,
        riderName: isDriver ? who?.full_name : undefined,
        riderPhone: isDriver ? who?.phone_number : undefined,
      };
    });

  const { rows: shares } = await pool.query(
    `SELECT s.share_id, s.request_id, s.rider_id, s.amount_kes, s.status, u.full_name FROM ride_shares s JOIN users u ON u.user_id = s.rider_id WHERE s.ride_id = $1`,
    [rideId],
  );
  const { rows: given } = await pool.query('SELECT ratee_id FROM ratings WHERE ride_id = $1 AND rater_id = $2', [rideId, userId]);
  const others = people.filter((p) => p.role === 'rider' && p.user_id !== userId && ['assigned', 'picked_up', 'completed'].includes(p.status));

  return {
    role: me.role,
    ride: { rideId: ride.ride_id, status: ride.status, totalKm: ride.total_km, totalKes: ride.total_cost_kes },
    myRequestId: me.request_id,
    myStatus,
    confirmedDriver: Boolean(reqById.get(me.request_id)?.rider_confirmed_driver_at),
    driver: {
      userId: driver.user_id,
      firstName: driver.full_name.split(' ')[0],
      fullName: driver.full_name,
      typeLabel: dtype[0] ? require('../lib/verification').TYPE_LABEL[dtype[0].driver_type] : null,
      verified: Boolean(dtype[0]),
      rating: Number(driver.avg_rating),
      phoneNumber: isDriver ? undefined : driver.phone_number, // shared once the ride is assigned
      vehicle: { makeModel: ride.make_model, plateNumber: ride.plate_number, colour: ride.colour },
      location: canSeeCar && ride.lat != null ? { lat: ride.lat, lng: ride.lng, heading: ride.heading, updatedAt: ride.last_seen_at } : null,
    },
    pooled: others.length > 0,
    pooledWith: isDriver ? undefined : others.map((o) => ({ zone: zones.get(reqById.get(o.request_id)?.dropoff_zone) || 'nearby' })),
    stops,
    riders: isDriver ? people.filter((p) => p.role === 'rider').map((p) => ({ userId: p.user_id, requestId: p.request_id, fullName: p.full_name, rating: Number(p.avg_rating), seats: p.seats, status: p.status, iRated: given.some((g) => g.ratee_id === p.user_id) })) : undefined,
    shares: shares
      .filter((s) => isDriver || s.rider_id === userId)
      .map((s) => ({ shareId: s.share_id, requestId: s.request_id, riderName: s.full_name, amountKes: s.amount_kes, status: s.status, mine: s.rider_id === userId })),
    iRatedDriver: given.some((g) => g.ratee_id === driver.user_id),
  };
}

// ---------------------------------------------------------------- ratings and SOS

async function rate({ rideId, raterId, rateeId, stars, tags = [], comment, ip }) {
  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT status FROM rides WHERE ride_id = $1', [rideId]);
      if (!rows[0]) throw errors.notFound('Ride not found.');
      const people = await loadParticipants(client, rideId);
      const me = people.find((p) => p.user_id === raterId);
      const them = people.find((p) => p.user_id === rateeId);
      if (!me || !them || me.user_id === them.user_id) throw errors.notFound('Ride not found.');
      // Riders rate the driver; the driver rates each rider.
      if (me.role === them.role) throw errors.badRequest('VALIDATION_ERROR', 'You can rate the driver, or as the driver your riders.');
      const rider = me.role === 'rider' ? me : them;
      if (rider.status !== 'completed') throw errors.conflict('NOT_RATEABLE', 'You can rate someone once the ride is over.');
      await client.query('INSERT INTO ratings (ride_id, rater_id, ratee_id, stars, comment, tags) VALUES ($1, $2, $3, $4, $5, $6)', [rideId, raterId, rateeId, stars, comment || null, tags]);
      await client.query(`UPDATE users SET avg_rating = (SELECT round(avg(stars), 1) FROM ratings WHERE ratee_id = $1) WHERE user_id = $1`, [rateeId]);
      await appendAudit(client, { userId: raterId, action: 'rating.create', entity: 'ride', entityId: rideId, ipAddress: ip, details: { ride_id: rideId, ratee_id: rateeId, stars, tags } });
    });
    await verification.suspendIfUnsafe(rateeId);
  } catch (err) {
    if (err.code === PG.UNIQUE_VIOLATION) throw errors.conflict('ALREADY_RATED', 'You have already rated this person for this ride.');
    throw err;
  }
}

/** A rider in trouble: every admin is told straight away, with the ride to open, and it goes in the audit log. */
async function sos({ rideId, userId, ip }) {
  await withTransaction(async (client) => {
    const people = await loadParticipants(client, rideId);
    const me = people.find((p) => p.user_id === userId);
    if (!me) throw errors.notFound('Ride not found.');
    await appendAudit(client, { userId, action: 'ride.sos', entity: 'ride', entityId: rideId, ipAddress: ip, details: { ride_id: rideId, raised_by: userId, role: me.role } });
    const admins = await adminIds(client);
    await notifyMany(client, admins, { type: 'ride.sos', message: `SOS from ${me.full_name} during a ride. Open the live map now.`, link: `/admin?tab=live&ride=${rideId}`, email: true });
    realtime.emitToAdmins('sos', { rideId, by: me.full_name });
  });
}

module.exports = { arrived, done, noShow, completeRide, settleShare, liveView, rate, sos, confirmDriver, legsSoFar, loadParticipants };
