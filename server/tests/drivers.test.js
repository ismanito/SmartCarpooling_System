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

const driverForm = { fullName: 'Dan Driver', phoneNumber: '0712345678' };
let n = 0;

async function applyAsDriver(overrides = {}) {
  n += 1;
  const token = tokenFor({ uid: `drv-${n}-${Date.now()}`, email: overrides.email || `driver${n}@gmail.com` });
  const res = await app.post('/api/users').set(auth(token)).send({ ...driverForm, ...overrides.form }).expect(201);
  return { token, user: res.body.user };
}

describe('who an email belongs to', () => {
  it('tells apart student, driver, admin and demo addresses', async () => {
    const kind = async (email) => (await app.post('/api/auth/check-domain').send({ email })).body;
    expect(await kind('amina@usiu.ac.ke')).toMatchObject({ kind: 'student', demo: false, allowed: true });
    expect(await kind('someone@gmail.com')).toMatchObject({ kind: 'driver', allowed: true });
    expect(await kind('amina@demo.test')).toMatchObject({ kind: 'student', demo: true });
  });
});

describe('driver accounts', () => {
  it('a Gmail user gets a driver account that cannot drive until it is verified', async () => {
    const d = await applyAsDriver();
    expect(d.user).toMatchObject({ role: 'driver', driverStatus: 'not_started', driverType: 'external', faculty: 'Driver' });
    const online = await app.post('/api/driver/online').set(auth(d.token)).send({ lat: -1.2189, lng: 36.8808 });
    expect(online.status).toBe(403);
    expect(online.body.error.code).toBe('DRIVER_NOT_VERIFIED');
    // The account has an empty verification waiting for the wizard, nothing to review yet.
    const { rows } = await pool.query('SELECT status, driver_type FROM driver_verifications WHERE driver_id = $1', [d.user.userId]);
    expect(rows[0]).toEqual({ status: 'not_started', driver_type: 'external' });
  });

  it('needs only a name and phone to open the account, because the papers go through verification', async () => {
    const token = tokenFor({ uid: 'drv-x', email: 'nolicence@gmail.com' });
    await app.post('/api/users').set(auth(token)).send({ fullName: 'No Licence', phoneNumber: '0712345678' }).expect(201);
    const second = tokenFor({ uid: 'drv-y', email: 'extra@gmail.com' });
    expect((await app.post('/api/users').set(auth(second)).send({ fullName: 'Extra Field', phoneNumber: '0712345678', licenceNumber: 'DL-1' })).status).toBe(400); // nothing is collected here any more
  });

  it('administrators cannot be drivers', async () => {
    const admin = await createAdmin();
    expect((await app.post('/api/driver/verification/start').set(auth(admin.token)).send({ driverType: 'external', consent: true })).status).toBe(403);
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
