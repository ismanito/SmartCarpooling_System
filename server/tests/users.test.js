const { api, resetDb, createStudent, tokenFor, auth } = require('./helpers/testApp');

beforeEach(resetDb);

describe('POST /api/users', () => {
  const token = () => tokenFor({ uid: 'uid-brian', email: 'brian@usiu.ac.ke' });

  it('creates a profile and normalises the phone number', async () => {
    const res = await api()
      .post('/api/users')
      .set(auth(token()))
      .send({ fullName: '  Brian Otieno ', phoneNumber: '0722 000 111', faculty: 'School of Science and Technology' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      fullName: 'Brian Otieno',
      phoneNumber: '+254722000111',
      universityEmail: 'brian@usiu.ac.ke',
      role: 'student',
      status: 'active',
      avgRating: 0,
    });
    expect(res.body.user).not.toHaveProperty('firebaseUid');
  });

  it('returns 409 if the profile already exists', async () => {
    const body = { fullName: 'Brian Otieno', phoneNumber: '0722000111', faculty: 'Other' };
    await api().post('/api/users').set(auth(token())).send(body).expect(201);
    const res = await api().post('/api/users').set(auth(token())).send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROFILE_EXISTS');
  });

  it('returns field-level validation errors', async () => {
    const res = await api().post('/api/users').set(auth(token())).send({ fullName: 'B', phoneNumber: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['fullName', 'phoneNumber', 'faculty']));
  });

  it('refuses to let a client set its own role', async () => {
    const res = await api()
      .post('/api/users')
      .set(auth(token()))
      .send({ fullName: 'Brian Otieno', phoneNumber: '0722000111', faculty: 'Other', role: 'admin' });
    expect(res.status).toBe(400);
  });
});

describe('GET/PUT /api/users/me', () => {
  it('returns and updates the current profile', async () => {
    const { token } = await createStudent({ fullName: 'Cynthia Achieng' });

    const me = await api().get('/api/users/me').set(auth(token));
    expect(me.body.user.fullName).toBe('Cynthia Achieng');

    const res = await api().put('/api/users/me').set(auth(token)).send({ faculty: 'Chandaria School of Business' });
    expect(res.status).toBe(200);
    expect(res.body.user.faculty).toBe('Chandaria School of Business');
    expect(res.body.user.fullName).toBe('Cynthia Achieng');
  });

  it('rejects empty updates and protected fields', async () => {
    const { token } = await createStudent();
    expect((await api().put('/api/users/me').set(auth(token)).send({})).status).toBe(400);
    expect((await api().put('/api/users/me').set(auth(token)).send({ role: 'admin' })).status).toBe(400);
    expect((await api().put('/api/users/me').set(auth(token)).send({ universityEmail: 'x@usiu.ac.ke' })).status).toBe(400);
  });
});
