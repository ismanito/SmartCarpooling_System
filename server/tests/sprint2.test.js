const http = require('node:http');
const request = require('supertest');
const { api, app, resetDb, createStudent, createAdmin, auth, pool, auditRows, tokenFor } = require('./helpers/testApp');
const { createApp } = require('../src/app');
const { config } = require('../src/config/env');
const { fakeVerifyIdToken } = require('./helpers/fakeAuth');
const { fetchMatches } = require('../src/services/matcherClient');
const { roadKm } = require('../src/lib/router');
const { findPlace, routeKm } = require('../src/lib/places');

beforeEach(resetDb);

const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();
const corolla = { makeModel: 'Toyota Corolla', plateNumber: 'kda 123a', colour: 'Silver', seatCapacity: 3 };

/** Driver and rider with a confirmed booking on a trip leaving soon. */
async function confirmedTrip(departMinutes = 30, target = app) {
  const driver = await createStudent({ fullName: 'Dan Driver' });
  const rider = await createStudent({ fullName: 'Rita Rider' });
  const v = await api().post('/api/vehicles').set(auth(driver.token)).send(corolla).expect(201);
  const offer = await api().post('/api/rides/offers').set(auth(driver.token))
    .send({ vehicleId: v.body.vehicle.vehicleId, origin: 'roysambu', destination: 'westlands', departAt: inMinutes(departMinutes), seats: 3 }).expect(201);
  const req = await api().post('/api/rides/requests').set(auth(rider.token))
    .send({ origin: 'trm', destination: 'westlands', departAt: inMinutes(departMinutes + 2), seats: 1 }).expect(201);
  const offerId = offer.body.offer.offerId;
  const requestId = req.body.request.requestId;
  const b = await request(target).post('/api/rides/bookings').set(auth(rider.token)).send({ offerId, requestId }).expect(201);
  const bookingId = b.body.booking.bookingId;
  await api().post(`/api/rides/bookings/${bookingId}/accept`).set(auth(driver.token)).expect(200);
  return { driver, rider, offerId, requestId, bookingId };
}

