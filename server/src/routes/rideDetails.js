const { Router } = require('express');
const { z } = require('zod');
const { pool, withTransaction } = require('../db/pool');
const { errors } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { validateBody, uuidParam } = require('../middleware/validate');
const { appendAudit } = require('../services/audit');
const { notify, notifyMany, adminIds } = require('../services/notify');
const { calculateFareSplit } = require('../lib/fare');
const rides = require('../repositories/rides');

const router = Router();
router.use(requireAuth(), requireRole('student', 'driver'));

/** Everyone in the car: the driver plus riders with a confirmed booking. */
async function participants(db, offerId) {
  const { rows } = await db.query(
    `SELECT u.user_id, u.full_name, u.phone_number, u.avg_rating, 'driver' AS role, NULL::uuid AS booking_id, 1 AS seats
       FROM ride_offers o JOIN users u ON u.user_id = o.driver_id WHERE o.offer_id = $1
     UNION ALL
     SELECT u.user_id, u.full_name, u.phone_number, u.avg_rating, 'rider', b.booking_id, b.seats
       FROM bookings b JOIN ride_requests r ON r.request_id = b.request_id JOIN users u ON u.user_id = r.rider_id
      WHERE b.offer_id = $1 AND b.status = 'accepted'`,
    [offerId],
  );
  return rows;
}

/** One car trip for the people in it: route, who is aboard, the fare breakdown and who has rated. */
router.get('/trips/:id', uuidParam('id'), async (req, res) => {
  const offer = await rides.findOffer(pool, req.params.id);
  if (!offer) throw errors.notFound('Ride not found.');
  const people = await participants(pool, offer.offer_id);
  const me = people.find((p) => p.user_id === req.user.userId);
  if (!me) throw errors.notFound('Ride not found.');

  const settings = await rides.loadMatchSettings();
  const riders = people.filter((p) => p.role === 'rider');
  const seatsTaken = riders.reduce((n, r) => n + r.seats, 0);
  const estimate =
    seatsTaken > 0 ? calculateFareSplit(Number(offer.route_km), settings.fuelRateKesPerKm, settings.fareRoundingKes, seatsTaken + 1) : null;

  const { rows: shares } = await pool.query(
    `SELECT s.share_id, s.amount_kes, s.status, s.method, s.paid_at, s.payer_id, u.full_name AS payer_name, b.booking_id
       FROM payment_shares s
       JOIN payments p ON p.payment_id = s.payment_id AND p.status <> 'cancelled'
       JOIN bookings b ON b.booking_id = p.booking_id
       JOIN users u ON u.user_id = s.payer_id
      WHERE b.offer_id = $1 AND b.status = 'accepted'
      ORDER BY u.full_name`,
    [offer.offer_id],
  );
  const { rows: given } = await pool.query(
    `SELECT x.booking_id, x.ratee_id FROM ratings x JOIN bookings b ON b.booking_id = x.booking_id WHERE b.offer_id = $1 AND x.rater_id = $2`,
    [offer.offer_id, req.user.userId],
  );

  const iAmDriver = me.role === 'driver';
  const visibleShares = shares.filter((s) => iAmDriver || s.payer_id === req.user.userId);
  const totalPaid = shares.filter((s) => s.status === 'paid').reduce((n, s) => n + s.amount_kes, 0);
  res.json({
    role: me.role,
    trip: {
      offerId: offer.offer_id,
      origin: offer.origin_name,
      destination: offer.destination_name,
      originPoint: { lat: Number(offer.origin_lat), lng: Number(offer.origin_lng) },
      destinationPoint: { lat: Number(offer.destination_lat), lng: Number(offer.destination_lng) },
      departAt: offer.depart_at,
      status: offer.status,
      routeKm: Number(offer.route_km),
      vehicle: { makeModel: offer.make_model, plateNumber: offer.plate_number, colour: offer.colour },
    },
    people: people.map((p) => ({
      userId: p.user_id,
      fullName: p.full_name,
      role: p.role,
      seats: p.seats,
      rating: Number(p.avg_rating),
      phoneNumber: p.user_id === req.user.userId ? null : p.phone_number, // both sides agreed to the ride
      bookingId: p.booking_id,
      isMe: p.user_id === req.user.userId,
      iRated: given.some((g) => g.ratee_id === p.user_id),
    })),
    fare: {
      totalKes: estimate ? estimate.totalKes : 0,
      driverShareKes: estimate ? estimate.shares[0] : 0,
      commissionKes: 0,
      collectedKes: iAmDriver ? totalPaid : undefined,
      shares: visibleShares.map((s) => ({
        shareId: s.share_id,
        bookingId: s.booking_id,
        payerName: s.payer_name,
        amountKes: s.amount_kes,
        status: s.status,
        method: s.method,
        mine: s.payer_id === req.user.userId,
      })),
    },
  });
});

const incidentSchema = z
  .object({
    reportedUserId: z.uuid('Choose who you are reporting'),
    category: z.enum(['unsafe_driving', 'no_show', 'harassment', 'payment_demand', 'other'], { message: 'Choose a category' }),
    description: z.string().trim().min(5, 'Describe what happened (at least 5 characters)').max(2000),
  })
  .strict();

