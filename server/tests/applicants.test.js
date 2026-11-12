const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { resetDb, createStudent, createAdmin, createSeniorAdmin, auth, pool, tokenFor } = require('./helpers/testApp');
const { createApp } = require('../src/app');
const { config } = require('../src/config/env');
const { fakeVerifyIdToken } = require('./helpers/fakeAuth');
const { useStorage, LocalStorage } = require('../src/services/storage');
const rules = require('../src/lib/verification');

// The default rule: an external driver must apply and be approved before they can create an account.
const app = request(createApp({ verifyIdToken: fakeVerifyIdToken, config: { ...config, allowDriverSignup: true, externalRequiresApplication: true } }));
useStorage(new LocalStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'ridemate-apply-'))));
beforeEach(async () => {
  await resetDb();
  await pool.query(`UPDATE system_settings SET setting_value = 'true' WHERE setting_key = 'external_drivers_enabled'`);
});

let seed = 0;
function png() {
  seed += 1;
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'latin1');
    data.copy(b, 8);
    return b;
  };
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13)), chunk('IDAT', Buffer.from(`px-${seed}-${Math.random()}`)), chunk('IEND', Buffer.alloc(0))]);
}
const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ref = (token) => ({ 'X-Application-Token': token });

const apply = (email = 'sam.driver@gmail.com') => app.post('/api/apply').send({ email, fullName: 'Sam Driver', phoneNumber: '0712345678' });

/** Fills in the whole application through the public endpoints and sends it in. */
async function submittedApplication(email) {
  const { token } = (await apply(email).expect(201)).body;
  const h = ref(token);
  const car = await app.post('/api/apply/vehicles').set(h).send({ makeModel: 'Toyota Axio', plateNumber: `KAP${Math.floor(Math.random() * 900 + 100)}A`, colour: 'White', seatCapacity: 3 }).expect(201);
  await app.post('/api/apply/verification/start').set(h).send({ driverType: 'external', consent: true }).expect(204);
  await app.put('/api/apply/verification/details').set(h).send({
    licenceNumber: 'DL-123456', licenceHolderName: 'Sam Driver', licenceExpiry: days(900), licenceHeldSince: '2018-01-01',
    insuranceProvider: 'Jubilee', insurancePolicyNo: 'P-1', insuranceExpiry: days(400), insuranceCoversPassengers: true,
    vehicleId: car.body.vehicle.vehicleId, ownerRelationship: 'self', nationalId: '12345678', goodConductIssued: days(-30),
    psvBadgeNo: 'PSV-77', psvBadgeExpiry: days(700), inspectionDate: days(-10), inspectedBy: 'NTSA Inspector',
  }).expect(204);
  for (const doc of rules.requiredDocs('external', 'self')) {
    await app.post('/api/apply/verification/documents').set(h).field('docType', doc).field('capturedLive', String(doc.startsWith('selfie'))).attach('file', png(), 'p.png').expect(201);
  }
  await app.post('/api/apply/verification/submit').set(h).expect(204);
  const { rows } = await pool.query('SELECT user_id FROM users WHERE university_email = $1', [email]);
  return { token, userId: rows[0].user_id, email };
}

async function approveApplication(a) {
  const senior = await createSeniorAdmin();
  for (const item of rules.checklistFor('external')) await app.post(`/api/admin/verifications/${a.userId}/checks`).set(auth(senior.token)).send({ item, result: 'pass' }).expect(204);
  await app.post(`/api/admin/verifications/${a.userId}/in-person`).set(auth(senior.token)).send({ date: days(0), officer: 'Officer Kamau' }).expect(204);
  await app.post(`/api/admin/verifications/${a.userId}/approve`).set(auth(senior.token)).expect(204);
  return senior;
}

