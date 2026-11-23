// Fills the demo accounts with about eight weeks of believable ride history, so dashboards and charts show trends.
// Rides grow week by week, weekdays are busier than weekends, rush hours are busiest, some rides are pooled,
// a few requests are cancelled or find no driver (more at the start), and fares come from the real fare rules.
//
// Usage: npm --prefix server run demo-history            (adds the history, replacing any earlier copy)
//        npm --prefix server run demo-history -- --remove  (takes it all out again)
// Set SEED_DEMO_HISTORY=false to remove it automatically (the Render start command runs this script).
// Only rows this script created are ever touched: it keeps their ids in a small table, demo_seed.
const { pool, withTransaction } = require('../src/db/pool');
const { calculateLegFares, estimateShare } = require('../src/lib/fare');
const { PLACES, routeKm } = require('../src/lib/places');

const DAYS = 56;
const remove = process.argv.includes('--remove') || process.env.SEED_DEMO_HISTORY === 'false';

// A small repeatable random generator, so every run looks the same.
let state = 20261123;
const rand = () => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const weighted = (items) => {
  let r = rand() * items.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[0][0];
};

const SEED_RIDERS = [
  ['Aisha Mohamed', 'student'], ['Brian Kiptoo', 'student'], ['Cynthia Achieng', 'student'], ['David Mutiso', 'student'],
  ['Esther Wambui', 'student'], ['Farid Hassan', 'student'], ['Gladys Chebet', 'staff'], ['Hassan Abdi', 'student'],
];
const DEMO_RIDERS = ['grace.wanjiru', 'kevin.omondi', 'faith.njeri'];
const DEMO_DRIVERS = [['dan.mwangi', 40], ['amina.hassan', 35], ['brian.otieno', 25]];
// Where people go (weights follow how close and popular a place is)
const HOMES = [['roysambu', 16], ['trm', 14], ['kasarani', 12], ['zimmerman', 10], ['mirema', 9], ['safari-park', 8], ['garden-city', 7], ['githurai', 6], ['ruaraka', 5], ['westlands', 5], ['kahawa-west', 4], ['cbd', 3], ['parklands', 2]];
const place = (id) => PLACES.find((p) => p.id === id);
const GATES = ['usiu-gate-a', 'usiu-gate-a', 'usiu-gate-b'];

async function setup(db) {
  await db.query('CREATE TABLE IF NOT EXISTS demo_seed (kind text NOT NULL, id uuid NOT NULL, PRIMARY KEY (kind, id))');
}

async function clear(db) {
  const ids = async (kind) => (await db.query('SELECT id FROM demo_seed WHERE kind = $1', [kind])).rows.map((r) => r.id);
  const requests = await ids('request');
  const rides = await ids('ride');
  if (rides.length) await db.query('DELETE FROM rides WHERE ride_id = ANY($1)', [rides]); // takes shares, ratings and incidents with it
  if (requests.length) await db.query('DELETE FROM trip_requests WHERE request_id = ANY($1)', [requests]);
  await db.query('DELETE FROM demo_seed');
}

const point = (p) => `POINT(${p.lng} ${p.lat})`;

