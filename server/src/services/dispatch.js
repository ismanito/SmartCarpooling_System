/**
 * Dispatch: finds the nearest suitable online driver for a ride request, offers it to them, and pools riders
 * heading to the same area into one car.
 *
 * Lock order is always request -> offer -> driver_status -> ride, so concurrent accepts, declines, expiries and
 * cancellations can never deadlock or assign one request twice.
 */
const { pool, withTransaction } = require('../db/pool');
const { errors } = require('../lib/errors');
const { routeKm } = require('../lib/places');
const { estimateShare } = require('../lib/fare');
const { etaMinutes, zonesCompatible, cheapestInsertion, scoreCandidate, rankCandidates } = require('../lib/dispatch');
const { appendAudit } = require('./audit');
const { notify } = require('./notify');
const { tagPoint, neighbourMap } = require('./zones');
const realtime = require('./realtime');

// ---------------------------------------------------------------- settings

const SETTING_KEYS = {
  dispatch_radius_km: ['dispatchRadiusKm', 3],
  offer_timeout_s: ['offerTimeoutS', 20],
  max_offers_per_request: ['maxOffers', 5],
  max_riders_per_car: ['maxRiders', 3],
  max_extra_minutes_per_rider: ['maxExtraMin', 8],
  scheduled_dispatch_lead_min: ['leadMin', 20],
  no_show_wait_s: ['noShowWaitS', 300],
  avg_speed_kmh: ['speedKmh', 25],
  fuel_rate_kes_per_km: ['fuelRate', 24],
  fare_rounding_kes: ['rounding', 10],
};

async function loadSettings(db = pool) {
  const s = Object.fromEntries(Object.values(SETTING_KEYS));
  const { rows } = await db.query('SELECT setting_key, setting_value FROM system_settings WHERE setting_key = ANY($1)', [Object.keys(SETTING_KEYS)]);
  for (const r of rows) {
    const [name] = SETTING_KEYS[r.setting_key];
    const n = Number(r.setting_value);
    if (Number.isFinite(n)) s[name] = n;
  }
  return s;
}

// ---------------------------------------------------------------- shared SQL

const point = (lat, lng) => `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

const REQ_COLUMNS = `r.request_id, r.rider_id, r.series_id, r.group_id, r.type, r.pickup_label, r.pickup_zone, r.dropoff_label, r.dropoff_zone,
  r.scheduled_for, r.repeat_days, r.seats, r.status, r.route_km, r.est_share_kes, r.est_pooled_kes, r.ride_id, r.driver_id,
  r.cancel_reason, r.assigned_at, r.created_at,
  ST_Y(r.pickup_point::geometry) AS pickup_lat, ST_X(r.pickup_point::geometry) AS pickup_lng,
  ST_Y(r.dropoff_point::geometry) AS dropoff_lat, ST_X(r.dropoff_point::geometry) AS dropoff_lng`;

async function findRequest(db, requestId, { forUpdate = false } = {}) {
  const { rows } = await db.query(`SELECT ${REQ_COLUMNS} FROM trip_requests r WHERE r.request_id = $1${forUpdate ? ' FOR UPDATE OF r' : ''}`, [requestId]);
  return rows[0] || null;
}

const pickupPoint = (r) => ({ lat: r.pickup_lat, lng: r.pickup_lng });
const dropoffPoint = (r) => ({ lat: r.dropoff_lat, lng: r.dropoff_lng });

function toStop(s) {
  return { stopId: s.stop_id, requestId: s.request_id, kind: s.kind, point: { lat: s.lat, lng: s.lng } };
}

/** The not-yet-done stops of a ride, in driving order. */
async function remainingStops(db, rideId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT stop_id, request_id, kind, sequence, ST_Y(point::geometry) AS lat, ST_X(point::geometry) AS lng
       FROM ride_stops WHERE ride_id = $1 AND done_at IS NULL ORDER BY sequence${forUpdate ? ' FOR UPDATE' : ''}`,
    [rideId],
  );
  return rows.map(toStop);
}

async function audit(db, userId, action, entity, entityId, details = {}, ip = null) {
  await appendAudit(db, { userId, action, entity, entityId, ipAddress: ip, details });
}

