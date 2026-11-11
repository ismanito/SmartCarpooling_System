const request = require('supertest');
const { api, resetDb, createStudent, createAdmin, auth, pool, tokenFor } = require('./helpers/testApp');
const { createApp } = require('../src/app');
const { config } = require('../src/config/env');
const { fakeVerifyIdToken } = require('./helpers/fakeAuth');

beforeEach(resetDb);

const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

/** A driver, a rider and one accepted booking, so there is a fare to pay. */
async function acceptedBooking() {
  const driver = await createStudent({ fullName: 'Dan Driver' });
  const v = await api()
    .post('/api/vehicles')
    .set(auth(driver.token))
    .send({ makeModel: 'Toyota Corolla', plateNumber: 'KDA123A', colour: 'Silver', seatCapacity: 3 })
    .expect(201);
  const offer = (
    await api()
      .post('/api/rides/offers')
      .set(auth(driver.token))
      .send({ vehicleId: v.body.vehicle.vehicleId, origin: 'roysambu', destination: 'westlands', departAt: inMinutes(120), seats: 3 })
      .expect(201)
  ).body.offer;
  const rider = await createStudent({ fullName: 'Rita Rider' });
  const req = (
    await api()
      .post('/api/rides/requests')
      .set(auth(rider.token))
      .send({ origin: 'trm', destination: 'westlands', departAt: inMinutes(125), seats: 1 })
      .expect(201)
  ).body.request;
  const booking = (await api().post('/api/rides/bookings').set(auth(rider.token)).send({ offerId: offer.offerId, requestId: req.requestId }).expect(201)).body.booking;
  await api().post(`/api/rides/bookings/${booking.bookingId}/accept`).set(auth(driver.token)).expect(200);
  return { driver, rider, offer, request: req, booking };
}

const myShare = async (who) => (await api().get('/api/payments/mine').set(auth(who.token))).body.payments[0].shares.find((s) => s.mine);
const split = (who, bookingId, emails) => api().post(`/api/payments/bookings/${bookingId}/split`).set(auth(who.token)).send({ emails });
const pay = (who, shareId, body) => api().post(`/api/payments/shares/${shareId}/pay`).set(auth(who.token)).send(body);

describe('fares', () => {
  it('creates the fare when a booking is accepted, at the suggested per-seat share', async () => {
    const { rider, driver, offer, booking } = await acceptedBooking();
    const mine = await api().get('/api/payments/mine').set(auth(rider.token)).expect(200);
    expect(mine.body.payments).toHaveLength(1);
    expect(mine.body.payments[0]).toMatchObject({ bookingId: booking.bookingId, totalKes: offer.costPerSeatKes, status: 'pending', isBooker: true });
    expect(mine.body.summary.owedKes).toBe(offer.costPerSeatKes);
    const earnings = await api().get('/api/payments/earnings').set(auth(driver.token)).expect(200);
    expect(earnings.body.summary).toEqual({ collectedKes: 0, pendingKes: offer.costPerSeatKes });
  });

  it('cancelling the booking cancels the fare', async () => {
    const { rider, booking } = await acceptedBooking();
    await api().post(`/api/rides/bookings/${booking.bookingId}/cancel`).set(auth(rider.token)).expect(200);
    const { rows } = await pool.query('SELECT status FROM payments');
    expect(rows[0].status).toBe('cancelled');
  });
});

describe('splitting a fare', () => {
  it('splits evenly with a friend, who then owes their share', async () => {
    const { rider, booking, offer } = await acceptedBooking();
    const friend = await createStudent({ fullName: 'Fred Friend' });
    await split(rider, booking.bookingId, [friend.email]).expect(204);

    const theirs = await api().get('/api/payments/mine').set(auth(friend.token)).expect(200);
    expect(theirs.body.payments).toHaveLength(1);
    expect(theirs.body.payments[0].isBooker).toBe(false);
    const total = offer.costPerSeatKes;
    expect(theirs.body.summary.owedKes).toBe(Math.floor(total / 2));
    const mine = await api().get('/api/payments/mine').set(auth(rider.token)).expect(200);
    expect(mine.body.summary.owedKes).toBe(total - Math.floor(total / 2));
  });

  it('rejects people who are not students, and anyone but the booker', async () => {
    const { rider, driver, booking } = await acceptedBooking();
    expect((await split(rider, booking.bookingId, ['nobody@usiu.ac.ke'])).status).toBe(400);
    expect((await split(driver, booking.bookingId, [])).status).toBe(404);
  });

  it('cannot change the split once someone has paid', async () => {
    const { rider, booking } = await acceptedBooking();
    const friend = await createStudent();
    await split(rider, booking.bookingId, [friend.email]).expect(204);
    await pay(friend, (await myShare(friend)).shareId, { method: 'cash' }).expect(204);
    expect((await split(rider, booking.bookingId, [])).status).toBe(409);
  });
});

