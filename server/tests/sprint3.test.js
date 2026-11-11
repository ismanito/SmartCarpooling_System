const crypto = require('node:crypto');
const { api, resetDb, createStudent, createAdmin, auth, pool, auditRows } = require('./helpers/testApp');
const { verifyAuditChain } = require('../src/services/audit');
const { canonicalJson } = require('../src/lib/canonicalJson');

beforeEach(resetDb);

const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();
const corolla = { makeModel: 'Toyota Corolla', plateNumber: 'KDA123A', colour: 'Silver', seatCapacity: 3 };

async function driverWithOffer(seats = 3, plate = corolla.plateNumber) {
  const driver = await createStudent({ fullName: 'Dan Driver' });
  const v = await api().post('/api/vehicles').set(auth(driver.token)).send({ ...corolla, plateNumber: plate }).expect(201);
  const offer = (
    await api()
      .post('/api/rides/offers')
      .set(auth(driver.token))
      .send({ vehicleId: v.body.vehicle.vehicleId, origin: 'roysambu', destination: 'westlands', departAt: inMinutes(30), seats })
      .expect(201)
  ).body.offer;
  return { driver, offer };
}

async function riderWithRequest(name = 'Rita Rider', seats = 1) {
  const rider = await createStudent({ fullName: name });
  const request = (
    await api().post('/api/rides/requests').set(auth(rider.token)).send({ origin: 'trm', destination: 'westlands', departAt: inMinutes(32), seats }).expect(201)
  ).body.request;
  return { rider, request };
}

const book = (who, offerId, requestId) => api().post('/api/rides/bookings').set(auth(who.token)).send({ offerId, requestId });
const respond = (who, bookingId, action) => api().post(`/api/rides/bookings/${bookingId}/${action}`).set(auth(who.token));
const notifications = async (who) => (await api().get('/api/notifications').set(auth(who.token)).expect(200)).body;

/** One driver, one rider, an accepted booking. */
async function confirmed() {
  const { driver, offer } = await driverWithOffer();
  const { rider, request } = await riderWithRequest();
  const booking = (await book(rider, offer.offerId, request.requestId).expect(201)).body.booking;
  await respond(driver, booking.bookingId, 'accept').expect(200);
  return { driver, rider, offer, request, booking };
}

describe('notifications', () => {
  it('tells the driver about a request, and the rider about the answer', async () => {
    const { driver, offer } = await driverWithOffer();
    const { rider, request } = await riderWithRequest();
    const booking = (await book(rider, offer.offerId, request.requestId).expect(201)).body.booking;

    const forDriver = await notifications(driver);
    expect(forDriver.unreadCount).toBe(1);
    expect(forDriver.notifications[0]).toMatchObject({ type: 'request.new', isRead: false });

    await respond(driver, booking.bookingId, 'decline').expect(200);
    const forRider = await notifications(rider);
    expect(forRider.notifications[0].type).toBe('request.declined');
  });

  it('marks one or all as read, and only for the owner', async () => {
    const { driver, offer } = await driverWithOffer();
    const { rider, request } = await riderWithRequest();
    await book(rider, offer.offerId, request.requestId).expect(201);
    const { notifications: list } = await notifications(driver);
    expect((await api().post(`/api/notifications/${list[0].notificationId}/read`).set(auth(rider.token))).status).toBe(404);
    await api().post(`/api/notifications/${list[0].notificationId}/read`).set(auth(driver.token)).expect(204);
    expect((await notifications(driver)).unreadCount).toBe(0);
    await api().post('/api/notifications/read-all').set(auth(rider.token)).expect(204);
  });
});