const money = (n) => `KES ${n}`;

// ---------------------------------------------------------------- creating requests

/**
 * Validates and saves a ride request: tags both points with a zone (refusing places outside the pilot area),
 * estimates the rider's share (alone and pooled), and records it. Does not start dispatching.
 */
async function createRequest(db, { riderId, type, pickup, dropoff, seats, scheduledFor = null, repeatDays = null, seriesId = null }) {
  const [pz, dz] = await Promise.all([tagPoint(pickup, db), tagPoint(dropoff, db)]);
  if (!pz || !dz) {
    throw errors.badRequest('OUTSIDE_PILOT_AREA', 'Outside the pilot area. RideMate currently covers USIU and the Thika Road area, Westlands, the CBD and nearby.', [
      { field: !pz ? 'pickup' : 'dropoff', message: 'Outside the pilot area' },
    ]);
  }
  const km = routeKm(pickup, dropoff);
  const s = await loadSettings(db);
  const alone = estimateShare(km, s.fuelRate, s.rounding, 2);
  const pooled = estimateShare(km, s.fuelRate, s.rounding, 4);
  const status = type === 'scheduled' ? 'scheduled' : 'searching';
  const { rows } = await db.query(
    `INSERT INTO trip_requests (rider_id, series_id, type, pickup_point, pickup_label, pickup_zone, dropoff_point, dropoff_label, dropoff_zone,
                                scheduled_for, repeat_days, seats, status, route_km, est_share_kes, est_pooled_kes)
     VALUES ($1, $2, $3, ${point('$4', '$5')}, $6, $7, ${point('$8', '$9')}, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING request_id`,
    [riderId, seriesId, type, pickup.lat, pickup.lng, pickup.label, pz.zoneId, dropoff.lat, dropoff.lng, dropoff.label, dz.zoneId, scheduledFor, repeatDays, seats, status, km, alone, pooled],
  );
  return findRequest(db, rows[0].request_id);
}

// ---------------------------------------------------------------- finding drivers

/** Online, eligible drivers near a pick-up who have not already been offered this request or hold another offer. */
async function nearbyDrivers(db, request, seats, s, { excludeRecentSeconds = null } = {}) {
  const { rows } = await db.query(
    `SELECT ds.driver_id, ds.seats_free, ds.active_ride_id, u.avg_rating, u.full_name,
            ST_Y(ds.current_location::geometry) AS lat, ST_X(ds.current_location::geometry) AS lng,
            ST_Distance(ds.current_location, r.pickup_point) AS dist_m
       FROM trip_requests r
       JOIN driver_status ds ON ds.is_online AND ds.current_location IS NOT NULL
       JOIN users u ON u.user_id = ds.driver_id
       JOIN vehicles v ON v.vehicle_id = ds.vehicle_id
      WHERE r.request_id = $1
        AND ds.last_seen_at > now() - interval '90 seconds'
        AND ds.seats_free >= $2
        AND u.status = 'active' AND u.is_verified
        AND (u.role = 'student' OR (u.role = 'driver' AND EXISTS (SELECT 1 FROM driver_applications da WHERE da.user_id = u.user_id AND da.status = 'approved')))
        AND ds.driver_id <> r.rider_id
        AND ST_DWithin(ds.current_location, r.pickup_point, $3)
        AND NOT EXISTS (SELECT 1 FROM dispatch_offers o
                         WHERE o.request_id = r.request_id AND o.driver_id = ds.driver_id
                           AND ($4::int IS NULL OR o.sent_at > now() - make_interval(secs => $4)))
        AND NOT EXISTS (SELECT 1 FROM dispatch_offers o2 WHERE o2.driver_id = ds.driver_id AND o2.response IS NULL AND o2.expires_at > now())
      ORDER BY ds.current_location <-> r.pickup_point
      LIMIT 20`,
    [request.request_id, seats, s.dispatchRadiusKm * 1000, excludeRecentSeconds],
  );
  return rows;
}

