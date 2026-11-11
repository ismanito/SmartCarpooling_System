// Usage: npm --prefix server run simulate            (uses the TEST database, never your real data)
//        npm --prefix server run simulate -- --seed 7 --drivers 20 --requests 60 --accept 0.85
//
// Puts online drivers and ride requests across the zones, lets the real dispatch code offer, pool, and finish the
// rides, and prints the figures for the report: average pick-up ETA, pooling rate and no-driver rate.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};
const SEED = arg('seed', 42);
const DRIVERS = arg('drivers', 20);
const REQUESTS = arg('requests', 60);
const ACCEPT = arg('accept', 0.85); // chance a driver says yes to an offer
const SPREAD = arg('spread', 1); // share of riders who start anywhere in the pilot area; the rest start near campus
const WAVE = arg('wave', 10); // requests that arrive before rides get finished and drivers free up

// The simulation writes data, so it only ever touches the test database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://ridemate:ridemate@localhost:5432/ridemate_test';
process.env.ALLOWED_EMAIL_DOMAINS = process.env.ALLOWED_EMAIL_DOMAINS || 'usiu.ac.ke';

const { pool, withTransaction } = require('../src/db/pool');
const dispatch = require('../src/services/dispatch');
const driverApp = require('../src/services/driverApp');
const rideOps = require('../src/services/rideOps');
const { migrate } = require('../src/db/migrator');

