const { api, resetDb, createStudent, createAdmin, auditRows, auth, pool } = require('./helpers/testApp');
const { verifyAuditChain, appendAudit, GENESIS_HASH } = require('../src/services/audit');
const { withTransaction } = require('../src/db/pool');

beforeEach(resetDb);

/** Simulates an attacker with superuser rights editing a row behind the trigger's back. */
async function tamper(sql, params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update_delete');
    await client.query(sql, params);
    await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update_delete');
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}

describe('audited actions', () => {
  it('records sign-in, profile update and vehicle create/update as a valid chain', async () => {
    const { token, user } = await createStudent();
    await api().post('/api/auth/session').set(auth(token)).expect(200);
    await api().put('/api/users/me').set(auth(token)).send({ fullName: 'Renamed Student' }).expect(200);
    const v = await api()
      .post('/api/vehicles')
      .set(auth(token))
      .send({ makeModel: 'Mazda Demio', plateNumber: 'KCB 456B', colour: 'Blue', seatCapacity: 4 });
    await api().put(`/api/vehicles/${v.body.vehicle.vehicleId}`).set(auth(token)).send({ seatCapacity: 3 }).expect(200);

    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['user.create', 'auth.sign_in', 'user.update', 'vehicle.create', 'vehicle.update']);
    expect(rows.every((r) => r.user_id === user.userId)).toBe(true);
    expect(rows[0].prev_hash).toBe(GENESIS_HASH);
    rows.slice(1).forEach((r, i) => expect(r.prev_hash).toBe(rows[i].entry_hash));
    expect(rows[2].details).toEqual({ fields: ['fullName'] });
    expect(rows[4].details).toEqual({ fields: ['seatCapacity'] });

    expect(await verifyAuditChain()).toEqual({ valid: true, checked: 5, firstBroken: null });
  });

  it('records a sign-in even before the profile exists', async () => {
    const { tokenFor } = require('./helpers/fakeAuth');
    const res = await api().post('/api/auth/session').set(auth(tokenFor({ uid: 'fresh', email: 'fresh@usiu.ac.ke' })));
    expect(res.body).toEqual({ user: null, needsProfile: true });
    const [row] = await auditRows();
    expect(row).toMatchObject({ action: 'auth.sign_in', user_id: null, entity_id: 'fresh' });
  });

  it('does not write an entry when nothing changed', async () => {
    const { token } = await createStudent({ fullName: 'Same Name' });
    await api().put('/api/users/me').set(auth(token)).send({ fullName: 'Same Name' }).expect(200);
    expect((await auditRows()).map((r) => r.action)).toEqual(['user.create']);
  });
});

describe('append-only enforcement', () => {
  beforeEach(() => createStudent());

  it.each([
    ['UPDATE', `UPDATE audit_log SET action = 'x'`],
    ['DELETE', 'DELETE FROM audit_log'],
    ['TRUNCATE', 'TRUNCATE audit_log'],
  ])('blocks %s', async (op, sql) => {
    await expect(pool.query(sql)).rejects.toThrow(`audit_log is append-only: ${op} is not allowed`);
  });
});

describe('verifyAuditChain()', () => {
  async function seedChain() {
    const { token } = await createStudent();
    for (const colour of ['Red', 'Green']) {
      await api().post('/api/auth/session').set(auth(token));
      await api().put('/api/users/me').set(auth(token)).send({ fullName: `Name ${colour}` });
    }
    return auditRows();
  }

  it('detects a manually altered row and reports it as the first broken entry', async () => {
    const rows = await seedChain();
    const target = rows[2];
    await tamper(`UPDATE audit_log SET details = '{"fields":["faculty"]}' WHERE audit_id = $1`, [target.audit_id]);

    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    expect(result.checked).toBe(2);
    expect(result.firstBroken).toMatchObject({ auditId: Number(target.audit_id), reason: 'entry_hash_mismatch' });
  });

  it('detects a deleted row via the broken prev_hash link', async () => {
    const rows = await seedChain();
    await tamper('DELETE FROM audit_log WHERE audit_id = $1', [rows[1].audit_id]);

    const result = await verifyAuditChain();
    expect(result.firstBroken).toMatchObject({ auditId: Number(rows[2].audit_id), reason: 'prev_hash_mismatch' });
  });

  it('detects a re-hashed row whose successor still points at the old hash', async () => {
    const rows = await seedChain();
    const { computeEntryHash } = require('../src/services/audit');
    const forged = { ...rows[1], action: 'auth.sign_in.forged' };
    const forgedHash = computeEntryHash(forged.prev_hash, forged);
    await tamper('UPDATE audit_log SET action = $1, entry_hash = $2 WHERE audit_id = $3', [
      forged.action,
      forgedHash,
      rows[1].audit_id,
    ]);

    const result = await verifyAuditChain();
    expect(result.firstBroken).toMatchObject({ auditId: Number(rows[2].audit_id), reason: 'prev_hash_mismatch' });
  });

  it('is exposed to admins, who see the tampering', async () => {
    const { token } = await createAdmin();
    const rows = await auditRows();
    await tamper(`UPDATE audit_log SET ip_address = '10.0.0.66' WHERE audit_id = $1`, [rows[0].audit_id]);

    const res = await api().get('/api/admin/audit/verify').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ valid: false, firstBroken: { auditId: Number(rows[0].audit_id) } });
  });

  it('stays linear under concurrent appends', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        withTransaction((client) => appendAudit(client, { action: 'test.concurrent', entity: 'test', entityId: i, ipAddress: '::1' })),
      ),
    );
    expect(await verifyAuditChain(undefined, { batchSize: 7 })).toEqual({ valid: true, checked: 25, firstBroken: null });
  });
});
