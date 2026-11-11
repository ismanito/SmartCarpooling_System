const { Router } = require('express');
const { z } = require('zod');
const { pool, withTransaction } = require('../db/pool');
const { errors } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { validateBody, uuidParam } = require('../middleware/validate');
const { appendAudit } = require('../services/audit');
const dispatch = require('../services/dispatch');

const router = Router();
router.use(requireAuth(), requireRole('admin'));

// ---------------------------------------------------------------- live map

/** Online drivers and rides under way. Positions exist only while a driver is online. */
router.get('/live', async (req, res) => {
  const { rows: drivers } = await pool.query(
    `SELECT ds.driver_id, u.full_name, ds.seats_free, ds.active_ride_id, ds.last_seen_at, ds.heading,
            ST_Y(ds.current_location::geometry) AS lat, ST_X(ds.current_location::geometry) AS lng,
            v.make_model, v.plate_number
       FROM driver_status ds JOIN users u ON u.user_id = ds.driver_id LEFT JOIN vehicles v ON v.vehicle_id = ds.vehicle_id
      WHERE ds.is_online AND ds.current_location IS NOT NULL ORDER BY u.full_name`,
  );
  const { rows: rides } = await pool.query(
    `SELECT r.ride_id, r.status, r.created_at, d.full_name AS driver_name,
            (SELECT count(*)::int FROM trip_requests t WHERE t.ride_id = r.ride_id AND t.status IN ('assigned', 'picked_up')) AS riders,
            (SELECT count(*)::int FROM ride_stops s WHERE s.ride_id = r.ride_id AND s.done_at IS NULL) AS stops_left
       FROM rides r JOIN users d ON d.user_id = r.driver_id WHERE r.status IN ('heading_to_pickup', 'in_progress') ORDER BY r.created_at`,
  );
  const { rows: waiting } = await pool.query(`SELECT count(*)::int AS n FROM trip_requests WHERE status IN ('searching', 'offered')`);
  res.json({
    drivers: drivers.map((d) => ({ driverId: d.driver_id, name: d.full_name, lat: d.lat, lng: d.lng, heading: d.heading, seatsFree: d.seats_free, rideId: d.active_ride_id, vehicle: `${d.make_model} ${d.plate_number}`, lastSeenAt: d.last_seen_at })),
    rides: rides.map((r) => ({ rideId: r.ride_id, status: r.status, driver: r.driver_name, riders: r.riders, stopsLeft: r.stops_left, startedAt: r.created_at })),
    waitingRequests: waiting[0].n,
  });
});

// ---------------------------------------------------------------- zones

const zoneSql = `SELECT z.zone_id, z.name, ST_AsGeoJSON(z.polygon::geometry)::json AS polygon,
  COALESCE((SELECT json_agg(n.neighbour_id ORDER BY n.neighbour_id) FROM zone_neighbours n WHERE n.zone_id = z.zone_id), '[]'::json) AS neighbours
  FROM zones z`;

const polygonSchema = z
  .object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(4)).min(1) })
  .strict();
const zoneBody = z
  .object({ name: z.string().trim().min(2).max(60), polygon: polygonSchema, neighbours: z.array(z.number().int()).max(40).default([]) })
  .strict();

router.get('/zones', async (req, res) => {
  const { rows } = await pool.query(`${zoneSql} ORDER BY z.name`);
  res.json({ zones: rows.map((z) => ({ zoneId: z.zone_id, name: z.name, polygon: z.polygon, neighbours: z.neighbours })) });
});

async function saveZone(client, zoneId, body) {
  const geo = JSON.stringify(body.polygon);
  const { rows: ok } = await client.query('SELECT ST_IsValid(ST_GeomFromGeoJSON($1)) AS valid', [geo]);
  if (!ok[0].valid) throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [{ field: 'polygon', message: 'The shape crosses itself or is not closed' }]);
  let id = zoneId;
  if (id) {
    await client.query('UPDATE zones SET name = $2, polygon = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)::geography WHERE zone_id = $1', [id, body.name, geo]);
  } else {
    const { rows } = await client.query('INSERT INTO zones (name, polygon) VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography) RETURNING zone_id', [body.name, geo]);
    id = rows[0].zone_id;
  }
  const neighbours = [...new Set(body.neighbours)].filter((n) => n !== id);
  await client.query('DELETE FROM zone_neighbours WHERE zone_id = $1 OR neighbour_id = $1', [id]);
  for (const n of neighbours) {
    await client.query('INSERT INTO zone_neighbours (zone_id, neighbour_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [id, n]);
  }
  return id;
}