/** Scores each nearby driver, dropping those who cannot take the rider without breaking the pooling rules. */
async function evaluateDrivers(db, request, drivers, seats, s) {
  const neighbours = await neighbourMap(db);
  const evaluated = [];
  for (const d of drivers) {
    const here = { lat: d.lat, lng: d.lng };
    if (!d.active_ride_id) {
      const eta = etaMinutes(here, pickupPoint(request), s.speedKmh);
      evaluated.push({ driverId: d.driver_id, name: d.full_name, rating: Number(d.avg_rating), pooled: false, pickupEtaMin: eta, extraMinutes: 0, score: scoreCandidate({ pickupEtaMin: eta }) });
      continue;
    }
    // Already carrying riders: they must be going to the same area, and there must be room.
    const { rows: aboard } = await db.query(
      `SELECT dropoff_zone, seats FROM trip_requests WHERE ride_id = $1 AND status IN ('assigned', 'picked_up')`,
      [d.active_ride_id],
    );
    if (aboard.length + 1 > s.maxRiders) continue;
    if (!zonesCompatible(aboard.map((a) => a.dropoff_zone), request.dropoff_zone, neighbours)) continue;
    const stops = await remainingStops(db, d.active_ride_id);
    const fit = cheapestInsertion({
      driverPoint: here,
      stops,
      pickup: pickupPoint(request),
      dropoff: dropoffPoint(request),
      requestId: request.request_id,
      maxExtraMin: s.maxExtraMin,
      speedKmh: s.speedKmh,
    });
    if (!fit) continue;
    evaluated.push({
      driverId: d.driver_id,
      name: d.full_name,
      rating: Number(d.avg_rating),
      pooled: true,
      pickupEtaMin: fit.pickupEtaMin,
      extraMinutes: fit.extraMinutes,
      score: scoreCandidate(fit),
    });
  }
  return rankCandidates(evaluated);
}

// ---------------------------------------------------------------- offering

function offerPayload(offer, request) {
  return {
    offerId: offer.offer_id,
    requestId: request.request_id,
    expiresAt: offer.expires_at,
    seconds: Math.max(0, Math.round((new Date(offer.expires_at) - Date.now()) / 1000)),
    pickup: { label: request.pickup_label, lat: request.pickup_lat, lng: request.pickup_lng },
    dropoffLabel: request.dropoff_label,
    pickupEtaMin: Math.round(offer.pickup_eta_min),
    extraMinutes: Math.round(offer.extra_minutes || 0),
    pooled: offer.pooled,
    estShareKes: request.est_share_kes,
  };
}

async function noDriver(db, request, reason) {
  await db.query(`UPDATE trip_requests SET status = 'no_driver' WHERE request_id = $1`, [request.request_id]);
  await audit(db, null, 'dispatch.no_driver', 'trip_request', request.request_id, { request_id: request.request_id, reason });
  await notify(db, {
    userId: request.rider_id,
    type: 'request.no_driver',
    message: request.type === 'scheduled' ? 'We could not find a driver for your booking. You can cancel it or try again.' : 'No driver is available near you right now. Try again, or book for later.',
    link: '/',
    email: request.type === 'scheduled',
  });
  realtime.emitToUser(request.rider_id, 'request:update', { requestId: request.request_id, status: 'no_driver' });
}

/**
 * Offers a searching request to the best remaining driver, or gives up when nobody is left.
 * Safe to call repeatedly: it does nothing while another driver still holds an unanswered offer.
 */