async function main() {
  const { rows: settingRows } = await pool.query(`SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('fuel_rate_kes_per_km', 'fare_rounding_kes', 'min_share_kes')`);
  const cfg = Object.fromEntries(settingRows.map((r) => [r.setting_key, Number(r.setting_value)]));
  const fuel = cfg.fuel_rate_kes_per_km || 24;
  const rounding = cfg.fare_rounding_kes || 10;
  const minShare = cfg.min_share_kes ?? 30;

  await withTransaction(async (db) => {
    await setup(db);
    await clear(db);
    if (remove) {
      console.log('Demo history removed.');
      return;
    }

    const emailOf = (base) => `${base}@demo.ridemate.test`;
    const user = async (email) => (await db.query('SELECT user_id, full_name FROM users WHERE university_email = $1', [email])).rows[0];

    // Riders that exist only for the demo (they cannot sign in), so the numbers look like a real campus.
    for (const [i, [name, kind]] of SEED_RIDERS.entries()) {
      const email = emailOf(`seed.${name.toLowerCase().replace(/[^a-z]+/g, '.')}`);
      await db.query(
        `INSERT INTO users (firebase_uid, university_email, full_name, phone_number, faculty, role, person_type, is_verified)
         VALUES ($1, $2, $3, $4, 'Demo', 'student', $5, true) ON CONFLICT (university_email) DO NOTHING`,
        [`seed:${i + 1}`, email, name, `+2547009000${String(i).padStart(2, '0')}`, kind],
      );
    }
    const riders = [];
    for (const base of DEMO_RIDERS) {
      const u = await user(emailOf(base));
      if (u) riders.push(u);
    }
    for (const [name] of SEED_RIDERS) riders.push(await user(emailOf(`seed.${name.toLowerCase().replace(/[^a-z]+/g, '.')}`)));
    const drivers = [];
    for (const [base, w] of DEMO_DRIVERS) {
      const u = await user(emailOf(base));
      if (!u) continue;
      const { rows } = await db.query('SELECT vehicle_id FROM vehicles WHERE owner_id = $1 ORDER BY created_at LIMIT 1', [u.user_id]);
      drivers.push([{ ...u, vehicleId: rows[0]?.vehicle_id || null }, w]);
    }
    if (drivers.length === 0 || riders.length < 3) throw new Error('Run "npm --prefix server run demo-accounts" first, so the demo accounts exist.');

    let rides = 0;
    let shares = 0;
    let unpaid = 0;
    const ratingRows = [];
    for (let back = DAYS - 1; back >= 0; back -= 1) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - back);
      const progress = (DAYS - 1 - back) / (DAYS - 1); // 0 at the start, 1 today
      const dow = day.getDay(); // 0 Sunday
      const dayFactor = dow === 0 ? 0.25 : dow === 6 ? 0.55 : dow === 5 ? 1.15 : 1;
      const expected = (1.2 + 4.8 * progress ** 1.15) * dayFactor;
      const count = Math.max(0, Math.round(expected + (rand() - 0.5) * 2.2));

      for (let n = 0; n < count; n += 1) {
        const driver = weighted(drivers);
        const outbound = rand() < 0.5; // leaving campus (evening) or heading to it (morning)
        const hour = outbound ? weighted([[16, 3], [17, 5], [18, 4], [19, 2], [13, 2]]) : weighted([[6, 1], [7, 5], [8, 5], [9, 2], [10, 1]]);
        const at = new Date(day.getTime() + hour * 3600_000 + Math.floor(rand() * 50) * 60_000);
        const pooled = rand() < 0.1 + 0.32 * progress;
        const first = pick(riders);
        let second = null;
        if (pooled) {
          do second = pick(riders);
          while (second.user_id === first.user_id);
        }
        const gate = place(pick(GATES));
        const home1 = place(weighted(HOMES));
        const home2 = second ? place(weighted(HOMES.filter(([id]) => Math.abs(place(id).lat - home1.lat) + Math.abs(place(id).lng - home1.lng) < 0.05))) : null;
        const make = (who, home) => ({ who, home, from: outbound ? gate : home, to: outbound ? home : gate });
        const a = make(first, home1);
        const b = second ? make(second, home2 || home1) : null;

        // Legs between stops, with who is in the car on each leg.
        const legs = [];
        let aboard = [];
        const order = outbound ? [a, b].filter(Boolean).sort((x, y) => routeKm(gate, x.home) - routeKm(gate, y.home)) : [a, b].filter(Boolean).sort((x, y) => routeKm(y.home, gate) - routeKm(x.home, gate));
        if (outbound) {
          aboard = order.map((o) => o.who.user_id);
          let at0 = gate;
          for (const o of order) {
            legs.push({ km: routeKm(at0, o.home), riderIds: [...aboard] });
            aboard = aboard.filter((id) => id !== o.who.user_id);
            at0 = o.home;
          }
        } else {
          let at0 = order[0].home;
          aboard = [order[0].who.user_id];
          for (const o of order.slice(1)) {
            legs.push({ km: routeKm(at0, o.home), riderIds: [...aboard] });
            aboard = [...aboard, o.who.user_id];
            at0 = o.home;
          }
          legs.push({ km: routeKm(at0, gate), riderIds: [...aboard] });
        }
        const fare = calculateLegFares(legs.filter((l) => l.km > 0), fuel, rounding, minShare);
        const totalKm = Math.round(legs.reduce((s, l) => s + l.km, 0) * 100) / 100;
        const started = new Date(at.getTime() + (3 + Math.floor(rand() * 8)) * 60_000);
        const done = new Date(started.getTime() + Math.round((totalKm / 22) * 3600_000) + 4 * 60_000);

        const { rows: ride } = await db.query(
          `INSERT INTO rides (driver_id, vehicle_id, status, total_km, total_cost_kes, started_at, completed_at, created_at)
           VALUES ($1, $2, 'completed', $3, $4, $5, $6, $7) RETURNING ride_id`,
          [driver.user_id, driver.vehicleId, totalKm, fare.totalKes, started, done, at],
        );
        const rideId = ride[0].ride_id;
        await db.query(`INSERT INTO demo_seed (kind, id) VALUES ('ride', $1)`, [rideId]);
        rides += 1;

        for (const o of [a, b].filter(Boolean)) {
          const km = routeKm(o.from, o.to);
          const { rows: req } = await db.query(
            `INSERT INTO trip_requests (rider_id, type, pickup_point, pickup_label, dropoff_point, dropoff_label, seats, status, route_km, est_share_kes, est_pooled_kes,
                                        created_at, updated_at, ride_id, driver_id, rider_confirmed_driver_at)
             VALUES ($1, 'now', ST_GeogFromText($2), $3, ST_GeogFromText($4), $5, 1, 'completed', $6, $7, $8, $9, $10, $11, $12, $13) RETURNING request_id`,
            [o.who.user_id, point(o.from), o.from.name, point(o.to), o.to.name, km, estimateShare(km, fuel, rounding, 2, minShare), estimateShare(km, fuel, rounding, 4, minShare), at, done, rideId, driver.user_id, started],
          );
          await db.query(`INSERT INTO demo_seed (kind, id) VALUES ('request', $1)`, [req[0].request_id]);
          const amount = fare.shares[o.who.user_id] ?? minShare;
          const recent = back < 3;
          const paid = !recent || rand() < 0.35;
          if (!paid) unpaid += 1;
          await db.query(
            `INSERT INTO ride_shares (ride_id, request_id, rider_id, amount_kes, status, method, paid_at, settled_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [rideId, req[0].request_id, o.who.user_id, amount, paid ? 'paid' : 'pending', paid ? (rand() < 0.8 ? 'mpesa' : 'cash') : null, paid ? new Date(done.getTime() + 20 * 60_000) : null, paid ? driver.user_id : null],
          );
          shares += 1;
          if (rand() < 0.8) ratingRows.push([rideId, o.who.user_id, driver.user_id, weighted([[5, 62], [4, 27], [3, 8], [2, 3]]), pick([['On time'], ['Safe driving'], ['Friendly'], ['Clean car'], []]), done]);
          if (rand() < 0.55) ratingRows.push([rideId, driver.user_id, o.who.user_id, weighted([[5, 70], [4, 25], [3, 5]]), pick([['Easy pick-up'], ['Friendly'], []]), done]);
        }
      }

      // Requests that never became rides: more of them early on, when there were few drivers.
      const extra = Math.round(count * (0.22 - 0.16 * progress) + rand());
      for (let n = 0; n < extra; n += 1) {
        const who = pick(riders);
        const home = place(weighted(HOMES));
        const gate = place(pick(GATES));
        const at = new Date(day.getTime() + weighted([[7, 4], [8, 4], [17, 5], [18, 3]]) * 3600_000 + Math.floor(rand() * 50) * 60_000);
        const status = rand() < 0.65 - 0.3 * progress ? 'no_driver' : 'cancelled';
        const km = routeKm(gate, home);
        const { rows: req } = await db.query(
          `INSERT INTO trip_requests (rider_id, type, pickup_point, pickup_label, dropoff_point, dropoff_label, seats, status, route_km, est_share_kes, est_pooled_kes, created_at, updated_at)
           VALUES ($1, 'now', ST_GeogFromText($2), $3, ST_GeogFromText($4), $5, 1, $6, $7, $8, $9, $10, $10) RETURNING request_id`,
          [who.user_id, point(gate), gate.name, point(home), home.name, status, km, estimateShare(km, fuel, rounding, 2, minShare), estimateShare(km, fuel, rounding, 4, minShare), at],
        );
        await db.query(`INSERT INTO demo_seed (kind, id) VALUES ('request', $1)`, [req[0].request_id]);
      }
    }

    for (const r of ratingRows) {
      await db.query('INSERT INTO ratings (ride_id, rater_id, ratee_id, stars, tags, created_at) VALUES ($1, $2, $3, $4, $5, $6)', r);
    }
    await db.query(`UPDATE users u SET avg_rating = x.avg FROM (SELECT ratee_id, round(avg(stars), 1) AS avg FROM ratings GROUP BY ratee_id) x WHERE u.user_id = x.ratee_id AND u.university_email LIKE '%@demo.ridemate.test'`);

    // Two safety reports so the admin pages have something to show: one dealt with, one still open.
    const lastRides = (await db.query(`SELECT ride_id, driver_id FROM rides WHERE ride_id IN (SELECT id FROM demo_seed WHERE kind = 'ride') ORDER BY created_at`)).rows;
    const reportFor = async (ride, category, description, closed) => {
      const { rows } = await db.query('SELECT rider_id FROM trip_requests WHERE ride_id = $1 LIMIT 1', [ride.ride_id]);
      await db.query(
        `INSERT INTO incident_reports (reporter_id, reported_user_id, ride_id, category, description, status, decision, admin_notes, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [rows[0].rider_id, ride.driver_id, ride.ride_id, category, description, closed ? 'closed' : 'open', closed ? 'warning' : null, closed ? 'Spoke to the driver and sent a written warning.' : null, closed ? new Date() : null],
      );
    };
    if (lastRides.length > 40) {
      await reportFor(lastRides[Math.floor(lastRides.length * 0.45)], 'no_show', 'The driver waited only a minute at the gate and left before I came out.', true);
      await reportFor(lastRides[lastRides.length - 6], 'unsafe_driving', 'The driver was going fast on Thika Road and braked hard twice.', false);
    }

    console.log(`Demo history added: ${rides} completed rides, ${shares} rider shares (${unpaid} unpaid), ${ratingRows.length} ratings, 2 safety reports.`);
    const { rows: t } = await db.query(`SELECT count(*) FILTER (WHERE status = 'completed')::int AS done, count(*) FILTER (WHERE status = 'no_driver')::int AS none, count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled FROM trip_requests WHERE request_id IN (SELECT id FROM demo_seed WHERE kind = 'request')`);
    console.log(`Requests: ${t[0].done} completed, ${t[0].cancelled} cancelled, ${t[0].none} found no driver.`);
  });
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
