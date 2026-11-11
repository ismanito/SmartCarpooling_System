// Pure functions – no database needed.
const { canonicalJson } = require('../src/lib/canonicalJson');
const { emailDomain, isAllowedEmail, isAdminEmail, canUseApp } = require('../src/lib/emailDomain');
const { splitEvenly } = require('../src/lib/payments');
const { calculateFareSplit } = require('../src/lib/fare');
const { parseDomains, parseEmails } = require('../src/config/env');
const { kenyanPhone } = require('../src/schemas/user');
const { computeEntryHash, GENESIS_HASH } = require('../src/services/audit');

describe('canonicalJson', () => {
  it('sorts keys recursively and ignores insertion order', () => {
    const a = canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } });
    const b = canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
  });

  it('serialises dates as ISO strings and drops undefined members', () => {
    expect(canonicalJson({ t: new Date('2026-01-02T03:04:05.006Z'), u: undefined })).toBe('{"t":"2026-01-02T03:04:05.006Z"}');
  });
});

describe('email domain rules', () => {
  const allowed = ['usiu.ac.ke'];

  it.each([
    ['jane@usiu.ac.ke', true],
    ['Jane.Doe@USIU.AC.KE', true],
    ['jane@gmail.com', false],
    ['jane@mail.usiu.ac.ke', false],
    ['jane@usiu.ac.ke.evil.com', false],
    ['usiu.ac.ke', false],
    ['jane@', false],
  ])('%s → %s', (email, expected) => {
    expect(isAllowedEmail(email, allowed)).toBe(expected);
  });

  it('parses the comma-separated env var', () => {
    expect(parseDomains(' usiu.ac.ke, @Example.ORG ,,')).toEqual(['usiu.ac.ke', 'example.org']);
    expect(emailDomain('a@b.c')).toBe('b.c');
  });
});

describe('Kenyan phone normalisation', () => {
  it.each([
    ['0712 345 678', '+254712345678'],
    ['254712345678', '+254712345678'],
    ['+254-110-345678', '+254110345678'],
  ])('%s → %s', (input, output) => {
    expect(kenyanPhone.parse(input)).toBe(output);
  });

  it('rejects non-Kenyan numbers', () => {
    expect(kenyanPhone.safeParse('+14155550100').success).toBe(false);
    expect(kenyanPhone.safeParse('0812345678').success).toBe(false);
  });
});

describe('audit entry hash', () => {
  const entry = {
    user_id: null,
    action: 'auth.sign_in',
    entity: 'user',
    entity_id: 'x',
    ip_address: '127.0.0.1',
    details: { a: 1 },
    created_at: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('is deterministic and depends on the previous hash and every field', () => {
    const h = computeEntryHash(GENESIS_HASH, entry);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeEntryHash(GENESIS_HASH, { ...entry })).toBe(h);
    expect(computeEntryHash('f'.repeat(64), entry)).not.toBe(h);
    expect(computeEntryHash(GENESIS_HASH, { ...entry, details: { a: 2 } })).not.toBe(h);
    expect(computeEntryHash(GENESIS_HASH, { ...entry, created_at: new Date('2026-01-01T00:00:00.001Z') })).not.toBe(h);
  });
});

