const { api, resetDb, createStudent, auth, pool } = require('./helpers/testApp');

beforeEach(resetDb);

const corolla = { makeModel: 'Toyota Corolla', plateNumber: 'kda 123a', colour: 'Silver', seatCapacity: 3 };

describe('vehicle CRUD', () => {
  it('creates, lists, updates and deletes own vehicle', async () => {
    const { token } = await createStudent();

    const created = await api().post('/api/vehicles').set(auth(token)).send(corolla);
    expect(created.status).toBe(201);
    expect(created.body.vehicle).toMatchObject({ plateNumber: 'KDA123A', seatCapacity: 3 });
    const id = created.body.vehicle.vehicleId;

    const list = await api().get('/api/vehicles/mine').set(auth(token));
    expect(list.body.vehicles).toHaveLength(1);

    const updated = await api().put(`/api/vehicles/${id}`).set(auth(token)).send({ seatCapacity: 4, colour: 'White' });
    expect(updated.status).toBe(200);
    expect(updated.body.vehicle).toMatchObject({ seatCapacity: 4, colour: 'White', makeModel: 'Toyota Corolla' });

    expect((await api().delete(`/api/vehicles/${id}`).set(auth(token))).status).toBe(204);
    expect((await api().get('/api/vehicles/mine').set(auth(token))).body.vehicles).toHaveLength(0);
  });

  it.each([0, 8, 2.5])('rejects seatCapacity %s', async (seatCapacity) => {
    const { token } = await createStudent();
    const res = await api().post('/api/vehicles').set(auth(token)).send({ ...corolla, seatCapacity });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('seatCapacity');
  });

  it('returns 409 for a duplicate number plate', async () => {
    const a = await createStudent();
    const b = await createStudent();
    await api().post('/api/vehicles').set(auth(a.token)).send(corolla).expect(201);
    const res = await api().post('/api/vehicles').set(auth(b.token)).send({ ...corolla, plateNumber: 'KDA-123A' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PLATE_TAKEN');
  });

  it('returns 404 for a malformed vehicle id', async () => {
    const { token } = await createStudent();
    const res = await api().put('/api/vehicles/not-a-uuid').set(auth(token)).send({ colour: 'Red' });
    expect(res.status).toBe(404);
  });
});

describe('ownership', () => {
  it("prevents a user from editing or deleting another user's vehicle", async () => {
    const owner = await createStudent();
    const intruder = await createStudent();
    const { body } = await api().post('/api/vehicles').set(auth(owner.token)).send(corolla);
    const id = body.vehicle.vehicleId;

    const put = await api().put(`/api/vehicles/${id}`).set(auth(intruder.token)).send({ colour: 'Red' });
    expect(put.status).toBe(404);
    const del = await api().delete(`/api/vehicles/${id}`).set(auth(intruder.token));
    expect(del.status).toBe(404);

    const { rows } = await pool.query('SELECT colour FROM vehicles WHERE vehicle_id = $1', [id]);
    expect(rows[0].colour).toBe('Silver');
    expect((await api().get('/api/vehicles/mine').set(auth(intruder.token))).body.vehicles).toHaveLength(0);
  });
});
