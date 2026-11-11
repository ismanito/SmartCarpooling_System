/**
 * Ride Now and Book: creating requests (one-off, scheduled, repeating), editing and cancelling them, and the
 * background worker that dispatches scheduled bookings, retries searches and tidies up.
 */
const crypto = require('node:crypto');
const { pool, withTransaction } = require('../db/pool');
const { config } = require('../config/env');
const { errors } = require('../lib/errors');
const { appendAudit } = require('./audit');
const { notify } = require('./notify');
const dispatch = require('./dispatch');
const driverApp = require('./driverApp');
const realtime = require('./realtime');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NAIROBI_OFFSET_MIN = 180; // UTC+3, no daylight saving
const SERIES_HORIZON_DAYS = 14;
const GROUP_WINDOW_MIN = 10;
const GROUP_PICKUP_KM = 3;

/** Weekday ('mon'...) in Nairobi for a moment in time. */
const weekdayOf = (date) => DAYS[new Date(date.getTime() + NAIROBI_OFFSET_MIN * 60_000).getUTCDay()];

/** The pick-up times in a repeating booking over the next two weeks, always including the first. */
function occurrences(firstAt, repeatDays, { now = new Date(), horizonDays = SERIES_HORIZON_DAYS, after = null } = {}) {
  const out = [];
  for (let d = 0; d <= horizonDays + 7; d += 1) {
    const at = new Date(firstAt.getTime() + d * 86_400_000);
    if (at.getTime() - now.getTime() > horizonDays * 86_400_000) break;
    const isFirst = d === 0;
    if (!isFirst && !repeatDays.includes(weekdayOf(at))) continue;
    if (after && at <= after) continue;
    out.push(at);
  }
  return out;
}

/**
 * Creates a request. Ride Now starts dispatching straight away. A repeating booking creates this week's and next
 * week's pick-ups now (the worker adds more as time passes).
 */
async function create({ user, body, ip }) {
  if (body.type === 'now') {
    const { rows } = await pool.query(`SELECT 1 FROM trip_requests WHERE rider_id = $1 AND type = 'now' AND status IN ('searching', 'offered', 'assigned', 'picked_up') LIMIT 1`, [user.userId]);
    if (rows.length > 0) throw errors.conflict('ALREADY_ACTIVE', 'You already have a ride in progress.');
  }

  const seriesId = body.repeatDays?.length ? crypto.randomUUID() : null;
  const firstAt = body.type === 'scheduled' ? new Date(body.scheduledFor) : null;
  const created = await withTransaction(async (client) => {
    const times = firstAt ? (seriesId ? occurrences(firstAt, body.repeatDays) : [firstAt]) : [null];
    const made = [];
    for (const at of times) {
      const row = await dispatch.createRequest(client, {
        riderId: user.userId,
        type: body.type,
        pickup: body.pickup,
        dropoff: body.dropoff,
        seats: body.seats,
        scheduledFor: at,
        repeatDays: seriesId ? body.repeatDays : null,
        seriesId,
      });
      made.push(row);
    }
    const first = made[0];
    await appendAudit(client, {
      userId: user.userId,
      action: 'request.create',
      entity: 'trip_request',
      entityId: first.request_id,
      ipAddress: ip,
      details: { request_id: first.request_id, type: body.type, pickup_zone: first.pickup_zone, dropoff_zone: first.dropoff_zone, seats: body.seats, occurrences: made.length },
    });
    if (body.type === 'scheduled') {
      await notify(client, {
        userId: user.userId,
        type: 'booking.created',
        message: `Booked: ${first.pickup_label} to ${first.dropoff_label}${seriesId ? `, repeating (${made.length} pick-ups scheduled)` : ''}. We will find your driver shortly before pick-up.`,
        link: '/bookings',
        email: true,
      });
    }
    return made;
  });
  if (body.type === 'now') await dispatch.dispatchRequest(created[0].request_id);
  return created;
}

