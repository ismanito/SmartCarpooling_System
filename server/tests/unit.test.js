// Pure functions – no database needed.
const { canonicalJson } = require('../src/lib/canonicalJson');
const { emailDomain, isAllowedEmail } = require('../src/lib/emailDomain');
const { parseDomains } = require('../src/config/env');
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
