const { Router } = require('express');
const { pool, withTransaction } = require('../db/pool');
const { errors, PG } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { validateBody, uuidParam } = require('../middleware/validate');
const { createOfferSchema, createRequestSchema, createBookingSchema, ratingSchema } = require('../schemas/ride');
const { fetchMatches } = require('../services/matcherClient');
const { roadKm } = require('../lib/router');
const { appendAudit } = require('../services/audit');
const { PLACES, CAMPUS_BUILDINGS, findPlace, withBuilding } = require('../lib/places');
const { scoreMatch, costPerSeatKes } = require('../lib/matching');
const vehiclesRepo = require('../repositories/vehicles');
const rides = require('../repositories/rides');
const paymentsRepo = require('../repositories/payments');
const { notify, notifyMany } = require('../services/notify');
const { calculateFareSplit } = require('../lib/fare');

const router = Router();
router.use(requireAuth(), requireRole('student', 'driver')); // admins are staff, not riders or drivers

// Only students ask for rides; only vetted drivers (or students) offer them.
const studentsOnly = requireRole('student');
function approvedToDrive(req, res, next) {
  if (req.user.role === 'student' && req.app.locals.config.studentsCanDrive === false) {
    throw errors.forbidden('DRIVERS_ONLY', 'Offering rides is for driver accounts.');
  }
  if (req.user.role === 'driver' && req.user.driverStatus !== 'approved') {
    throw errors.forbidden('DRIVER_NOT_APPROVED', 'Your driver application has not been approved yet.');
  }
  next();
}

/** Rider / driver user ids behind a list of bookings (for notifications). */
async function riderIds(db, bookings) {
  const ids = [];
  for (const b of bookings) ids.push((await rides.findRequest(db, b.request_id)).rider_id);
  return ids;
}
async function driverIds(db, bookings) {
  const ids = [];
  for (const b of bookings) ids.push((await rides.findOffer(db, b.offer_id)).driver_id);
  return ids;
}

// ---------------------------------------------------------------- serialisers

const r1 = (x) => Math.round(Number(x) * 10) / 10;

function offerToApi(row, settings) {
  return {
    offerId: row.offer_id,
    origin: row.origin_name,
    destination: row.destination_name,
    departAt: row.depart_at,
    seatsTotal: row.seats_total,
    seatsAvailable: row.seats_available,
    routeKm: Number(row.route_km),
    costPerSeatKes: costPerSeatKes(Number(row.route_km), row.seats_total, settings),
    status: row.status,
    vehicle: { makeModel: row.make_model, plateNumber: row.plate_number, colour: row.colour },
  };
}

function requestToApi(row) {
  return {
    requestId: row.request_id,
    origin: row.origin_name,
    destination: row.destination_name,
    departAt: row.depart_at,
    seatsNeeded: row.seats_needed,
    status: row.status,
  };
}

function matchToApi(row, fit) {
  return {
    score: fit.score,
    pickupKm: r1(row.pickup_km),
    dropoffKm: r1(row.dropoff_km),
    timeDiffMin: Math.round(Number(row.time_diff_min)),
    detourKm: r1(fit.detourKm),
  };
}

const metrics = (row) => ({
  pickupKm: Number(row.pickup_km),
  dropoffKm: Number(row.dropoff_km),
  timeDiffMin: Number(row.time_diff_min),
  riderKm: Number(row.rider_km),
  driverKm: Number(row.driver_km),
});

// Phone numbers are shared only once both sides have agreed.
const phoneIfAccepted = (b, phone) => (b.status === 'accepted' ? phone : null);

/**
 * Scores candidate rows with the Python matching engine, or the built-in rules if it is not running.
 * Both apply the same rules; `engine` in the response says which one answered.
 */
async function rankMatches(req, kind, id, rows, idColumn, settings) {
  const remote = await fetchMatches(req.app.locals.config.matcher, kind, id);
  if (remote) {
    const byId = new Map(remote.map((m) => [m.id, m]));
    const ranked = rows
      .filter((row) => byId.has(row[idColumn]))
      .map((row) => ({ row, fit: { score: byId.get(row[idColumn]).score, detourKm: byId.get(row[idColumn]).detour_km } }));
    return { engine: 'matcher', ranked: ranked.sort((a, b) => b.fit.score - a.fit.score) };
  }
  const ranked = rows
    .map((row) => ({ row, fit: scoreMatch(metrics(row), settings) }))
    .filter((m) => m.fit)
    .sort((a, b) => b.fit.score - a.fit.score);
  return { engine: 'builtin', ranked };
}