describe('ride matching', () => {
  const { scoreMatch, costPerSeatKes, settingsFromRows, DEFAULT_SETTINGS } = require('../src/lib/matching');
  const { routeKm, findPlace, haversineKm } = require('../src/lib/places');
  const perfect = { pickupKm: 0, dropoffKm: 0, timeDiffMin: 0, riderKm: 10, driverKm: 10 };

  it('scores an identical trip at the same time as 1', () => {
    expect(scoreMatch(perfect)).toMatchObject({ score: 1, overlap: 1, timeFit: 1, detourKm: 0 });
  });

  it.each([
    ['pick-up too far', { pickupKm: 2.5 }],
    ['drop-off too far', { dropoffKm: 2.1 }],
    ['too early', { timeDiffMin: -16 }],
    ['too late', { timeDiffMin: 20 }],
    ['detour too long', { pickupKm: 1.8, dropoffKm: 1.8 }],
  ])('rejects a pair when %s', (_, change) => {
    expect(scoreMatch({ ...perfect, ...change })).toBeNull();
  });

  it('ranks closer, better-timed trips higher', () => {
    const near = scoreMatch({ ...perfect, pickupKm: 0.2, timeDiffMin: 2 });
    const far = scoreMatch({ ...perfect, pickupKm: 1.5, timeDiffMin: 12 });
    expect(near.score).toBeGreaterThan(far.score);
    expect(far.score).toBeGreaterThan(0);
  });

  it('uses the weights from system_settings and ignores bad values', () => {
    const s = settingsFromRows([
      { setting_key: 'w_overlap', setting_value: '0' },
      { setting_key: 'w_time', setting_value: '1' },
      { setting_key: 'w_detour', setting_value: '0' },
      { setting_key: 'search_radius_km', setting_value: 'oops' },
    ]);
    expect(s.searchRadiusKm).toBe(DEFAULT_SETTINGS.searchRadiusKm);
    expect(scoreMatch({ ...perfect, riderKm: 1 }, s).score).toBe(1);
  });

  it('splits fuel cost between the driver and every seat, rounded to 10 KES', () => {
    expect(costPerSeatKes(10, 3)).toBe(60); // 10 km * 24 KES / 4 people
    expect(costPerSeatKes(0.1, 7)).toBe(10);
  });

  it('estimates road distance from the place list', () => {
    const usiu = findPlace('usiu');
    const cbd = findPlace('cbd');
    expect(haversineKm(usiu, cbd)).toBeGreaterThan(8);
    expect(routeKm(usiu, cbd)).toBeCloseTo(haversineKm(usiu, cbd) * 1.3, 1);
    expect(findPlace('nowhere')).toBeNull();
  });
});

describe('admin emails', () => {
  it('parses a comma-separated list of exact addresses', () => {
    expect(parseEmails(' Boss@Gmail.com, , nope, ops@x.org ')).toEqual(['boss@gmail.com', 'ops@x.org']);
    expect(parseEmails('')).toEqual([]);
  });

  it('lets a listed real email in without opening up its whole domain', () => {
    const admins = ['boss@gmail.com'];
    expect(isAdminEmail('Boss@gmail.com', admins)).toBe(true);
    expect(isAdminEmail('other@gmail.com', admins)).toBe(false);
    expect(canUseApp('boss@gmail.com', ['usiu.ac.ke'], admins)).toBe(true);
    expect(canUseApp('other@gmail.com', ['usiu.ac.ke'], admins)).toBe(false);
    expect(canUseApp('kim@usiu.ac.ke', ['usiu.ac.ke'], admins)).toBe(true);
  });
});

describe('splitEvenly', () => {
  it('always adds up to the fare, with the leftover on the booker', () => {
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
    expect(splitEvenly(120, 4)).toEqual([30, 30, 30, 30]);
    expect(splitEvenly(70, 1)).toEqual([70]);
    for (const [total, n] of [[10, 6], [999, 5], [61, 2]]) {
      expect(splitEvenly(total, n).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('rejects impossible splits', () => {
    expect(() => splitEvenly(5, 6)).toThrow(RangeError);
    expect(() => splitEvenly(100, 7)).toThrow(RangeError);
    expect(() => splitEvenly(0, 1)).toThrow(RangeError);
    expect(() => splitEvenly(10.5, 2)).toThrow(RangeError);
  });
});

describe('calculateFareSplit', () => {
  it('14.8 km at KES 24 with 3 people is 360 total, 120 each, no commission', () => {
    expect(calculateFareSplit(14.8, 24, 10, 3)).toEqual({ totalKes: 360, shares: [120, 120, 120], commissionKes: 0 });
  });

  it('always adds up to the total, with the leftover on the driver', () => {
    for (const [km, rate, rounding, n] of [[10, 24, 10, 4], [7.3, 31, 5, 3], [22.2, 24, 1, 6], [3, 24, 10, 2]]) {
      const r = calculateFareSplit(km, rate, rounding, n);
      expect(r.shares.reduce((a, b) => a + b, 0)).toBe(r.totalKes);
      expect(r.shares[0]).toBeGreaterThanOrEqual(r.shares[1] ?? 0);
      expect(r.totalKes % rounding).toBe(0);
    }
    expect(calculateFareSplit(10, 24, 10, 4).shares).toEqual([60, 60, 60, 60]);
    expect(calculateFareSplit(10.1, 24, 1, 4).shares).toEqual([62, 60, 60, 60]);
  });

  it('rejects bad input', () => {
    expect(() => calculateFareSplit(0, 24, 10, 2)).toThrow(RangeError);
    expect(() => calculateFareSplit(10, 24, 10, 0)).toThrow(RangeError);
  });
});
