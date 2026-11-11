/**
 * Ride matching rules. Postgres/PostGIS does the coarse filtering (radius, time window, seats);
 * these pure functions decide the final fit and score so they can be unit-tested.
 */

const DEFAULT_SETTINGS = {
  searchRadiusKm: 2,
  timeWindowMin: 15,
  maxDetourKm: 3,
  wOverlap: 0.5,
  wTime: 0.3,
  wDetour: 0.2,
  fuelRateKesPerKm: 24,
  fareRoundingKes: 10,
};

const SETTING_KEYS = {
  search_radius_km: 'searchRadiusKm',
  time_window_min: 'timeWindowMin',
  max_detour_km: 'maxDetourKm',
  w_overlap: 'wOverlap',
  w_time: 'wTime',
  w_detour: 'wDetour',
  fuel_rate_kes_per_km: 'fuelRateKesPerKm',
  fare_rounding_kes: 'fareRoundingKes',
};

/** Turns system_settings rows into numeric matching settings, falling back to defaults. */
function settingsFromRows(rows) {
  const s = { ...DEFAULT_SETTINGS };
  for (const { setting_key: key, setting_value: value } of rows) {
    const field = SETTING_KEYS[key];
    const n = Number(value);
    if (field && Number.isFinite(n) && n >= 0) s[field] = n;
  }
  return s;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;

/**
 * Scores one offer/request pair.
 * @param {{ pickupKm: number, dropoffKm: number, timeDiffMin: number, riderKm: number, driverKm: number }} pair
 *   pickupKm/dropoffKm: straight-line distance between the two origins / two destinations
 *   riderKm/driverKm:   length of each trip
 * @returns {null | { score, overlap, timeFit, detourKm, detourFit }} null when the pair is not a match
 */
function scoreMatch(pair, settings = DEFAULT_SETTINGS) {
  const { pickupKm, dropoffKm, timeDiffMin, riderKm, driverKm } = pair;
  const s = settings;
  if (pickupKm > s.searchRadiusKm || dropoffKm > s.searchRadiusKm) return null;
  if (Math.abs(timeDiffMin) > s.timeWindowMin) return null;

  // The driver leaves their route to collect the rider and again to drop them off.
  const detourKm = pickupKm + dropoffKm;
  if (detourKm > s.maxDetourKm) return null;

  const overlap = riderKm > 0 && driverKm > 0 ? Math.min(riderKm, driverKm) / Math.max(riderKm, driverKm) : 0;
  const timeFit = s.timeWindowMin > 0 ? clamp01(1 - Math.abs(timeDiffMin) / s.timeWindowMin) : 1;
  const detourFit = s.maxDetourKm > 0 ? clamp01(1 - detourKm / s.maxDetourKm) : 1;

  const totalWeight = s.wOverlap + s.wTime + s.wDetour || 1;
  const score = clamp01((s.wOverlap * overlap + s.wTime * timeFit + s.wDetour * detourFit) / totalWeight);

  return {
    score: round(score, 3),
    overlap: round(overlap, 3),
    timeFit: round(timeFit, 3),
    detourKm: round(detourKm, 2),
    detourFit: round(detourFit, 3),
  };
}

/** Suggested fuel contribution per seat: the trip's fuel cost split between the driver and every seat. */
function costPerSeatKes(routeKm, seatsTotal, settings = DEFAULT_SETTINGS) {
  const step = settings.fareRoundingKes >= 1 ? settings.fareRoundingKes : 10;
  const raw = (routeKm * settings.fuelRateKesPerKm) / (seatsTotal + 1);
  return Math.max(step, Math.round(raw / step) * step);
}

module.exports = { DEFAULT_SETTINGS, settingsFromRows, scoreMatch, costPerSeatKes };
