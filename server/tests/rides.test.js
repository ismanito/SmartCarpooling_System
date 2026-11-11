const { api, resetDb, createStudent, auth, pool, auditRows, tokenFor } = require('./helpers/testApp');

beforeEach(resetDb);

const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();
const corolla = { makeModel: 'Toyota Corolla', plateNumber: 'kda 123a', colour: 'Silver', seatCapacity: 3 };

async function driverWithOffer(offer = {}, { plateNumber = corolla.plateNumber } = {}) {
  const driver = await createStudent({ fullName: 'Dan Driver' });
  const v = await api().post('/api/vehicles').set(auth(driver.token)).send({ ...corolla, plateNumber }).expect(201);
  const res = await api()
    .post('/api/rides/offers')
    .set(auth(driver.token))
    .send({ vehicleId: v.body.vehicle.vehicleId, origin: 'roysambu', destination: 'westlands', departAt: inMinutes(120), seats: 3, ...offer });
  expect(res.status).toBe(201);
  return { driver, vehicleId: v.body.vehicle.vehicleId, offer: res.body.offer };
}

async function riderWithRequest(request = {}) {
  const rider = await createStudent({ fullName: 'Rita Rider' });
  const res = await api()
    .post('/api/rides/requests')
    .set(auth(rider.token))
    .send({ origin: 'trm', destination: 'westlands', departAt: inMinutes(125), seats: 1, ...request });
  expect(res.status).toBe(201);
  return { rider, request: res.body.request };
}

const book = (token, offerId, requestId) => api().post('/api/rides/bookings').set(auth(token)).send({ offerId, requestId });
const act = (token, bookingId, action) => api().post(`/api/rides/bookings/${bookingId}/${action}`).set(auth(token));
const seatsLeft = async (offerId) =>
  (await pool.query('SELECT seats_available FROM ride_offers WHERE offer_id = $1', [offerId])).rows[0].seats_available;

describe('places', () => {
  it('lists the pick-up points', async () => {
    const { token } = await createStudent();
    const res = await api().get('/api/rides/places').set(auth(token)).expect(200);
    expect(res.body.places).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'usiu', name: 'USIU-Africa campus', lat: expect.any(Number), lng: expect.any(Number) })]));
  });
});

