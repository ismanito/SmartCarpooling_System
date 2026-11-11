/**
 * Fare splitting. Amounts are whole Kenyan shillings so shares always add up exactly:
 * the booker takes any leftover shilling(s) after an even split.
 */
const MAX_PAYERS = 6;

/**
 * @param {number} totalKes whole shillings
 * @param {number} people   number of payers, including the booker
 * @returns {number[]} one amount per payer; index 0 is the booker (who carries the remainder)
 */
function splitEvenly(totalKes, people) {
  if (!Number.isInteger(totalKes) || totalKes < 1) throw new RangeError('totalKes must be a positive whole number');
  if (!Number.isInteger(people) || people < 1 || people > MAX_PAYERS) throw new RangeError(`people must be 1 to ${MAX_PAYERS}`);
  if (totalKes < people) throw new RangeError('The fare is too small to split that many ways');
  const base = Math.floor(totalKes / people);
  const shares = Array(people).fill(base);
  shares[0] += totalKes - base * people;
  return shares;
}

module.exports = { MAX_PAYERS, splitEvenly };
