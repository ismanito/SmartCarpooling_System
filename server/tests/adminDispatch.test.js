const { api, resetDb, createStudent, createAdmin, auth, pool, auditRows } = require('./helpers/testApp');

beforeEach(resetDb);

const GATE = { lat: -1.2189, lng: 36.8808, label: 'USIU-Africa, Gate A' };
const KASARANI = { lat: -1.2216, lng: 36.9046, label: 'Kasarani' };

async function ride() {
  const d = await createStudent({ fullName: 'Dan Driver' });
  const r = await createStudent({ fullName: 'Rita Rider' });
  await api().post('/api/vehicles').set(auth(d.token)).send({ makeModel: 'Toyota Axio', plateNumber: 'KDZ901Z', colour: 'Grey', seatCapacity: 3 }).expect(201);
  await api().post('/api/driver/online').set(auth(d.token)).send({ lat: GATE.lat, lng: GATE.lng }).expect(200);
  await api().post('/api/requests').set(auth(r.token)).send({ type: 'now', pickup: GATE, dropoff: KASARANI, seats: 1 }).expect(201);
  const offer = (await api().get('/api/driver/state').set(auth(d.token))).body.offer;
  await api().post(`/api/offers/${offer.offerId}/accept`).set(auth(d.token)).expect(200);
  return { d, r };
}

describe('admin dispatch tools', () => {
  it('students and drivers cannot reach them', async () => {
    const s = await createStudent();
    for (const p of ['live', 'zones', 'dispatch-settings', 'dispatch/requests', 'dispatch/analytics']) {
      expect((await api().get(`/api/admin/${p}`).set(auth(s.token))).status).toBe(403);
    }
  });

  it('shows online drivers and rides under way', async () => {
    const admin = await createAdmin();
    await ride();
    const live = (await api().get('/api/admin/live').set(auth(admin.token)).expect(200)).body;
    expect(live.drivers).toHaveLength(1);
    expect(live.drivers[0]).toMatchObject({ name: 'Dan Driver', seatsFree: 2 });
    expect(live.rides).toHaveLength(1);
    expect(live.rides[0]).toMatchObject({ driver: 'Dan Driver', riders: 1, stopsLeft: 2 });
  });

  it('logs who was offered each request and what they did', async () => {
    const admin = await createAdmin();
    await ride();
    const log = (await api().get('/api/admin/dispatch/requests').set(auth(admin.token)).expect(200)).body.requests;
    expect(log[0]).toMatchObject({ status: 'assigned', rider: 'Rita Rider', driver: 'Dan Driver' });
    expect(log[0].offers).toHaveLength(1);
    expect(log[0].offers[0]).toMatchObject({ driver: 'Dan Driver', response: 'accepted' });
  });

  it('edits zones with a map shape and neighbours, and refuses a bad shape', async () => {
    const admin = await createAdmin();
    const zones = (await api().get('/api/admin/zones').set(auth(admin.token)).expect(200)).body.zones;
    expect(zones.length).toBeGreaterThanOrEqual(16);
    const campus = zones.find((z) => z.name === 'USIU Campus');
    const square = (w, s, e, n) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });

    const created = await api().post('/api/admin/zones').set(auth(admin.token)).send({ name: 'Test Zone', polygon: square(37.0, -1.1, 37.05, -1.05), neighbours: [campus.zoneId] }).expect(201);
    const after = (await api().get('/api/admin/zones').set(auth(admin.token))).body.zones;
    expect(after.find((z) => z.zoneId === created.body.zoneId).neighbours).toEqual([campus.zoneId]);
    expect(after.find((z) => z.zoneId === campus.zoneId).neighbours).toContain(created.body.zoneId); // stored both ways

    await api().put(`/api/admin/zones/${created.body.zoneId}`).set(auth(admin.token)).send({ name: 'Renamed', polygon: square(37.0, -1.1, 37.06, -1.05), neighbours: [] }).expect(200);
    const bowtie = { type: 'Polygon', coordinates: [[[37, -1], [37.1, -1.1], [37.1, -1], [37, -1.1], [37, -1]]] };
    expect((await api().post('/api/admin/zones').set(auth(admin.token)).send({ name: 'Bad', polygon: bowtie, neighbours: [] })).status).toBe(400);
    expect((await api().post('/api/admin/zones').set(auth(admin.token)).send({ name: 'Renamed', polygon: square(37, -1.1, 37.1, -1.05), neighbours: [] })).status).toBe(409);
    expect((await auditRows()).map((a) => a.action)).toEqual(expect.arrayContaining(['zone.create', 'zone.update']));
  });

  it('changes dispatch settings within limits, and audits it', async () => {
    const admin = await createAdmin();
    await api().put('/api/admin/dispatch-settings').set(auth(admin.token)).send({ offer_timeout_s: 30, max_riders_per_car: 2 }).expect(200);
    expect((await api().get('/api/admin/dispatch-settings').set(auth(admin.token))).body.settings).toMatchObject({ offer_timeout_s: 30, max_riders_per_car: 2 });
    expect((await api().put('/api/admin/dispatch-settings').set(auth(admin.token)).send({ offer_timeout_s: 1 })).status).toBe(400);
    expect((await api().put('/api/admin/dispatch-settings').set(auth(admin.token)).send({ nonsense: 1 })).status).toBe(400);
    await pool.query(`UPDATE system_settings SET setting_value = '20' WHERE setting_key = 'offer_timeout_s'`);
    await pool.query(`UPDATE system_settings SET setting_value = '3' WHERE setting_key = 'max_riders_per_car'`);
    expect((await auditRows()).map((a) => a.action)).toContain('dispatch_settings.update');
  });

  it('reports requests, fill rate, waiting time, pooling and savings', async () => {
    const admin = await createAdmin();
    await ride();
    const a = (await api().get('/api/admin/dispatch/analytics').set(auth(admin.token)).expect(200)).body;
    expect(a).toMatchObject({ requests: 1, fillRate: 100, noDriverRate: 0 });
    expect(a.avgWaitSeconds).toBeGreaterThanOrEqual(0);
  });
});