describe('finishing a trip and rating', () => {
  it('lets both people rate each other once the driver finishes the trip', async () => {
    const { driver, rider, offerId, bookingId } = await confirmedTrip();

    // Not rateable before the trip finishes.
    const early = await api().post(`/api/rides/bookings/${bookingId}/rate`).set(auth(rider.token)).send({ stars: 5 });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('NOT_RATEABLE');

    await api().post(`/api/rides/offers/${offerId}/complete`).set(auth(driver.token)).expect(204);

    const mine = await api().get('/api/rides/requests/mine').set(auth(rider.token));
    expect(mine.body.requests[0].status).toBe('completed');
    expect(mine.body.requests[0].bookings[0]).toMatchObject({ offerStatus: 'completed', myStars: null });

    await api().post(`/api/rides/bookings/${bookingId}/rate`).set(auth(rider.token)).send({ stars: 4, comment: 'On time' }).expect(201);
    await api().post(`/api/rides/bookings/${bookingId}/rate`).set(auth(driver.token)).send({ stars: 5 }).expect(201);

    const again = await api().post(`/api/rides/bookings/${bookingId}/rate`).set(auth(rider.token)).send({ stars: 1 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_RATED');

    expect((await api().get('/api/users/me').set(auth(driver.token))).body.user.avgRating).toBe(4);
    expect((await api().get('/api/users/me').set(auth(rider.token))).body.user.avgRating).toBe(5);
    const after = await api().get('/api/rides/requests/mine').set(auth(rider.token));
    expect(after.body.requests[0].bookings[0].myStars).toBe(4);
    expect((await auditRows()).map((r) => r.action)).toEqual(expect.arrayContaining(['ride_offer.complete', 'rating.create']));
  });

  it('refuses to finish a trip too early, or someone else’s trip', async () => {
    const early = await confirmedTrip(180);
    const res = await api().post(`/api/rides/offers/${early.offerId}/complete`).set(auth(early.driver.token));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOO_EARLY');
    expect((await api().post(`/api/rides/offers/${early.offerId}/complete`).set(auth(early.rider.token))).status).toBe(404);
  });

  it('rejects bad stars and strangers', async () => {
    const { driver, offerId, bookingId } = await confirmedTrip();
    await api().post(`/api/rides/offers/${offerId}/complete`).set(auth(driver.token)).expect(204);
    expect((await api().post(`/api/rides/bookings/${bookingId}/rate`).set(auth(driver.token)).send({ stars: 6 })).status).toBe(400);
    const stranger = await createStudent();
    expect((await api().post(`/api/rides/bookings/${bookingId}/rate`).set(auth(stranger.token)).send({ stars: 3 })).status).toBe(404);
  });

  it('cannot cancel a finished trip or its booking', async () => {
    const { driver, rider, offerId, requestId, bookingId } = await confirmedTrip();
    await api().post(`/api/rides/offers/${offerId}/complete`).set(auth(driver.token)).expect(204);
    expect((await api().post(`/api/rides/offers/${offerId}/cancel`).set(auth(driver.token))).status).toBe(409);
    expect((await api().post(`/api/rides/requests/${requestId}/cancel`).set(auth(rider.token))).status).toBe(409);
    expect((await api().post(`/api/rides/bookings/${bookingId}/cancel`).set(auth(rider.token))).status).toBe(409);
  });
});

describe('admin area', () => {
  it('only admins can reach it', async () => {
    const { token } = await createStudent();
    for (const path of ['stats', 'audit', 'users', 'settings']) {
      expect((await api().get(`/api/admin/${path}`).set(auth(token))).status).toBe(403);
    }
  });

  it('shows stats, users and the audit trail', async () => {
    const admin = await createAdmin();
    await createStudent({ fullName: 'Findable Person' });
    const stats = await api().get('/api/admin/stats').set(auth(admin.token)).expect(200);
    expect(stats.body.stats.users).toBe(2);
    const users = await api().get('/api/admin/users?search=findable').set(auth(admin.token)).expect(200);
    expect(users.body.users).toHaveLength(1);
    const audit = await api().get('/api/admin/audit?limit=1').set(auth(admin.token)).expect(200);
    expect(audit.body.entries).toHaveLength(1);
    expect(audit.body.entries[0].action).toBe('user.create');
  });

  it('suspending blocks the student, reactivating restores them, and it is audited', async () => {
    const admin = await createAdmin();
    const student = await createStudent();
    await api().post(`/api/admin/users/${student.user.userId}/status`).set(auth(admin.token)).send({ status: 'suspended' }).expect(200);
    const blocked = await api().get('/api/users/me').set(auth(student.token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('USER_SUSPENDED');
    await api().post(`/api/admin/users/${student.user.userId}/status`).set(auth(admin.token)).send({ status: 'active' }).expect(200);
    await api().get('/api/users/me').set(auth(student.token)).expect(200);
    expect((await auditRows()).map((r) => r.action)).toEqual(expect.arrayContaining(['user.suspend', 'user.reactivate']));
  });

  it('admins cannot suspend themselves', async () => {
    const admin = await createAdmin();
    const res = await api().post(`/api/admin/users/${admin.user.userId}/status`).set(auth(admin.token)).send({ status: 'suspended' });
    expect(res.status).toBe(409);
  });

  it('changes matching settings within limits, and matching uses them', async () => {
    const admin = await createAdmin();
    const res = await api().put('/api/admin/settings').set(auth(admin.token)).send({ time_window_min: 30 }).expect(200);
    expect(res.body.settings.time_window_min).toBe(30);
    expect((await api().put('/api/admin/settings').set(auth(admin.token)).send({ time_window_min: 500 })).status).toBe(400);
    expect((await api().put('/api/admin/settings').set(auth(admin.token)).send({ allowed_email_domains: 'x.com' })).status).toBe(400);
    expect((await api().put('/api/admin/settings').set(auth(admin.token)).send({ w_overlap: 0, w_time: 0, w_detour: 0 })).status).toBe(400);
    await pool.query(`UPDATE system_settings SET setting_value = '15' WHERE setting_key = 'time_window_min'`);
  });
});

describe('Python matcher integration', () => {
  function fakeMatcher(handler) {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
    });
  }

  it('sends the internal key and returns matches', async () => {
    let seen;
    const { server, url } = await fakeMatcher((req, res) => {
      seen = { url: req.url, key: req.headers['x-internal-key'] };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ matches: [{ id: 'a', score: 0.9, detour_km: 1 }] }));
    });
    const out = await fetchMatches({ url, internalKey: 'secret' }, 'requests', 'abc');
    server.close();
    expect(seen).toEqual({ url: '/v1/requests/abc/matches', key: 'secret' });
    expect(out[0].score).toBe(0.9);
  });

  it('returns null when it is unconfigured, failing or down', async () => {
    expect(await fetchMatches({ url: '', internalKey: 'x' }, 'requests', 'a')).toBeNull();
    expect(await fetchMatches({ url: 'http://x', internalKey: '' }, 'requests', 'a')).toBeNull();
    const { server, url } = await fakeMatcher((req, res) => {
      res.statusCode = 500;
      res.end('boom');
    });
    expect(await fetchMatches({ url, internalKey: 'k' }, 'requests', 'a')).toBeNull();
    server.close();
    expect(await fetchMatches({ url: 'http://127.0.0.1:1', internalKey: 'k' }, 'requests', 'a', { timeoutMs: 300 })).toBeNull();
  });

  it('uses the matcher scores when it answers and built-in rules when it is down', async () => {
    const driver = await createStudent();
    const rider = await createStudent();
    const v = await api().post('/api/vehicles').set(auth(driver.token)).send(corolla);
    const o = await api().post('/api/rides/offers').set(auth(driver.token))
      .send({ vehicleId: v.body.vehicle.vehicleId, origin: 'roysambu', destination: 'westlands', departAt: inMinutes(120), seats: 3 });
    const r = await api().post('/api/rides/requests').set(auth(rider.token))
      .send({ origin: 'trm', destination: 'westlands', departAt: inMinutes(125), seats: 1 });
    const path = `/api/rides/requests/${r.body.request.requestId}/matches`;

    const builtin = await api().get(path).set(auth(rider.token)).expect(200);
    expect(builtin.body.engine).toBe('builtin');

    const { server, url } = await fakeMatcher((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ matches: [{ id: o.body.offer.offerId, score: 0.42, detour_km: 0.5 }] }));
    });
    const withMatcher = createApp({
      verifyIdToken: fakeVerifyIdToken,
      config: { ...config, matcher: { url, internalKey: 'k' } },
    });
    const res = await request(withMatcher).get(path).set(auth(rider.token)).expect(200);
    server.close();
    expect(res.body.engine).toBe('matcher');
    expect(res.body.matches[0].match.score).toBe(0.42);
  });
});

