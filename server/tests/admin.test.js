const { api, resetDb, createStudent, createAdmin, auth } = require('./helpers/testApp');

beforeEach(resetDb);

describe('admin routes', () => {
  it('rejects anonymous requests with 401', async () => {
    const res = await api().get('/api/admin/audit/verify');
    expect(res.status).toBe(401);
  });

  it('rejects students with 403', async () => {
    const { token } = await createStudent();
    const res = await api().get('/api/admin/audit/verify').set(auth(token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('lets admins verify the audit chain', async () => {
    const { token } = await createAdmin();
    const res = await api().get('/api/admin/audit/verify').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ valid: true, firstBroken: null });
    expect(res.body.checked).toBeGreaterThanOrEqual(1);
  });
});