async function zoneRoute(req, res, zoneId) {
  try {
    const id = await withTransaction(async (client) => {
      const saved = await saveZone(client, zoneId, req.body);
      await appendAudit(client, { userId: req.user.userId, action: zoneId ? 'zone.update' : 'zone.create', entity: 'zone', entityId: saved, ipAddress: req.ip, details: { zone_id: saved, name: req.body.name, neighbours: req.body.neighbours.length } });
      return saved;
    });
    res.status(zoneId ? 200 : 201).json({ zoneId: id });
  } catch (err) {
    if (err.code === '23505') throw errors.conflict('ZONE_EXISTS', 'A zone with that name already exists.');
    if (err.code === '23503') throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [{ field: 'neighbours', message: 'One of the neighbouring zones does not exist' }]);
    throw err;
  }
}

router.post('/zones', validateBody(zoneBody), (req, res) => zoneRoute(req, res, null));
router.put('/zones/:id', validateBody(zoneBody), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw errors.notFound();
  const { rows } = await pool.query('SELECT 1 FROM zones WHERE zone_id = $1', [id]);
  if (!rows[0]) throw errors.notFound('Zone not found.');
  return zoneRoute(req, res, id);
});

// ---------------------------------------------------------------- dispatch settings

const DISPATCH_SETTINGS = {
  dispatch_radius_km: { min: 0.5, max: 10 },
  offer_timeout_s: { min: 5, max: 120 },
  max_offers_per_request: { min: 1, max: 20 },
  max_riders_per_car: { min: 1, max: 6 },
  max_extra_minutes_per_rider: { min: 0, max: 30 },
  scheduled_dispatch_lead_min: { min: 5, max: 120 },
  no_show_wait_s: { min: 30, max: 1800 },
  avg_speed_kmh: { min: 5, max: 80 },
  fuel_rate_kes_per_km: { min: 1, max: 200 },
  fare_rounding_kes: { min: 1, max: 100 },
};

router.get('/dispatch-settings', async (req, res) => {
  const { rows } = await pool.query('SELECT setting_key, setting_value FROM system_settings WHERE setting_key = ANY($1)', [Object.keys(DISPATCH_SETTINGS)]);
  res.json({ settings: Object.fromEntries(rows.map((r) => [r.setting_key, Number(r.setting_value)])), limits: DISPATCH_SETTINGS });
});

const settingsSchema = z
  .object(Object.fromEntries(Object.entries(DISPATCH_SETTINGS).map(([k, { min, max }]) => [k, z.coerce.number().min(min, `Must be at least ${min}`).max(max, `Must be at most ${max}`).optional()])))
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Change at least one setting' });

router.put('/dispatch-settings', validateBody(settingsSchema), async (req, res) => {
  const changes = Object.entries(req.body).filter(([, v]) => v !== undefined);
  await withTransaction(async (client) => {
    for (const [key, value] of changes) {
      await client.query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ($1, $2, $3)
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, String(value), req.user.userId],
      );
    }
    await appendAudit(client, { userId: req.user.userId, action: 'dispatch_settings.update', entity: 'system_settings', ipAddress: req.ip, details: Object.fromEntries(changes) });
  });
  const { rows } = await pool.query('SELECT setting_key, setting_value FROM system_settings WHERE setting_key = ANY($1)', [Object.keys(DISPATCH_SETTINGS)]);
  res.json({ settings: Object.fromEntries(rows.map((r) => [r.setting_key, Number(r.setting_value)])) });
});

// ---------------------------------------------------------------- request log