describe('external driver applications', () => {
  it('can be started without an account and need a reference code afterwards', async () => {
    const res = await apply().expect(201);
    expect(res.body.token).toMatch(/^RM-/);
    expect((await app.get('/api/apply/verification')).status).toBe(401); // no code, no access
    expect((await app.get('/api/apply/verification').set(ref('RM-WRONG'))).status).toBe(401);
    const view = await app.get('/api/apply/verification').set(ref(res.body.token)).expect(200);
    expect(view.body.driverType).toBe('external');
    const { rows } = await pool.query('SELECT token_hash FROM driver_applicants');
    expect(JSON.stringify(rows)).not.toContain(res.body.token); // only a hash is kept
  });

  it('is not open to university addresses, existing accounts or a closed external track', async () => {
    expect((await apply('kim@usiu.ac.ke')).body.error.code).toBe('NOT_EXTERNAL');
    await apply('sam.driver@gmail.com').expect(201);
    expect((await apply('sam.driver@gmail.com')).body.error.code).toBe('APPLICATION_EXISTS');
    await pool.query(`UPDATE system_settings SET setting_value = 'false' WHERE setting_key = 'external_drivers_enabled'`);
    expect((await apply('other@gmail.com')).body.error.code).toBe('EXTERNAL_CLOSED');
  });

  it('goes to the admin queue once everything is filled in', async () => {
    const a = await submittedApplication('sam.driver@gmail.com');
    const admin = await createAdmin();
    const queue = await app.get('/api/admin/verifications?status=pending_review').set(auth(admin.token)).expect(200);
    expect(JSON.stringify(queue.body)).toContain(a.userId);
  });

  it('cannot create an account until it is approved', async () => {
    const email = 'sam.driver@gmail.com';
    const token = tokenFor({ uid: 'sam-uid', email });
    const body = { fullName: 'Sam Driver', phoneNumber: '0712345678' };
    // never applied
    const none = await app.post('/api/users').set(auth(token)).send(body);
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe('AUTH_DRIVER_NOT_APPROVED');
    expect((await app.post('/api/auth/check-domain').send({ email })).body).toMatchObject({ allowed: false, needsApplication: true, application: 'none' });
    // applied but still waiting
    const a = await submittedApplication(email);
    expect((await app.post('/api/users').set(auth(token)).send(body)).status).toBe(403);
    expect((await app.post('/api/auth/check-domain').send({ email })).body).toMatchObject({ allowed: false, application: 'pending_review' });
    // rejected
    const admin = await createAdmin();
    await app.post(`/api/admin/verifications/${a.userId}/reject`).set(auth(admin.token)).send({ reason: 'Licence photo is not readable' }).expect(204);
    expect((await app.post('/api/users').set(auth(token)).send(body)).status).toBe(403);
    expect((await app.post('/api/auth/check-domain').send({ email })).body).toMatchObject({ allowed: false, application: 'rejected' });
  });

  it('becomes a working driver account once approved, keeping the documents and the approval', async () => {
    const email = 'sam.driver@gmail.com';
    const a = await submittedApplication(email);
    await approveApplication(a);
    expect((await app.post('/api/auth/check-domain').send({ email })).body).toMatchObject({ allowed: true, application: 'approved' });

    const token = tokenFor({ uid: 'sam-uid', email });
    const created = await app.post('/api/users').set(auth(token)).send({ fullName: 'Sam Driver', phoneNumber: '0712345678' }).expect(201);
    expect(created.body.user).toMatchObject({ userId: a.userId, role: 'driver', driverStatus: 'approved', driverType: 'external' });
    const { rows } = await pool.query('SELECT firebase_uid FROM users WHERE user_id = $1', [a.userId]);
    expect(rows[0].firebase_uid).toBe('sam-uid');
    expect((await app.get('/api/users/me').set(auth(token))).body.user.driverStatus).toBe('approved');
    expect((await app.get('/api/driver/verification').set(auth(token))).body.status).toBe('approved');
    expect((await app.get('/api/vehicles/mine').set(auth(token))).body.vehicles).toHaveLength(1);
    // the reference code stops working once the account exists
    expect((await app.get('/api/apply/verification').set(ref(a.token))).status).toBe(401);
    // a second account cannot claim it
    expect((await app.post('/api/users').set(auth(tokenFor({ uid: 'other', email }))).send({ fullName: 'Sam', phoneNumber: '0712345678' })).status).toBe(403);
  });

  it('does not touch students, staff or admins', async () => {
    const s = await createStudent();
    expect(s.user.role).toBe('student');
    expect((await app.post('/api/auth/check-domain').send({ email: 'kim@usiu.ac.ke' })).body).toMatchObject({ allowed: true });
  });
});
