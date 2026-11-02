const { api, resetDb, createStudent, tokenFor, auth, pool } = require('./helpers/testApp');

beforeEach(resetDb);

describe('auth middleware', () => {
  it('returns 401 without a token', async () => {
    const res = await api().get('/api/users/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'AUTH_MISSING_TOKEN', message: expect.any(String) } });
  });

  it('returns 401 for a malformed Authorization header', async () => {
    const res = await api().get('/api/users/me').set('Authorization', 'Token abc');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_MISSING_TOKEN');
  });

  it('returns 401 for an invalid token', async () => {
    const res = await api().get('/api/users/me').set(auth('not-a-real-token'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('returns 403 for an unverified email', async () => {
    const token = tokenFor({ uid: 'u1', email: 'new@usiu.ac.ke', emailVerified: false });
    const res = await api().post('/api/users').set(auth(token)).send({ fullName: 'New', phoneNumber: '0712345678', faculty: 'Other' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_EMAIL_UNVERIFIED');
  });

  it('returns 403 PROFILE_REQUIRED for a verified user who has not onboarded', async () => {
    const token = tokenFor({ uid: 'u2', email: 'new@usiu.ac.ke' });
    const res = await api().get('/api/users/me').set(auth(token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROFILE_REQUIRED');
  });

  it('returns 403 for a suspended user', async () => {
    const { token, user } = await createStudent();
    await pool.query(`UPDATE users SET status = 'suspended' WHERE user_id = $1`, [user.userId]);
    const res = await api().get('/api/users/me').set(auth(token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_SUSPENDED');
  });

  it('attaches the user and role from Postgres', async () => {
    const { token, user } = await createStudent();
    const res = await api().get('/api/users/me').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ userId: user.userId, role: 'student' });
  });

  it('leaves the health check public', async () => {
    const res = await api().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('uses the JSON error format for unknown routes and bad JSON', async () => {
    const missing = await api().get('/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    const badJson = await api().post('/api/auth/check-domain').set('Content-Type', 'application/json').send('{"email":');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.code).toBe('INVALID_JSON');
  });
});