describe('offers and requests', () => {
  it('creates an offer with a route distance and cost per seat', async () => {
    const { offer } = await driverWithOffer();
    expect(offer).toMatchObject({ origin: 'Roysambu', destination: 'Westlands', seatsTotal: 3, seatsAvailable: 3, status: 'open' });
    expect(offer.routeKm).toBeGreaterThan(5);
    expect(offer.costPerSeatKes).toBeGreaterThanOrEqual(10);
  });

  it.each([
    ['a past departure', { departAt: inMinutes(-5) }, 'departAt'],
    ['an unknown place', { origin: 'mars' }, 'origin'],
    ['the same start and end', { destination: 'roysambu' }, 'destination'],
    ['more seats than the car has', { seats: 5 }, 'seats'],
  ])('rejects an offer with %s', async (_, change, field) => {
    const { driver, vehicleId } = await driverWithOffer();
    const res = await api()
      .post('/api/rides/offers')
      .set(auth(driver.token))
      .send({ vehicleId, origin: 'roysambu', destination: 'westlands', departAt: inMinutes(60), seats: 2, ...change });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
  });

  it("rejects an offer using someone else's vehicle", async () => {
    const { vehicleId } = await driverWithOffer();
    const other = await createStudent();
    const res = await api()
      .post('/api/rides/offers')
      .set(auth(other.token))
      .send({ vehicleId, origin: 'usiu', destination: 'cbd', departAt: inMinutes(60), seats: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('vehicleId');
  });

  it('requires a completed profile', async () => {
    const token = tokenFor({ uid: 'no-profile', email: 'np@usiu.ac.ke' });
    const res = await api().get('/api/rides/requests/mine').set(auth(token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROFILE_REQUIRED');
  });
});

describe('matching', () => {
  it('suggests nearby offers at a similar time to the rider', async () => {
    const { offer } = await driverWithOffer();
    const { rider, request } = await riderWithRequest();
    const res = await api().get(`/api/rides/requests/${request.requestId}/matches`).set(auth(rider.token)).expect(200);
    expect(res.body.matches).toHaveLength(1);
    expect(res.body.matches[0].offer).toMatchObject({ offerId: offer.offerId, driver: { fullName: 'Dan Driver' } });
    expect(res.body.matches[0].offer.driver.phoneNumber).toBeUndefined();
    expect(res.body.matches[0].match.score).toBeGreaterThan(0.5);
    expect(res.body.matches[0].match.timeDiffMin).toBe(-5);
  });

  it('suggests matching riders to the driver', async () => {
    const { driver, offer } = await driverWithOffer();
    const { request } = await riderWithRequest();
    const res = await api().get(`/api/rides/offers/${offer.offerId}/matches`).set(auth(driver.token)).expect(200);
    expect(res.body.matches.map((m) => m.request.requestId)).toEqual([request.requestId]);
    expect(res.body.matches[0].request.rider).toMatchObject({ fullName: 'Rita Rider' });
  });

  it.each([
    ['the pick-up is far away', { origin: 'cbd', destination: 'westlands' }],
    ['the drop-off is far away', { destination: 'embakasi' }],
    ['the time is too different', { departAt: inMinutes(200) }],
    ['more seats are needed than offered', { seats: 4 }],
  ])('does not match when %s', async (_, change) => {
    await driverWithOffer();
    const { rider, request } = await riderWithRequest(change);
    const res = await api().get(`/api/rides/requests/${request.requestId}/matches`).set(auth(rider.token)).expect(200);
    expect(res.body.matches).toHaveLength(0);
  });

  it("hides other students' requests and offers", async () => {
    const { offer } = await driverWithOffer();
    const { request } = await riderWithRequest();
    const stranger = await createStudent();
    expect((await api().get(`/api/rides/requests/${request.requestId}/matches`).set(auth(stranger.token))).status).toBe(404);
    expect((await api().get(`/api/rides/offers/${offer.offerId}/matches`).set(auth(stranger.token))).status).toBe(404);
  });
});

describe('booking flow', () => {
  it('rider requests a seat, driver accepts, seats drop and phone numbers are shared', async () => {
    const { driver, offer } = await driverWithOffer();
    const { rider, request } = await riderWithRequest({ seats: 2 });

    const booked = await book(rider.token, offer.offerId, request.requestId);
    expect(booked.status).toBe(201);
    expect(booked.body.booking).toMatchObject({ initiatedBy: 'rider', status: 'pending', seats: 2 });
    const id = booked.body.booking.bookingId;

    // Pending: no phone numbers yet, and the rider cannot accept their own request.
    const pending = await api().get('/api/rides/offers/mine').set(auth(driver.token)).expect(200);
    expect(pending.body.offers[0].bookings[0].rider.phoneNumber).toBeNull();
    expect((await act(rider.token, id, 'accept')).status).toBe(403);

    const accepted = await act(driver.token, id, 'accept');
    expect(accepted.status).toBe(200);
    expect(accepted.body.booking.status).toBe('accepted');

    const mineDriver = await api().get('/api/rides/offers/mine').set(auth(driver.token));
    expect(mineDriver.body.offers[0].seatsAvailable).toBe(1);
    expect(mineDriver.body.offers[0].bookings[0].rider.phoneNumber).toBe('+254712345678');

    const mineRider = await api().get('/api/rides/requests/mine').set(auth(rider.token));
    expect(mineRider.body.requests[0].status).toBe('matched');
    expect(mineRider.body.requests[0].bookings[0]).toMatchObject({
      status: 'accepted',
      driver: { fullName: 'Dan Driver', phoneNumber: '+254712345678' },
      vehicle: { plateNumber: 'KDA123A' },
    });

    const actions = (await auditRows()).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['ride_offer.create', 'ride_request.create', 'booking.create', 'booking.accept']));
  });

  it('driver invites a rider, rider declines, and the pair is not suggested again', async () => {
    const { driver, offer } = await driverWithOffer();
    const { rider, request } = await riderWithRequest();
    const invite = await book(driver.token, offer.offerId, request.requestId);
    expect(invite.body.booking.initiatedBy).toBe('driver');
    const id = invite.body.booking.bookingId;

    expect((await act(driver.token, id, 'accept')).status).toBe(403);
    expect((await act(rider.token, id, 'decline')).body.booking.status).toBe('declined');

    const again = await api().get(`/api/rides/requests/${request.requestId}/matches`).set(auth(rider.token));
    expect(again.body.matches).toHaveLength(0);
    expect((await book(driver.token, offer.offerId, request.requestId)).status).toBe(409);
  });

  it("accepting one ride withdraws the rider's other pending bookings", async () => {
    const a = await driverWithOffer();
    const b = await driverWithOffer({ departAt: inMinutes(130), seats: 2 }, { plateNumber: 'KDB 999B' });
    const { rider, request } = await riderWithRequest();
    const b1 = await book(rider.token, a.offer.offerId, request.requestId);
    const b2 = await book(rider.token, b.offer.offerId, request.requestId);

    await act(a.driver.token, b1.body.booking.bookingId, 'accept').expect(200);
    expect((await act(b.driver.token, b2.body.booking.bookingId, 'accept')).status).toBe(409);
    const { rows } = await pool.query('SELECT status FROM bookings WHERE booking_id = $1', [b2.body.booking.bookingId]);
    expect(rows[0].status).toBe('cancelled');
  });

  it('never sells more seats than offered, even when accepting at the same time', async () => {
    const { driver, offer } = await driverWithOffer({ seats: 2 });
    const r1 = await riderWithRequest({ seats: 2 });
    const r2 = await riderWithRequest({ seats: 1 });
    const b1 = await book(r1.rider.token, offer.offerId, r1.request.requestId);
    const b2 = await book(r2.rider.token, offer.offerId, r2.request.requestId);

    const results = await Promise.all([
      act(driver.token, b1.body.booking.bookingId, 'accept'),
      act(driver.token, b2.body.booking.bookingId, 'accept'),
    ]);
    const statuses = results.map((r) => r.status);
    expect(statuses).toContain(200);
    const left = await seatsLeft(offer.offerId);
    expect(left).toBeGreaterThanOrEqual(0);
    // Either rider 1 got both seats (rider 2 refused) or rider 2 got one and rider 1 was refused.
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
  });

  it('cancelling an accepted booking gives the seat back and reopens the request', async () => {
    const { driver, offer } = await driverWithOffer();
    const { rider, request } = await riderWithRequest();
    const b = await book(rider.token, offer.offerId, request.requestId);
    await act(driver.token, b.body.booking.bookingId, 'accept').expect(200);
    await act(rider.token, b.body.booking.bookingId, 'cancel').expect(200);

    expect(await seatsLeft(offer.offerId)).toBe(3);
    const mine = await api().get('/api/rides/requests/mine').set(auth(rider.token));
    expect(mine.body.requests[0].status).toBe('open');
  });

  it("cancelling an offer cancels its bookings and reopens the riders' requests", async () => {
    const { driver, offer, vehicleId } = await driverWithOffer();
    const { rider, request } = await riderWithRequest();
    const b = await book(rider.token, offer.offerId, request.requestId);
    await act(driver.token, b.body.booking.bookingId, 'accept').expect(200);

    // The vehicle cannot be deleted while it has an upcoming ride.
    const blocked = await api().delete(`/api/vehicles/${vehicleId}`).set(auth(driver.token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('VEHICLE_IN_USE');

    await api().post(`/api/rides/offers/${offer.offerId}/cancel`).set(auth(driver.token)).expect(204);
    const mine = await api().get('/api/rides/requests/mine').set(auth(rider.token));
    expect(mine.body.requests[0].status).toBe('open');
    expect(mine.body.requests[0].bookings[0].status).toBe('cancelled');
    expect((await api().delete(`/api/vehicles/${vehicleId}`).set(auth(driver.token))).status).toBe(204);
  });

  it('cancelling a request frees the seats it held', async () => {
    const { driver, offer } = await driverWithOffer();
    const { rider, request } = await riderWithRequest({ seats: 2 });
    const b = await book(rider.token, offer.offerId, request.requestId);
    await act(driver.token, b.body.booking.bookingId, 'accept').expect(200);
    await api().post(`/api/rides/requests/${request.requestId}/cancel`).set(auth(rider.token)).expect(204);
    expect(await seatsLeft(offer.offerId)).toBe(3);
  });

  it('rejects booking your own ride and strangers acting on bookings', async () => {
    const { driver, offer } = await driverWithOffer();
    const own = await api()
      .post('/api/rides/requests')
      .set(auth(driver.token))
      .send({ origin: 'roysambu', destination: 'westlands', departAt: inMinutes(120), seats: 1 });
    const self = await book(driver.token, offer.offerId, own.body.request.requestId);
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe('OWN_RIDE');

    const { rider, request } = await riderWithRequest();
    const b = await book(rider.token, offer.offerId, request.requestId);
    const stranger = await createStudent();
    expect((await act(stranger.token, b.body.booking.bookingId, 'accept')).status).toBe(404);
    expect((await book(stranger.token, offer.offerId, request.requestId)).status).toBe(404);
  });
});
