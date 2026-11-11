// One full journey through the real API (verified-token stand-in for Firebase, real Postgres).
const { api, resetDb, createStudent, createAdmin, auth } = require('./helpers/testApp');

beforeEach(resetDb);

const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

it('driver and rider travel together, rate each other, and the admin acts on a report', async () => {
  // Sign up
  const driver = await createStudent({ fullName: 'Dan Driver' });
  const rider = await createStudent({ fullName: 'Rita Rider' });
  const admin = await createAdmin();

  // Both post trips
  const vehicle = (await api().post('/api/vehicles').set(auth(driver.token)).send({ makeModel: 'Toyota Axio', plateNumber: 'KDE222E', colour: 'White', seatCapacity: 3 }).expect(201)).body.vehicle;
  const offer = (
    await api().post('/api/rides/offers').set(auth(driver.token)).send({ vehicleId: vehicle.vehicleId, origin: 'roysambu', destination: 'westlands', departAt: inMinutes(30), seats: 3 }).expect(201)
  ).body.offer;
  const request = (
    await api().post('/api/rides/requests').set(auth(rider.token)).send({ origin: 'trm', destination: 'westlands', departAt: inMinutes(32), seats: 1 }).expect(201)
  ).body.request;

  // The rider sees the driver in matches, asks for a seat, the driver accepts
  const matches = (await api().get(`/api/rides/requests/${request.requestId}/matches`).set(auth(rider.token)).expect(200)).body.matches;
  expect(matches.map((m) => m.offer.offerId)).toContain(offer.offerId);
  const booking = (await api().post('/api/rides/bookings').set(auth(rider.token)).send({ offerId: offer.offerId, requestId: request.requestId }).expect(201)).body.booking;
  await api().post(`/api/rides/bookings/${booking.bookingId}/accept`).set(auth(driver.token)).expect(200);

  // The driver completes; the fare is shared correctly (driver + 1 rider)
  await api().post(`/api/rides/offers/${offer.offerId}/complete`).set(auth(driver.token)).expect(204);
  const { fare } = (await api().get(`/api/rides/trips/${offer.offerId}`).set(auth(driver.token)).expect(200)).body;
  expect(fare.commissionKes).toBe(0);
  expect(fare.driverShareKes + fare.shares.reduce((n, s) => n + s.amountKes, 0)).toBe(fare.totalKes);
  await api().post(`/api/payments/shares/${fare.shares[0].shareId}/settle`).set(auth(driver.token)).expect(204);

  // Both rate
  await api().post(`/api/rides/bookings/${booking.bookingId}/rate`).set(auth(rider.token)).send({ stars: 2, tags: ['On time'] }).expect(201);
  await api().post(`/api/rides/bookings/${booking.bookingId}/rate`).set(auth(driver.token)).send({ stars: 5 }).expect(201);

  // The rider reports an incident
  const { reportId } = (
    await api()
      .post(`/api/rides/bookings/${booking.bookingId}/incidents`)
      .set(auth(rider.token))
      .send({ reportedUserId: driver.user.userId, category: 'unsafe_driving', description: 'Used a phone while driving.' })
      .expect(201)
  ).body;

  // The admin sees it, verifies the audit chain, and suspends the driver
  const list = (await api().get('/api/admin/incidents?status=open').set(auth(admin.token)).expect(200)).body.incidents;
  expect(list.map((i) => i.reportId)).toContain(reportId);
  const verified = (await api().get('/api/admin/audit/verify').set(auth(admin.token)).expect(200)).body;
  expect(verified).toMatchObject({ valid: true, firstBroken: null });
  await api().post(`/api/admin/incidents/${reportId}/decision`).set(auth(admin.token)).send({ decision: 'suspended', notes: 'Unsafe driving' }).expect(200);

  // The driver is locked out, and a new rider no longer sees their trips
  expect((await api().get('/api/users/me').set(auth(driver.token))).status).toBe(403);
  const newer = await createStudent({ fullName: 'Nia New' });
  const newRequest = (
    await api().post('/api/rides/requests').set(auth(newer.token)).send({ origin: 'trm', destination: 'westlands', departAt: inMinutes(33), seats: 1 }).expect(201)
  ).body.request;
  const after = (await api().get(`/api/rides/requests/${newRequest.requestId}/matches`).set(auth(newer.token)).expect(200)).body.matches;
  expect(after).toHaveLength(0);
  expect((await api().get('/api/admin/audit/verify').set(auth(admin.token))).body.valid).toBe(true);
});
