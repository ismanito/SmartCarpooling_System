const { calculateLegFares, estimateShare } = require('../src/lib/fare');

describe('minimum share', () => {
  it('a very short trip costs at least the minimum, and the driver then keeps nothing extra', () => {
    const f = calculateLegFares([{ km: 1, riderIds: ['a'] }], 24, 10, 30);
    expect(f.shares.a).toBe(30);
    expect(f.totalKes).toBe(30);
    expect(f.driverShareKes).toBe(0);
  });

  it('does not change a trip that already costs more than the minimum', () => {
    const plain = calculateLegFares([{ km: 9, riderIds: ['a'] }], 24, 10, 0);
    const withMin = calculateLegFares([{ km: 9, riderIds: ['a'] }], 24, 10, 30);
    expect(withMin).toEqual(plain);
    expect(plain.shares.a).toBe(110); // 9 km x 24 = 216, split with the driver
  });

  it('applies to each rider of a pooled trip on their own', () => {
    const f = calculateLegFares([{ km: 1, riderIds: ['a', 'b'] }, { km: 6, riderIds: ['b'] }], 24, 10, 30);
    expect(f.shares.a).toBe(30); // 1 km shared three ways is 8 KES, lifted to the minimum
    expect(f.shares.b).toBeGreaterThan(30);
    expect(f.totalKes).toBe(f.driverShareKes + f.shares.a + f.shares.b);
  });

  it('shows the same minimum in the estimate', () => {
    expect(estimateShare(1.2, 24, 10, 2, 30)).toBe(30);
    expect(estimateShare(1.2, 24, 10, 2)).toBeLessThan(30);
    expect(estimateShare(9, 24, 10, 2, 30)).toBe(110);
  });
});
