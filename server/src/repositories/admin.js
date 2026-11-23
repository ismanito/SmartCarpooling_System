const { pool } = require('../db/pool');

async function stats(db = pool) {
  const { rows } = await db.query(`
    SELECT (SELECT count(*)::int FROM users) AS users,
           (SELECT count(*)::int FROM users WHERE role = 'student') AS students,
           (SELECT count(*)::int FROM users WHERE status = 'suspended') AS suspended,
           (SELECT count(*)::int FROM vehicles) AS vehicles,
           (SELECT count(*)::int FROM ride_offers WHERE status = 'open' AND depart_at > now()) AS open_offers,
           (SELECT count(*)::int FROM ride_requests WHERE status = 'open' AND depart_at > now()) AS open_requests,
           (SELECT count(*)::int FROM bookings WHERE status = 'accepted') AS confirmed_bookings,
           (SELECT count(*)::int FROM ride_offers WHERE status = 'completed') AS completed_trips`);
  const r = rows[0];
  return {
    users: r.users,
    students: r.students,
    suspended: r.suspended,
    vehicles: r.vehicles,
    openOffers: r.open_offers,
    openRequests: r.open_requests,
    confirmedBookings: r.confirmed_bookings,
    completedTrips: r.completed_trips,
  };
}

const RANGE = `($1::timestamptz IS NULL OR o.depart_at >= $1) AND ($2::timestamptz IS NULL OR o.depart_at < $2)`;

/** Dashboard figures for the console. from/to (ISO dates) limit the trip-based figures. */
async function dashboard({ from = null, to = null, fuelRate = 24 } = {}, db = pool) {
  const range = [from, to];
  const [completed, savings, routes, weekly, people, ratings, activity] = await Promise.all([
    db.query(`SELECT count(*)::int AS n FROM ride_offers o WHERE o.status = 'completed' AND ${RANGE}`, range),
    db.query(
      `SELECT COALESCE(sum(GREATEST(0, o.route_km * $3 - p.amount_kes)), 0)::int AS kes
         FROM payments p JOIN bookings b ON b.booking_id = p.booking_id JOIN ride_offers o ON o.offer_id = b.offer_id
        WHERE o.status = 'completed' AND p.status <> 'cancelled' AND ${RANGE}`,
      [...range, fuelRate],
    ),
    db.query(
      `SELECT o.origin_name, o.destination_name, count(*)::int AS trips
         FROM ride_offers o WHERE o.status <> 'cancelled' AND ${RANGE}
        GROUP BY 1, 2 ORDER BY trips DESC, 1, 2 LIMIT 5`,
      range,
    ),
    db.query(
      `SELECT date_trunc('week', o.depart_at) AS week, count(*)::int AS rides
         FROM ride_offers o WHERE o.status = 'completed' AND o.depart_at > now() - interval '8 weeks'
        GROUP BY 1 ORDER BY 1`,
    ),
    db.query(`SELECT count(*) FILTER (WHERE role = 'student' AND is_verified)::int AS verified FROM users`),
    db.query(`SELECT COALESCE(round(avg(stars), 2), 0)::float AS avg FROM ratings`),
    db.query(
      `SELECT (SELECT count(*)::int FROM ride_offers WHERE status = 'open' AND depart_at > now()) AS active_trips,
              (SELECT count(*)::int FROM ride_requests q WHERE ($1::timestamptz IS NULL OR q.created_at >= $1) AND ($2::timestamptz IS NULL OR q.created_at < $2)) AS requests,
              (SELECT count(*)::int FROM bookings b WHERE ($1::timestamptz IS NULL OR b.created_at >= $1) AND ($2::timestamptz IS NULL OR b.created_at < $2)) AS matches,
              (SELECT count(*)::int FROM incident_reports WHERE status <> 'closed') AS open_incidents,
              (SELECT count(*)::int FROM driver_verifications WHERE status = 'pending_review' OR recheck_state = 'submitted') AS pending_drivers,
              (SELECT count(*)::int FROM driver_verifications WHERE status = 'approved') AS approved_drivers`,
      range,
    ),
  ]);
  return {
    verifiedStudents: people.rows[0].verified,
    activeTrips: activity.rows[0].active_trips,
    matches: activity.rows[0].matches,
    requests: activity.rows[0].requests,
    completedRides: completed.rows[0].n,
    avgRating: ratings.rows[0].avg,
    estimatedSavingsKes: savings.rows[0].kes,
    openIncidents: activity.rows[0].open_incidents,
    pendingDrivers: activity.rows[0].pending_drivers,
    approvedDrivers: activity.rows[0].approved_drivers,
    topRoutes: routes.rows.map((x) => ({ origin: x.origin_name, destination: x.destination_name, trips: x.trips })),
    ridesPerWeek: weekly.rows.map((x) => ({ week: x.week, rides: x.rides })),
  };
}

