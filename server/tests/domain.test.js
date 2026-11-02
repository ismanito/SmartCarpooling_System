const { api, resetDb, tokenFor, auth, pool } = require('./helpers/testApp');

beforeEach(resetDb);

const profile = { fullName: 'Amina Wanjiru', phoneNumber: '0712345678', faculty: 'Chandaria School of Business' };

describe('POST /api/auth/check-domain (public)', () => {
  it('accepts a university email', async () => {
    const res = await api().post('/api/auth/check-domain').send({ email: 'amina@usiu.ac.ke' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ allowed: true, domain: 'usiu.ac.ke', allowedDomains: ['usiu.ac.ke'] });
  });

  it('rejects a non-university email', async () => {
    const res = await api().post('/api/auth/check-domain').send({ email: 'amina@gmail.com' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ allowed: false, domain: 'gmail.com' });
  });

  it('validates the body', async () => {
    const res = await api().post('/api/auth/check-domain').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('registration is limited to university domains (enforced by the API)', () => {
  it.each(['amina@gmail.com', 'amina@usiu.ac.ke.evil.com', 'amina@students.usiu.ac.ke'])(
    'rejects %s with 403 and creates no user',
    async (email) => {
      const token = tokenFor({ uid: 'uid-outsider', email });
      const res = await api().post('/api/users').set(auth(token)).send(profile);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: { code: 'AUTH_DOMAIN_NOT_ALLOWED', message: expect.any(String) } });
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
      expect(rows[0].n).toBe(0);
    },
  );

  it('accepts a verified university email and stores it lower-cased', async () => {
    const token = tokenFor({ uid: 'uid-amina', email: 'Amina@USIU.ac.ke' });
    const res = await api().post('/api/users').set(auth(token)).send(profile);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ universityEmail: 'amina@usiu.ac.ke', role: 'student', isVerified: true });
  });
});
