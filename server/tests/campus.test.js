const { api, resetDb, createStudent, auth } = require('./helpers/testApp');
const { withBuilding, findPlace } = require('../src/lib/places');

beforeEach(resetDb);

const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

describe('campus gates and buildings', () => {
  it('lists Gate A and Gate B and the buildings', async () => {
    const { token } = await createStudent();
    const res = await api().get('/api/rides/places').set(auth(token)).expect(200);
    expect(res.body.places.filter((p) => p.campus).map((p) => p.id)).toEqual(['usiu-gate-a', 'usiu-gate-b']);
    expect(res.body.campusBuildings.map((b) => b.name)).toContain('Science Centre');
  });

  it('puts the building into the trip name', () => {
    expect(withBuilding(findPlace('usiu-gate-a'), 'science-centre').name).toBe('USIU-Africa, Gate A (Science Centre)');
    expect(withBuilding(findPlace('usiu-gate-b'), undefined).name).toBe('USIU-Africa, Gate B');
    expect(withBuilding(findPlace('westlands'), 'science-centre')).toBeNull(); // only campus gates have buildings
    expect(withBuilding(findPlace('usiu-gate-a'), 'moon-base')).toBeNull();
  });

  it('a ride request to a building shows the gate and the building', async () => {
    const { token } = await createStudent();
    const res = await api()
      .post('/api/rides/requests')
      .set(auth(token))
      .send({ origin: 'roysambu', destination: 'usiu-gate-b', destinationBuilding: 'science-centre', departAt: inMinutes(60), seats: 1 })
      .expect(201);
    expect(res.body.request.destination).toBe('USIU-Africa, Gate B (Science Centre)');
  });

  it('refuses a building away from campus, or one that does not exist', async () => {
    const { token } = await createStudent();
    const send = (body) => api().post('/api/rides/requests').set(auth(token)).send({ origin: 'roysambu', departAt: inMinutes(60), seats: 1, ...body });
    const off = await send({ destination: 'westlands', destinationBuilding: 'science-centre' });
    expect(off.status).toBe(400);
    expect(off.body.error.details[0].field).toBe('destinationBuilding');
    expect((await send({ destination: 'usiu-gate-a', destinationBuilding: 'moon-base' })).status).toBe(400);
  });

  it('riders going to the same gate still match drivers there', async () => {
    const driver = await createStudent();
    const rider = await createStudent();
    const v = await api().post('/api/vehicles').set(auth(driver.token)).send({ makeModel: 'Toyota Axio', plateNumber: 'KDH222H', colour: 'Blue', seatCapacity: 3 }).expect(201);
    const offer = (await api().post('/api/rides/offers').set(auth(driver.token)).send({ vehicleId: v.body.vehicle.vehicleId, origin: 'roysambu', destination: 'usiu-gate-a', departAt: inMinutes(60), seats: 3 }).expect(201)).body.offer;
    const req = (await api().post('/api/rides/requests').set(auth(rider.token)).send({ origin: 'roysambu', destination: 'usiu-gate-b', destinationBuilding: 'library', departAt: inMinutes(62), seats: 1 }).expect(201)).body.request;
    const m = (await api().get(`/api/rides/requests/${req.requestId}/matches`).set(auth(rider.token)).expect(200)).body.matches;
    expect(m.map((x) => x.offer.offerId)).toContain(offer.offerId);
  });
});
