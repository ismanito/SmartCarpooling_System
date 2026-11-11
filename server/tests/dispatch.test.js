const { api, resetDb, createStudent, createAdmin, auth, pool, auditRows } = require('./helpers/testApp');
const { verifyAuditChain } = require('../src/services/audit');
const dispatch = require('../src/services/dispatch');
const booking = require('../src/services/booking');
const realtime = require('../src/services/realtime');

let pushed = [];
beforeAll(() => realtime.setSink((e) => pushed.push(e)));
afterAll(() => realtime.setSink(null));
beforeEach(async () => {
  await resetDb();
  pushed = [];
});

// Places (all inside the seeded zones)
const GATE = { lat: -1.2189, lng: 36.8808, label: 'USIU-Africa, Gate A' };
const NEAR_GATE = { lat: -1.2192, lng: 36.8812, label: 'Near the gate' };
const TRM = { lat: -1.2196, lng: 36.8886, label: 'Thika Road Mall' };
const ROYSAMBU = { lat: -1.2185, lng: 36.8892, label: 'Roysambu' };
const KASARANI = { lat: -1.2216, lng: 36.9046, label: 'Kasarani' };
const WESTLANDS = { lat: -1.2676, lng: 36.8108, label: 'Westlands' };
const FAR_AWAY = { lat: -1.6, lng: 36.2, label: 'Somewhere far' };

let plateNo = 0;
async function onlineDriver(at, name = 'Dan Driver') {
  plateNo += 1;
  const d = await createStudent({ fullName: name });
  await api().post('/api/vehicles').set(auth(d.token)).send({ makeModel: 'Toyota Axio', plateNumber: `KDQ${100 + plateNo}Q`, colour: 'White', seatCapacity: 3 }).expect(201);
  await api().post('/api/driver/online').set(auth(d.token)).send({ lat: at.lat, lng: at.lng }).expect(200);
  return d;
}
const rider = (name = 'Rita Rider') => createStudent({ fullName: name });
const ask = (who, pickup, dropoff, extra = {}) => api().post('/api/requests').set(auth(who.token)).send({ type: 'now', pickup, dropoff, seats: 1, ...extra });
const state = async (d) => (await api().get('/api/driver/state').set(auth(d.token)).expect(200)).body;
const accept = (d, offerId) => api().post(`/api/offers/${offerId}/accept`).set(auth(d.token));
const decline = (d, offerId) => api().post(`/api/offers/${offerId}/decline`).set(auth(d.token));
const mine = async (who) => (await api().get('/api/requests/mine').set(auth(who.token)).expect(200)).body.requests;
const live = (who, rideId) => api().get(`/api/rides/${rideId}/live`).set(auth(who.token));

/** The request's current status. */
const statusOf = async (id) => (await pool.query('SELECT status FROM trip_requests WHERE request_id = $1', [id])).rows[0].status;

describe('zones and the pilot area', () => {
  it('refuses places outside every zone', async () => {
    const r = await rider();
    const res = await ask(r, GATE, FAR_AWAY);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OUTSIDE_PILOT_AREA');
  });

  it('tags pick-up and drop-off with their zones, and estimates a share range', async () => {
    const r = await rider();
    const est = (await api().post('/api/requests/estimate').set(auth(r.token)).send({ pickup: GATE, dropoff: WESTLANDS }).expect(200)).body;
    expect(est).toMatchObject({ inPilotArea: true, pickupZone: 'USIU Campus', dropoffZone: 'Westlands', driversNearby: 0 });
    expect(est.estShareKes).toBeGreaterThan(est.estPooledKes);
  });
});