async function listUsers(search, db = pool, { status = null, role = null } = {}) {
  const { rows } = await db.query(
    `SELECT user_id, full_name, university_email, faculty, role, person_type, status, avg_rating, created_at
       FROM users
      WHERE ($1 = '' OR full_name ILIKE '%' || $1 || '%' OR university_email ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR status = $2) AND ($3::text IS NULL OR role = $3)
      ORDER BY created_at DESC LIMIT 200`,
    [search, status, role],
  );
  return rows.map((u) => ({
    userId: u.user_id,
    fullName: u.full_name,
    universityEmail: u.university_email,
    faculty: u.faculty,
    role: u.role,
    personType: u.person_type,
    status: u.status,
    avgRating: u.avg_rating,
    createdAt: u.created_at,
  }));
}

async function setUserStatus(db, userId, status) {
  const { rows } = await db.query(
    'UPDATE users SET status = $2 WHERE user_id = $1 RETURNING user_id, university_email, role, status',
    [userId, status],
  );
  return rows[0] || null;
}

async function listAudit({ limit, before, userId = null, action = null, from = null, to = null }, db = pool) {
  const { rows } = await db.query(
    `SELECT audit_id, user_id, action, entity, entity_id, details, created_at, entry_hash
       FROM audit_log
      WHERE ($2::bigint IS NULL OR audit_id < $2)
        AND ($3::uuid IS NULL OR user_id = $3)
        AND ($4::text IS NULL OR action ILIKE $4 || '%')
        AND ($5::timestamptz IS NULL OR created_at >= $5)
        AND ($6::timestamptz IS NULL OR created_at < $6)
      ORDER BY audit_id DESC LIMIT $1`,
    [limit, before ?? null, userId, action, from, to],
  );
  return rows.map((a) => ({
    auditId: Number(a.audit_id),
    userId: a.user_id,
    action: a.action,
    entity: a.entity,
    entityId: a.entity_id,
    details: a.details,
    createdAt: a.created_at,
    entryHash: a.entry_hash,
  }));
}

const MATCH_SETTINGS = {
  search_radius_km: { min: 0.5, max: 20 },
  time_window_min: { min: 5, max: 120 },
  max_detour_km: { min: 0.5, max: 30 },
  w_overlap: { min: 0, max: 1 },
  w_time: { min: 0, max: 1 },
  w_detour: { min: 0, max: 1 },
  fuel_rate_kes_per_km: { min: 1, max: 200 },
  fare_rounding_kes: { min: 1, max: 100 },
};

async function listSettings(db = pool) {
  const { rows } = await db.query('SELECT setting_key, setting_value FROM system_settings WHERE setting_key = ANY($1)', [
    Object.keys(MATCH_SETTINGS),
  ]);
  return Object.fromEntries(rows.map((r) => [r.setting_key, Number(r.setting_value)]));
}

async function saveSetting(db, key, value, userId) {
  await db.query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, String(value), userId],
  );
}

