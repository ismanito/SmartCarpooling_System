/**
 * Splits a finished trip's fuel cost between everyone in the car, driver included.
 * Whole shillings only, so the shares always add up exactly; the driver takes any leftover.
 * RideMate takes no commission.
 *
 * @param {number} distanceKm  route length
 * @param {number} fuelRate    KES per km
 * @param {number} rounding    round the total to the nearest this many KES (1 = no rounding)
 * @param {number} occupants   people in the car, driver included
 * @returns {{ totalKes: number, shares: number[], commissionKes: 0 }} shares[0] is the driver's
 */
function calculateFareSplit(distanceKm, fuelRate, rounding, occupants) {
  if (!(distanceKm > 0) || !(fuelRate > 0)) throw new RangeError('distanceKm and fuelRate must be positive');
  if (!Number.isInteger(occupants) || occupants < 1) throw new RangeError('occupants must be a whole number of at least 1');
  const step = rounding >= 1 ? rounding : 1;
  const totalKes = Math.max(step, Math.round((distanceKm * fuelRate) / step) * step);
  const base = Math.floor(totalKes / occupants);
  const shares = Array(occupants).fill(base);
  shares[0] += totalKes - base * occupants;
  return { totalKes, shares, commissionKes: 0 };
}

/**
 * Cost sharing by leg. Each stretch of road between two stops costs `km x fuelRate`, and is split equally between
 * the riders in the car on that stretch plus the driver (who counts as one person). Each rider's total is rounded
 * to the nearest `rounding` KES, and the driver keeps whatever is left, so everything adds up exactly. No commission.
 *
 * @param {{ km: number, riderIds: string[] }[]} legs
 * @returns {{ totalKes: number, shares: Record<string, number>, driverShareKes: number, commissionKes: 0 }}
 */
function calculateLegFares(legs, fuelRate, rounding) {
  if (!(fuelRate > 0)) throw new RangeError('fuelRate must be positive');
  const step = rounding >= 1 ? rounding : 1;
  let totalCost = 0;
  const owed = new Map(); // fractional KES per rider
  for (const { km, riderIds } of legs) {
    if (!(km >= 0)) throw new RangeError('leg km must not be negative');
    const cost = km * fuelRate;
    totalCost += cost;
    const people = riderIds.length + 1; // the driver counts as one
    for (const id of riderIds) owed.set(id, (owed.get(id) || 0) + cost / people);
  }
  const totalKes = Math.round(totalCost);
  const shares = {};
  let sum = 0;
  for (const [id, kes] of owed) {
    shares[id] = Math.round(kes / step) * step;
    sum += shares[id];
  }
  // Rounding up could push the riders past the total. Take the excess back from the biggest shares.
  while (sum > totalKes) {
    const biggest = Object.keys(shares).reduce((a, b) => (shares[b] > shares[a] ? b : a));
    const cut = Math.min(step, shares[biggest]);
    if (cut === 0) break;
    shares[biggest] -= cut;
    sum -= cut;
  }
  return { totalKes, shares, driverShareKes: totalKes - sum, commissionKes: 0 };
}

/** What one rider would pay for a whole trip with `occupants` people in the car (driver included), whole shillings. */
function estimateShare(distanceKm, fuelRate, rounding, occupants) {
  return calculateFareSplit(distanceKm, fuelRate, rounding, occupants).shares[1];
}

module.exports = { calculateFareSplit, calculateLegFares, estimateShare };
