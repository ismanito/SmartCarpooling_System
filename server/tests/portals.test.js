const request = require('supertest');
const { resetDb, createAdmin, createStudent, auth, tokenFor } = require('./helpers/testApp');
const { createApp } = require('../src/app');
const { config } = require('../src/config/env');
const { fakeVerifyIdToken } = require('./helpers/fakeAuth');

beforeEach(resetDb);

// Driver accounts only: rider accounts (students and staff) may not drive.
const app = request(createApp({ verifyIdToken: fakeVerifyIdToken, config: { ...config, allowDriverSignup: true, studentsCanDrive: false } }));

const GATE = { lat: -1.2189, lng: 36.8808, label: 'USIU-Africa, Gate A' };
const KASARANI = { lat: -1.2216, lng: 36.9046, label: 'Kasarani' };
let n = 0;

async function approvedDriver() {
  n += 1;
  const token = tokenFor({ uid: `pd-${n}-${Date.now()}`, email: `portal.driver${n}@gmail.com` });
  const res = await app.post('/api/users').set(auth(token)).send({ fullName: 'Dan Driver', phoneNumber: '0712345678', licenceNumber: 'DL-123456', idNumber: '12345678' }).expect(201);
  const admin = await createAdmin();
  const list = (await app.get('/api/admin/drivers?status=pending').set(auth(admin.token))).body.applications;
  await app.post(`/api/admin/drivers/${list[0].applicationId}/decision`).set(auth(admin.token)).send({ decision: 'approved' }).expect(200);
  await app.post('/api/vehicles').set(auth(token)).send({ makeModel: 'Toyota Axio', plateNumber: `KDP${100 + n}P`, colour: 'Blue', seatCapacity: 3 }).expect(201);
  return { token, user: res.body.user };
}

describe('rider accounts: students and staff', () => {
  it('a student is the default, and a staff member gives a department', async () => {
    const student = await app.post('/api/users').set(auth(tokenFor({ uid: 's1', email: 'kim@usiu.ac.ke' }))).send({ fullName: 'Kim Student', phoneNumber: '0712345678', faculty: 'Law' }).expect(201);
    expect(student.body.user).toMatchObject({ role: 'student', personType: 'student' });
    const staff = await app.post('/api/users').set(auth(tokenFor({ uid: 's2', email: 'lee@usiu.ac.ke' }))).send({ fullName: 'Lee Staff', phoneNumber: '0712345678', faculty: 'Registrar office', personType: 'staff' }).expect(201);
    expect(staff.body.user).toMatchObject({ role: 'student', personType: 'staff', faculty: 'Registrar office' });
    expect((await app.post('/api/users').set(auth(tokenFor({ uid: 's3', email: 'x@usiu.ac.ke' }))).send({ fullName: 'Bad Type', phoneNumber: '0712345678', faculty: 'Law', personType: 'visitor' })).status).toBe(400);
  });

  it('shows each person type in the admin user list', async () => {
    await app.post('/api/users').set(auth(tokenFor({ uid: 's2', email: 'lee@usiu.ac.ke' }))).send({ fullName: 'Lee Staff', phoneNumber: '0712345678', faculty: 'Registrar office', personType: 'staff' }).expect(201);
    const admin = await createAdmin();
    const users = (await app.get('/api/admin/users?search=lee').set(auth(admin.token)).expect(200)).body.users;
    expect(users[0].personType).toBe('staff');
  });
});

describe('separate portals', () => {
  it('rider accounts cannot use the driving screens when drivers are separate', async () => {
    const rider = await createStudent();
    for (const path of ['/api/driver/state', '/api/driver/dashboard', '/api/vehicles/mine']) {
      const res = await app.get(path).set(auth(rider.token));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('DRIVERS_ONLY');
    }
    expect((await app.post('/api/driver/online').set(auth(rider.token)).send({ lat: GATE.lat, lng: GATE.lng })).status).toBe(403);
  });

  it('driver accounts cannot ask for rides', async () => {
    const d = await approvedDriver();
    expect((await app.post('/api/requests').set(auth(d.token)).send({ type: 'now', pickup: GATE, dropoff: KASARANI, seats: 1 })).status).toBe(403);
    expect((await app.get('/api/requests/history').set(auth(d.token))).status).toBe(403);
  });
});