/** Anyone who was in the car can report a safety problem; every admin is told, and it is audited. */
router.post('/bookings/:id/incidents', uuidParam('id'), validateBody(incidentSchema), async (req, res) => {
  const report = await withTransaction(async (client) => {
    const booking = await rides.findBooking(client, req.params.id);
    if (!booking || booking.status !== 'accepted') throw errors.notFound('Ride not found.');
    const people = await participants(client, booking.offer_id);
    if (!people.some((p) => p.user_id === req.user.userId)) throw errors.notFound('Ride not found.');
    if (req.body.reportedUserId === req.user.userId) throw errors.badRequest('VALIDATION_ERROR', 'You cannot report yourself.');
    if (!people.some((p) => p.user_id === req.body.reportedUserId)) {
      throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [{ field: 'reportedUserId', message: 'Choose someone who was in the car' }]);
    }
    const { rows } = await client.query(
      `INSERT INTO incident_reports (reporter_id, reported_user_id, booking_id, category, description)
       VALUES ($1, $2, $3, $4, $5) RETURNING report_id, created_at`,
      [req.user.userId, req.body.reportedUserId, booking.booking_id, req.body.category, req.body.description],
    );
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'incident.report',
      entity: 'incident_report',
      entityId: rows[0].report_id,
      ipAddress: req.ip,
      details: {
        report_id: rows[0].report_id,
        booking_id: booking.booking_id,
        ride_id: booking.offer_id,
        reporter_id: req.user.userId,
        reported_user_id: req.body.reportedUserId,
        category: req.body.category,
      },
    });
    await notifyMany(client, await adminIds(client), {
      type: 'incident.new',
      message: `New safety report (${req.body.category.replace('_', ' ')}) filed by ${req.user.profile.full_name}.`,
      link: `/admin?tab=incidents&id=${rows[0].report_id}`,
      email: true,
    });
    return rows[0];
  });
  await require('../services/verification').suspendIfUnsafe(req.body.reportedUserId);
  res.status(201).json({ reportId: report.report_id });
});

// ---------------------------------------------------------------- live location

// The driver may share their position from two hours before departure until the ride is finished.
const SHARE_WINDOW_MS = 2 * 60 * 60 * 1000;
const STALE_AFTER_S = 60;

const locationSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    heading: z.number().min(0).max(360).nullish(),
    speedKmh: z.number().min(0).max(300).nullish(),
  })
  .strict();

/** The driver's phone sends its position every few seconds while they are driving. Only the latest is kept. */
router.post('/trips/:id/location', uuidParam('id'), validateBody(locationSchema), async (req, res) => {
  const offer = await rides.findOffer(pool, req.params.id);
  if (!offer || offer.driver_id !== req.user.userId) throw errors.notFound('Ride not found.');
  if (offer.status !== 'open') throw errors.conflict('RIDE_NOT_ACTIVE', 'This ride is not under way.');
  if (new Date(offer.depart_at).getTime() - Date.now() > SHARE_WINDOW_MS) {
    throw errors.conflict('TOO_EARLY', 'You can share your live location from two hours before departure.');
  }
  await pool.query(
    `INSERT INTO ride_locations (offer_id, driver_id, lat, lng, heading, speed_kmh, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (offer_id) DO UPDATE
       SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, heading = EXCLUDED.heading, speed_kmh = EXCLUDED.speed_kmh, updated_at = now()`,
    [offer.offer_id, req.user.userId, req.body.lat, req.body.lng, req.body.heading ?? null, req.body.speedKmh ?? null],
  );
  res.status(204).end();
});

/** The driver stops sharing (they arrived, or switched it off). */
router.delete('/trips/:id/location', uuidParam('id'), async (req, res) => {
  await pool.query('DELETE FROM ride_locations WHERE offer_id = $1 AND driver_id = $2', [req.params.id, req.user.userId]);
  res.status(204).end();
});

/** Where the car is now. Only the driver and riders with a confirmed seat can see it. */
router.get('/trips/:id/location', uuidParam('id'), async (req, res) => {
  const offer = await rides.findOffer(pool, req.params.id);
  if (!offer) throw errors.notFound('Ride not found.');
  const people = await participants(pool, offer.offer_id);
  if (!people.some((p) => p.user_id === req.user.userId)) throw errors.notFound('Ride not found.');

  const { rows } = await pool.query(
    `SELECT lat, lng, heading, speed_kmh, updated_at, EXTRACT(EPOCH FROM (now() - updated_at))::int AS age_s
       FROM ride_locations WHERE offer_id = $1`,
    [offer.offer_id],
  );
  const l = offer.status === 'open' ? rows[0] : null;
  res.json({
    sharing: Boolean(l) && l.age_s <= STALE_AFTER_S,
    location: l ? { lat: l.lat, lng: l.lng, heading: l.heading, speedKmh: l.speed_kmh, updatedAt: l.updated_at, ageSeconds: l.age_s } : null,
  });
});

module.exports = router;