describe('paying a share', () => {
  it('marks the fare paid once every share is paid, and the driver sees the money', async () => {
    const { rider, driver, booking, offer } = await acceptedBooking();
    const friend = await createStudent();
    await split(rider, booking.bookingId, [friend.email]).expect(204);

    await pay(rider, (await myShare(rider)).shareId, { method: 'mpesa', reference: 'SJK12ABC34' }).expect(204);
    let earnings = await api().get('/api/payments/earnings').set(auth(driver.token));
    expect(earnings.body.payments[0].status).toBe('pending');
    await pay(friend, (await myShare(friend)).shareId, { method: 'cash' }).expect(204);

    earnings = await api().get('/api/payments/earnings').set(auth(driver.token));
    expect(earnings.body.payments[0].status).toBe('paid');
    expect(earnings.body.summary).toEqual({ collectedKes: offer.costPerSeatKes, pendingKes: 0 });
  });

  it('needs an M-Pesa code, only lets the payer pay, and only once', async () => {
    const { rider, driver } = await acceptedBooking();
    const { shareId } = await myShare(rider);
    expect((await pay(rider, shareId, { method: 'mpesa' })).status).toBe(400);
    expect((await pay(driver, shareId, { method: 'cash' })).status).toBe(404);
    await pay(rider, shareId, { method: 'cash' }).expect(204);
    expect((await pay(rider, shareId, { method: 'cash' })).status).toBe(409);
  });
});

describe('admin payments', () => {
  it('summarises billed, collected and outstanding money for admins only', async () => {
    const { rider, offer } = await acceptedBooking();
    const admin = await createAdmin();
    await pay(rider, (await myShare(rider)).shareId, { method: 'cash' }).expect(204);

    const res = await api().get('/api/admin/payments').set(auth(admin.token)).expect(200);
    expect(res.body.summary).toMatchObject({ billedKes: offer.costPerSeatKes, collectedKes: offer.costPerSeatKes, outstandingKes: 0, fares: 1 });
    expect(res.body.recent).toHaveLength(1);
    expect((await api().get('/api/admin/payments').set(auth(rider.token))).status).toBe(403);
  });
});

describe('admins with a real email', () => {
  const staffApp = () => request(createApp({ verifyIdToken: fakeVerifyIdToken, config: { ...config, adminEmails: ['boss@gmail.com'] } }));

  it('lets a listed non-university email sign up as an admin, not a student', async () => {
    const token = tokenFor({ uid: 'staff-1', email: 'boss@gmail.com' });
    const res = await staffApp().post('/api/users').set(auth(token)).send({ fullName: 'Pat Admin', phoneNumber: '0712345678' }).expect(201);
    expect(res.body.user).toMatchObject({ role: 'admin', faculty: 'Administration' });
    await staffApp().get('/api/admin/stats').set(auth(token)).expect(200);
    expect((await staffApp().get('/api/rides/offers/mine').set(auth(token))).status).toBe(403);
  });

  it('still refuses other non-university emails', async () => {
    const token = tokenFor({ uid: 'x-1', email: 'random@gmail.com' });
    const res = await staffApp().post('/api/users').set(auth(token)).send({ fullName: 'Rand Om', phoneNumber: '0712345678', faculty: 'Law' });
    expect(res.status).toBe(403);
  });

  it('students must still choose a school', async () => {
    const token = tokenFor({ uid: 'stu-1', email: 'kim@usiu.ac.ke' });
    const res = await staffApp().post('/api/users').set(auth(token)).send({ fullName: 'Kim Student', phoneNumber: '0712345678' });
    expect(res.status).toBe(400);
  });
});