async function dispatchRequest(requestId) {
  return withTransaction(async (client) => {
    const request = await findRequest(client, requestId, { forUpdate: true });
    if (!request || request.status !== 'searching') return { status: request?.status ?? 'missing' };
    if (request.group_id && request.group_id !== request.request_id) return { status: 'grouped' }; // the group leader drives dispatch

    const { rows: pending } = await client.query(`SELECT 1 FROM dispatch_offers WHERE request_id = $1 AND response IS NULL AND expires_at > now()`, [requestId]);
    if (pending.length > 0) return { status: 'offered' };

    const s = await loadSettings(client);
    const scheduled = request.type === 'scheduled';
    if (scheduled && new Date(request.scheduled_for) < new Date()) {
      await noDriver(client, request, 'pickup_time_passed');
      return { status: 'no_driver' };
    }
    if (!scheduled) {
      const { rows } = await client.query('SELECT count(*)::int AS n FROM dispatch_offers WHERE request_id = $1', [requestId]);
      if (rows[0].n >= s.maxOffers) {
        await noDriver(client, request, 'max_offers_reached');
        return { status: 'no_driver' };
      }
    }

    // A group of pooled bookings travels together, so the offer is for all their seats.
    const { rows: members } = await client.query(`SELECT seats FROM trip_requests WHERE group_id = $1 AND status = 'searching'`, [request.group_id ?? request.request_id]);
    const seats = members.length > 0 ? members.reduce((n, m) => n + m.seats, 0) : request.seats;

    const nearby = await nearbyDrivers(client, request, seats, s, { excludeRecentSeconds: scheduled ? 90 : null });
    const ranked = await evaluateDrivers(client, request, nearby, seats, s);
    if (ranked.length === 0) {
      if (scheduled) return { status: 'searching' }; // keep trying until pick-up time
      await noDriver(client, request, 'no_candidates');
      return { status: 'no_driver' };
    }

    const best = ranked[0];
    const { rows: offerRows } = await client.query(
      `INSERT INTO dispatch_offers (request_id, driver_id, expires_at, pickup_eta_min, extra_minutes, score, pooled)
       VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5, $6, $7)
       RETURNING offer_id, expires_at, pickup_eta_min, extra_minutes, pooled`,
      [requestId, best.driverId, s.offerTimeoutS, best.pickupEtaMin, best.extraMinutes, best.score, best.pooled],
    );
    await client.query(`UPDATE trip_requests SET status = 'offered' WHERE request_id = $1`, [requestId]);
    await audit(client, null, 'dispatch.offer', 'dispatch_offer', offerRows[0].offer_id, {
      offer_id: offerRows[0].offer_id,
      request_id: requestId,
      driver_id: best.driverId,
      pickup_eta_min: Math.round(best.pickupEtaMin * 10) / 10,
      pooled: best.pooled,
    });
    realtime.emitToUser(best.driverId, 'offer:new', offerPayload(offerRows[0], request));
    realtime.emitToUser(request.rider_id, 'request:update', { requestId, status: 'offered' });
    return { status: 'offered', driverId: best.driverId, offerId: offerRows[0].offer_id };
  });
}

// ---------------------------------------------------------------- putting riders into a car

/**
 * Adds a request to a driver's ride (creating the ride if they have none), placing the stops where they cost the
 * existing riders least. Throws code INFEASIBLE if pooling is no longer possible. Caller holds the locks.
 */
async function addToRide(db, { driver, request, s, now = new Date() }) {
  const start = { lat: driver.lat, lng: driver.lng };
  let rideId = driver.active_ride_id;
  let existing = [];
  if (rideId) existing = await remainingStops(db, rideId, { forUpdate: true });

  const fit = cheapestInsertion({
    driverPoint: start,
    stops: existing,
    pickup: pickupPoint(request),
    dropoff: dropoffPoint(request),
    requestId: request.request_id,
    maxExtraMin: s.maxExtraMin,
    speedKmh: s.speedKmh,
  });
  if (!fit) throw Object.assign(new Error('Pooling is no longer possible'), { code: 'INFEASIBLE' });

  if (!rideId) {
    const { rows } = await db.query(`INSERT INTO rides (driver_id, vehicle_id) SELECT $1::uuid, vehicle_id FROM driver_status WHERE driver_id = $1::uuid RETURNING ride_id`, [driver.driver_id]);
    rideId = rows[0].ride_id;
  }

  // Walk the new order, giving each stop its sequence number and an estimated arrival time.
  let at = start;
  let t = 0;
  let seq = 0;
  const labels = new Map([[`new-pickup-${request.request_id}`, request.pickup_label], [`new-dropoff-${request.request_id}`, request.dropoff_label]]);
  for (const stop of fit.stops) {
    seq += 1;
    t += etaMinutes(at, stop.point, s.speedKmh);
    at = stop.point;
    const eta = new Date(now.getTime() + t * 60_000);
    if (stop.stopId.startsWith('new-')) {
      await db.query(
        `INSERT INTO ride_stops (ride_id, request_id, kind, point, label, sequence, eta) VALUES ($1, $2, $3, ${point('$4', '$5')}, $6, $7, $8)`,
        [rideId, request.request_id, stop.kind, stop.point.lat, stop.point.lng, labels.get(stop.stopId), seq, eta],
      );
    } else {
      await db.query('UPDATE ride_stops SET sequence = $2, eta = $3 WHERE stop_id = $1', [stop.stopId, seq, eta]);
    }
  }

  await db.query(
    `UPDATE trip_requests SET status = 'assigned', ride_id = $2, driver_id = $3, group_id = NULL, assigned_at = now() WHERE request_id = $1`,
    [request.request_id, rideId, driver.driver_id],
  );
  await db.query('UPDATE driver_status SET seats_free = seats_free - $2, active_ride_id = $3 WHERE driver_id = $1', [driver.driver_id, request.seats, rideId]);
  return { rideId, fit };
}