// ---------------------------------------------------------------- places

router.get('/places', (req, res) => {
  res.json({ places: PLACES, campusBuildings: CAMPUS_BUILDINGS });
});

/** Looks up a chosen place and, for campus gates, the building inside; field errors say which one is wrong. */
function resolvePlace(id, buildingId, field) {
  const place = findPlace(id);
  const resolved = place && withBuilding(place, buildingId);
  if (!resolved) {
    throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [
      { field: `${field}Building`, message: 'Choose a building on campus, after picking Gate A or Gate B' },
    ]);
  }
  return resolved;
}

// ---------------------------------------------------------------- offers (drivers)

router.post('/offers', approvedToDrive, validateBody(createOfferSchema), async (req, res) => {
  const origin = resolvePlace(req.body.origin, req.body.originBuilding, 'origin');
  const destination = resolvePlace(req.body.destination, req.body.destinationBuilding, 'destination');
  const settings = await rides.loadMatchSettings();
  const km = await roadKm(origin, destination, { apiKey: req.app.locals.config.googleMapsKey });

  const offer = await withTransaction(async (client) => {
    const vehicle = await vehiclesRepo.findOwned(client, req.body.vehicleId, req.user.userId);
    if (!vehicle) {
      throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [
        { field: 'vehicleId', message: 'Choose one of your registered vehicles' },
      ]);
    }
    if (req.body.seats > vehicle.seat_capacity) {
      throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [
        { field: 'seats', message: `Your ${vehicle.make_model} has ${vehicle.seat_capacity} passenger seat(s)` },
      ]);
    }
    const row = await rides.createOffer(client, req.user.userId, {
      vehicleId: vehicle.vehicle_id,
      origin,
      destination,
      departAt: req.body.departAt,
      seats: req.body.seats,
      routeKm: km,
    });
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'ride_offer.create',
      entity: 'ride_offer',
      entityId: row.offer_id,
      ipAddress: req.ip,
      details: { origin: origin.id, destination: destination.id, depart_at: row.depart_at, seats: row.seats_total },
    });
    return row;
  });
  res.status(201).json({ offer: offerToApi(offer, settings) });
});

router.get('/offers/mine', async (req, res) => {
  const settings = await rides.loadMatchSettings();
  const offers = await rides.listOffersByDriver(req.user.userId);
  const bookings = await rides.bookingsForOffers(offers.map((o) => o.offer_id), req.user.userId);
  res.json({
    offers: offers.map((o) => ({
      ...offerToApi(o, settings),
      bookings: bookings
        .filter((b) => b.offer_id === o.offer_id)
        .map((b) => ({
          bookingId: b.booking_id,
          requestId: b.request_id,
          status: b.status,
          myStars: b.my_stars,
          initiatedBy: b.initiated_by,
          seats: b.seats,
          score: Number(b.score),
          trip: { origin: b.origin_name, destination: b.destination_name, departAt: b.depart_at },
          rider: {
            fullName: b.rider_name,
            faculty: b.rider_faculty,
            rating: Number(b.rider_rating),
            phoneNumber: phoneIfAccepted(b, b.rider_phone),
          },
        })),
    })),
  });
});

router.get('/offers/:id/matches', uuidParam('id'), async (req, res) => {
  const offer = await rides.findOffer(pool, req.params.id);
  if (!offer || offer.driver_id !== req.user.userId) throw errors.notFound('Ride offer not found.');
  const settings = await rides.loadMatchSettings();
  const rows = await rides.candidateRequestsForOffer(offer.offer_id, settings);
  const { engine, ranked } = await rankMatches(req, 'offers', offer.offer_id, rows, 'request_id', settings);
  const matches = ranked
    .map(({ row, fit }) => ({
      request: {
        ...requestToApi(row),
        rider: { fullName: row.rider_name, faculty: row.rider_faculty, rating: Number(row.rider_rating) },
      },
      match: matchToApi(row, fit),
    }));
  res.json({ engine, matches });
});