describe('dashboards', () => {
  it('the driver dashboard shows the week, money to collect and recent rides; the rider history shows what they paid', async () => {
    const d = await approvedDriver();
    const rider = await createStudent({ fullName: 'Rita Rider' });
    await app.post('/api/driver/online').set(auth(d.token)).send({ lat: GATE.lat, lng: GATE.lng }).expect(200);
    await app.post('/api/requests').set(auth(rider.token)).send({ type: 'now', pickup: GATE, dropoff: KASARANI, seats: 1 }).expect(201);
    const { offer } = (await app.get('/api/driver/state').set(auth(d.token))).body;
    await app.post(`/api/offers/${offer.offerId}/accept`).set(auth(d.token)).expect(200);
    const { ride } = (await app.get('/api/driver/state').set(auth(d.token))).body;
    for (const s of ride.stops) {
      await app.post(`/api/rides/${ride.ride.rideId}/stops/${s.stopId}/arrived`).set(auth(d.token)).expect(204);
      await app.post(`/api/rides/${ride.ride.rideId}/stops/${s.stopId}/done`).set(auth(d.token)).expect(200);
    }
    await app.post(`/api/rides/${ride.ride.rideId}/complete`).set(auth(d.token)).expect(200);

    const dash = (await app.get('/api/driver/dashboard').set(auth(d.token)).expect(200)).body;
    expect(dash.week).toMatchObject({ rides: 1, riders: 1 });
    expect(dash.week.pendingKes).toBeGreaterThan(0);
    expect(dash.toCollect).toHaveLength(1);
    expect(dash.toCollect[0]).toMatchObject({ riderName: 'Rita Rider' });
    expect(dash.recent).toHaveLength(1);
    expect(dash.answers.accepted).toBe(1);

    const hist = (await app.get('/api/requests/history').set(auth(rider.token)).expect(200)).body;
    expect(hist.summary.ridesTaken).toBe(1);
    expect(hist.summary.owedKes).toBe(dash.toCollect[0].amountKes);
    expect(hist.rides[0]).toMatchObject({ status: 'completed', driverFirstName: 'Dan', shareStatus: 'pending' });

    await app.post(`/api/ride-shares/${dash.toCollect[0].shareId}/settle`).set(auth(d.token)).expect(204);
    expect((await app.get('/api/driver/dashboard').set(auth(d.token))).body.toCollect).toHaveLength(0);
    expect((await app.get('/api/requests/history').set(auth(rider.token))).body.summary.owedKes).toBe(0);
  });
});

describe('driver accounts on demo domains', () => {
  const demoApp = request(createApp({ verifyIdToken: fakeVerifyIdToken, config: { ...config, allowDriverSignup: true, studentsCanDrive: false, demoEmailDomains: ['demo.test'], allowedEmailDomains: ['usiu.ac.ke', 'demo.test'] } }));

  it('a demo address can open a driver account when asked, but a real university address cannot', async () => {
    const form = { fullName: 'Dan Demo', phoneNumber: '0712345678', licenceNumber: 'DL-123456', idNumber: '12345678', accountType: 'driver' };
    const demo = await demoApp.post('/api/users').set(auth(tokenFor({ uid: 'dd1', email: 'dan@demo.test' }))).send(form).expect(201);
    expect(demo.body.user).toMatchObject({ role: 'driver', driverStatus: 'pending' });
    const real = await demoApp.post('/api/users').set(auth(tokenFor({ uid: 'dd2', email: 'real@usiu.ac.ke' }))).send(form);
    expect(real.status).toBe(400); // a university address gets the student form, which has no licence fields
  });
});