/** Changes the time of one booking (or the time and days of a whole repeating series). */
async function edit({ user, requestId, scheduledFor, repeatDays, wholeSeries, ip }) {
  return withTransaction(async (client) => {
    const request = await dispatch.findRequest(client, requestId, { forUpdate: true });
    if (!request || request.rider_id !== user.userId) throw errors.notFound('Booking not found.');
    if (request.type !== 'scheduled' || !['scheduled', 'searching', 'no_driver'].includes(request.status)) {
      throw errors.conflict('NOT_EDITABLE', 'This booking can no longer be changed.');
    }
    const at = new Date(scheduledFor);
    if (wholeSeries && request.series_id) {
      await client.query(`UPDATE trip_requests SET status = 'cancelled', cancel_reason = 'edited' WHERE series_id = $1 AND status IN ('scheduled', 'searching', 'no_driver') AND request_id <> $2`, [request.series_id, requestId]);
      const days = repeatDays?.length ? repeatDays : request.repeat_days;
      for (const when of occurrences(at, days).slice(1)) {
        await dispatch.createRequest(client, {
          riderId: user.userId,
          type: 'scheduled',
          pickup: { lat: request.pickup_lat, lng: request.pickup_lng, label: request.pickup_label },
          dropoff: { lat: request.dropoff_lat, lng: request.dropoff_lng, label: request.dropoff_label },
          seats: request.seats,
          scheduledFor: when,
          repeatDays: days,
          seriesId: request.series_id,
        });
      }
    }
    await client.query(
      `UPDATE trip_requests SET scheduled_for = $2, status = 'scheduled', repeat_days = COALESCE($3, repeat_days) WHERE request_id = $1`,
      [requestId, at, wholeSeries ? repeatDays || null : null],
    );
    await appendAudit(client, { userId: user.userId, action: 'request.edit', entity: 'trip_request', entityId: requestId, ipAddress: ip, details: { request_id: requestId, whole_series: Boolean(wholeSeries) } });
  });
}

async function cancel({ user, requestId, wholeSeries, ip }) {
  const { rows } = await pool.query('SELECT series_id FROM trip_requests WHERE request_id = $1 AND rider_id = $2', [requestId, user.userId]);
  if (!rows[0]) throw errors.notFound('Request not found.');
  await dispatch.cancelRequest({ requestId, riderId: user.userId, ip });
  if (wholeSeries && rows[0].series_id) {
    const { rows: rest } = await pool.query(`SELECT request_id FROM trip_requests WHERE series_id = $1 AND rider_id = $2 AND status IN ('scheduled', 'searching', 'offered', 'no_driver')`, [rows[0].series_id, user.userId]);
    for (const r of rest) await dispatch.cancelRequest({ requestId: r.request_id, riderId: user.userId, ip });
  }
}

// ---------------------------------------------------------------- worker

/**
 * Bookings due within the lead time are grouped (same drop-off area, pick-ups close in time and place) so one driver
 * takes them together, then dispatched.
 */
