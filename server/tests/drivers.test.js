const request = require('supertest');
const { resetDb, createAdmin, createStudent, auth, pool, tokenFor } = require('./helpers/testApp');
const { createApp } = require('../src/app');
const { config } = require('../src/config/env');
const { fakeVerifyIdToken } = require('./helpers/fakeAuth');

beforeEach(resetDb);

const verified = [];
const app = request(
  createApp({
    verifyIdToken: fakeVerifyIdToken,
    markEmailVerified: async (uid) => verified.push(uid),
    config: { ...config, allowDriverSignup: true, demoEmailDomains: ['demo.test'], allowedEmailDomains: ['usiu.ac.ke', 'demo.test'] },
  }),
);

const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();
const driverForm = { fullName: 'Dan Driver', phoneNumber: '0712345678', licenceNumber: 'DL-123456', idNumber: '12345678', about: 'Five years of driving' };
let n = 0;

async function applyAsDriver(overrides = {}) {
  n += 1;
  const token = tokenFor({ uid: `drv-${n}-${Date.now()}`, email: overrides.email || `driver${n}@gmail.com` });
  const res = await app.post('/api/users').set(auth(token)).send({ ...driverForm, ...overrides.form }).expect(201);
  return { token, user: res.body.user };
}

async function approve(driver, decision = 'approved', notes) {
  const admin = await createAdmin();
  const list = (await app.get('/api/admin/drivers?status=pending').set(auth(admin.token)).expect(200)).body.applications;
  const mine = list.find((a) => a.userId === driver.user.userId);
  await app.post(`/api/admin/drivers/${mine.applicationId}/decision`).set(auth(admin.token)).send({ decision, notes }).expect(200);
  return { admin, application: mine };
}

const offerBody = (vehicleId) => ({ vehicleId, origin: 'roysambu', destination: 'westlands', departAt: inMinutes(60), seats: 3 });
const car = { makeModel: 'Toyota Axio', plateNumber: 'KDF456F', colour: 'White', seatCapacity: 3 };

describe('who an email belongs to', () => {
  it('tells apart student, driver, admin and demo addresses', async () => {
    const kind = async (email) => (await app.post('/api/auth/check-domain').send({ email })).body;
    expect(await kind('amina@usiu.ac.ke')).toMatchObject({ kind: 'student', demo: false, allowed: true });
    expect(await kind('someone@gmail.com')).toMatchObject({ kind: 'driver', allowed: true });
    expect(await kind('amina@demo.test')).toMatchObject({ kind: 'student', demo: true });
  });
});