async function lockDriver(db, driverId) {
  const { rows } = await db.query(
    `SELECT driver_id, is_online, seats_free, active_ride_id, vehicle_id,
            ST_Y(current_location::geometry) AS lat, ST_X(current_location::geometry) AS lng
       FROM driver_status WHERE driver_id = $1 FOR UPDATE`,
    [driverId],
  );
  return rows[0] || null;
}

/** Tells everyone in a ride (and the driver) to refresh. */
async function pingRide(db, rideId, extra = {}) {
  const { rows } = await db.query(
    `SELECT driver_id AS user_id FROM rides WHERE ride_id = $1
     UNION SELECT rider_id FROM trip_requests WHERE ride_id = $1 AND status IN ('assigned', 'picked_up')`,
    [rideId],
  );
  for (const r of rows) realtime.emitToUser(r.user_id, 'ride:update', { rideId, ...extra });
}

// ---------------------------------------------------------------- driver answers

/** Locks request -> offer -> driver and checks the offer is still live. */
async function lockOffer(client, offerId, driverId) {
  const { rows: peek } = await client.query('SELECT request_id FROM dispatch_offers WHERE offer_id = $1', [offerId]);
  if (!peek[0]) throw errors.notFound('Offer not found.');
  const request = await findRequest(client, peek[0].request_id, { forUpdate: true });
  const { rows } = await client.query('SELECT * FROM dispatch_offers WHERE offer_id = $1 FOR UPDATE', [offerId]);
  const offer = rows[0];
  if (!offer || offer.driver_id !== driverId) throw errors.notFound('Offer not found.');
  return { request, offer };
}