router.post('/offers/:id/cancel', uuidParam('id'), async (req, res) => {
  await withTransaction(async (client) => {
    const offer = await rides.findOffer(client, req.params.id, { forUpdate: true });
    if (!offer || offer.driver_id !== req.user.userId) throw errors.notFound('Ride offer not found.');
    if (offer.status === 'cancelled') return;
    if (offer.status === 'completed') throw errors.conflict('TRIP_FINISHED', 'This trip has already finished.');

    const live = await rides.activeBookings(client, { offerId: offer.offer_id });
    for (const b of live) {
      if (b.status === 'accepted') {
        await rides.setRequestStatus(client, b.request_id, 'open');
        await paymentsRepo.cancelForBooking(client, b.booking_id);
      }
      await rides.setBookingStatus(client, b.booking_id, 'cancelled');
    }
    await notifyMany(client, await riderIds(client, live), {
      type: 'ride.cancelled',
      message: `${offer.driver_name} cancelled the ride from ${offer.origin_name} to ${offer.destination_name}.`,
      link: '/',
      email: true,
    });
    await rides.setOfferStatus(client, offer.offer_id, 'cancelled');
    await client.query('DELETE FROM ride_locations WHERE offer_id = $1', [offer.offer_id]);
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'ride_offer.cancel',
      entity: 'ride_offer',
      entityId: offer.offer_id,
      ipAddress: req.ip,
      details: { bookings_cancelled: live.length },
    });
  });
  res.status(204).end();
});

// A driver can finish a trip from one hour before its departure time onwards.
const FINISH_WINDOW_MS = 60 * 60 * 1000;

router.post('/offers/:id/complete', uuidParam('id'), async (req, res) => {
  await withTransaction(async (client) => {
    const offer = await rides.findOffer(client, req.params.id, { forUpdate: true });
    if (!offer || offer.driver_id !== req.user.userId) throw errors.notFound('Ride offer not found.');
    if (offer.status !== 'open') throw errors.conflict('OFFER_CLOSED', `This ride is already ${offer.status}.`);
    if (new Date(offer.depart_at).getTime() - Date.now() > FINISH_WINDOW_MS) {
      throw errors.conflict('TOO_EARLY', 'You can finish a trip from one hour before it leaves.');
    }
    const live = await rides.activeBookings(client, { offerId: offer.offer_id });
    for (const b of live) {
      if (b.status === 'accepted') await rides.setRequestStatus(client, b.request_id, 'completed');
      else await rides.setBookingStatus(client, b.booking_id, 'cancelled');
    }
    await rides.setOfferStatus(client, offer.offer_id, 'completed');
    await client.query('DELETE FROM ride_locations WHERE offer_id = $1', [offer.offer_id]);

    // Everyone in the car, driver included, shares the real fuel cost; the driver takes any leftover shilling.
    const onBoard = live.filter((b) => b.status === 'accepted');
    let fare = null;
    if (onBoard.length > 0) {
      const settings = await rides.loadMatchSettings(client);
      const seatsTaken = onBoard.reduce((n, b) => n + b.seats, 0);
      fare = calculateFareSplit(Number(offer.route_km), settings.fuelRateKesPerKm, settings.fareRoundingKes, seatsTaken + 1);
      const perSeat = fare.shares[1] ?? 0;
      for (const b of onBoard) await paymentsRepo.refare(client, b.booking_id, perSeat * b.seats);
    }
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'ride_offer.complete',
      entity: 'ride_offer',
      entityId: offer.offer_id,
      ipAddress: req.ip,
      details: { passengers: onBoard.length, total_kes: fare ? fare.totalKes : 0 },
    });
    await notifyMany(client, await riderIds(client, onBoard), {
      type: 'ride.completed',
      message: `Your ride from ${offer.origin_name} to ${offer.destination_name} is finished. Please rate ${offer.driver_name} and settle your share.`,
      link: '/',
    });
  });
  res.status(204).end();
});

// ---------------------------------------------------------------- requests (riders)

router.post('/requests', studentsOnly, validateBody(createRequestSchema), async (req, res) => {
  const origin = resolvePlace(req.body.origin, req.body.originBuilding, 'origin');
  const destination = resolvePlace(req.body.destination, req.body.destinationBuilding, 'destination');
  const request = await withTransaction(async (client) => {
    const row = await rides.createRequest(client, req.user.userId, {
      origin,
      destination,
      departAt: req.body.departAt,
      seats: req.body.seats,
    });
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'ride_request.create',
      entity: 'ride_request',
      entityId: row.request_id,
      ipAddress: req.ip,
      details: { origin: origin.id, destination: destination.id, depart_at: row.depart_at, seats: row.seats_needed },
    });
    return row;
  });
  res.status(201).json({ request: requestToApi(request) });
});

