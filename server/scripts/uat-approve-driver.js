// Approves a volunteer as a student driver for user testing, with one car, and writes an audit entry.
// Usage: npm --prefix server run uat-approve-driver -- volunteer@demo.ridemate.test "Toyota Axio" KDA123A [White] [seats]
// For UAT only. Say in the report that driver accounts were approved by the administrator before testing.
const { pool, withTransaction } = require('../src/db/pool');
const { appendAudit } = require('../src/services/audit');

const [email, makeModel, plateRaw, colour = 'White', seats = '3'] = process.argv.slice(2);
if (!email || !makeModel || !plateRaw) {
  console.error('Usage: npm --prefix server run uat-approve-driver -- email "Make Model" PLATE [colour] [seats]');
  process.exit(1);
}
const plate = plateRaw.replace(/\s/g, '').toUpperCase();

async function main() {
  const { rows } = await pool.query(`SELECT user_id, role, full_name FROM users WHERE university_email = $1`, [email.toLowerCase()]);
  const user = rows[0];
  if (!user) throw new Error('No account with that email. The volunteer must sign up first.');
  if (user.role === 'admin') throw new Error('Admins cannot be drivers.');
  await withTransaction(async (client) => {
    const { rows: v } = await client.query(
      `INSERT INTO vehicles (owner_id, make_model, plate_number, colour, seat_capacity) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (plate_number) DO UPDATE SET owner_id = EXCLUDED.owner_id RETURNING vehicle_id`,
      [user.user_id, makeModel, plate, colour, Number(seats)],
    );
    const type = user.role === 'driver' ? 'external' : 'student';
    await client.query(
      `INSERT INTO driver_verifications (driver_id, driver_type, status, consent_at, licence_number, licence_holder_name, licence_expiry, licence_held_since,
          insurance_provider, insurance_policy_no, insurance_expiry, insurance_covers_passengers, vehicle_id, owner_relationship, psv_badge_expiry, approved_at, next_recheck_at)
       VALUES ($1, $2, 'approved', now(), $3, $4, now() + interval '3 years', now() - interval '5 years', 'UAT sample', $5, now() + interval '1 year', true, $6, 'self',
          CASE WHEN $2 = 'external' THEN (now() + interval '1 year')::date END, now(), now() + interval '6 months')
       ON CONFLICT (driver_id) DO UPDATE SET driver_type = EXCLUDED.driver_type, status = 'approved', vehicle_id = EXCLUDED.vehicle_id,
          licence_expiry = EXCLUDED.licence_expiry, insurance_expiry = EXCLUDED.insurance_expiry, psv_badge_expiry = EXCLUDED.psv_badge_expiry,
          approved_at = now(), next_recheck_at = EXCLUDED.next_recheck_at`,
      [user.user_id, type, `UAT-${plate}`, user.full_name, `UAT-${plate}`, v[0].vehicle_id],
    );
    await appendAudit(client, { userId: user.user_id, action: 'verification.uat_approve', entity: 'driver_verification', entityId: user.user_id, details: { driver_id: user.user_id, note: 'Approved for user acceptance testing' } });
  });
  console.log(`${user.full_name} is approved as a driver with ${makeModel} ${plate}. They can go online now (they may need to refresh the page).`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