describe('road distance', () => {
  const a = findPlace('usiu');
  const b = findPlace('cbd');

  it('uses the mock router without a key', async () => {
    expect(await roadKm(a, b)).toBe(routeKm(a, b));
  });

  it('uses Google when a key is set', async () => {
    const fetchImpl = async (url) => {
      expect(String(url)).toContain('key=abc');
      return { json: async () => ({ rows: [{ elements: [{ distance: { value: 12345 } }] }] }) };
    };
    expect(await roadKm(a, b, { apiKey: 'abc', fetchImpl })).toBe(12.35);
  });

  it('falls back when Google fails or has no route', async () => {
    const fail = async () => { throw new Error('down'); };
    expect(await roadKm(a, b, { apiKey: 'abc', fetchImpl: fail })).toBe(routeKm(a, b));
    const none = async () => ({ json: async () => ({ rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }] }) });
    expect(await roadKm(a, b, { apiKey: 'abc', fetchImpl: none })).toBe(routeKm(a, b));
  });
});

describe('emulator profile reconnect', () => {
  it('reconnects a profile by verified email only in emulator mode', async () => {
    const student = await createStudent({ email: 'lost@usiu.ac.ke' });
    const newToken = tokenFor({ uid: 'brand-new-uid', email: 'lost@usiu.ac.ke' });

    // Real Firebase mode: no reconnect.
    const real = await api().get('/api/users/me').set(auth(newToken));
    expect(real.status).toBe(403);
    expect(real.body.error.code).toBe('PROFILE_REQUIRED');

    const emulated = createApp({
      verifyIdToken: fakeVerifyIdToken,
      config: { ...config, firebase: { ...config.firebase, useEmulator: true } },
    });
    const res = await request(emulated).get('/api/users/me').set(auth(newToken)).expect(200);
    expect(res.body.user.userId).toBe(student.user.userId);
  });
});