describe('finding a driver', () => {
  it('offers the request to the nearest driver first', async () => {
    const near = await onlineDriver(NEAR_GATE, 'Near Nick');
    const far = await onlineDriver(ROYSAMBU, 'Far Fred');
    const r = await rider();
    await ask(r, GATE, ROYSAMBU).expect(201);
    expect((await state(near)).offer).toMatchObject({ pickup: { label: GATE.label } });
    expect((await state(far)).offer).toBeNull();
    expect(pushed.some((e) => e.event === 'offer:new' && e.userId === near.user.userId)).toBe(true);
  });

  it('a decline or an expired offer passes it to the next driver, and nobody gets it twice', async () => {
    const a = await onlineDriver(NEAR_GATE, 'Ann');
    const b = await onlineDriver(TRM, 'Ben');
    const r = await rider();
    const req = (await ask(r, GATE, ROYSAMBU).expect(201)).body.request;
    const first = (await state(a)).offer;
    await decline(a, first.offerId).expect(204);
    const second = (await state(b)).offer;
    expect(second.requestId).toBe(req.requestId);
    // Let it run out instead of answering.
    await pool.query('UPDATE dispatch_offers SET expires_at = now() - interval \'1 second\' WHERE offer_id = $1', [second.offerId]);
    await dispatch.sweepExpiredOffers();
    expect(await statusOf(req.requestId)).toBe('no_driver'); // nobody left, and Ann was already asked
    const log = (await pool.query('SELECT response FROM dispatch_offers ORDER BY sent_at')).rows.map((x) => x.response);
    expect(log).toEqual(['declined', 'expired']);
    const actions = (await auditRows()).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['dispatch.offer', 'dispatch.decline', 'dispatch.expire', 'dispatch.no_driver']));
  });

  it('never offers to drivers who are offline, full, too far, or have no vehicle', async () => {
    const offline = await onlineDriver(NEAR_GATE, 'Off Olive');
    await api().post('/api/driver/offline').set(auth(offline.token)).expect(204);
    const full = await onlineDriver(NEAR_GATE, 'Full Fay');
    await pool.query('UPDATE driver_status SET seats_free = 0 WHERE driver_id = $1', [full.user.userId]);
    const far = await onlineDriver({ lat: -1.2676, lng: 36.8108 }, 'Far Frank'); // Westlands, well over 3 km away
    const noCar = await createStudent({ fullName: 'No Car' });
    const refused = await api().post('/api/driver/online').set(auth(noCar.token)).send({ lat: GATE.lat, lng: GATE.lng });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('NO_VEHICLE');

    const r = await rider();
    const req = (await ask(r, GATE, ROYSAMBU).expect(201)).body.request;
    for (const d of [offline, full, far]) expect((await state(d)).offer).toBeNull();
    expect(await statusOf(req.requestId)).toBe('no_driver');
  });

  it('a suspended driver is never offered a request', async () => {
    const d = await onlineDriver(NEAR_GATE);
    const admin = await createAdmin();
    await api().post(`/api/admin/users/${d.user.userId}/suspend`).set(auth(admin.token)).expect(200);
    const r = await rider();
    const req = (await ask(r, GATE, ROYSAMBU).expect(201)).body.request;
    expect(await statusOf(req.requestId)).toBe('no_driver');
  });
});

