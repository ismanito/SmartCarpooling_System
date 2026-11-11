// Pure functions: no database needed.
const v = require('../src/lib/verification');
const files = require('../src/lib/files');
const { LocalStorage } = require('../src/services/storage');

const NOW = new Date('2026-11-12T10:00:00Z');
const base = (over = {}) => ({
  driver_type: 'student', status: 'approved', consent_at: NOW, licence_number: 'DL-1', licence_holder_name: 'Dan Mwangi', licence_expiry: '2028-01-01', licence_held_since: '2020-01-01',
  insurance_provider: 'Jubilee', insurance_policy_no: 'P-1', insurance_expiry: '2027-06-01', vehicle_id: 'v1', owner_relationship: 'self', ...over,
});

describe('status machine', () => {
  it('only allows the documented moves', () => {
    expect(v.canTransition('not_started', 'pending_review')).toBe(true);
    expect(v.canTransition('pending_review', 'approved')).toBe(true);
    expect(v.canTransition('pending_review', 'rejected')).toBe(true);
    expect(v.canTransition('rejected', 'pending_review')).toBe(true);
    expect(v.canTransition('approved', 'expired')).toBe(true);
    expect(v.canTransition('approved', 'suspended')).toBe(true);
    expect(v.canTransition('suspended', 'approved')).toBe(true);
    expect(v.canTransition('not_started', 'approved')).toBe(false); // nobody skips the review
    expect(v.canTransition('rejected', 'approved')).toBe(false);
    expect(v.canTransition('approved', 'rejected')).toBe(false);
  });
});

describe('what each driver type must provide', () => {
  it('students and staff need their university ID; external drivers need the extra papers', () => {
    expect(v.requiredDocs('student', 'self')).toContain('student_id');
    expect(v.requiredDocs('staff', 'self')).toContain('staff_id');
    expect(v.requiredDocs('student', 'self')).not.toContain('good_conduct');
    for (const d of ['national_id_front', 'national_id_back', 'good_conduct', 'psv_badge', 'inspection_report']) expect(v.requiredDocs('external', 'self')).toContain(d);
  });

  it('asks for the logbook when it is your car and a letter when it is not', () => {
    expect(v.requiredDocs('student', 'self')).toContain('logbook');
    expect(v.requiredDocs('student', 'parent')).toContain('owner_letter');
    expect(v.requiredDocs('student', 'parent')).not.toContain('logbook');
  });

  it('has a longer checklist for external drivers', () => {
    expect(v.checklistFor('external').length).toBeGreaterThan(v.checklistFor('student').length);
    expect(v.checklistFor('external')).toContain('in_person_check_done');
  });
});

describe('licence age and expiry', () => {
  it('counts only completed years', () => {
    expect(v.yearsBetween('2025-11-13', NOW)).toBe(0);
    expect(v.yearsBetween('2025-11-12', NOW)).toBe(1);
    expect(v.yearsBetween('2020-01-01', NOW)).toBe(6);
  });

  it('a date counts as expired from the day after it', () => {
    expect(v.isExpired('2026-11-11', NOW)).toBe(true);
    expect(v.isExpired('2026-11-12', NOW)).toBe(false);
    expect(v.expiredItems(base({ insurance_expiry: '2026-01-01' }), NOW)).toEqual(['insurance']);
    expect(v.expiredItems(base({ driver_type: 'external', psv_badge_expiry: '2026-01-01' }), NOW)).toEqual(['psv_badge']);
  });

  it('warns before things run out', () => {
    expect(v.expiringItems(base({ licence_expiry: '2026-11-20' }), NOW, 14)).toEqual([{ item: 'licence', date: '2026-11-20' }]);
    expect(v.expiringItems(base({ licence_expiry: '2026-12-30' }), NOW, 14)).toEqual([]);
  });

  it('a Certificate of Good Conduct must be under 6 months old', () => {
    expect(v.goodConductFresh('2026-08-01', NOW)).toBe(true);
    expect(v.goodConductFresh('2026-05-01', NOW)).toBe(false);
    expect(v.goodConductFresh(null, NOW)).toBe(false);
  });
});

describe('ready to submit?', () => {
  const docs = (types) => types.map((t) => ({ doc_type: t }));
  it('lists everything still missing, and blocks a licence held for too short a time', () => {
    const bare = v.missingForSubmit({ driver_type: 'student' }, [], { now: NOW });
    expect(bare.length).toBeGreaterThan(10);
    const young = v.missingForSubmit(base({ licence_held_since: '2026-06-01' }), docs(v.requiredDocs('student', 'self')), { now: NOW, minLicenceYears: 1 });
    expect(young).toEqual(['Your licence must have been held for at least 1 year']);
    expect(v.missingForSubmit(base(), docs(v.requiredDocs('student', 'self')), { now: NOW })).toEqual([]);
  });

  it('refuses expired papers and an old Certificate of Good Conduct', () => {
    const ext = base({ driver_type: 'external', national_id_last4: '1234', good_conduct_issued: '2026-01-01', psv_badge_no: 'B1', psv_badge_expiry: '2027-01-01', inspection_date: '2026-10-01', inspected_by: 'NTSA' });
    const all = docs(v.requiredDocs('external', 'self'));
    expect(v.missingForSubmit(ext, all, { now: NOW })).toEqual(['Your Certificate of Good Conduct must be less than 6 months old']);
    expect(v.missingForSubmit({ ...ext, good_conduct_issued: '2026-09-01', licence_expiry: '2026-01-01' }, all, { now: NOW })).toEqual(['Your licence has expired']);
  });
});