/** Small seeded random numbers so a run can be repeated exactly. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);

async function main() {
  await migrate(process.env.DATABASE_URL);
  const { rows: zones } = await pool.query(
    `SELECT zone_id, name, ST_XMin(polygon::geometry) AS w, ST_YMin(polygon::geometry) AS s, ST_XMax(polygon::geometry) AS e, ST_YMax(polygon::geometry) AS n FROM zones ORDER BY name`,
  );
  const campus = zones.find((z) => z.name === 'USIU Campus');
  const near = zones.filter((z) => ['USIU Campus', 'Thika Road Mall', 'Roysambu', 'Kasarani', 'Ruaraka'].includes(z.name));
  const outer = zones.filter((z) => z !== campus);
  const inZone = (z) => ({ lat: between(z.s, z.n), lng: between(z.w, z.e), label: z.name });

  // Clean up anything a previous run left, then create the people.
  await pool.query(`DELETE FROM users WHERE university_email LIKE 'sim-%@usiu.ac.ke'`);
  const make = async (kind, i) => {
    const { rows } = await pool.query(
      `INSERT INTO users (firebase_uid, full_name, university_email, phone_number, faculty, role, is_verified, avg_rating)
       VALUES ($1, $2, $3, '+254712345678', 'School of Science and Technology', 'student', true, $4) RETURNING user_id`,
      [`sim-${kind}-${i}`, `Sim ${kind} ${i}`, `sim-${kind}-${i}@usiu.ac.ke`, (3 + rand() * 2).toFixed(1)],
    );
    return rows[0].user_id;
  };

  console.log(`Seed ${SEED}: ${DRIVERS} drivers, ${REQUESTS} requests, drivers accept ${Math.round(ACCEPT * 100)}% of offers\n`);
  const drivers = [];
  for (let i = 0; i < DRIVERS; i += 1) {
    const userId = await make('driver', i);
    await pool.query(`INSERT INTO vehicles (owner_id, make_model, plate_number, colour, seat_capacity) VALUES ($1, 'Toyota Axio', $2, 'White', 3)`, [userId, `SIM${100 + i}X`]);
    // Most drivers live near campus (that is where students travel to), the rest are spread around.
    const z = i < Math.ceil(DRIVERS * 0.6) ? pick(near) : pick(outer);
    const at = inZone(z);
    await driverApp.goOnline({ user: { userId, role: 'student' }, lat: at.lat, lng: at.lng });
    drivers.push({ userId, home: z.name });
  }

  const requests = [];
  for (let i = 0; i < REQUESTS; i += 1) {
    const riderId = await make('rider', i);
    const roll = rand();
    // 70% head to campus, 15% leave campus, 15% travel between other areas.
    const origin = () => (rand() < SPREAD ? pick(outer) : pick(near.filter((z) => z !== campus)));
    const [from, to] = roll < 0.7 ? [origin(), campus] : roll < 0.85 ? [campus, origin()] : [origin(), origin()];
    requests.push({ riderId, pickup: inZone(from), dropoff: inZone(to) });
  }

  const answerOffers = async () => {
    for (let round = 0; round < 60; round += 1) {
      const { rows } = await pool.query(`SELECT offer_id, driver_id FROM dispatch_offers WHERE response IS NULL AND expires_at > now()`);
      if (rows.length === 0) return;
      for (const o of rows) {
        try {
          if (rand() < ACCEPT) await dispatch.acceptOffer({ offerId: o.offer_id, driverId: o.driver_id });
          else await dispatch.declineOffer({ offerId: o.offer_id, driverId: o.driver_id });
        } catch {
          /* the request was taken or no longer fits: the engine moved on */
        }
      }
    }
  };

  const finishRides = async () => {
    const { rows: active } = await pool.query(`SELECT ride_id, driver_id FROM rides WHERE status IN ('heading_to_pickup', 'in_progress')`);
    for (const r of active) {
      for (const s of await dispatch.remainingStops(pool, r.ride_id)) {
        await rideOps.arrived({ rideId: r.ride_id, stopId: s.stopId, driverId: r.driver_id });
        await rideOps.done({ rideId: r.ride_id, stopId: s.stopId, driverId: r.driver_id });
      }
      await rideOps.completeRide({ rideId: r.ride_id, driverId: r.driver_id }).catch(() => {});
    }
  };

  const seen = [];
  for (let i = 0; i < requests.length; i += 1) {
    const r = requests[i];
    const made = await withTransaction((c) => dispatch.createRequest(c, { riderId: r.riderId, type: 'now', pickup: r.pickup, dropoff: r.dropoff, seats: 1 }));
    seen.push(made.request_id);
    await dispatch.dispatchRequest(made.request_id);
    await answerOffers();
    if ((i + 1) % WAVE === 0) await finishRides();
  }
  await finishRides();

  // ---- the numbers
  const ids = `ARRAY[${seen.map((s) => `'${s}'::uuid`).join(',')}]`;
  const { rows: totals } = await pool.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE assigned_at IS NOT NULL)::int AS served, count(*) FILTER (WHERE status = 'no_driver')::int AS no_driver
       FROM trip_requests WHERE request_id = ANY(${ids})`,
  );
  const { rows: eta } = await pool.query(
    `SELECT round(avg(o.pickup_eta_min)::numeric, 1) AS avg_eta, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY o.pickup_eta_min)::numeric, 1) AS median_eta,
            round(max(o.pickup_eta_min)::numeric, 1) AS worst_eta, count(*)::int AS n
       FROM dispatch_offers o WHERE o.response = 'accepted' AND o.request_id = ANY(${ids})`,
  );
  const { rows: offers } = await pool.query(`SELECT count(*)::int AS offers, count(*) FILTER (WHERE response = 'declined')::int AS declined FROM dispatch_offers WHERE request_id = ANY(${ids})`);
  const { rows: rides } = await pool.query(
    `SELECT count(*)::int AS rides, count(*) FILTER (WHERE riders >= 2)::int AS pooled, round(avg(riders)::numeric, 2) AS avg_riders FROM (
       SELECT r.ride_id, (SELECT count(*) FROM ride_shares s WHERE s.ride_id = r.ride_id) AS riders FROM rides r WHERE r.status = 'completed'
          AND EXISTS (SELECT 1 FROM trip_requests t WHERE t.ride_id = r.ride_id AND t.request_id = ANY(${ids}))) x`,
  );
  const { rows: money } = await pool.query(
    `SELECT COALESCE(sum(s.amount_kes), 0)::int AS shared, COALESCE(sum(GREATEST(0, t.route_km * 24 - s.amount_kes)), 0)::int AS saved
       FROM ride_shares s JOIN trip_requests t ON t.request_id = s.request_id WHERE s.request_id = ANY(${ids})`,
  );
  const decided = totals[0].served + totals[0].no_driver;
  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');

  const report = {
    seed: SEED,
    spread: SPREAD,
    drivers: DRIVERS,
    requests: totals[0].total,
    served: totals[0].served,
    noDriver: totals[0].no_driver,
    noDriverRate: pct(totals[0].no_driver, decided),
    avgPickupEtaMin: eta[0].avg_eta === null ? null : Number(eta[0].avg_eta),
    medianPickupEtaMin: eta[0].median_eta === null ? null : Number(eta[0].median_eta),
    worstPickupEtaMin: eta[0].worst_eta === null ? null : Number(eta[0].worst_eta),
    offersSent: offers[0].offers,
    offersDeclined: offers[0].declined,
    rides: rides[0].rides,
    pooledRides: rides[0].pooled,
    poolingRate: pct(rides[0].pooled, rides[0].rides),
    avgRidersPerRide: Number(rides[0].avg_riders),
    fuelCostSharedKes: money[0].shared,
    estimatedSavingsKes: money[0].saved,
  };
  console.log('Average pick-up ETA ........', `${report.avgPickupEtaMin} min (median ${report.medianPickupEtaMin}, worst ${report.worstPickupEtaMin})`);
  console.log('Requests served ............', `${report.served} of ${report.requests}`);
  console.log('No-driver rate .............', report.noDriverRate);
  console.log('Pooling rate ...............', `${report.poolingRate} of rides had 2+ riders (${report.pooledRides} of ${report.rides}, average ${report.avgRidersPerRide} riders per ride)`);
  console.log('Offers sent / declined .....', `${report.offersSent} / ${report.offersDeclined}`);
  console.log('Cost shared / saved ........', `KES ${report.fuelCostSharedKes} / KES ${report.estimatedSavingsKes}`);
  console.log('\n' + JSON.stringify(report));

  await pool.query(`DELETE FROM users WHERE university_email LIKE 'sim-%@usiu.ac.ke'`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
