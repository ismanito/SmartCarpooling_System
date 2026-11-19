const { api, resetDb, createStudent, auth, pool, approveAsDriver } = require('./helpers/testApp');
const realtime = require('../src/services/realtime');

let pushed = [];
beforeAll(() => realtime.setSink((e) => pushed.push(e)));
afterAll(() => realtime.setSink(null));
beforeEach(async () => {
  await resetDb();
  pushed = [];
  await pool.query(`UPDATE system_settings SET setting_value = '0' WHERE setting_key = 'random_selfie_check_percent'`);
});

const GATE = { lat: -1.2189, lng: 36.8808, label: 'USIU-Africa, Gate A' };
const ROYSAMBU = { lat: -1.2185, lng: 36.8892, label: 'Roysambu' };

let plate = 0;
async function assignedRide(riderCount = 1) {
  plate += 1;
  const driver = await createStudent({ fullName: 'Dan Driver' });
  await api().post('/api/vehicles').set(auth(driver.token)).send({ makeModel: 'Toyota Axio', plateNumber: `KMS${100 + plate}M`, colour: 'White', seatCapacity: 3 }).expect(201);
  await approveAsDriver(driver.user.userId);
  await api().post('/api/driver/online').set(auth(driver.token)).send({ lat: GATE.lat, lng: GATE.lng }).expect(200);
  const riders = [];
  for (let i = 0; i < riderCount; i += 1) {
    const r = await createStudent({ fullName: `Rider ${i + 1}` });
    await api().post('/api/requests').set(auth(r.token)).send({ type: 'now', pickup: GATE, dropoff: ROYSAMBU, seats: 1 }).expect(201);
    const offer = (await api().get('/api/driver/state').set(auth(driver.token)).expect(200)).body.offer;
    await api().post(`/api/offers/${offer.offerId}/accept`).set(auth(driver.token)).expect(200);
    riders.push(r);
  }
  const { rows } = await pool.query('SELECT ride_id FROM rides WHERE driver_id = $1', [driver.user.userId]);
  return { driver, riders, rideId: rows[0].ride_id };
}
const send = (who, rideId, body, riderId) => api().post(`/api/rides/${rideId}/messages`).set(auth(who.token)).send({ body, ...(riderId ? { riderId } : {}) });
const read = (who, rideId, riderId, markRead = false) => api().get(`/api/rides/${rideId}/messages`).query({ ...(riderId ? { riderId } : {}), ...(markRead ? { read: 1 } : {}) }).set(auth(who.token));

describe('messages between a driver and a rider', () => {
  it('lets them talk, tells the other person, and counts unread messages', async () => {
    const { driver, riders: [rider], rideId } = await assignedRide();
    await send(rider, rideId, 'I am at the gate by the guard').expect(201);
    expect(pushed.some((e) => e.event === 'message:new' && e.userId === driver.user.userId)).toBe(true);

    const unread = (await api().get(`/api/rides/${rideId}/messages/unread`).set(auth(driver.token)).expect(200)).body;
    expect(unread.total).toBe(1);
    expect(unread.byRider[rider.user.userId]).toBe(1);

    const seen = (await read(driver, rideId, rider.user.userId, true).expect(200)).body;
    expect(seen.messages).toEqual([expect.objectContaining({ body: 'I am at the gate by the guard', mine: false })]);
    expect((await api().get(`/api/rides/${rideId}/messages/unread`).set(auth(driver.token))).body.total).toBe(0);

    await send(driver, rideId, 'On my way, two minutes', rider.user.userId).expect(201);
    const back = (await read(rider, rideId).expect(200)).body;
    expect(back.messages.map((m) => [m.body, m.mine])).toEqual([['I am at the gate by the guard', true], ['On my way, two minutes', false]]);
  });

  it('keeps each rider in a pooled ride in a private thread with the driver', async () => {
    const { driver, riders: [a, b], rideId } = await assignedRide(2);
    await send(a, rideId, 'Hello from A').expect(201);
    await send(b, rideId, 'Hello from B').expect(201);
    expect((await read(a, rideId)).body.messages.map((m) => m.body)).toEqual(['Hello from A']);
    expect((await read(b, rideId)).body.messages.map((m) => m.body)).toEqual(['Hello from B']);
    expect((await read(driver, rideId, a.user.userId)).body.messages.map((m) => m.body)).toEqual(['Hello from A']);
    // the driver must say which rider
    expect((await read(driver, rideId)).status).toBe(400);
  });

  it('is closed to everyone else', async () => {
    const { riders: [rider], rideId } = await assignedRide();
    const stranger = await createStudent({ fullName: 'Stranger' });
    expect((await send(stranger, rideId, 'hi')).status).toBe(404);
    expect((await read(stranger, rideId)).status).toBe(404);
    expect((await read(stranger, rideId, rider.user.userId)).status).toBe(404);
    expect((await api().get(`/api/rides/${rideId}/messages`)).status).toBe(401);
  });

  it('rejects empty and over-long messages, and cleans control characters', async () => {
    const { riders: [rider], rideId } = await assignedRide();
    expect((await send(rider, rideId, '   ')).status).toBe(400);
    expect((await send(rider, rideId, 'x'.repeat(301))).status).toBe(400);
    const ok = await send(rider, rideId, 'two\nlines\tand   spaces').expect(201);
    expect(ok.body.body).toBe('two lines and spaces');
  });

  it('closes once a ride is cancelled or has been over for two hours', async () => {
    const { riders: [rider], rideId } = await assignedRide();
    await pool.query(`UPDATE rides SET status = 'completed', completed_at = now() - interval '3 hours' WHERE ride_id = $1`, [rideId]);
    const res = await send(rider, rideId, 'thanks!');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHAT_CLOSED');
    expect((await read(rider, rideId)).status).toBe(200); // the history can still be read
  });
});