describe('driver applications', () => {
  it('a Gmail user becomes a pending driver and cannot offer rides yet', async () => {
    const d = await applyAsDriver();
    expect(d.user).toMatchObject({ role: 'driver', driverStatus: 'pending', faculty: 'Driver' });
    // They can add their car while they wait, but not offer a ride.
    const v = await app.post('/api/vehicles').set(auth(d.token)).send(car).expect(201);
    const res = await app.post('/api/rides/offers').set(auth(d.token)).send(offerBody(v.body.vehicle.vehicleId));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DRIVER_NOT_APPROVED');
  });

  it('needs a licence and ID number', async () => {
    const token = tokenFor({ uid: 'drv-x', email: 'nolicence@gmail.com' });
    const res = await app.post('/api/users').set(auth(token)).send({ fullName: 'No Licence', phoneNumber: '0712345678' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((x) => x.field)).toEqual(expect.arrayContaining(['licenceNumber', 'idNumber']));
  });

  it('an admin approves, notifies the driver, and the driver can then offer rides that students can find', async () => {
    const d = await applyAsDriver();
    const { admin } = await approve(d);
    expect((await app.get('/api/users/me').set(auth(d.token))).body.user.driverStatus).toBe('approved');
    expect((await app.get('/api/notifications').set(auth(d.token))).body.notifications.map((x) => x.type)).toContain('driver.approved');

    const v = await app.post('/api/vehicles').set(auth(d.token)).send(car).expect(201);
    const offer = (await app.post('/api/rides/offers').set(auth(d.token)).send(offerBody(v.body.vehicle.vehicleId)).expect(201)).body.offer;
    const rider = await createStudent({ fullName: 'Rita Rider' });
    const request1 = (
      await app.post('/api/rides/requests').set(auth(rider.token)).send({ origin: 'trm', destination: 'westlands', departAt: inMinutes(62), seats: 1 }).expect(201)
    ).body.request;
    const matches = (await app.get(`/api/rides/requests/${request1.requestId}/matches`).set(auth(rider.token)).expect(200)).body.matches;
    expect(matches.map((m) => m.offer.offerId)).toContain(offer.offerId);
    expect((await pool.query(`SELECT action FROM audit_log WHERE action IN ('driver.apply','driver.approve')`)).rows).toHaveLength(2);
    void admin;
  });

  it('a rejected driver stays blocked, can fix the details, and is reviewed again', async () => {
    const d = await applyAsDriver();
    await approve(d, 'rejected', 'Licence photo unclear');
    expect((await app.get('/api/users/me').set(auth(d.token))).body.user.driverStatus).toBe('rejected');
    const v = await app.post('/api/vehicles').set(auth(d.token)).send(car).expect(201);
    expect((await app.post('/api/rides/offers').set(auth(d.token)).send(offerBody(v.body.vehicle.vehicleId))).status).toBe(403);

    await app.post('/api/drivers/application').set(auth(d.token)).send({ licenceNumber: 'DL-999999', idNumber: '87654321' }).expect(204);
    expect((await app.get('/api/users/me').set(auth(d.token))).body.user.driverStatus).toBe('pending');
    expect((await app.post('/api/drivers/application').set(auth(d.token)).send({ licenceNumber: 'DL-111111', idNumber: '11111111' })).status).toBe(409);
  });

  it('only admins decide, and each application only once', async () => {
    const d = await applyAsDriver();
    const rider = await createStudent();
    const { application, admin } = await approve(d);
    expect((await app.get('/api/admin/drivers').set(auth(rider.token))).status).toBe(403);
    expect((await app.get('/api/admin/drivers').set(auth(d.token))).status).toBe(403);
    expect((await app.post(`/api/admin/drivers/${application.applicationId}/decision`).set(auth(admin.token)).send({ decision: 'rejected' })).status).toBe(409);
  });

  it('drivers do not get rider features, and students are not drivers', async () => {
    const d = await applyAsDriver();
    await approve(d);
    const res = await app.post('/api/rides/requests').set(auth(d.token)).send({ origin: 'trm', destination: 'westlands', departAt: inMinutes(60), seats: 1 });
    expect(res.status).toBe(403);
    const student = await createStudent();
    expect((await app.get('/api/drivers/application').set(auth(student.token))).status).toBe(403);
  });
});

describe('demo accounts', () => {
  it('verifies a demo-domain account without an inbox, and lets it register as a student', async () => {
    const token = tokenFor({ uid: 'demo-1', email: 'kim@demo.test', emailVerified: false });
    expect((await app.get('/api/users/me').set(auth(token))).status).toBe(403); // still unverified for normal routes
    await app.post('/api/auth/demo-verify').set(auth(token)).expect(200);
    expect(verified).toContain('demo-1');
    const ok = tokenFor({ uid: 'demo-1', email: 'kim@demo.test' });
    const res = await app.post('/api/users').set(auth(ok)).send({ fullName: 'Kim Demo', phoneNumber: '0712345678', faculty: 'Law' }).expect(201);
    expect(res.body.user.role).toBe('student');
  });

  it('refuses to demo-verify real or driver addresses', async () => {
    for (const email of ['kim@usiu.ac.ke', 'kim@gmail.com']) {
      const token = tokenFor({ uid: `x-${email}`, email, emailVerified: false });
      const res = await app.post('/api/auth/demo-verify').set(auth(token));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('DEMO_NOT_ALLOWED');
    }
    expect(verified).not.toContain('x-kim@gmail.com');
  });
});