async function acceptOffer({ offerId, driverId, ip }) {
  const result = await withTransaction(async (client) => {
    const { request, offer } = await lockOffer(client, offerId, driverId);
    if (offer.response) throw errors.conflict('OFFER_CLOSED', `This request was already ${offer.response}.`);
    if (new Date(offer.expires_at) <= new Date()) throw errors.conflict('OFFER_EXPIRED', 'This request has expired.');
    if (request.status !== 'offered') throw errors.conflict('REQUEST_TAKEN', 'This request is no longer available.');

    const driver = await lockDriver(client, driverId);
    const s = await loadSettings(client);
    const { rows: group } = await client.query(
      `SELECT request_id FROM trip_requests WHERE group_id = $1 AND request_id <> $2 AND status = 'searching' ORDER BY scheduled_for`,
      [request.group_id ?? request.request_id, request.request_id],
    );
    const everyone = [request, ...(await Promise.all(group.map((g) => findRequest(client, g.request_id, { forUpdate: true }))))];
    const seatsNeeded = everyone.reduce((n, r) => n + r.seats, 0);
    if (!driver || !driver.is_online || driver.seats_free < seatsNeeded) {
      throw errors.conflict('NO_SEATS', 'You can no longer take this request.');
    }

    let rideId = null;
    const unplaced = [];
    for (const r of everyone) {
      try {
        const fresh = await lockDriver(client, driverId);
        ({ rideId } = await addToRide(client, { driver: fresh, request: r, s }));
      } catch (err) {
        if (err.code !== 'INFEASIBLE') throw err;
        unplaced.push(r);
      }
    }
    if (!everyone.some((r) => !unplaced.includes(r))) throw errors.conflict('POOLING_FAILED', 'This request no longer fits your route.');

    // Group members who could not be placed go back to searching on their own.
    for (const r of unplaced) await client.query(`UPDATE trip_requests SET status = 'searching', group_id = NULL WHERE request_id = $1`, [r.request_id]);
    await client.query(`UPDATE dispatch_offers SET response = 'accepted', responded_at = now() WHERE offer_id = $1`, [offerId]);
    await audit(client, driverId, 'dispatch.accept', 'dispatch_offer', offerId, { offer_id: offerId, request_id: request.request_id, ride_id: rideId }, ip);

    const placed = everyone.filter((r) => !unplaced.includes(r));
    const { rows: vehicle } = await client.query(
      `SELECT v.make_model, v.plate_number, v.colour, u.full_name FROM driver_status ds
         JOIN vehicles v ON v.vehicle_id = ds.vehicle_id JOIN users u ON u.user_id = ds.driver_id WHERE ds.driver_id = $1`,
      [driverId],
    );
    for (const r of placed) {
      await audit(client, driverId, 'ride.assign', 'ride', rideId, { ride_id: rideId, request_id: r.request_id, driver_id: driverId, rider_id: r.rider_id }, ip);
      await notify(client, {
        userId: r.rider_id,
        type: 'ride.assigned',
        message: `${vehicle[0].full_name.split(' ')[0]} is on the way in a ${vehicle[0].colour} ${vehicle[0].make_model}, plate ${vehicle[0].plate_number}.`,
        link: '/',
        email: true,
      });
    }
    // People already in the car hear that someone is joining.
    const { rows: others } = await client.query(
      `SELECT rider_id FROM trip_requests WHERE ride_id = $1 AND status IN ('assigned', 'picked_up') AND request_id <> ALL($2::uuid[])`,
      [rideId, placed.map((r) => r.request_id)],
    );
    for (const o of others) {
      await notify(client, { userId: o.rider_id, type: 'ride.joined', message: 'Another student heading your way is joining your ride.', link: '/' });
    }
    return { rideId, placed, unplaced };
  });

  for (const r of result.placed) realtime.emitToUser(r.rider_id, 'request:update', { requestId: r.request_id, status: 'assigned', rideId: result.rideId });
  await withTransaction((c) => pingRide(c, result.rideId));
  for (const r of result.unplaced) await dispatchRequest(r.request_id);
  return { rideId: result.rideId };
}

async function declineOffer({ offerId, driverId, ip }) {
  const request = await withTransaction(async (client) => {
    const { request: req, offer } = await lockOffer(client, offerId, driverId);
    if (offer.response) throw errors.conflict('OFFER_CLOSED', `This request was already ${offer.response}.`);
    await client.query(`UPDATE dispatch_offers SET response = 'declined', responded_at = now() WHERE offer_id = $1`, [offerId]);
    if (req.status === 'offered') await client.query(`UPDATE trip_requests SET status = 'searching' WHERE request_id = $1`, [req.request_id]);
    await audit(client, driverId, 'dispatch.decline', 'dispatch_offer', offerId, { offer_id: offerId, request_id: req.request_id }, ip);
    return req;
  });
  await dispatchRequest(request.request_id); // on to the next driver
  return { requestId: request.request_id };
}

/** Marks unanswered offers past their deadline as expired and moves each request on to the next driver. */
async function sweepExpiredOffers() {
  const { rows } = await pool.query(`SELECT offer_id, request_id, driver_id FROM dispatch_offers WHERE response IS NULL AND expires_at <= now() LIMIT 50`);
  const moveOn = [];
  for (const o of rows) {
    const done = await withTransaction(async (client) => {
      const request = await findRequest(client, o.request_id, { forUpdate: true });
      const { rows: cur } = await client.query('SELECT response FROM dispatch_offers WHERE offer_id = $1 FOR UPDATE', [o.offer_id]);
      if (!cur[0] || cur[0].response) return false;
      await client.query(`UPDATE dispatch_offers SET response = 'expired', responded_at = now() WHERE offer_id = $1`, [o.offer_id]);
      if (request?.status === 'offered') await client.query(`UPDATE trip_requests SET status = 'searching' WHERE request_id = $1`, [o.request_id]);
      await audit(client, null, 'dispatch.expire', 'dispatch_offer', o.offer_id, { offer_id: o.offer_id, request_id: o.request_id, driver_id: o.driver_id });
      return true;
    });
    if (done) {
      realtime.emitToUser(o.driver_id, 'offer:gone', { offerId: o.offer_id });
      moveOn.push(o.request_id);
    }
  }
  for (const id of new Set(moveOn)) await dispatchRequest(id);
  return moveOn.length;
}

