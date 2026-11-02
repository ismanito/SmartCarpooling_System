// Usage: npm run make-admin -- student@usiu.ac.ke
// The only way to grant the admin role; no API route can do this.
const { pool, withTransaction } = require('../src/db/pool');
const { appendAudit } = require('../src/services/audit');

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) throw new Error('Usage: npm run make-admin -- <university email>');

  const user = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE users SET role = 'admin' WHERE university_email = $1 RETURNING user_id, role`,
      [email],
    );
    if (!rows[0]) return null;
    await appendAudit(client, {
      userId: null,
      action: 'user.role_grant',
      entity: 'user',
      entityId: rows[0].user_id,
      ipAddress: null,
      details: { role: 'admin', via: 'cli' },
    });
    return rows[0];
  });

  if (!user) throw new Error(`No user with email ${email}. They must complete onboarding first.`);
  console.log(`${email} is now an admin.`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