describe('who may drive right now', () => {
  it('only approved drivers with valid papers and a vehicle', () => {
    expect(v.driveEligibility(base(), { now: NOW }).ok).toBe(true);
    for (const status of ['not_started', 'pending_review', 'rejected', 'expired', 'suspended']) expect(v.driveEligibility(base({ status }), { now: NOW })).toEqual({ ok: false, reason: status });
    expect(v.driveEligibility(base({ licence_expiry: '2026-01-01' }), { now: NOW })).toEqual({ ok: false, reason: 'licence_expired' });
    expect(v.driveEligibility(base({ insurance_expiry: '2026-01-01' }), { now: NOW })).toEqual({ ok: false, reason: 'insurance_expired' });
    expect(v.driveEligibility(base({ vehicle_id: null }), { now: NOW })).toEqual({ ok: false, reason: 'no_vehicle' });
    expect(v.driveEligibility(null, { now: NOW }).ok).toBe(false);
  });

  it('external drivers also need their PSV badge and the external track switched on', () => {
    const ext = base({ driver_type: 'external', psv_badge_expiry: '2027-01-01' });
    expect(v.driveEligibility(ext, { now: NOW, externalEnabled: false })).toEqual({ ok: false, reason: 'external_disabled' });
    expect(v.driveEligibility(ext, { now: NOW, externalEnabled: true }).ok).toBe(true);
    expect(v.driveEligibility({ ...ext, psv_badge_expiry: '2026-01-01' }, { now: NOW, externalEnabled: true })).toEqual({ ok: false, reason: 'psv_badge_expired' });
  });
});

describe('reviewer flags and the checklist', () => {
  it('flags a name mismatch, expiry, a reused file and a taken plate', () => {
    const flags = v.reviewFlags(base({ licence_holder_name: 'Someone Else', insurance_expiry: '2026-11-20' }), { accountName: 'Dan Mwangi', hashReusedBy: ['Eve Other'], plateTakenBy: 'Eve Other' }, { now: NOW });
    expect(flags.map((f) => f.code)).toEqual(expect.arrayContaining(['name_mismatch', 'insurance_expiring', 'document_reused', 'plate_in_use']));
    expect(v.reviewFlags(base(), { accountName: 'Dan Mwangi' }, { now: NOW })).toEqual([]);
  });

  it('approval needs every checklist item to pass', () => {
    const all = Object.fromEntries(v.checklistFor('student').map((i) => [i, 'pass']));
    expect(v.checklistComplete('student', all).ok).toBe(true);
    expect(v.checklistComplete('student', { ...all, names_match: 'fail' })).toEqual({ ok: false, failed: ['names_match'] });
    expect(v.checklistComplete('external', all).ok).toBe(false);
  });
});

describe('files', () => {
  const jpegWithExif = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1, 0x00, 0x0a]),
    Buffer.from('Exif\0GPS!'), // an EXIF block holding "location"
    Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]), // JFIF header
    Buffer.from([0xff, 0xda, 0x00, 0x02]),
    Buffer.from('PIXELS'),
    Buffer.from([0xff, 0xd9]),
  ]);
  const png = (parts = []) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...parts]);
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'latin1');
    data.copy(b, 8);
    return b;
  };

  it('reads the real type from the first bytes, not the name', () => {
    expect(files.sniffType(jpegWithExif)).toBe('image/jpeg');
    expect(files.sniffType(png([chunk('IHDR', Buffer.alloc(13))]))).toBe('image/png');
    expect(files.sniffType(Buffer.from('%PDF-1.7 hello world'))).toBe('application/pdf');
    expect(files.sniffType(Buffer.from('MZ this is an executable'))).toBeNull();
    expect(files.sniffType(Buffer.from('<html>not an image</html>'))).toBeNull();
  });

  it('strips location data from photos', () => {
    const cleaned = files.stripMetadata(jpegWithExif, 'image/jpeg');
    expect(cleaned.includes(Buffer.from('GPS!'))).toBe(false);
    expect(cleaned.includes(Buffer.from('PIXELS'))).toBe(true);
    expect(cleaned.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    const p = png([chunk('IHDR', Buffer.alloc(13)), chunk('eXIf', Buffer.from('GPS!')), chunk('IDAT', Buffer.from('PIXELS')), chunk('IEND', Buffer.alloc(0))]);
    const cleanedPng = files.stripMetadata(p, 'image/png');
    expect(cleanedPng.includes(Buffer.from('GPS!'))).toBe(false);
    expect(cleanedPng.includes(Buffer.from('PIXELS'))).toBe(true);
  });

  it('hashes with SHA-256', () => {
    expect(files.sha256(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('signed links', () => {
  const store = new LocalStorage('unused');
  it('work for 5 minutes for the named viewer, and not after', () => {
    const t0 = 1_700_000_000_000;
    const { url } = store.signedUrl('doc1', 'admin1', t0);
    const q = Object.fromEntries(new URL(`http://x${url}`).searchParams);
    expect(store.verify('doc1', q, t0 + 4 * 60_000)).toBe(true);
    expect(store.verify('doc1', q, t0 + 5 * 60_000 + 2000)).toBe(false);
    expect(store.verify('doc2', q, t0)).toBe(false); // another file
    expect(store.verify('doc1', { ...q, who: 'admin2' }, t0)).toBe(false); // another viewer
    expect(store.verify('doc1', { ...q, sig: 'deadbeef' }, t0)).toBe(false);
    expect(store.verify('doc1', { exp: q.exp, who: q.who }, t0)).toBe(false); // unsigned
  });
});