/** The console's front page: Ride Now figures, plus a 30-day series and how requests ended. */
async function overview(db = pool) {
  const { rows } = await db.query(`
    SELECT (SELECT count(*)::int FROM users WHERE role = 'student' AND is_verified) AS verified_students,
           (SELECT count(*)::int FROM driver_verifications WHERE status = 'approved') AS approved_drivers,
           (SELECT count(*)::int FROM driver_status WHERE is_online AND last_seen_at > now() - interval '2 minutes') AS online_now,
           (SELECT count(*)::int FROM driver_verifications WHERE status = 'pending_review' OR recheck_state = 'submitted') AS pending_verifications,
           (SELECT count(*)::int FROM incident_reports WHERE status <> 'closed') AS open_incidents,
           (SELECT count(*)::int FROM rides WHERE status NOT IN ('completed', 'cancelled')) AS active_rides,
           (SELECT count(*)::int FROM rides WHERE status = 'completed') AS rides_completed,
           (SELECT count(*)::int FROM rides r WHERE r.status = 'completed' AND (SELECT count(*) FROM ride_shares s WHERE s.ride_id = r.ride_id) > 1) AS pooled,
           (SELECT COALESCE(sum(s.amount_kes), 0)::int FROM ride_shares s JOIN rides r ON r.ride_id = s.ride_id WHERE r.status = 'completed') AS shared_kes,
           (SELECT COALESCE(sum(s.amount_kes) FILTER (WHERE s.status = 'paid'), 0)::int FROM ride_shares s JOIN rides r ON r.ride_id = s.ride_id WHERE r.status = 'completed') AS paid_kes,
           (SELECT COALESCE(round(avg(stars), 2), 0)::float FROM ratings) AS avg_rating`);
  const { rows: daily } = await db.query(`
    SELECT to_char(d, 'YYYY-MM-DD') AS day,
           (SELECT count(*)::int FROM rides r WHERE r.status = 'completed' AND r.completed_at::date = d::date) AS rides,
           (SELECT COALESCE(sum(s.amount_kes), 0)::int FROM ride_shares s JOIN rides r ON r.ride_id = s.ride_id WHERE r.status = 'completed' AND r.completed_at::date = d::date) AS shared_kes,
           (SELECT count(*)::int FROM trip_requests q WHERE q.created_at::date = d::date) AS requests,
           (SELECT count(*)::int FROM rides r WHERE r.status = 'completed' AND r.completed_at::date = d::date AND (SELECT count(*) FROM ride_shares s WHERE s.ride_id = r.ride_id) > 1) AS pooled
      FROM generate_series(current_date - 29, current_date, interval '1 day') d
     ORDER BY d`);
  const { rows: outcomes } = await db.query(`
    SELECT count(*) FILTER (WHERE status = 'completed')::int AS completed,
           count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
           count(*) FILTER (WHERE status = 'no_driver')::int AS no_driver
      FROM trip_requests WHERE created_at > now() - interval '30 days'`);
  const { rows: places } = await db.query(`
    SELECT dropoff_label AS place, count(*)::int AS trips FROM trip_requests WHERE status = 'completed'
     GROUP BY 1 ORDER BY trips DESC, 1 LIMIT 5`);
  const r = rows[0];
  return {
    verifiedStudents: r.verified_students,
    approvedDrivers: r.approved_drivers,
    onlineNow: r.online_now,
    pendingVerifications: r.pending_verifications,
    openIncidents: r.open_incidents,
    activeRides: r.active_rides,
    ridesCompleted: r.rides_completed,
    pooledRides: r.pooled,
    sharedKes: r.shared_kes,
    paidKes: r.paid_kes,
    avgRating: r.avg_rating,
    daily: daily.map((x) => ({ day: x.day, rides: x.rides, sharedKes: x.shared_kes, requests: x.requests, pooled: x.pooled })),
    outcomes: outcomes[0],
    topPlaces: places,
  };
}

module.exports = { overview, dashboard, stats, listUsers, setUserStatus, listAudit, listSettings, saveSetting, MATCH_SETTINGS };