// ---------------------------------------------------------------- cancelling

/** Removes a request from its ride (before pick-up), frees the seats and, if the car is now empty, ends the ride. */
async function releaseFromRide(db, request) {
  await db.query('DELETE FROM ride_stops WHERE ride_id = $1 AND request_id = $2 AND done_at IS NULL', [request.ride_id, request.request_id]);
  await db.query('UPDATE driver_status SET seats_free = seats_free + $2 WHERE driver_id = $1', [request.driver_id, request.seats]);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM trip_requests WHERE ride_id = $1 AND status IN ('assigned', 'picked_up') AND request_id <> $2`, [request.ride_id, request.request_id]);
  if (rows[0].n === 0) {
    await db.query(`UPDATE rides SET status = 'cancelled', completed_at = now() WHERE ride_id = $1`, [request.ride_id]);
    await db.query('UPDATE driver_status SET active_ride_id = NULL WHERE driver_id = $1 AND active_ride_id = $2', [request.driver_id, request.ride_id]);
  } else {
    // Renumber what is left so the stop list has no gaps.
    await db.query(
      `UPDATE ride_stops s SET sequence = n.rn FROM (SELECT stop_id, row_number() OVER (ORDER BY sequence) AS rn FROM ride_stops WHERE ride_id = $1 AND done_at IS NULL) n WHERE s.stop_id = n.stop_id`,
      [request.ride_id],
    );
  }
}

async function cancelRequest({ requestId, riderId, reason = 'rider_cancelled', ip }) {
  const out = await withTransaction(async (client) => {
    const request = await findRequest(client, requestId, { forUpdate: true });
    if (!request || request.rider_id !== riderId) throw errors.notFound('Request not found.');
    if (['cancelled', 'completed'].includes(request.status)) return { already: true, request };
    if (request.status === 'picked_up') throw errors.conflict('IN_PROGRESS', 'You are already in the car. Ask the driver to end the ride.');

    const { rows: pending } = await client.query(`UPDATE dispatch_offers SET response = 'expired', responded_at = now() WHERE request_id = $1 AND response IS NULL RETURNING driver_id, offer_id`, [requestId]);
    let driverToTell = null;
    if (request.status === 'assigned') {
      const driver = await lockDriver(client, request.driver_id);
      if (driver) {
        await releaseFromRide(client, request);
        driverToTell = request.driver_id;
      }
    }
    await client.query(`UPDATE trip_requests SET status = 'cancelled', cancel_reason = $2, ride_id = CASE WHEN status = 'assigned' THEN ride_id ELSE NULL END WHERE request_id = $1`, [requestId, reason]);
    await audit(client, riderId, 'request.cancel', 'trip_request', requestId, { request_id: requestId, was: request.status, reason }, ip);
    if (driverToTell) {
      await notify(client, { userId: driverToTell, type: 'ride.cancelled', message: `${request.pickup_label} to ${request.dropoff_label}: the rider cancelled.`, link: '/drive' });
    }
    return { request, pending, driverToTell };
  });
  if (out.already) return { cancelled: true };
  for (const p of out.pending || []) realtime.emitToUser(p.driver_id, 'offer:gone', { offerId: p.offer_id });
  if (out.driverToTell) await withTransaction((c) => pingRide(c, out.request.ride_id));
  realtime.emitToUser(riderId, 'request:update', { requestId, status: 'cancelled' });
  return { cancelled: true };
}

module.exports = {
  loadSettings,
  findRequest,
  remainingStops,
  createRequest,
  dispatchRequest,
  acceptOffer,
  declineOffer,
  sweepExpiredOffers,
  cancelRequest,
  releaseFromRide,
  lockDriver,
  pingRide,
  offerPayload,
  REQ_COLUMNS,
  money,
};
