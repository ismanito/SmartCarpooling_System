// The pilot figures for report 7.6, read straight from the database.
// Usage: npm --prefix server run pilot-figures -- --since 2026-11-20 [--exclude-demo]
//   --since         first day of the pilot (default: all time)
//   --exclude-demo  leave out @demo.ridemate.test accounts and the rides they were in
// To read the live (Render) database, set DATABASE_URL to its external connection string first.
const { pool } = require('../src/db/pool');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const since = value('--since');
const noDemo = flag('--exclude-demo');
if (since && Number.isNaN(Date.parse(since))) {
  console.error('--since needs a date like 2026-11-20');
  process.exit(1);
}

const demoUser = (alias) => (noDemo ? `AND ${alias}.university_email NOT LIKE '%@demo.ridemate.test'` : '');

async function main() {
  const from = since || '1970-01-01';
  const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

  const students = await one(`SELECT count(*)::int AS n FROM users u WHERE u.role = 'student' AND u.is_verified ${demoUser('u')}`);
  const joined = await one(`SELECT count(*)::int AS n FROM users u WHERE u.role = 'student' AND u.is_verified AND u.created_at >= $1 ${demoUser('u')}`, [from]);
  const drivers = await one(
    `SELECT count(*)::int AS n FROM driver_verifications v JOIN users u ON u.user_id = v.driver_id WHERE v.status = 'approved' ${demoUser('u')}`,
  );

  // Rides that finished in the pilot window, with how many riders shared each one.
  const rides = await pool.query(
    `SELECT r.ride_id, r.total_cost_kes,
            (SELECT count(*)::int FROM ride_shares s WHERE s.ride_id = r.ride_id) AS riders,
            (SELECT COALESCE(sum(s.amount_kes), 0)::int FROM ride_shares s WHERE s.ride_id = r.ride_id) AS shared,
            (SELECT COALESCE(sum(s.amount_kes) FILTER (WHERE s.status = 'paid'), 0)::int FROM ride_shares s WHERE s.ride_id = r.ride_id) AS paid
       FROM rides r JOIN users d ON d.user_id = r.driver_id
      WHERE r.status = 'completed' AND r.completed_at >= $1 ${demoUser('d')}`,
    [from],
  );
  const done = rides.rows;
  const pooled = done.filter((r) => r.riders > 1).length;
  const sum = (k) => done.reduce((s, r) => s + (r[k] || 0), 0);
  const riderTrips = done.reduce((s, r) => s + r.riders, 0);

  const incidents = await pool.query(
    `SELECT i.created_at, i.category, i.status, i.decision, i.admin_notes, i.description
       FROM incident_reports i JOIN users ru ON ru.user_id = i.reporter_id
      WHERE i.created_at >= $1 ${demoUser('ru')} ORDER BY i.created_at`,
    [from],
  );

  console.log(`Pilot figures${since ? ` since ${since}` : ' (all time)'}${noDemo ? ', demo accounts excluded' : ''}\n`);
  console.log(`Verified students:           ${students.n}${since ? ` (${joined.n} joined during the pilot)` : ''}`);
  console.log(`Approved drivers:            ${drivers.n}`);
  console.log(`Rides completed:             ${done.length}  (${riderTrips} rider trips)`);
  console.log(`Pooled rides (2+ riders):    ${pooled} of ${done.length}  = ${done.length ? Math.round((pooled / done.length) * 100) : 0}%`);
  console.log(`Fuel cost shared (riders' shares): KES ${sum('shared')}   of which paid KES ${sum('paid')}`);
  console.log(`Total fuel cost of those rides:    KES ${sum('total_cost_kes')}`);
  console.log(`Safety reports:              ${incidents.rowCount}`);
  for (const i of incidents.rows) {
    console.log(`  - ${i.created_at.toISOString().slice(0, 10)} ${i.category} [${i.status}${i.decision ? `, ${i.decision}` : ''}] ${i.admin_notes ? `Action: ${i.admin_notes}` : 'No action recorded yet'}`);
  }
  if (incidents.rowCount === 0) console.log('  (none reported)');
  console.log('\nAlso take screenshots of the Admin Dashboard and Incident reports pages for the report.');
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