/** For each request: who was offered it, in order, and what they did. This is the trail for complaints. */
router.get('/dispatch/requests', async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  const status = ['scheduled', 'searching', 'offered', 'assigned', 'picked_up', 'completed', 'cancelled', 'no_driver'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await pool.query(
    `SELECT r.request_id, r.type, r.status, r.pickup_label, r.dropoff_label, r.seats, r.created_at, r.scheduled_for, r.assigned_at, r.cancel_reason,
            u.full_name AS rider_name, d.full_name AS driver_name,
            COALESCE((SELECT json_agg(json_build_object('offerId', o.offer_id, 'driver', du.full_name, 'sentAt', o.sent_at, 'response', COALESCE(o.response, CASE WHEN o.expires_at > now() THEN 'waiting' ELSE 'expired' END),
                        'pickupEtaMin', round(o.pickup_eta_min::numeric, 1), 'pooled', o.pooled) ORDER BY o.sent_at)
                       FROM dispatch_offers o JOIN users du ON du.user_id = o.driver_id WHERE o.request_id = r.request_id), '[]'::json) AS offers
       FROM trip_requests r JOIN users u ON u.user_id = r.rider_id LEFT JOIN users d ON d.user_id = r.driver_id
      WHERE ($2::text IS NULL OR r.status = $2) ORDER BY r.created_at DESC LIMIT $1`,
    [limit, status],
  );
  res.json({
    requests: rows.map((r) => ({
      requestId: r.request_id, type: r.type, status: r.status, rider: r.rider_name, driver: r.driver_name, pickup: r.pickup_label, dropoff: r.dropoff_label,
      seats: r.seats, createdAt: r.created_at, scheduledFor: r.scheduled_for, assignedAt: r.assigned_at, cancelReason: r.cancel_reason, offers: r.offers,
    })),
  });
});

// ---------------------------------------------------------------- analytics

const dateParam = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

router.get('/dispatch/analytics', async (req, res) => {
  const range = [dateParam(req.query.from), dateParam(req.query.to)];
  const s = await dispatch.loadSettings();
  const R = `($1::timestamptz IS NULL OR r.created_at >= $1) AND ($2::timestamptz IS NULL OR r.created_at < $2)`;
  const [reqs, wait, pooled, savings] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS requests,
              count(*) FILTER (WHERE assigned_at IS NOT NULL)::int AS served,
              count(*) FILTER (WHERE status = 'no_driver')::int AS no_driver,
              count(*) FILTER (WHERE status = 'completed')::int AS completed
         FROM trip_requests r WHERE ${R}`,
      range,
    ),
    pool.query(`SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (assigned_at - created_at)))::numeric), 0)::int AS secs FROM trip_requests r WHERE type = 'now' AND assigned_at IS NOT NULL AND ${R}`, range),
    pool.query(
      `SELECT count(*)::int AS rides, count(*) FILTER (WHERE riders >= 2)::int AS pooled FROM (
         SELECT r.ride_id, (SELECT count(*) FROM ride_shares s WHERE s.ride_id = r.ride_id) AS riders
           FROM rides r WHERE r.status = 'completed' AND ($1::timestamptz IS NULL OR r.created_at >= $1) AND ($2::timestamptz IS NULL OR r.created_at < $2)) x`,
      range,
    ),
    pool.query(
      `SELECT COALESCE(sum(GREATEST(0, t.route_km * $3 - s.amount_kes)), 0)::int AS kes
         FROM ride_shares s JOIN trip_requests t ON t.request_id = s.request_id JOIN rides r ON r.ride_id = s.ride_id
        WHERE ($1::timestamptz IS NULL OR r.created_at >= $1) AND ($2::timestamptz IS NULL OR r.created_at < $2)`,
      [...range, s.fuelRate],
    ),
  ]);
  const q = reqs.rows[0];
  const decided = q.served + q.no_driver;
  res.json({
    requests: q.requests,
    completed: q.completed,
    fillRate: decided ? Math.round((q.served / decided) * 1000) / 10 : null, // % of searches that found a driver
    noDriverRate: decided ? Math.round((q.no_driver / decided) * 1000) / 10 : null,
    avgWaitSeconds: wait.rows[0].secs,
    pooledPercent: pooled.rows[0].rides ? Math.round((pooled.rows[0].pooled / pooled.rows[0].rides) * 1000) / 10 : null,
    completedRides: pooled.rows[0].rides,
    estimatedSavingsKes: savings.rows[0].kes,
  });
});

module.exports = router;
void uuidParam;