router.get('/requests/mine', studentsOnly, async (req, res) => {
  const settings = await rides.loadMatchSettings();
  const requests = await rides.listRequestsByRider(req.user.userId);
  const bookings = await rides.bookingsForRequests(requests.map((r) => r.request_id), req.user.userId);
  res.json({
    requests: requests.map((r) => ({
      ...requestToApi(r),
      bookings: bookings
        .filter((b) => b.request_id === r.request_id)
        .map((b) => ({
          bookingId: b.booking_id,
          offerId: b.offer_id,
          status: b.status,
          myStars: b.my_stars,
          offerStatus: b.offer_status,
          initiatedBy: b.initiated_by,
          seats: b.seats,
          score: Number(b.score),
          trip: { origin: b.origin_name, destination: b.destination_name, departAt: b.depart_at },
          costPerSeatKes: costPerSeatKes(Number(b.route_km), b.seats_total, settings),
          vehicle: { makeModel: b.make_model, plateNumber: b.plate_number, colour: b.colour },
          driver: {
            fullName: b.driver_name,
            rating: Number(b.driver_rating),
            phoneNumber: phoneIfAccepted(b, b.driver_phone),
          },
        })),
    })),
  });
});

router.get('/requests/:id/matches', studentsOnly, uuidParam('id'), async (req, res) => {
  const request = await rides.findRequest(pool, req.params.id);
  if (!request || request.rider_id !== req.user.userId) throw errors.notFound('Ride request not found.');
  const settings = await rides.loadMatchSettings();
  const rows = await rides.candidateOffersForRequest(request.request_id, settings);
  const { engine, ranked } = await rankMatches(req, 'requests', request.request_id, rows, 'offer_id', settings);
  const matches = ranked
    .map(({ row, fit }) => ({
      offer: {
        ...offerToApi(row, settings),
        driver: { fullName: row.driver_name, rating: Number(row.driver_rating) },
      },
      match: matchToApi(row, fit),
    }));
  res.json({ engine, matches });
});

router.post('/requests/:id/cancel', studentsOnly, uuidParam('id'), async (req, res) => {
  await withTransaction(async (client) => {
    // Lock order everywhere is offer → request → booking, so look up the offers first.
    const preview = await rides.findRequest(client, req.params.id);
    if (!preview || preview.rider_id !== req.user.userId) throw errors.notFound('Ride request not found.');
    if (preview.status === 'cancelled') return;
    if (preview.status === 'completed') throw errors.conflict('TRIP_FINISHED', 'This trip has already finished.');

    const { rows: linked } = await client.query(
      `SELECT DISTINCT offer_id FROM bookings WHERE request_id = $1 AND status = 'accepted' ORDER BY offer_id`,
      [preview.request_id],
    );
    for (const { offer_id: offerId } of linked) await rides.findOffer(client, offerId, { forUpdate: true });
    await rides.findRequest(client, preview.request_id, { forUpdate: true });

    const live = await rides.activeBookings(client, { requestId: preview.request_id });
    for (const b of live) {
      if (b.status === 'accepted') {
        await rides.changeSeats(client, b.offer_id, b.seats);
        await paymentsRepo.cancelForBooking(client, b.booking_id);
      }
      await rides.setBookingStatus(client, b.booking_id, 'cancelled');
    }
    await notifyMany(client, await driverIds(client, live), {
      type: 'ride.cancelled',
      message: `${req.user.profile.full_name} cancelled their trip from ${preview.origin_name} to ${preview.destination_name}.`,
      link: '/driver',
    });
    await rides.setRequestStatus(client, preview.request_id, 'cancelled');
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'ride_request.cancel',
      entity: 'ride_request',
      entityId: preview.request_id,
      ipAddress: req.ip,
      details: { bookings_cancelled: live.length },
    });
  });
  res.status(204).end();
});

// ---------------------------------------------------------------- bookings

/** Works out whether the caller is the driver or the rider on this pair; 404 if neither. */
function partyOf(userId, offer, request) {
  if (offer && offer.driver_id === userId) return 'driver';
  if (request && request.rider_id === userId) return 'rider';
  return null;
}