describe('requests and seats', () => {
  it('a rider cannot accept their own request', async () => {
    const { driver, offer } = await driverWithOffer();
    const { rider, request } = await riderWithRequest();
    const booking = (await book(rider, offer.offerId, request.requestId).expect(201)).body.booking;
    const res = await respond(rider, booking.bookingId, 'accept');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_YOUR_TURN');
    void driver;
  });

  it('refuses to accept when no seats are left', async () => {
    const { driver, offer } = await driverWithOffer(1, 'KDB456B');
    const a = await riderWithRequest('Ann');
    const b = await riderWithRequest('Bob');
    const first = (await book(a.rider, offer.offerId, a.request.requestId).expect(201)).body.booking;
    const second = (await book(b.rider, offer.offerId, b.request.requestId).expect(201)).body.booking;
    await respond(driver, first.bookingId, 'accept').expect(200);
    const res = await respond(driver, second.bookingId, 'accept');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_SEATS');
  });

  it('lets only one of two simultaneous accepts take the last seat', async () => {
    const { driver, offer } = await driverWithOffer(1, 'KDC789C');
    const a = await riderWithRequest('Ann');
    const b = await riderWithRequest('Bob');
    const first = (await book(a.rider, offer.offerId, a.request.requestId).expect(201)).body.booking;
    const second = (await book(b.rider, offer.offerId, b.request.requestId).expect(201)).body.booking;
    const results = await Promise.all([respond(driver, first.bookingId, 'accept'), respond(driver, second.bookingId, 'accept')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const { rows } = await pool.query('SELECT seats_available FROM ride_offers WHERE offer_id = $1', [offer.offerId]);
    expect(rows[0].seats_available).toBe(0);
  });
});

describe('ride details', () => {
  it('shows the people in the car to participants only', async () => {
    const { driver, rider, offer } = await confirmed();
    const stranger = await createStudent();
    const asRider = await api().get(`/api/rides/trips/${offer.offerId}`).set(auth(rider.token)).expect(200);
    expect(asRider.body.role).toBe('rider');
    expect(asRider.body.people).toHaveLength(2);
    expect(asRider.body.people.find((p) => !p.isMe).phoneNumber).toMatch(/^\+254/);
    expect((await api().get(`/api/rides/trips/${offer.offerId}`).set(auth(driver.token))).body.role).toBe('driver');
    expect((await api().get(`/api/rides/trips/${offer.offerId}`).set(auth(stranger.token))).status).toBe(404);
  });
});

describe('finishing a trip and the fare', () => {
  it('splits the fuel cost between everyone in the car and the shares add up', async () => {
    const { driver, rider, offer } = await confirmed();
    await api().post(`/api/rides/offers/${offer.offerId}/complete`).set(auth(driver.token)).expect(204);

    const detail = (await api().get(`/api/rides/trips/${offer.offerId}`).set(auth(driver.token)).expect(200)).body;
    const { totalKes, driverShareKes, shares, commissionKes } = detail.fare;
    expect(commissionKes).toBe(0);
    expect(driverShareKes + shares.reduce((n, s) => n + s.amountKes, 0)).toBe(totalKes);
    expect(totalKes % 10).toBe(0);
    expect(shares).toHaveLength(1);
    expect((await notifications(rider)).notifications.map((n) => n.type)).toContain('ride.completed');
  });

  it('lets only the driver settle a share', async () => {
    const { driver, rider, offer } = await confirmed();
    await api().post(`/api/rides/offers/${offer.offerId}/complete`).set(auth(driver.token)).expect(204);
    const share = (await api().get(`/api/rides/trips/${offer.offerId}`).set(auth(rider.token))).body.fare.shares[0];
    expect((await api().post(`/api/payments/shares/${share.shareId}/settle`).set(auth(rider.token))).status).toBe(404);
    await api().post(`/api/payments/shares/${share.shareId}/settle`).set(auth(driver.token)).expect(204);
    expect((await api().post(`/api/payments/shares/${share.shareId}/settle`).set(auth(driver.token))).status).toBe(409);
    const after = (await api().get(`/api/rides/trips/${offer.offerId}`).set(auth(driver.token))).body.fare;
    expect(after.shares[0].status).toBe('paid');
    expect(after.collectedKes).toBe(after.shares[0].amountKes);
  });

  it('notifies riders when the driver cancels', async () => {
    const { driver, rider, offer } = await confirmed();
    await api().post(`/api/rides/offers/${offer.offerId}/cancel`).set(auth(driver.token)).expect(204);
    expect((await notifications(rider)).notifications.map((n) => n.type)).toContain('ride.cancelled');
  });
});

describe('ratings with tags', () => {
  it('saves tags, updates the average, and refuses early or repeat ratings', async () => {
    const { driver, rider, offer, booking } = await confirmed();
    const early = await api().post(`/api/rides/bookings/${booking.bookingId}/rate`).set(auth(rider.token)).send({ stars: 5 });
    expect(early.status).toBe(409);
    await api().post(`/api/rides/offers/${offer.offerId}/complete`).set(auth(driver.token)).expect(204);
    await api().post(`/api/rides/bookings/${booking.bookingId}/rate`).set(auth(rider.token)).send({ stars: 4, tags: ['On time', 'Clean car'] }).expect(201);
    expect((await api().post(`/api/rides/bookings/${booking.bookingId}/rate`).set(auth(rider.token)).send({ stars: 4, tags: ['Rude'] })).status).toBe(400);
    expect((await api().post(`/api/rides/bookings/${booking.bookingId}/rate`).set(auth(rider.token)).send({ stars: 1 })).status).toBe(409);
    const { rows } = await pool.query('SELECT tags FROM ratings');
    expect(rows[0].tags).toEqual(['On time', 'Clean car']);
    expect((await api().get('/api/users/me').set(auth(driver.token))).body.user.avgRating).toBe(4);
    const stranger = await createStudent();
    expect((await api().post(`/api/rides/bookings/${booking.bookingId}/rate`).set(auth(stranger.token)).send({ stars: 5 })).status).toBe(404);
  });
});

describe('incident reports and the admin console', () => {
  async function reported() {
    const trip = await confirmed();
    await api().post(`/api/rides/offers/${trip.offer.offerId}/complete`).set(auth(trip.driver.token)).expect(204);
    const admin = await createAdmin();
    const res = await api()
      .post(`/api/rides/bookings/${trip.booking.bookingId}/incidents`)
      .set(auth(trip.rider.token))
      .send({ reportedUserId: trip.driver.user.userId, category: 'unsafe_driving', description: 'Drove through a red light.' })
      .expect(201);
    return { ...trip, admin, reportId: res.body.reportId };
  }

  it('only people in the car can report, and not themselves', async () => {
    const trip = await confirmed();
    const stranger = await createStudent();
    const body = { reportedUserId: trip.driver.user.userId, category: 'other', description: 'Something happened.' };
    expect((await api().post(`/api/rides/bookings/${trip.booking.bookingId}/incidents`).set(auth(stranger.token)).send(body)).status).toBe(404);
    expect((await api().post(`/api/rides/bookings/${trip.booking.bookingId}/incidents`).set(auth(trip.driver.token)).send(body)).status).toBe(400);
  });

  it('notifies admins and records report, ride and both people in the audit log', async () => {
    const { admin, reportId, rider, driver, offer } = await reported();
    expect((await notifications(admin)).notifications.map((n) => n.type)).toContain('incident.new');
    const entry = (await auditRows()).find((r) => r.action === 'incident.report');
    expect(entry.details).toMatchObject({ report_id: reportId, ride_id: offer.offerId, reporter_id: rider.user.userId, reported_user_id: driver.user.userId });
  });

  it('shows the detail with its audit trail, and exports evidence whose hash matches', async () => {
    const { admin, reportId } = await reported();
    const detail = (await api().get(`/api/admin/incidents/${reportId}`).set(auth(admin.token)).expect(200)).body.incident;
    expect(detail.integrity.valid).toBe(true);
    expect(detail.auditTrail.map((a) => a.action)).toContain('incident.report');

    const res = await api().get(`/api/admin/incidents/${reportId}/evidence`).set(auth(admin.token)).expect(200);
    const file = JSON.parse(res.text);
    expect(crypto.createHash('sha256').update(canonicalJson(file.payload)).digest('hex')).toBe(file.sha256);
    expect(res.headers['x-evidence-sha256']).toBe(file.sha256);
    // Changing anything breaks the match.
    file.payload.report.description = 'edited';
    expect(crypto.createHash('sha256').update(canonicalJson(file.payload)).digest('hex')).not.toBe(file.sha256);
  });

  it('suspending the driver blocks them and removes their trips from matching', async () => {
    const { admin, reportId, driver } = await reported();
    const { driver: other, offer } = await driverWithOffer(3, 'KDD111D');
    const { rider: seeker, request } = await riderWithRequest('Seeker');
    expect((await api().get(`/api/rides/requests/${request.requestId}/matches`).set(auth(seeker.token))).body.matches.some((m) => m.offer.offerId === offer.offerId)).toBe(true);

    await api().post(`/api/admin/incidents/${reportId}/decision`).set(auth(admin.token)).send({ decision: 'suspended', notes: 'Unsafe' }).expect(200);
    expect((await api().get('/api/users/me').set(auth(driver.token))).status).toBe(403);
    expect((await api().post(`/api/admin/incidents/${reportId}/decision`).set(auth(admin.token)).send({ decision: 'dismissed' })).status).toBe(409);

    // Now suspend the second driver directly: their offer disappears from the matches.
    await api().post(`/api/admin/users/${other.user.userId}/suspend`).set(auth(admin.token)).expect(200);
    const after = await api().get(`/api/rides/requests/${request.requestId}/matches`).set(auth(seeker.token));
    expect(after.body.matches.some((m) => m.offer.offerId === offer.offerId)).toBe(false);
    await api().post(`/api/admin/users/${other.user.userId}/reinstate`).set(auth(admin.token)).expect(200);

    expect(await verifyAuditChain()).toMatchObject({ valid: true });
  });

  it('students get 403 on every admin route', async () => {
    const { rider, reportId } = await reported();
    for (const path of ['stats', 'stats.csv', 'payments', 'incidents', `incidents/${reportId}`, `incidents/${reportId}/evidence`, 'audit', 'users', 'settings']) {
      expect((await api().get(`/api/admin/${path}`).set(auth(rider.token))).status).toBe(403);
    }
    expect((await api().post(`/api/admin/incidents/${reportId}/decision`).set(auth(rider.token)).send({ decision: 'dismissed' })).status).toBe(403);
  });
});

describe('admin dashboard and settings', () => {
  it('reports figures, a csv export and filtered audit entries', async () => {
    const { driver, offer } = await confirmed();
    await api().post(`/api/rides/offers/${offer.offerId}/complete`).set(auth(driver.token)).expect(204);
    const admin = await createAdmin();
    const { stats } = (await api().get('/api/admin/stats').set(auth(admin.token)).expect(200)).body;
    expect(stats).toMatchObject({ completedRides: 1, verifiedStudents: 2 });
    expect(stats.topRoutes[0]).toMatchObject({ origin: 'Roysambu', destination: 'Westlands', trips: 1 });
    expect(stats.estimatedSavingsKes).toBeGreaterThanOrEqual(0);
    const csv = await api().get('/api/admin/stats.csv').set(auth(admin.token)).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('completed_rides');
    const audit = await api().get('/api/admin/audit?action=ride_offer.complete').set(auth(admin.token)).expect(200);
    expect(audit.body.entries.every((e) => e.action === 'ride_offer.complete')).toBe(true);
    expect(audit.body.entries).toHaveLength(1);
    expect((await api().get('/api/admin/users?status=suspended').set(auth(admin.token))).body.users).toHaveLength(0);
  });

  it('requires the three weights to add up to 1', async () => {
    const admin = await createAdmin();
    const bad = await api().put('/api/admin/settings').set(auth(admin.token)).send({ w_overlap: 0.9 });
    expect(bad.status).toBe(400);
    await api().put('/api/admin/settings').set(auth(admin.token)).send({ w_overlap: 0.6, w_time: 0.2, w_detour: 0.2, fare_rounding_kes: 5 }).expect(200);
    await pool.query(`UPDATE system_settings SET setting_value = '0.5' WHERE setting_key = 'w_overlap'`);
    await pool.query(`UPDATE system_settings SET setting_value = '0.3' WHERE setting_key = 'w_time'`);
    await pool.query(`UPDATE system_settings SET setting_value = '10' WHERE setting_key = 'fare_rounding_kes'`);
  });
});

describe('audit trail for this sprint', () => {
  it('records each state change and keeps the chain valid; tampering is caught', async () => {
    const { driver, rider, offer, booking } = await confirmed();
    await api().post(`/api/rides/offers/${offer.offerId}/complete`).set(auth(driver.token)).expect(204);
    await api().post(`/api/rides/bookings/${booking.bookingId}/rate`).set(auth(rider.token)).send({ stars: 5 }).expect(201);
    const share = (await api().get(`/api/rides/trips/${offer.offerId}`).set(auth(driver.token))).body.fare.shares[0];
    await api().post(`/api/payments/shares/${share.shareId}/settle`).set(auth(driver.token)).expect(204);
    expect((await auditRows()).map((r) => r.action)).toEqual(expect.arrayContaining(['booking.create', 'booking.accept', 'ride_offer.complete', 'rating.create', 'payment.settle']));
    expect(await verifyAuditChain()).toMatchObject({ valid: true });

    const rows = await auditRows();
    const client = await pool.connect();
    try {
      await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update_delete');
      await client.query(`UPDATE audit_log SET details = '{"x":1}' WHERE audit_id = $1`, [rows[2].audit_id]);
      await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update_delete');
    } finally {
      client.release();
    }
    expect((await verifyAuditChain()).firstBroken.auditId).toBe(Number(rows[2].audit_id));
  });
});
