const { Router } = require('express');
const { pool } = require('../db/pool');
const { errors } = require('../lib/errors');
const { routeKm } = require('../lib/places');
const { estimateShare } = require('../lib/fare');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { validateBody, uuidParam } = require('../middleware/validate');
const { createSchema, estimateSchema, editSchema, cancelSchema } = require('../schemas/dispatch');
const booking = require('../services/booking');
const dispatch = require('../services/dispatch');
const { tagPoint, zoneNames } = require('../services/zones');

const router = Router();
router.use(requireAuth(), requireRole('student')); // riders are students

const toApi = (r, zones, extra = {}) => ({
  requestId: r.request_id,
  type: r.type,
  status: r.status,
  seriesId: r.series_id,
  seats: r.seats,
  pickup: { label: r.pickup_label, lat: r.pickup_lat, lng: r.pickup_lng, zone: zones.get(r.pickup_zone) || null },
  dropoff: { label: r.dropoff_label, lat: r.dropoff_lat, lng: r.dropoff_lng, zone: zones.get(r.dropoff_zone) || null },
  scheduledFor: r.scheduled_for,
  repeatDays: r.repeat_days,
  routeKm: Number(r.route_km),
  estShareKes: r.est_share_kes,
  estPooledKes: r.est_pooled_kes,
  rideId: r.ride_id,
  cancelReason: r.cancel_reason,
  createdAt: r.created_at,
  ...extra,
});

/** Before asking for a ride: the area check, the share range, and how many drivers are around. */
router.post('/estimate', validateBody(estimateSchema), async (req, res) => {
  const { pickup, dropoff } = req.body;
  const [pz, dz] = await Promise.all([tagPoint(pickup), tagPoint(dropoff)]);
  const s = await dispatch.loadSettings();
  const km = routeKm(pickup, dropoff);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM driver_status ds JOIN users u ON u.user_id = ds.driver_id
      WHERE ds.is_online AND ds.seats_free > 0 AND ds.last_seen_at > now() - interval '90 seconds' AND u.status = 'active'
        AND ds.driver_id <> $4 AND ST_DWithin(ds.current_location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)`,
    [pickup.lat, pickup.lng, s.dispatchRadiusKm * 1000, req.user.userId],
  );
  res.json({
    inPilotArea: Boolean(pz && dz),
    pickupZone: pz?.name ?? null,
    dropoffZone: dz?.name ?? null,
    routeKm: km,
    estShareKes: estimateShare(km, s.fuelRate, s.rounding, 2), // alone with the driver
    estPooledKes: estimateShare(km, s.fuelRate, s.rounding, 4), // pooled with two other students
    driversNearby: rows[0].n,
  });
});

router.post('/', validateBody(createSchema), async (req, res) => {
  const made = await booking.create({ user: req.user.profile && { userId: req.user.userId }, body: req.body, ip: req.ip });
  const zones = await zoneNames();
  const first = await dispatch.findRequest(pool, made[0].request_id);
  res.status(201).json({ request: toApi(first, zones), occurrences: made.length });
});

router.get('/mine', async (req, res) => {
  const zones = await zoneNames();
  const { rows } = await pool.query(
    `SELECT ${dispatch.REQ_COLUMNS}, u.full_name AS driver_name
       FROM trip_requests r LEFT JOIN users u ON u.user_id = r.driver_id
      WHERE r.rider_id = $1 AND (r.created_at > now() - interval '30 days' OR r.scheduled_for > now())
      ORDER BY COALESCE(r.scheduled_for, r.created_at) DESC LIMIT 100`,
    [req.user.userId],
  );
  res.json({ requests: rows.map((r) => toApi(r, zones, { driverFirstName: r.driver_name ? r.driver_name.split(' ')[0] : null })) });
});

/** Rides taken, what each cost the rider, and what is still owed. */
router.get('/history', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.request_id, r.pickup_label, r.dropoff_label, r.status, r.created_at, r.ride_id, r.cancel_reason,
            s.amount_kes, s.status AS share_status, d.full_name AS driver_name
       FROM trip_requests r
       LEFT JOIN ride_shares s ON s.request_id = r.request_id
       LEFT JOIN users d ON d.user_id = r.driver_id
      WHERE r.rider_id = $1 AND r.status IN ('completed', 'cancelled', 'no_driver')
      ORDER BY r.created_at DESC LIMIT 100`,
    [req.user.userId],
  );
  const taken = rows.filter((r) => r.status === 'completed');
  res.json({
    summary: {
      ridesTaken: taken.length,
      sharedKes: taken.reduce((n, r) => n + (r.amount_kes || 0), 0),
      owedKes: taken.filter((r) => r.share_status === 'pending').reduce((n, r) => n + (r.amount_kes || 0), 0),
    },
    rides: rows.map((r) => ({
      requestId: r.request_id,
      rideId: r.ride_id,
      status: r.status,
      pickup: r.pickup_label,
      dropoff: r.dropoff_label,
      at: r.created_at,
      driverFirstName: r.driver_name ? r.driver_name.split(' ')[0] : null,
      shareKes: r.amount_kes ?? null,
      shareStatus: r.share_status ?? null,
      cancelReason: r.cancel_reason,
    })),
  });
});

router.get('/:id', uuidParam('id'), async (req, res) => {
  const r = await dispatch.findRequest(pool, req.params.id);
  if (!r || r.rider_id !== req.user.userId) throw errors.notFound('Request not found.');
  res.json({ request: toApi(r, await zoneNames()) });
});

router.post('/:id/cancel', uuidParam('id'), validateBody(cancelSchema), async (req, res) => {
  await booking.cancel({ user: { userId: req.user.userId }, requestId: req.params.id, wholeSeries: req.body.series, ip: req.ip });
  res.status(204).end();
});

router.patch('/:id', uuidParam('id'), validateBody(editSchema), async (req, res) => {
  await booking.edit({ user: { userId: req.user.userId }, requestId: req.params.id, scheduledFor: req.body.scheduledFor, repeatDays: req.body.repeatDays, wholeSeries: req.body.series, ip: req.ip });
  res.status(204).end();
});

module.exports = router;