router.post('/bookings', validateBody(createBookingSchema), async (req, res) => {
  const settings = await rides.loadMatchSettings();
  const booking = await withTransaction(async (client) => {
    const offer = await rides.findOffer(client, req.body.offerId, { forUpdate: true });
    const request = await rides.findRequest(client, req.body.requestId, { forUpdate: true });
    const party = partyOf(req.user.userId, offer, request);
    // You may only start a booking from your own offer or your own request.
    if (!party || !offer || !request) throw errors.notFound('Ride not found.');
    if (offer.driver_id === request.rider_id) throw errors.conflict('OWN_RIDE', 'You cannot book your own ride.');
    if (offer.status !== 'open' || new Date(offer.depart_at) <= new Date()) {
      throw errors.conflict('OFFER_CLOSED', 'This ride is no longer available.');
    }
    if (request.status !== 'open' || new Date(request.depart_at) <= new Date()) {
      throw errors.conflict('REQUEST_CLOSED', 'This ride request is no longer open.');
    }
    if (offer.seats_available < request.seats_needed) {
      throw errors.conflict('NO_SEATS', 'There are not enough seats left on this ride.');
    }

    const { rows: existing } = await client.query(
      `SELECT status FROM bookings WHERE offer_id = $1 AND request_id = $2 AND status IN ('pending', 'accepted', 'declined')`,
      [offer.offer_id, request.request_id],
    );
    if (existing.length > 0) {
      throw errors.conflict('ALREADY_REQUESTED', 'A booking between this ride and request already exists.');
    }

    const fit = scoreMatch(metrics(await rides.pairMetrics(client, offer.offer_id, request.request_id)), settings);
    if (!fit) throw errors.conflict('NOT_A_MATCH', 'This ride does not match the request (route or time too different).');

    const row = await rides.createBooking(client, {
      offerId: offer.offer_id,
      requestId: request.request_id,
      initiatedBy: party,
      seats: request.seats_needed,
      score: fit.score,
    });
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'booking.create',
      entity: 'booking',
      entityId: row.booking_id,
      ipAddress: req.ip,
      details: { offer_id: offer.offer_id, request_id: request.request_id, initiated_by: party, score: fit.score },
    });
    if (party === 'rider') {
      await notify(client, { userId: offer.driver_id, type: 'request.new', message: `${req.user.profile.full_name} wants ${request.seats_needed === 1 ? 'a seat' : `${request.seats_needed} seats`} on your ride from ${offer.origin_name} to ${offer.destination_name}.`, link: '/driver', email: true });
    } else {
      await notify(client, { userId: request.rider_id, type: 'request.invite', message: `${req.user.profile.full_name} offered you a ride from ${offer.origin_name} to ${offer.destination_name}.`, link: '/rides/find', email: true });
    }
    return row;
  });
  res.status(201).json({ booking: bookingToApi(booking) });
});

function bookingToApi(b) {
  return {
    bookingId: b.booking_id,
    offerId: b.offer_id,
    requestId: b.request_id,
    initiatedBy: b.initiated_by,
    seats: b.seats,
    score: Number(b.score),
    status: b.status,
  };
}

/** Loads and locks offer → request → booking in that order, and returns who the caller is. */
async function lockBooking(client, bookingId, userId) {
  const peek = await rides.findBooking(client, bookingId);
  if (!peek) throw errors.notFound('Booking not found.');
  const offer = await rides.findOffer(client, peek.offer_id, { forUpdate: true });
  const request = await rides.findRequest(client, peek.request_id, { forUpdate: true });
  const booking = await rides.findBooking(client, bookingId, { forUpdate: true });
  const party = partyOf(userId, offer, request);
  if (!party) throw errors.notFound('Booking not found.');
  return { offer, request, booking, party };
}

