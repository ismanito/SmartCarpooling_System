// Pure functions: no database needed.
const { calculateLegFares, estimateShare } = require('../src/lib/fare');
const { etaMinutes, timeline, zonesCompatible, cheapestInsertion, scoreCandidate, rankCandidates } = require('../src/lib/dispatch');

const P = (lat, lng) => ({ lat, lng });
const campus = P(-1.2195, 36.8789);
const trm = P(-1.2196, 36.8886);
const roysambu = P(-1.2185, 36.8892);
const kasarani = P(-1.2216, 36.9046);
const westlands = P(-1.2676, 36.8108);

describe('calculateLegFares', () => {
  it('one rider alone with the driver pays half, and everything adds up', () => {
    const r = calculateLegFares([{ km: 10, riderIds: ['a'] }], 24, 10);
    expect(r).toEqual({ totalKes: 240, shares: { a: 120 }, driverShareKes: 120, commissionKes: 0 });
  });

  it('splits each leg between the people in the car on that leg', () => {
    // 6 km with A and B aboard (3 people), then 4 km with only B (2 people).
    const r = calculateLegFares([{ km: 6, riderIds: ['a', 'b'] }, { km: 4, riderIds: ['b'] }], 25, 1);
    expect(r.totalKes).toBe(250);
    expect(r.shares.a).toBe(50); // 150 / 3
    expect(r.shares.b).toBe(50 + 50); // 150 / 3 from the first leg, 100 / 2 from the second
    expect(r.driverShareKes).toBe(250 - 50 - 100);
  });

  it('shares always add up exactly to the total, whatever the rounding', () => {
    const legs = [{ km: 3.7, riderIds: ['a', 'b', 'c'] }, { km: 2.1, riderIds: ['b', 'c'] }, { km: 5.3, riderIds: ['c'] }];
    for (const rounding of [1, 5, 10, 50]) {
      const r = calculateLegFares(legs, 24, rounding);
      const sum = Object.values(r.shares).reduce((n, x) => n + x, 0) + r.driverShareKes;
      expect(sum).toBe(r.totalKes);
      expect(r.driverShareKes).toBeGreaterThanOrEqual(0);
      expect(r.commissionKes).toBe(0);
      for (const kes of Object.values(r.shares)) expect(kes % rounding).toBe(0);
    }
  });

  it('a rider who was in the car for less pays less', () => {
    const r = calculateLegFares([{ km: 8, riderIds: ['a', 'b'] }, { km: 8, riderIds: ['b'] }], 24, 10);
    expect(r.shares.a).toBeLessThan(r.shares.b);
  });

  it('rejects bad input', () => {
    expect(() => calculateLegFares([], 0, 10)).toThrow(RangeError);
    expect(() => calculateLegFares([{ km: -1, riderIds: [] }], 24, 10)).toThrow(RangeError);
  });
});

describe('estimateShare', () => {
  it('shows a lower share the more people are in the car', () => {
    const alone = estimateShare(14.8, 24, 10, 2);
    const pooled = estimateShare(14.8, 24, 10, 4);
    expect(alone).toBeGreaterThan(pooled);
    expect(estimateShare(14.8, 24, 10, 3)).toBe(120); // 360 split three ways
  });
});

describe('zones', () => {
  const neighbours = new Map([[1, new Set([2])], [2, new Set([1, 3])], [3, new Set([2])]]);
  it('same or neighbouring zones can share a car; others cannot', () => {
    expect(zonesCompatible([1, 1], 1, neighbours)).toBe(true);
    expect(zonesCompatible([1], 2, neighbours)).toBe(true);
    expect(zonesCompatible([1], 3, neighbours)).toBe(false);
    expect(zonesCompatible([], 3, neighbours)).toBe(true);
    expect(zonesCompatible([1, 3], 2, neighbours)).toBe(true);
  });
});

describe('eta and timeline', () => {
  it('is zero for the same point and grows with distance', () => {
    expect(etaMinutes(campus, campus)).toBe(0);
    expect(etaMinutes(campus, westlands)).toBeGreaterThan(etaMinutes(campus, trm));
    const t = timeline(campus, [{ point: trm }, { point: kasarani }]);
    expect(t[1]).toBeGreaterThan(t[0]);
  });
});

describe('cheapestInsertion', () => {
  const stops = [
    { stopId: 's1', requestId: 'r1', kind: 'dropoff', point: kasarani }, // r1 is already in the car, heading to Kasarani
  ];

  it('slots a new rider in so the pick-up comes before the drop-off', () => {
    const r = cheapestInsertion({ driverPoint: campus, stops, pickup: trm, dropoff: roysambu, requestId: 'r2', maxExtraMin: 20 });
    const kinds = r.stops.map((s) => `${s.requestId}:${s.kind}`);
    expect(kinds.indexOf('r2:pickup')).toBeLessThan(kinds.indexOf('r2:dropoff'));
    expect(kinds).toContain('r1:dropoff');
    expect(r.pickupEtaMin).toBeGreaterThan(0);
  });

  it('keeps a far-off pick-up behind the rider already in the car instead of delaying them', () => {
    // Collecting someone in Westlands first would send the car far off route for r1, so r1 is dropped off first.
    const r = cheapestInsertion({ driverPoint: campus, stops, pickup: westlands, dropoff: trm, requestId: 'r2', maxExtraMin: 5 });
    expect(r.stops[0]).toMatchObject({ requestId: 'r1', kind: 'dropoff' });
    expect(r.extraByRequest.get('r1')).toBe(0);
    expect(r.pickupEtaMin).toBeGreaterThan(30); // the price is paid by the new rider's wait, which the score sees
  });

  it('never exceeds the extra-minutes limit for any existing rider', () => {
    const two = [...stops, { stopId: 's2', requestId: 'r3', kind: 'dropoff', point: roysambu }];
    for (const max of [3, 8, 15]) {
      const r = cheapestInsertion({ driverPoint: campus, stops: two, pickup: trm, dropoff: kasarani, requestId: 'r4', maxExtraMin: max });
      if (r) for (const extra of r.extraByRequest.values()) expect(extra).toBeLessThanOrEqual(max);
    }
  });

  it('with an empty car the new rider is simply picked up then dropped', () => {
    const r = cheapestInsertion({ driverPoint: campus, stops: [], pickup: trm, dropoff: kasarani, requestId: 'r1', maxExtraMin: 8 });
    expect(r.stops.map((s) => s.kind)).toEqual(['pickup', 'dropoff']);
    expect(r.extraMinutes).toBe(0);
  });
});

describe('ranking drivers', () => {
  it('scores pick-up time plus half the delay to riders already aboard', () => {
    expect(scoreCandidate({ pickupEtaMin: 6, extraMinutes: 4 })).toBe(8);
    expect(scoreCandidate({ pickupEtaMin: 6 })).toBe(6);
  });

  it('puts the nearest first', () => {
    const ranked = rankCandidates([{ id: 'far', score: 14 }, { id: 'near', score: 3 }, { id: 'mid', score: 8 }]);
    expect(ranked.map((c) => c.id)).toEqual(['near', 'mid', 'far']);
  });

  it('on a near tie prefers pooling, then the better rated driver', () => {
    const ranked = rankCandidates([
      { id: 'empty', score: 5.2, pooled: false, rating: 5 },
      { id: 'pooled', score: 5.9, pooled: true, rating: 3 },
      { id: 'empty-low', score: 5.0, pooled: false, rating: 2 },
    ]);
    expect(ranked[0].id).toBe('pooled');
    expect(ranked[1].id).toBe('empty');
  });
});
