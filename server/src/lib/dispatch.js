/**
 * Pure dispatch maths: no database, no clock. The services feed it positions and read back decisions,
 * so every rule can be unit-tested.
 *
 * Points are { lat, lng }. Times are minutes. A "stop" is { stopId, requestId, kind: 'pickup'|'dropoff', point }.
 */
const { haversineKm, ROAD_FACTOR } = require('./places');

const DEFAULT_SPEED_KMH = 25; // Nairobi traffic

/** Estimated drive time in minutes. The Google Distance Matrix replaces this for the top candidates when a key is set. */
function etaMinutes(a, b, speedKmh = DEFAULT_SPEED_KMH) {
  return ((haversineKm(a, b) * ROAD_FACTOR) / speedKmh) * 60;
}

/** Minutes from `start` until each stop, driving the stops in the given order. */
function timeline(start, stops, speedKmh = DEFAULT_SPEED_KMH) {
  const times = [];
  let t = 0;
  let at = start;
  for (const s of stops) {
    t += etaMinutes(at, s.point, speedKmh);
    times.push(t);
    at = s.point;
  }
  return times;
}

/** True when every rider already in the car is going to the new rider's zone or one next to it. */
function zonesCompatible(existingDropoffZones, newDropoffZone, neighbours) {
  if (newDropoffZone == null) return existingDropoffZones.length === 0;
  return existingDropoffZones.every((z) => z === newDropoffZone || (neighbours.get(z)?.has(newDropoffZone) ?? false));
}

/**
 * Tries every place to slip a new pick-up and drop-off into the driver's remaining stops and keeps the cheapest
 * (shortest finish time) that does not make any rider already in the car arrive more than `maxExtraMin` later.
 *
 * @returns {null | { stops, pickupEtaMin, dropoffEtaMin, extraMinutes, maxExtraMinutes, extraByRequest }}
 */
function cheapestInsertion({ driverPoint, stops, pickup, dropoff, requestId, maxExtraMin, speedKmh = DEFAULT_SPEED_KMH }) {
  const baseTimes = timeline(driverPoint, stops, speedKmh);
  const baseDrop = new Map();
  stops.forEach((s, i) => {
    if (s.kind === 'dropoff') baseDrop.set(s.requestId, baseTimes[i]);
  });

  const newPickup = { stopId: `new-pickup-${requestId}`, requestId, kind: 'pickup', point: pickup };
  const newDropoff = { stopId: `new-dropoff-${requestId}`, requestId, kind: 'dropoff', point: dropoff };

  let best = null;
  for (let i = 0; i <= stops.length; i += 1) {
    for (let j = i; j <= stops.length; j += 1) {
      const seq = [...stops.slice(0, i), newPickup, ...stops.slice(i, j), newDropoff, ...stops.slice(j)];
      const times = timeline(driverPoint, seq, speedKmh);

      const extraByRequest = new Map();
      let feasible = true;
      let extraTotal = 0;
      let extraMax = 0;
      seq.forEach((s, k) => {
        if (s.kind !== 'dropoff' || s.requestId === requestId) return;
        const extra = Math.max(0, times[k] - baseDrop.get(s.requestId));
        extraByRequest.set(s.requestId, extra);
        extraTotal += extra;
        extraMax = Math.max(extraMax, extra);
        if (extra > maxExtraMin) feasible = false;
      });
      if (!feasible) continue;

      const pickupIdx = seq.indexOf(newPickup);
      const finish = times[times.length - 1];
      const candidate = {
        stops: seq,
        pickupEtaMin: times[pickupIdx],
        dropoffEtaMin: times[seq.indexOf(newDropoff)],
        extraMinutes: extraTotal,
        maxExtraMinutes: extraMax,
        extraByRequest,
        finish,
      };
      if (!best || finish < best.finish - 1e-9 || (Math.abs(finish - best.finish) < 1e-9 && candidate.pickupEtaMin < best.pickupEtaMin)) best = candidate;
    }
  }
  if (!best) return null;
  const { finish, ...result } = best; // eslint-disable-line no-unused-vars
  return result;
}

/** Lower is better: minutes until pick-up, plus half the delay caused to people already in the car. */
function scoreCandidate({ pickupEtaMin, extraMinutes = 0 }) {
  return pickupEtaMin + 0.5 * extraMinutes;
}

/**
 * Orders candidates best first. Scores within a couple of minutes count as close, and then a driver who is
 * already carrying riders to the same zone comes first (more pooling), then the better rated driver.
 */
function rankCandidates(candidates, { tieMinutes = 2 } = {}) {
  return [...candidates].sort((a, b) => {
    const bucketA = Math.floor(a.score / tieMinutes);
    const bucketB = Math.floor(b.score / tieMinutes);
    if (bucketA !== bucketB) return bucketA - bucketB;
    if (Boolean(a.pooled) !== Boolean(b.pooled)) return a.pooled ? -1 : 1;
    if ((b.rating ?? 0) !== (a.rating ?? 0)) return (b.rating ?? 0) - (a.rating ?? 0);
    return a.score - b.score;
  });
}

module.exports = { DEFAULT_SPEED_KMH, etaMinutes, timeline, zonesCompatible, cheapestInsertion, scoreCandidate, rankCandidates };
