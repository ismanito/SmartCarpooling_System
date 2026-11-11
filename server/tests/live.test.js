const { api, resetDb, createStudent, auth, pool } = require('./helpers/testApp');

beforeEach(resetDb);

const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

let plates = 0
async function confirmed(departMinutes = 30) {
  plates += 1
  const driver = await createStudent({ fullName: 'Dan Driver' });
  const rider = await createStudent({ fullName: 'Rita Rider' });
  const v = await api().post('/api/vehicles').set(auth(driver.token)).send({ makeModel: 'Toyota Axio', plateNumber: `KDG${100 + plates}G`, colour: 'Grey', seatCapacity: 3 }).expect(201);
  const offer = (
    await api().post('/api/rides/offers').set(auth(driver.token)).send({ vehicleId: v.body.vehicle.vehicleId, origin: 'roysambu', destination: 'westlands', departAt: inMinutes(departMinutes), seats: 3 }).expect(201)
  ).body.offer;
  const request = (
    await api().post('/api/rides/requests').set(auth(rider.token)).send({ origin: 'trm', destination: 'westlands', departAt: inMinutes(departMinutes + 2), seats: 1 }).expect(201)
  ).body.request;
  const booking = (await api().post('/api/rides/bookings').set(auth(rider.token)).send({ offerId: offer.offerId, requestId: request.requestId }).expect(201)).body.booking;
  await api().post(`/api/rides/bookings/${booking.bookingId}/accept`).set(auth(driver.token)).expect(200);
  return { driver, rider, offer };
}

const send = (who, offerId, body) => api().post(`/api/rides/trips/${offerId}/location`).set(auth(who.token)).send(body);
const read = (who, offerId) => api().get(`/api/rides/trips/${offerId}/location`).set(auth(who.token));

describe('live location', () => {
  it('shows riders where the driver is, and keeps only the latest position', async () => {
    const { driver, rider, offer } = await confirmed();
    expect((await read(rider, offer.offerId).expect(200)).body).toEqual({ sharing: false, location: null });

    await send(driver, offer.offerId, { lat: -1.22, lng: 36.88, heading: 90, speedKmh: 40 }).expect(204);
    await send(driver, offer.offerId, { lat: -1.23, lng: 36.89 }).expect(204);
    const seen = (await read(rider, offer.offerId).expect(200)).body;
    expect(seen.sharing).toBe(true);
    expect(seen.location).toMatchObject({ lat: -1.23, lng: 36.89 });
    expect((await pool.query('SELECT count(*)::int AS n FROM ride_locations')).rows[0].n).toBe(1);
  });

  it('only the driver can share, and only people in the car can watch', async () => {
    const { driver, rider, offer } = await confirmed();
    const stranger = await createStudent();
    expect((await send(rider, offer.offerId, { lat: -1.2, lng: 36.8 })).status).toBe(404);
    expect((await read(stranger, offer.offerId)).status).toBe(404);
    await send(driver, offer.offerId, { lat: -1.2, lng: 36.8 }).expect(204);
    expect((await read(stranger, offer.offerId)).status).toBe(404);
  });

  it('rejects impossible positions and sharing too early', async () => {
    const { driver, offer } = await confirmed();
    expect((await send(driver, offer.offerId, { lat: 123, lng: 36.8 })).status).toBe(400);
    expect((await send(driver, offer.offerId, { lat: -1.2 })).status).toBe(400);
    const later = await confirmed(60 * 5);
    const res = await send(later.driver, later.offer.offerId, { lat: -1.2, lng: 36.8 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOO_EARLY');
  });

  it('goes quiet when the driver stops, the position goes stale, or the ride ends', async () => {
    const { driver, rider, offer } = await confirmed();
    await send(driver, offer.offerId, { lat: -1.2, lng: 36.8 }).expect(204);
    await pool.query(`UPDATE ride_locations SET updated_at = now() - interval '5 minutes'`);
    expect((await read(rider, offer.offerId)).body.sharing).toBe(false); // stale: the phone stopped reporting

    await send(driver, offer.offerId, { lat: -1.2, lng: 36.8 }).expect(204);
    await api().delete(`/api/rides/trips/${offer.offerId}/location`).set(auth(driver.token)).expect(204);
    expect((await read(rider, offer.offerId)).body.location).toBeNull();

    await send(driver, offer.offerId, { lat: -1.2, lng: 36.8 }).expect(204);
    await api().post(`/api/rides/offers/${offer.offerId}/complete`).set(auth(driver.token)).expect(204);
    expect((await pool.query('SELECT count(*)::int AS n FROM ride_locations')).rows[0].n).toBe(0);
    expect((await send(driver, offer.offerId, { lat: -1.2, lng: 36.8 })).status).toBe(409);
  });
});