async function dispatchDueBookings() {
  const s = await dispatch.loadSettings();
  const due = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT request_id FROM trip_requests
        WHERE status = 'scheduled' AND scheduled_for - make_interval(mins => $1) <= now()
        ORDER BY scheduled_for FOR UPDATE SKIP LOCKED LIMIT 100`,
      [s.leadMin],
    );
    const reqs = [];
    for (const r of rows) reqs.push(await dispatch.findRequest(client, r.request_id, { forUpdate: true }));

    // Greedy clusters: same drop-off zone, pick-ups within 10 minutes and a few km of each other, room in one car.
    const clusters = [];
    for (const r of reqs) {
      const fit = clusters.find(
        (c) =>
          c.zone === r.dropoff_zone &&
          c.members.length < s.maxRiders &&
          c.seats + r.seats <= 3 &&
          Math.abs(new Date(r.scheduled_for) - new Date(c.members[0].scheduled_for)) <= GROUP_WINDOW_MIN * 60_000 &&
          Math.hypot(r.pickup_lat - c.members[0].pickup_lat, r.pickup_lng - c.members[0].pickup_lng) * 111 <= GROUP_PICKUP_KM,
      );
      if (fit) {
        fit.members.push(r);
        fit.seats += r.seats;
      } else clusters.push({ zone: r.dropoff_zone, members: [r], seats: r.seats });
    }
    const leaders = [];
    for (const c of clusters) {
      const leader = c.members[0];
      for (const m of c.members) {
        await client.query(`UPDATE trip_requests SET status = 'searching', group_id = $2 WHERE request_id = $1`, [m.request_id, c.members.length > 1 ? leader.request_id : null]);
      }
      if (c.members.length > 1) {
        await appendAudit(client, { userId: null, action: 'dispatch.group', entity: 'trip_request', entityId: leader.request_id, details: { leader_id: leader.request_id, members: c.members.map((m) => m.request_id) } });
      }
      leaders.push(leader.request_id);
    }
    return leaders;
  });
  for (const id of due) await dispatch.dispatchRequest(id);
  return due.length;
}

/** Scheduled bookings still without a driver keep being offered to drivers until the pick-up time. */
async function retrySearching() {
  const { rows } = await pool.query(
    `SELECT request_id FROM trip_requests
      WHERE status = 'searching' AND type = 'scheduled' AND (group_id IS NULL OR group_id = request_id)
        AND NOT EXISTS (SELECT 1 FROM dispatch_offers o WHERE o.request_id = trip_requests.request_id AND o.response IS NULL AND o.expires_at > now())`,
  );
  for (const r of rows) await dispatch.dispatchRequest(r.request_id);
  return rows.length;
}

/** Repeating bookings always have the next two weeks of pick-ups scheduled. */
async function topUpSeries() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (series_id) request_id, series_id, scheduled_for, repeat_days, rider_id, seats, pickup_label, dropoff_label,
            ST_Y(pickup_point::geometry) AS pickup_lat, ST_X(pickup_point::geometry) AS pickup_lng,
            ST_Y(dropoff_point::geometry) AS dropoff_lat, ST_X(dropoff_point::geometry) AS dropoff_lng
       FROM trip_requests WHERE series_id IS NOT NULL
      ORDER BY series_id, scheduled_for DESC`,
  );
  let added = 0;
  for (const s of rows) {
    const live = await pool.query(`SELECT 1 FROM trip_requests WHERE series_id = $1 AND status IN ('scheduled', 'searching', 'offered', 'assigned', 'picked_up') LIMIT 1`, [s.series_id]);
    if (live.rows.length === 0) continue; // the rider cancelled the series
    const last = new Date(s.scheduled_for);
    const more = occurrences(last, s.repeat_days, { after: last }).slice(0);
    for (const at of more) {
      await withTransaction((client) =>
        dispatch.createRequest(client, {
          riderId: s.rider_id,
          type: 'scheduled',
          pickup: { lat: s.pickup_lat, lng: s.pickup_lng, label: s.pickup_label },
          dropoff: { lat: s.dropoff_lat, lng: s.dropoff_lng, label: s.dropoff_label },
          seats: s.seats,
          scheduledFor: at,
          repeatDays: s.repeat_days,
          seriesId: s.series_id,
        }),
      ).catch(() => {});
      added += 1;
    }
  }
  return added;
}

let lastVerificationRun = 0;

/** One pass of everything that has to happen on a timer. */
async function tick() {
  const out = {};
  out.expired = await dispatch.sweepExpiredOffers();
  out.due = await dispatchDueBookings();
  out.retried = await retrySearching();
  out.offline = await driverApp.dropStaleDrivers();
  // Expiry, reminders, re-checks, file retention and automatic suspension: about once an hour.
  if (!config.isTest && Date.now() - lastVerificationRun > 3600_000) {
    lastVerificationRun = Date.now();
    out.verification = await require('./verification').runJobs().catch((err) => ({ error: err.message }));
  }
  return out;
}

let timer = null;
let slowTimer = null;
function start({ everyMs = 2000 } = {}) {
  if (timer) return;
  let busy = false;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } catch (err) {
      console.error('dispatch tick failed:', err.message);
    } finally {
      busy = false;
    }
  }, everyMs);
  slowTimer = setInterval(() => topUpSeries().catch((err) => console.error('series top-up failed:', err.message)), 10 * 60_000);
}
function stop() {
  clearInterval(timer);
  clearInterval(slowTimer);
  timer = null;
  slowTimer = null;
}

module.exports = { create, edit, cancel, occurrences, weekdayOf, dispatchDueBookings, retrySearching, topUpSeries, tick, start, stop, realtime };