async function respond(req, res, accept) {
  const booking = await withTransaction(async (client) => {
    const { offer, request, booking: b, party } = await lockBooking(client, req.params.id, req.user.userId);
    if (b.status !== 'pending') throw errors.conflict('BOOKING_CLOSED', `This booking is already ${b.status}.`);
    if (b.initiated_by === party) {
      throw errors.forbidden('NOT_YOUR_TURN', 'You sent this request; the other person needs to respond.');
    }

    if (accept) {
      if (offer.status !== 'open' || new Date(offer.depart_at) <= new Date()) {
        throw errors.conflict('OFFER_CLOSED', 'This ride is no longer available.');
      }
      if (request.status !== 'open') throw errors.conflict('REQUEST_CLOSED', 'This ride request already has a ride.');
      if (offer.seats_available < b.seats) throw errors.conflict('NO_SEATS', 'There are not enough seats left on this ride.');

      await rides.changeSeats(client, offer.offer_id, -b.seats);
      await rides.setRequestStatus(client, request.request_id, 'matched');
      // The fare is fixed now, at the suggested per-seat share, so both sides see the same amount.
      const settings = await rides.loadMatchSettings(client);
      await paymentsRepo.createForBooking(client, {
        bookingId: b.booking_id,
        riderId: request.rider_id,
        amountKes: costPerSeatKes(Number(offer.route_km), offer.seats_total, settings) * b.seats,
      });
      // The rider now has a ride: withdraw their other pending bookings.
      for (const other of await rides.activeBookings(client, { requestId: request.request_id })) {
        if (other.booking_id !== b.booking_id) await rides.setBookingStatus(client, other.booking_id, 'cancelled');
      }
    }

    const updated = await rides.setBookingStatus(client, b.booking_id, accept ? 'accepted' : 'declined');
    await appendAudit(client, {
      userId: req.user.userId,
      action: accept ? 'booking.accept' : 'booking.decline',
      entity: 'booking',
      entityId: b.booking_id,
      ipAddress: req.ip,
      details: { offer_id: offer.offer_id, request_id: request.request_id, by: party },
    });
    const asker = party === 'driver' ? request.rider_id : offer.driver_id;
    await notify(client, {
      userId: asker,
      type: accept ? 'request.accepted' : 'request.declined',
      message: `${req.user.profile.full_name} ${accept ? 'accepted' : 'declined'} your request for the ride from ${offer.origin_name} to ${offer.destination_name}.`,
      link: party === 'driver' ? '/' : '/driver',
      email: true,
    });
    return updated;
  });
  res.json({ booking: bookingToApi(booking) });
}

router.post('/bookings/:id/accept', uuidParam('id'), (req, res) => respond(req, res, true));
router.post('/bookings/:id/decline', uuidParam('id'), (req, res) => respond(req, res, false));

router.post('/bookings/:id/rate', uuidParam('id'), validateBody(ratingSchema), async (req, res) => {
  try {
    await withTransaction(async (client) => {
      const { offer, request, booking: b, party } = await lockBooking(client, req.params.id, req.user.userId);
      if (b.status !== 'accepted' || offer.status !== 'completed') {
        throw errors.conflict('NOT_RATEABLE', 'You can rate someone once your trip with them has finished.');
      }
      const rateeId = party === 'driver' ? request.rider_id : offer.driver_id;
      await rides.addRating(client, {
        bookingId: b.booking_id,
        raterId: req.user.userId,
        rateeId,
        stars: req.body.stars,
        comment: req.body.comment,
        tags: req.body.tags,
      });
      await appendAudit(client, {
        userId: req.user.userId,
        action: 'rating.create',
        entity: 'booking',
        entityId: b.booking_id,
        ipAddress: req.ip,
        details: { stars: req.body.stars, ratee_id: rateeId, tags: req.body.tags || [] },
      });
    });
  } catch (err) {
    if (err.code === PG.UNIQUE_VIOLATION) throw errors.conflict('ALREADY_RATED', 'You have already rated this trip.');
    throw err;
  }
  res.status(201).json({ stars: req.body.stars });
});

router.post('/bookings/:id/cancel', uuidParam('id'), async (req, res) => {
  const booking = await withTransaction(async (client) => {
    const { offer, request, booking: b, party } = await lockBooking(client, req.params.id, req.user.userId);
    if (!['pending', 'accepted'].includes(b.status)) {
      throw errors.conflict('BOOKING_CLOSED', `This booking is already ${b.status}.`);
    }
    if (offer.status === 'completed') throw errors.conflict('TRIP_FINISHED', 'This trip has already finished.');
    if (b.status === 'accepted') {
      await rides.changeSeats(client, offer.offer_id, b.seats);
      if (request.status === 'matched') await rides.setRequestStatus(client, request.request_id, 'open');
      await paymentsRepo.cancelForBooking(client, b.booking_id);
    }
    const updated = await rides.setBookingStatus(client, b.booking_id, 'cancelled');
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'booking.cancel',
      entity: 'booking',
      entityId: b.booking_id,
      ipAddress: req.ip,
      details: { was: b.status, by: party },
    });
    await notify(client, {
      userId: party === 'driver' ? request.rider_id : offer.driver_id,
      type: 'ride.cancelled',
      message: `${req.user.profile.full_name} cancelled the booking for ${offer.origin_name} to ${offer.destination_name}.`,
      link: party === 'driver' ? '/' : '/driver',
      email: true,
    });
    return updated;
  });
  res.json({ booking: bookingToApi(booking) });
});

module.exports = router;
