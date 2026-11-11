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

module.exports = { calculateFareSplit };