describe('accepting', () => {
  it('assigns the driver, builds the stop list and takes a seat', async () => {
    const d = await onlineDriver(NEAR_GATE);
    const r = await rider();
    const req = (await ask(r, GATE, ROYSAMBU).expect(201)).body.request;
    const { offer } = await state(d);
    const res = await accept(d, offer.offerId).expect(200);
    expect(await statusOf(req.requestId)).toBe('assigned');
    const s = await state(d);
    expect(s.seatsFree).toBe(2);
    expect(s.ride.stops.map((x) => x.kind)).toEqual(['pickup', 'dropoff']);
    expect(res.body.rideId).toBe(s.ride.ride.rideId);
    const m = (await mine(r))[0];
    expect(m).toMatchObject({ status: 'assigned', rideId: res.body.rideId, driverFirstName: 'Dan' });
    expect((await api().get('/api/notifications').set(auth(r.token))).body.notifications.map((n) => n.type)).toContain('ride.assigned');
  });

  it('a request can never be assigned to two drivers, even when both accept at once', async () => {
    const a = await onlineDriver(NEAR_GATE, 'Ann');
    const b = await onlineDriver(TRM, 'Ben');
    const r = await rider();
    const req = (await ask(r, GATE, ROYSAMBU).expect(201)).body.request;
    const offerA = (await state(a)).offer;
    // Force a second live offer for the same request, as if a race had handed it to both.
    const { rows } = await pool.query(
      `INSERT INTO dispatch_offers (request_id, driver_id, expires_at, pickup_eta_min) VALUES ($1, $2, now() + interval '30 seconds', 3) RETURNING offer_id`,
      [req.requestId, b.user.userId],
    );
    const results = await Promise.all([accept(a, offerA.offerId), accept(b, rows[0].offer_id)]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    expect((await pool.query('SELECT count(*)::int AS n FROM ride_stops WHERE request_id = $1', [req.requestId])).rows[0].n).toBe(2);
  });

  it('only the driver the offer was sent to can answer it, and only once', async () => {
    const a = await onlineDriver(NEAR_GATE, 'Ann');
    const other = await onlineDriver(TRM, 'Ben');
    const r = await rider();
    await ask(r, GATE, ROYSAMBU).expect(201);
    const { offer } = await state(a);
    expect((await accept(other, offer.offerId)).status).toBe(404);
    expect((await accept(r, offer.offerId)).status).toBe(404);
    await accept(a, offer.offerId).expect(200);
    expect((await accept(a, offer.offerId)).status).toBe(409);
    expect((await decline(a, offer.offerId)).status).toBe(409);
  });

  it('an expired offer cannot be accepted', async () => {
    const d = await onlineDriver(NEAR_GATE);
    const r = await rider();
    await ask(r, GATE, ROYSAMBU).expect(201);
    const { offer } = await state(d);
    await pool.query(`UPDATE dispatch_offers SET expires_at = now() - interval '1 second'`);
    const res = await accept(d, offer.offerId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OFFER_EXPIRED');
  });
});

describe('pooling riders going to the same area', () => {
  async function carryingRoysambu() {
    const d = await onlineDriver(NEAR_GATE, 'Pool Pat');
    const first = await rider('First Rider');
    await ask(first, GATE, ROYSAMBU).expect(201);
    await accept(d, (await state(d)).offer.offerId).expect(200);
    return { d, first };
  }

  it('offers a second rider heading to the same zone to the car already going there', async () => {
    const { d } = await carryingRoysambu();
    const empty = await onlineDriver(TRM, 'Empty Eve'); // also close, but carrying nobody
    const second = await rider('Second Rider');
    const req = (await ask(second, NEAR_GATE, ROYSAMBU).expect(201)).body.request;
    const offer = (await state(d)).offer;
    expect(offer).toMatchObject({ requestId: req.requestId, pooled: true });
    expect((await state(empty)).offer).toBeNull();
    await accept(d, offer.offerId).expect(200);

    const s = await state(d);
    expect(s.seatsFree).toBe(1);
    expect(s.ride.stops).toHaveLength(4);
    expect(s.ride.riders).toHaveLength(2);
    // Each rider sees that the car is shared, but only the other rider's area.
    const seen = await live(second, s.ride.ride.rideId).expect(200);
    expect(seen.body.pooled).toBe(true);
    expect(seen.body.pooledWith[0].zone).toBe('Thika Road Mall'); // that point sits in the smaller TRM zone
    expect(JSON.stringify(seen.body)).not.toContain('First Rider');
  });

  it('does not pool a rider going to a zone that is not next to the first', async () => {
    const { d } = await carryingRoysambu();
    const third = await rider('Westlands Wendy');
    const req = (await ask(third, NEAR_GATE, WESTLANDS).expect(201)).body.request;
    expect((await state(d)).offer).toBeNull();
    expect(await statusOf(req.requestId)).toBe('no_driver');
  });

  it('never carries more riders than the limit', async () => {
    const { d } = await carryingRoysambu();
    await pool.query(`UPDATE system_settings SET setting_value = '1' WHERE setting_key = 'max_riders_per_car'`);
    const second = await rider('Second');
    const req = (await ask(second, NEAR_GATE, ROYSAMBU).expect(201)).body.request;
    expect((await state(d)).offer).toBeNull();
    expect(await statusOf(req.requestId)).toBe('no_driver');
    await pool.query(`UPDATE system_settings SET setting_value = '3' WHERE setting_key = 'max_riders_per_car'`);
  });
});

describe('a whole ride', () => {
  async function pooledRide() {
    const d = await onlineDriver(NEAR_GATE, 'Dan Driver');
    const a = await rider('Amina A');
    const b = await rider('Brian B');
    const ra = (await ask(a, GATE, KASARANI).expect(201)).body.request;
    await accept(d, (await state(d)).offer.offerId).expect(200);
    const rb = (await ask(b, NEAR_GATE, KASARANI).expect(201)).body.request;
    await accept(d, (await state(d)).offer.offerId).expect(200);
    const s = await state(d);
    return { d, a, b, ra, rb, rideId: s.ride.ride.rideId, stops: s.ride.stops };
  }
  const stopStep = (d, rideId, stopId, step) => api().post(`/api/rides/${rideId}/stops/${stopId}/${step}`).set(auth(d.token));

  it('runs pick-ups and drop-offs, shares the fuel cost by leg, and adds up exactly', async () => {
    const { d, a, b, rideId, stops } = await pooledRide();
    for (const stop of stops) {
      await stopStep(d, rideId, stop.stopId, 'arrived').expect(204);
      await stopStep(d, rideId, stop.stopId, 'done').expect(200);
    }
    const done = await api().post(`/api/rides/${rideId}/complete`).set(auth(d.token)).expect(200);

    const sa = (await live(a, rideId).expect(200)).body.shares;
    const sb = (await live(b, rideId).expect(200)).body.shares;
    expect(sa).toHaveLength(1);
    expect(sb).toHaveLength(1);
    const all = (await live(d, rideId).expect(200)).body;
    const riders = all.shares.reduce((n, x) => n + x.amountKes, 0);
    expect(riders).toBeLessThanOrEqual(done.body.totalKes);
    expect(done.body.totalKes).toBeGreaterThan(0);
    expect(sa[0].amountKes).toBeGreaterThan(0);
    // Two riders shared most of the road, so each pays less than the one-rider estimate.
    expect(sa[0].amountKes + sb[0].amountKes).toBeLessThan(done.body.totalKes);
    expect((await pool.query('SELECT status FROM rides WHERE ride_id = $1', [rideId])).rows[0].status).toBe('completed');
    expect((await state(d)).seatsFree).toBe(3);

    // Driver confirms the cash, then everyone rates.
    await api().post(`/api/ride-shares/${all.shares[0].shareId}/settle`).set(auth(d.token)).expect(204);
    expect((await api().post(`/api/ride-shares/${all.shares[0].shareId}/settle`).set(auth(d.token))).status).toBe(409);
    expect((await api().post(`/api/ride-shares/${all.shares[1].shareId}/settle`).set(auth(a.token))).status).toBe(404);
    await api().post(`/api/rides/${rideId}/ratings`).set(auth(a.token)).send({ rateeId: d.user.userId, stars: 4, tags: ['On time'] }).expect(201);
    expect((await api().post(`/api/rides/${rideId}/ratings`).set(auth(a.token)).send({ rateeId: d.user.userId, stars: 1 })).status).toBe(409);
    expect((await api().get('/api/users/me').set(auth(d.token))).body.user.avgRating).toBe(4);
    expect(await verifyAuditChain()).toMatchObject({ valid: true });
    const actions = (await auditRows()).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['ride.assign', 'ride.arrived', 'ride.picked_up', 'ride.dropped_off', 'ride.complete', 'payment.settle', 'rating.create']));
  });

  it('shows the car only to riders who are still in or waiting for it, and never stores a trail', async () => {
    const { d, a, b, rideId, stops } = await pooledRide();
    const stranger = await rider('Stranger');
    expect((await live(stranger, rideId)).status).toBe(404);

    await api().post('/api/driver/location').set(auth(d.token)).send({ lat: -1.22, lng: 36.88, heading: 90 }).expect(204);
    expect((await live(a, rideId).expect(200)).body.driver.location).toMatchObject({ lat: -1.22, lng: 36.88 });
    expect(pushed.some((e) => e.event === 'ride:location' && e.userId === a.user.userId)).toBe(true);

    // Amina is dropped off (after both are picked up) and can no longer see where the car is.
    const pick = stops.filter((s) => s.kind === 'pickup');
    for (const p of pick) {
      await stopStep(d, rideId, p.stopId, 'done').expect(200);
    }
    const dropA = stops.find((s) => s.kind === 'dropoff' && s.riderName === 'Amina A');
    await stopStep(d, rideId, dropA.stopId, 'done').expect(200);
    expect((await live(a, rideId).expect(200)).body.driver.location).toBeNull();
    expect((await live(b, rideId).expect(200)).body.driver.location).not.toBeNull();

    // One row per driver, overwritten: there is no location history anywhere.
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM driver_status`);
    expect(rows[0].n).toBe(1);
    await api().post('/api/driver/location').set(auth(d.token)).send({ lat: -1.23, lng: 36.89 }).expect(204);
    expect((await pool.query('SELECT count(*)::int AS n FROM driver_status')).rows[0].n).toBe(1);
  });

  it('only the assigned driver can act on a ride, and a rider cannot be dropped before pick-up', async () => {
    const { d, rideId, stops } = await pooledRide();
    const other = await onlineDriver(TRM, 'Other Olu');
    expect((await stopStep(other, rideId, stops[0].stopId, 'done')).status).toBe(404);
    expect((await api().post(`/api/rides/${rideId}/complete`).set(auth(other.token))).status).toBe(404);
    const drop = stops.find((s) => s.kind === 'dropoff');
    const early = await stopStep(d, rideId, drop.stopId, 'done');
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('NOT_PICKED_UP');
    const notYet = await api().post(`/api/rides/${rideId}/complete`).set(auth(d.token));
    expect(notYet.status).toBe(409);
  });

  it('after the wait, a driver can mark a no-show and the car is freed', async () => {
    const d = await onlineDriver(NEAR_GATE);
    const r = await rider();
    const req = (await ask(r, GATE, ROYSAMBU).expect(201)).body.request;
    await accept(d, (await state(d)).offer.offerId).expect(200);
    const { ride } = await state(d);
    const pickup = ride.stops.find((s) => s.kind === 'pickup');

    expect((await stopStep(d, ride.ride.rideId, pickup.stopId, 'no-show')).status).toBe(409); // not arrived yet
    await stopStep(d, ride.ride.rideId, pickup.stopId, 'arrived').expect(204);
    const early = await stopStep(d, ride.ride.rideId, pickup.stopId, 'no-show');
    expect(early.body.error.code).toBe('TOO_EARLY');
    await pool.query(`UPDATE ride_stops SET arrived_at = now() - interval '6 minutes' WHERE stop_id = $1`, [pickup.stopId]);
    await stopStep(d, ride.ride.rideId, pickup.stopId, 'no-show').expect(204);

    expect(await statusOf(req.requestId)).toBe('cancelled');
    const s = await state(d);
    expect(s.ride).toBeNull();
    expect(s.seatsFree).toBe(3);
    expect((await auditRows()).map((x) => x.action)).toContain('ride.no_show');
  });
});

describe('cancelling', () => {
  it('a rider can cancel while searching or after assignment, and the seat comes back', async () => {
    const d = await onlineDriver(NEAR_GATE);
    const r = await rider();
    const req = (await ask(r, GATE, ROYSAMBU).expect(201)).body.request;
    const { offer } = await state(d);
    await accept(d, offer.offerId).expect(200);
    expect((await state(d)).seatsFree).toBe(2);
    await api().post(`/api/requests/${req.requestId}/cancel`).set(auth(r.token)).send({}).expect(204);
    const s = await state(d);
    expect(s.seatsFree).toBe(3);
    expect(s.ride).toBeNull();
    expect((await api().get('/api/notifications').set(auth(d.token))).body.notifications.map((n) => n.type)).toContain('ride.cancelled');

    // Cancelling while an offer is out withdraws it.
    const r2 = await rider('Second');
    const req2 = (await ask(r2, GATE, ROYSAMBU).expect(201)).body.request;
    expect((await state(d)).offer).not.toBeNull();
    await api().post(`/api/requests/${req2.requestId}/cancel`).set(auth(r2.token)).send({}).expect(204);
    expect((await state(d)).offer).toBeNull();
    expect((await api().post(`/api/requests/${req2.requestId}/cancel`).set(auth(r.token)).send({})).status).toBe(404);
  });

  it('a driver cannot go offline in the middle of a ride', async () => {
    const d = await onlineDriver(NEAR_GATE);
    const r = await rider();
    await ask(r, GATE, ROYSAMBU).expect(201);
    await accept(d, (await state(d)).offer.offerId).expect(200);
    const res = await api().post('/api/driver/offline').set(auth(d.token));
    expect(res.status).toBe(409);
  });
});

describe('booking ahead', () => {
  const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

  it('dispatches a booking at the lead time, and pools compatible bookings into one request', async () => {
    const d = await onlineDriver(NEAR_GATE);
    const a = await rider('Amina');
    const b = await rider('Brian');
    const body = (at, pickup) => ({ type: 'scheduled', pickup, dropoff: KASARANI, seats: 1, scheduledFor: at });
    const ra = (await api().post('/api/requests').set(auth(a.token)).send(body(inMinutes(60), GATE)).expect(201)).body.request;
    const rb = (await api().post('/api/requests').set(auth(b.token)).send(body(inMinutes(64), NEAR_GATE)).expect(201)).body.request;
    expect(ra.status).toBe('scheduled');
    expect((await state(d)).offer).toBeNull(); // too early

    await pool.query(`UPDATE trip_requests SET scheduled_for = now() + interval '15 minutes' WHERE request_id = $1`, [ra.requestId]);
    await pool.query(`UPDATE trip_requests SET scheduled_for = now() + interval '19 minutes' WHERE request_id = $1`, [rb.requestId]);
    await booking.tick();
    const { offer } = await state(d);
    expect(offer.seats).toBe(1);
    await accept(d, offer.offerId).expect(200);
    expect(await statusOf(ra.requestId)).toBe('assigned');
    expect(await statusOf(rb.requestId)).toBe('assigned'); // grouped: both went to the same driver
    expect((await state(d)).ride.riders).toHaveLength(2);
    expect((await auditRows()).map((x) => x.action)).toContain('dispatch.group');
  });

  it('keeps looking until pick-up time, then says no driver was found', async () => {
    const a = await rider();
    const req = (await api().post('/api/requests').set(auth(a.token)).send({ type: 'scheduled', pickup: GATE, dropoff: KASARANI, seats: 1, scheduledFor: inMinutes(30) }).expect(201)).body.request;
    await pool.query(`UPDATE trip_requests SET scheduled_for = now() + interval '10 minutes' WHERE request_id = $1`, [req.requestId]);
    await booking.tick();
    expect(await statusOf(req.requestId)).toBe('searching'); // nobody online yet, but it keeps trying
    const d = await onlineDriver(NEAR_GATE);
    await booking.tick();
    expect((await state(d)).offer).not.toBeNull(); // a driver came online and was offered it

    await pool.query(`UPDATE dispatch_offers SET response = 'expired'`);
    await pool.query(`UPDATE trip_requests SET scheduled_for = now() - interval '1 minute', status = 'searching' WHERE request_id = $1`, [req.requestId]);
    await dispatch.dispatchRequest(req.requestId);
    expect(await statusOf(req.requestId)).toBe('no_driver');
    expect((await api().get('/api/notifications').set(auth(a.token))).body.notifications.map((n) => n.type)).toEqual(expect.arrayContaining(['booking.created', 'request.no_driver']));
  });

  it('a repeating booking schedules the next weeks, and can be cancelled as a series', async () => {
    const a = await rider();
    const res = await api()
      .post('/api/requests')
      .set(auth(a.token))
      .send({ type: 'scheduled', pickup: GATE, dropoff: KASARANI, seats: 1, scheduledFor: inMinutes(60 * 24), repeatDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] })
      .expect(201);
    expect(res.body.occurrences).toBeGreaterThan(7);
    const list = await mine(a);
    expect(new Set(list.map((x) => x.seriesId)).size).toBe(1);
    await api().post(`/api/requests/${res.body.request.requestId}/cancel`).set(auth(a.token)).send({ series: true }).expect(204);
    expect((await mine(a)).every((x) => x.status === 'cancelled')).toBe(true);
  });

  it('can change the time of a booking, but not make it too soon', async () => {
    const a = await rider();
    const req = (await api().post('/api/requests').set(auth(a.token)).send({ type: 'scheduled', pickup: GATE, dropoff: KASARANI, seats: 1, scheduledFor: inMinutes(120) }).expect(201)).body.request;
    await api().patch(`/api/requests/${req.requestId}`).set(auth(a.token)).send({ scheduledFor: inMinutes(180) }).expect(204);
    expect((await api().patch(`/api/requests/${req.requestId}`).set(auth(a.token)).send({ scheduledFor: inMinutes(1) })).status).toBe(400);
    expect((await api().post('/api/requests').set(auth(a.token)).send({ type: 'scheduled', pickup: GATE, dropoff: KASARANI, seats: 1, scheduledFor: inMinutes(2) })).status).toBe(400);
  });
});

describe('who may do what', () => {
  it('admins and unapproved drivers cannot ask for rides or go online', async () => {
    const admin = await createAdmin();
    expect((await ask(admin, GATE, ROYSAMBU)).status).toBe(403);
    expect((await api().post('/api/driver/online').set(auth(admin.token)).send({ lat: GATE.lat, lng: GATE.lng })).status).toBe(403);
    expect((await api().get('/api/driver/state')).status).toBe(401);
  });

  it('one active ride at a time', async () => {
    const r = await rider();
    await ask(r, GATE, ROYSAMBU).expect(201); // no drivers: ends as no_driver, so a new one is fine
    const d = await onlineDriver(NEAR_GATE);
    await ask(r, GATE, ROYSAMBU).expect(201);
    expect((await state(d)).offer).not.toBeNull();
    expect((await ask(r, GATE, ROYSAMBU)).status).toBe(409);
  });
});
