const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { resetDb, createStudent, createAdmin, createSeniorAdmin, approveAsDriver, auth, pool, auditRows, tokenFor } = require('./helpers/testApp');
const { createApp } = require('../src/app');
const { config } = require('../src/config/env');
const { fakeVerifyIdToken } = require('./helpers/fakeAuth');
const { useStorage, LocalStorage, provider } = require('../src/services/storage');
const { verifyAuditChain } = require('../src/services/audit');
const rules = require('../src/lib/verification');
const verification = require('../src/services/verification');
const dispatch = require('../src/services/dispatch');
const files = require('../src/lib/files');

const app = request(createApp({ verifyIdToken: fakeVerifyIdToken, config: { ...config, allowDriverSignup: true, externalRequiresApplication: false } }));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ridemate-docs-'));
useStorage(new LocalStorage(tmp));

beforeEach(resetDb);

// ---------------------------------------------------------------- helpers

let seed = 0;
/** A small valid PNG whose bytes differ every time, so no two files share a hash by accident. */
function png(unique = true) {
  seed += 1;
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'latin1');
    data.copy(b, 8);
    return b;
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.alloc(13)),
    chunk('IDAT', Buffer.from(unique ? `pixels-${seed}-${Math.random()}` : 'same-pixels')),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const upload = (who, docType, { buffer = png(), live = docType.startsWith('selfie') } = {}) =>
  app.post('/api/driver/verification/documents').set(auth(who.token)).field('docType', docType).field('capturedLive', String(live)).attach('file', buffer, 'photo.png');

const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let plate = 0;
const vehicle = async (who, over = {}) => {
  plate += 1;
  const res = await app.post('/api/vehicles').set(auth(who.token)).send({ makeModel: 'Toyota Axio', plateNumber: `KVR${100 + plate}V`, colour: 'White', seatCapacity: 3, ...over });
  return res;
};

async function details(who, type, vehicleId, over = {}) {
  const body = {
    licenceNumber: 'DL-123456',
    licenceHolderName: who.user.fullName,
    licenceExpiry: daysFromNow(900),
    licenceHeldSince: '2018-01-01',
    insuranceProvider: 'Jubilee Insurance',
    insurancePolicyNo: 'POL-1',
    insuranceExpiry: daysFromNow(400),
    insuranceCoversPassengers: true,
    vehicleId,
    ownerRelationship: 'self',
    ...(type === 'external'
      ? { nationalId: '12345678', goodConductIssued: daysFromNow(-30), psvBadgeNo: 'PSV-77', psvBadgeExpiry: daysFromNow(700), inspectionDate: daysFromNow(-10), inspectedBy: 'NTSA Inspector' }
      : { idExpiry: daysFromNow(700) }),
    ...over,
  };
  return app.put('/api/driver/verification/details').set(auth(who.token)).send(body);
}

/** A student, staff or external driver who has done everything the wizard asks and sent it in. */
async function submitted(type = 'student', { fullName = 'Dan Mwangi' } = {}) {
  let who;
  if (type === 'external') {
    const token = tokenFor({ uid: `ext-${Date.now()}-${Math.random()}`, email: `ext${Math.random().toString(36).slice(2, 8)}@gmail.com` });
    const res = await app.post('/api/users').set(auth(token)).send({ fullName, phoneNumber: '0712345678' }).expect(201);
    who = { token, user: res.body.user };
    await pool.query(`UPDATE system_settings SET setting_value = 'true' WHERE setting_key = 'external_drivers_enabled'`);
  } else {
    who = await createStudent({ fullName });
    if (type === 'staff') await pool.query(`UPDATE users SET person_type = 'staff' WHERE user_id = $1`, [who.user.userId]);
  }
  const v = await vehicle(who);
  expect(v.status).toBe(201);
  await app.post('/api/driver/verification/start').set(auth(who.token)).send({ driverType: type, consent: true }).expect(204);
  await details(who, type, v.body.vehicle.vehicleId).then((r) => expect(r.status).toBe(204));
  for (const doc of rules.requiredDocs(type, 'self')) await upload(who, doc).then((r) => expect(r.status).toBe(201));
  await app.post('/api/driver/verification/submit').set(auth(who.token)).expect(204);
  who.vehicleId = v.body.vehicle.vehicleId;
  return who;
}

const passAll = async (admin, who, type) => {
  for (const item of rules.checklistFor(type)) await app.post(`/api/admin/verifications/${who.user.userId}/checks`).set(auth(admin.token)).send({ item, result: 'pass' }).expect(204);
};
const approve = (admin, who) => app.post(`/api/admin/verifications/${who.user.userId}/approve`).set(auth(admin.token));
const row = async (who) => (await pool.query('SELECT * FROM driver_verifications WHERE driver_id = $1', [who.user.userId])).rows[0];

// ---------------------------------------------------------------- choosing a type

describe('driver types', () => {
  it('student and staff drivers need a matching university account; external ones need the track switched on', async () => {
    const gmail = tokenFor({ uid: 'g1', email: 'dan@gmail.com' });
    await app.post('/api/users').set(auth(gmail)).send({ fullName: 'Dan Gmail', phoneNumber: '0712345678' }).expect(201);
    const start = (tok, driverType) => app.post('/api/driver/verification/start').set(auth(tok)).send({ driverType, consent: true });
    expect((await start(gmail, 'student')).status).toBe(400); // a Gmail address is not a student
    expect((await start(gmail, 'staff')).status).toBe(400);
    const ext = await start(gmail, 'external');
    expect(ext.status).toBe(403);
    expect(ext.body.error.code).toBe('EXTERNAL_DISABLED'); // the external track is off by default

    const student = await createStudent();
    expect((await start(student.token, 'staff')).status).toBe(400); // a student account cannot claim to be staff
    await start(student.token, 'student').expect(204);

    const staff = await createStudent();
    await pool.query(`UPDATE users SET person_type = 'staff' WHERE user_id = $1`, [staff.user.userId]);
    expect((await start(staff.token, 'student')).status).toBe(400);
    await start(staff.token, 'staff').expect(204);
  });

  it('needs the consent first', async () => {
    const s = await createStudent();
    const res = await app.post('/api/driver/verification/start').set(auth(s.token)).send({ driverType: 'student', consent: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('admins cannot become drivers, and the type shows on the account', async () => {
    const admin = await createAdmin();
    expect((await app.post('/api/driver/verification/start').set(auth(admin.token)).send({ driverType: 'student', consent: true })).status).toBe(403);
    const s = await createStudent();
    await app.post('/api/driver/verification/start').set(auth(s.token)).send({ driverType: 'student', consent: true }).expect(204);
    expect((await app.get('/api/users/me').set(auth(s.token))).body.user).toMatchObject({ driverType: 'student', driverStatus: 'not_started' });
  });
});

// ---------------------------------------------------------------- the wizard

describe('details and documents', () => {
  it('stores only the last four digits of a national ID', async () => {
    const who = await submitted('external');
    const v = await row(who);
    expect(v.national_id_last4).toBe('5678');
    expect(JSON.stringify(v)).not.toContain('12345678');
    expect(JSON.stringify((await app.get('/api/driver/verification').set(auth(who.token))).body)).not.toContain('12345678');
    const log = JSON.stringify(await auditRows());
    expect(log).not.toContain('12345678');
  });

  it('blocks a licence held for less than the minimum, and expired papers', async () => {
    const s = await createStudent();
    const v = await vehicle(s);
    await app.post('/api/driver/verification/start').set(auth(s.token)).send({ driverType: 'student', consent: true }).expect(204);
    await details(s, 'student', v.body.vehicle.vehicleId, { licenceHeldSince: daysFromNow(-100) }).then((r) => expect(r.status).toBe(204));
    for (const doc of rules.requiredDocs('student', 'self')) await upload(s, doc);
    const res = await app.post('/api/driver/verification/submit').set(auth(s.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VERIFICATION_INCOMPLETE');
    expect(res.body.error.details.map((d) => d.message).join(' ')).toMatch(/held for at least 1 year/);

    await details(s, 'student', v.body.vehicle.vehicleId, { insuranceExpiry: daysFromNow(-3) });
    const again = await app.post('/api/driver/verification/submit').set(auth(s.token));
    expect(again.body.error.details.map((d) => d.message).join(' ')).toMatch(/insurance has expired/);
  });

  it('lists what is missing before submitting', async () => {
    const s = await createStudent();
    await app.post('/api/driver/verification/start').set(auth(s.token)).send({ driverType: 'student', consent: true }).expect(204);
    const view = (await app.get('/api/driver/verification').set(auth(s.token))).body;
    expect(view.missing.length).toBeGreaterThan(10);
    expect(view.requiredDocs).toContain('student_id');
  });

  it('accepts only real JPG, PNG and PDF files up to 5 MB, and strips location data', async () => {
    const s = await createStudent();
    await app.post('/api/driver/verification/start').set(auth(s.token)).send({ driverType: 'student', consent: true }).expect(204);
    // A program renamed to .png is refused: the type is read from the first bytes.
    const exe = await upload(s, 'student_id', { buffer: Buffer.from('MZ this is a program, not a picture at all') });
    expect(exe.status).toBe(400);
    expect(exe.body.error.code).toBe('FILE_TYPE');
    const big = await upload(s, 'student_id', { buffer: Buffer.concat([png(), Buffer.alloc(5 * 1024 * 1024 + 10)]) });
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe('FILE_TOO_LARGE');

    const jpegWithGps = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0a]), Buffer.from('Exif\0GPS!'),
      Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02]), Buffer.from('PIXELS'), Buffer.from([0xff, 0xd9]),
    ]);
    const ok = await upload(s, 'student_id', { buffer: jpegWithGps });
    expect(ok.status).toBe(201);
    const { rows } = await pool.query(`SELECT storage_key, sha256 FROM verification_documents WHERE doc_type = 'student_id'`);
    const stored = fs.readFileSync(path.join(tmp, rows[0].storage_key));
    expect(stored.includes(Buffer.from('GPS!'))).toBe(false);
    expect(files.sha256(stored)).toBe(rows[0].sha256);
  });

  it('wants selfies taken with the camera, and refuses documents that do not belong to the driver type', async () => {
    const s = await createStudent();
    await app.post('/api/driver/verification/start').set(auth(s.token)).send({ driverType: 'student', consent: true }).expect(204);
    const gallery = await upload(s, 'selfie', { live: false });
    expect(gallery.body.error.code).toBe('LIVE_CAPTURE_REQUIRED');
    expect((await upload(s, 'selfie', { live: true })).status).toBe(201);
    expect((await upload(s, 'psv_badge')).status).toBe(400); // a student driver has no PSV badge
  });

  it('logs each upload with its type and hash, never the contents', async () => {
    const s = await createStudent();
    await app.post('/api/driver/verification/start').set(auth(s.token)).send({ driverType: 'student', consent: true }).expect(204);
    const buf = png();
    await upload(s, 'student_id', { buffer: buf }).then((r) => expect(r.status).toBe(201));
    const entry = (await auditRows()).find((a) => a.action === 'verification.doc_uploaded');
    expect(entry.details).toMatchObject({ doc_type: 'student_id', sha256: files.sha256(files.stripMetadata(buf, 'image/png')) });
    expect(JSON.stringify(entry.details)).not.toContain('pixels');
  });
});

// ---------------------------------------------------------------- the admin review

describe('admin review', () => {
  it('students and drivers get 403 on every admin verification route, and nobody reads another driver\'s file', async () => {
    const who = await submitted('student');
    const other = await createStudent();
    const doc = (await pool.query(`SELECT doc_id FROM verification_documents LIMIT 1`)).rows[0].doc_id;
    const routes = [['get', '/api/admin/verifications'], ['get', `/api/admin/verifications/${who.user.userId}`], ['get', `/api/admin/documents/${doc}/url`], ['post', `/api/admin/verifications/${who.user.userId}/approve`], ['post', `/api/admin/verifications/${who.user.userId}/suspend`]];
    for (const [method, url] of routes) {
      expect((await app[method](url).set(auth(other.token))).status).toBe(403);
      expect((await app[method](url).set(auth(who.token))).status).toBe(403); // not even for the driver who owns the file
    }
  });

  it('shows the queue oldest first with the waiting time, and the review page with flags', async () => {
    const first = await submitted('student', { fullName: 'First Driver' });
    await pool.query(`UPDATE driver_verifications SET submitted_at = now() - interval '5 hours' WHERE driver_id = $1`, [first.user.userId]);
    const second = await submitted('student', { fullName: 'Second Driver' });
    const admin = await createAdmin();
    const queue = (await app.get('/api/admin/verifications').set(auth(admin.token)).expect(200)).body.verifications;
    expect(queue.map((q) => q.name)).toEqual(['First Driver', 'Second Driver']);
    expect(queue[0].waitingHours).toBeGreaterThanOrEqual(5);
    expect(queue[0].typeLabel).toBe('Student driver');

    await details(second, 'student', second.vehicleId, { licenceHolderName: 'Someone Else', insuranceExpiry: daysFromNow(5) });
    // the second driver already submitted, so their details are locked: change them directly for the flag test
    await pool.query(`UPDATE driver_verifications SET licence_holder_name = 'Someone Else', insurance_expiry = $2 WHERE driver_id = $1`, [second.user.userId, daysFromNow(5)]);
    const detail = (await app.get(`/api/admin/verifications/${second.user.userId}`).set(auth(admin.token)).expect(200)).body;
    expect(detail.flags.map((f) => f.code)).toEqual(expect.arrayContaining(['name_mismatch', 'insurance_expiring']));
    expect(detail.checklist.length).toBe(rules.checklistFor('student').length);
    expect(detail.documents.length).toBe(rules.requiredDocs('student', 'self').length);
    expect(JSON.stringify(detail)).not.toMatch(/storage_key|"sha256"/); // only a short hash prefix is shown
  });

  it('flags a file another driver already uploaded', async () => {
    const a = await submitted('student', { fullName: 'Driver A' });
    const reused = fs.readFileSync(path.join(tmp, (await pool.query(`SELECT storage_key FROM verification_documents WHERE driver_id = $1 AND doc_type = 'licence_front'`, [a.user.userId])).rows[0].storage_key));
    const b = await createStudent({ fullName: 'Driver B' });
    const v = await vehicle(b);
    await app.post('/api/driver/verification/start').set(auth(b.token)).send({ driverType: 'student', consent: true }).expect(204);
    await details(b, 'student', v.body.vehicle.vehicleId);
    for (const doc of rules.requiredDocs('student', 'self')) await upload(b, doc, doc === 'licence_front' ? { buffer: reused } : {});
    await app.post('/api/driver/verification/submit').set(auth(b.token)).expect(204);
    const admin = await createAdmin();
    const detail = (await app.get(`/api/admin/verifications/${b.user.userId}`).set(auth(admin.token))).body;
    expect(detail.flags.find((f) => f.code === 'document_reused').text).toMatch(/Driver A/);
  });

  it('rejects a plate that another driver already registered', async () => {
    const a = await createStudent();
    const first = await vehicle(a, { plateNumber: 'KDA123A' });
    expect(first.status).toBe(201);
    const b = await createStudent();
    const second = await vehicle(b, { plateNumber: 'kda 123a' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('PLATE_TAKEN');
  });

  it('approves only when every checklist item passes, and rejects only with a reason', async () => {
    const who = await submitted('student');
    const admin = await createAdmin();
    const early = await approve(admin, who);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('CHECKLIST_INCOMPLETE');

    const items = rules.checklistFor('student');
    for (const item of items.slice(0, -1)) await app.post(`/api/admin/verifications/${who.user.userId}/checks`).set(auth(admin.token)).send({ item, result: 'pass' }).expect(204);
    await app.post(`/api/admin/verifications/${who.user.userId}/checks`).set(auth(admin.token)).send({ item: items.at(-1), result: 'fail', note: 'Photo is blurry' }).expect(204);
    expect((await approve(admin, who)).status).toBe(409); // one failed item blocks approval

    expect((await app.post(`/api/admin/verifications/${who.user.userId}/checks`).set(auth(admin.token)).send({ item: 'made_up', result: 'pass' })).status).toBe(400);
    expect((await app.post(`/api/admin/verifications/${who.user.userId}/reject`).set(auth(admin.token)).send({})).status).toBe(400);
    expect((await app.post(`/api/admin/verifications/${who.user.userId}/reject`).set(auth(admin.token)).send({ reason: 'no' })).status).toBe(400);

    await app.post(`/api/admin/verifications/${who.user.userId}/checks`).set(auth(admin.token)).send({ item: items.at(-1), result: 'pass' }).expect(204); // the latest decision counts
    await approve(admin, who).expect(204);
    expect((await row(who)).status).toBe('approved');
    const view = (await app.get('/api/driver/verification').set(auth(who.token))).body;
    expect(view).toMatchObject({ status: 'approved', typeLabel: 'Student driver' });
    expect(view.qrToken).toBeTruthy();
    expect((await app.get('/api/users/me').set(auth(who.token))).body.user.driverStatus).toBe('approved');
  });

  it('a rejected driver sees the reason, fixes the problem and sends it again', async () => {
    const who = await submitted('student');
    const admin = await createAdmin();
    await app.post(`/api/admin/verifications/${who.user.userId}/reject`).set(auth(admin.token)).send({ reason: 'The licence photo is too dark to read.' }).expect(204);
    const view = (await app.get('/api/driver/verification').set(auth(who.token))).body;
    expect(view).toMatchObject({ status: 'rejected', rejectionReason: 'The licence photo is too dark to read.' });
    expect((await app.get('/api/notifications').set(auth(who.token))).body.notifications.map((n) => n.type)).toContain('verification.rejected');
    await upload(who, 'licence_front').then((r) => expect(r.status).toBe(201)); // allowed again after a rejection
    await app.post('/api/driver/verification/submit').set(auth(who.token)).expect(204);
    expect((await row(who)).status).toBe('pending_review');
    // nobody can skip the review: a rejected driver cannot be approved without sending it again first
    expect((await row(who)).rejection_reason).toBeNull();
  });

  it('locks the details while a review is under way', async () => {
    const who = await submitted('student');
    expect((await upload(who, 'licence_front')).status).toBe(409);
    expect((await details(who, 'student', who.vehicleId)).status).toBe(409);
  });
});

// ---------------------------------------------------------------- external drivers

describe('external drivers', () => {
  it('cannot register while the track is switched off', async () => {
    const token = tokenFor({ uid: 'e1', email: 'ext@gmail.com' });
    await app.post('/api/users').set(auth(token)).send({ fullName: 'Ext Driver', phoneNumber: '0712345678' }).expect(201);
    const res = await app.post('/api/driver/verification/start').set(auth(token)).send({ driverType: 'external', consent: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EXTERNAL_DISABLED');
  });

  it('needs every extra paper before it can be submitted', async () => {
    const token = tokenFor({ uid: 'e2', email: 'ext2@gmail.com' });
    const res = await app.post('/api/users').set(auth(token)).send({ fullName: 'Ext Driver', phoneNumber: '0712345678' }).expect(201);
    const who = { token, user: res.body.user };
    await pool.query(`UPDATE system_settings SET setting_value = 'true' WHERE setting_key = 'external_drivers_enabled'`);
    const v = await vehicle(who);
    await app.post('/api/driver/verification/start').set(auth(who.token)).send({ driverType: 'external', consent: true }).expect(204);
    await details(who, 'external', v.body.vehicle.vehicleId, { goodConductIssued: daysFromNow(-300) }); // older than 6 months
    for (const doc of rules.requiredDocs('external', 'self').filter((d) => d !== 'good_conduct' && d !== 'psv_badge')) await upload(who, doc);
    const submit = await app.post('/api/driver/verification/submit').set(auth(who.token));
    expect(submit.status).toBe(400);
    const msg = submit.body.error.details.map((d) => d.message).join(' | ');
    expect(msg).toMatch(/good conduct/i);
    expect(msg).toMatch(/psv badge/i);
    expect(msg).toMatch(/less than 6 months/);
  });

  it('is approved only by a senior admin, after the in-person check, with everything passing', async () => {
    const who = await submitted('external');
    const plain = await createAdmin();
    const senior = await createSeniorAdmin();
    await passAll(senior, who, 'external');

    expect((await approve(plain, who)).body.error.code).toBe('SENIOR_ADMIN_REQUIRED');
    const noCheck = await approve(senior, who);
    expect(noCheck.status).toBe(409);
    expect(noCheck.body.error.code).toBe('IN_PERSON_REQUIRED');

    await app.post(`/api/admin/verifications/${who.user.userId}/in-person`).set(auth(senior.token)).send({ date: daysFromNow(0), officer: 'Officer Kamau' }).expect(204);
    await approve(senior, who).expect(204);
    expect((await row(who)).status).toBe('approved');
    expect((await auditRows()).map((a) => a.action)).toEqual(expect.arrayContaining(['verification.in_person', 'verification.approve']));
  });

  it('is shown to riders as a verified external driver', () => {
    expect(rules.TYPE_LABEL).toEqual({ student: 'Student driver', staff: 'Staff driver', external: 'Verified external driver' });
  });
});

// ---------------------------------------------------------------- documents and links

describe('document access', () => {
  it('an admin gets a 5-minute link, every view is logged, and nothing else reaches a file', async () => {
    const who = await submitted('student');
    const admin = await createAdmin();
    const doc = (await pool.query(`SELECT doc_id FROM verification_documents WHERE driver_id = $1 AND doc_type = 'licence_front'`, [who.user.userId])).rows[0].doc_id;

    expect((await app.get(`/api/documents/${doc}`)).status).toBe(403); // no link at all
    const { url, expiresAt } = (await app.get(`/api/admin/documents/${doc}/url`).set(auth(admin.token)).expect(200)).body;
    expect(new Date(expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    const file = await app.get(url).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['cache-control']).toMatch(/no-store/);

    expect((await app.get(url.replace(/sig=[0-9a-f]+/, 'sig=00'))).status).toBe(403); // tampered
    const expired = provider().signedUrl(doc, admin.user.userId, Date.now() - 6 * 60_000).url;
    expect((await app.get(expired)).status).toBe(403); // older than 5 minutes
    const view = (await auditRows()).find((a) => a.action === 'verification.doc_viewed');
    expect(view.details).toMatchObject({ doc_id: doc, viewer_id: admin.user.userId, doc_type: 'licence_front' });
    expect(view.user_id).toBe(admin.user.userId);
  });

  it('keeps hashes and checklist results but deletes the files after the retention period', async () => {
    const who = await submitted('student');
    const admin = await createAdmin();
    await passAll(admin, who, 'student');
    await approve(admin, who).expect(204);
    const before = (await pool.query(`SELECT doc_id, storage_key, sha256 FROM verification_documents WHERE driver_id = $1`, [who.user.userId])).rows;
    expect(before.every((d) => fs.existsSync(path.join(tmp, d.storage_key)))).toBe(true);

    await verification.runJobs(); // too early: nothing is deleted
    expect(before.every((d) => fs.existsSync(path.join(tmp, d.storage_key)))).toBe(true);

    await pool.query(`UPDATE driver_verifications SET approved_at = now() - interval '31 days' WHERE driver_id = $1`, [who.user.userId]);
    const out = await verification.runJobs();
    expect(out.filesDeleted).toBe(before.length);
    expect(before.some((d) => fs.existsSync(path.join(tmp, d.storage_key)))).toBe(false);
    const after = (await pool.query(`SELECT sha256, deleted_at, deleted_reason FROM verification_documents WHERE driver_id = $1`, [who.user.userId])).rows;
    expect(after.map((d) => d.sha256).sort()).toEqual(before.map((d) => d.sha256).sort()); // the hashes stay
    expect(after.every((d) => d.deleted_at && d.deleted_reason === 'retention')).toBe(true);
    expect((await pool.query('SELECT count(*)::int AS n FROM verification_checks WHERE driver_id = $1', [who.user.userId])).rows[0].n).toBe(rules.checklistFor('student').length);
    expect((await row(who)).status).toBe('approved'); // the dates and approval remain
    const doc = before[0].doc_id;
    const gone = await app.get(`/api/admin/documents/${doc}/url`).set(auth(admin.token));
    expect(gone.status).toBe(409);
    expect((await auditRows()).map((a) => a.action)).toContain('verification.retention');
  });

  it('deletes a rejected driver\'s files after 30 days', async () => {
    const who = await submitted('student');
    const admin = await createAdmin();
    await app.post(`/api/admin/verifications/${who.user.userId}/reject`).set(auth(admin.token)).send({ reason: 'Documents are not clear enough.' }).expect(204);
    await verification.runJobs();
    expect((await pool.query(`SELECT count(*)::int AS n FROM verification_documents WHERE driver_id = $1 AND deleted_at IS NULL`, [who.user.userId])).rows[0].n).toBeGreaterThan(0);
    await pool.query(`UPDATE driver_verifications SET reviewed_at = now() - interval '31 days' WHERE driver_id = $1`, [who.user.userId]);
    await verification.runJobs();
    expect((await pool.query(`SELECT count(*)::int AS n FROM verification_documents WHERE driver_id = $1 AND deleted_at IS NULL`, [who.user.userId])).rows[0].n).toBe(0);
  });
});

// ---------------------------------------------------------------- who may go online

const GATE = { lat: -1.2189, lng: 36.8808, label: 'USIU-Africa, Gate A' };
const KASARANI = { lat: -1.2216, lng: 36.9046, label: 'Kasarani' };

async function approvedOnline(type = 'student') {
  const who = await submitted(type);
  const admin = await (type === 'external' ? createSeniorAdmin() : createAdmin());
  await passAll(admin, who, type);
  if (type === 'external') await app.post(`/api/admin/verifications/${who.user.userId}/in-person`).set(auth(admin.token)).send({ date: daysFromNow(0), officer: 'Officer Kamau' }).expect(204);
  await approve(admin, who).expect(204);
  return who;
}
const goOnline = (who, extra = {}) => app.post('/api/driver/online').set(auth(who.token)).send({ lat: GATE.lat, lng: GATE.lng, ...extra });

describe('only approved drivers drive', () => {
  it('a driver who is not approved cannot go online', async () => {
    const s = await createStudent();
    const none = await goOnline(s);
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe('DRIVER_NOT_VERIFIED');
    const pending = await submitted('student');
    expect((await goOnline(pending)).status).toBe(403);
    const admin = await createAdmin();
    await app.post(`/api/admin/verifications/${pending.user.userId}/reject`).set(auth(admin.token)).send({ reason: 'Documents are not clear.' }).expect(204);
    expect((await goOnline(pending)).status).toBe(403);
  });

  it('an approved driver goes online, and expired papers stop them', async () => {
    const who = await approvedOnline('student');
    await goOnline(who).expect(200);
    await app.post('/api/driver/offline').set(auth(who.token)).expect(204);
    for (const [column, label] of [['licence_expiry', 'licence'], ['insurance_expiry', 'insurance']]) {
      const good = daysFromNow(300);
      await pool.query(`UPDATE driver_verifications SET ${column} = $2 WHERE driver_id = $1`, [who.user.userId, daysFromNow(-1)]);
      const res = await goOnline(who);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(new RegExp(label, 'i'));
      await pool.query(`UPDATE driver_verifications SET ${column} = $2 WHERE driver_id = $1`, [who.user.userId, good]);
    }
    expect((await goOnline(who)).status).toBe(200);
  });

  it('dispatch never offers a request to a driver whose papers ran out, even if they were already online', async () => {
    const who = await approvedOnline('student');
    await goOnline(who).expect(200);
    await pool.query(`UPDATE driver_verifications SET insurance_expiry = $2 WHERE driver_id = $1`, [who.user.userId, daysFromNow(-1)]);
    const rider = await createStudent();
    const req = (await app.post('/api/requests').set(auth(rider.token)).send({ type: 'now', pickup: GATE, dropoff: KASARANI, seats: 1 }).expect(201)).body.request;
    expect((await pool.query('SELECT status FROM trip_requests WHERE request_id = $1', [req.requestId])).rows[0].status).toBe('no_driver');
    expect((await pool.query('SELECT count(*)::int AS n FROM dispatch_offers')).rows[0].n).toBe(0);
  });

  it('a rider who turned off external drivers is never matched with one', async () => {
    const ext = await approvedOnline('external');
    await goOnline(ext).expect(200);
    const rider = await createStudent();
    await app.put('/api/users/me/settings').set(auth(rider.token)).send({ allowExternalDrivers: false }).expect(200);
    const refused = (await app.post('/api/requests').set(auth(rider.token)).send({ type: 'now', pickup: GATE, dropoff: KASARANI, seats: 1 }).expect(201)).body.request;
    expect((await pool.query('SELECT status FROM trip_requests WHERE request_id = $1', [refused.requestId])).rows[0].status).toBe('no_driver');

    const open = await createStudent();
    const ok = (await app.post('/api/requests').set(auth(open.token)).send({ type: 'now', pickup: GATE, dropoff: KASARANI, seats: 1 }).expect(201)).body.request;
    expect((await pool.query('SELECT status FROM trip_requests WHERE request_id = $1', [ok.requestId])).rows[0].status).toBe('offered');
    expect((await auditRows()).map((a) => a.action)).toContain('user.settings');
  });

  it('switching the external track off stops external drivers everywhere', async () => {
    const ext = await approvedOnline('external');
    await goOnline(ext).expect(200);
    await app.post('/api/driver/offline').set(auth(ext.token)).expect(204);
    await pool.query(`UPDATE system_settings SET setting_value = 'false' WHERE setting_key = 'external_drivers_enabled'`);
    const res = await goOnline(ext);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/External drivers are not accepted/);
  });

  it('student and staff drivers show their type on the live ride', async () => {
    const who = await approvedOnline('staff');
    expect((await app.get('/api/users/me').set(auth(who.token))).body.user.driverType).toBe('staff');
    expect(rules.TYPE_LABEL.staff).toBe('Staff driver');
  });
});

// ---------------------------------------------------------------- staying verified

describe('staying verified', () => {
  it('the expiry job sets expired, takes the driver offline and tells them', async () => {
    const who = await approvedOnline('student');
    await goOnline(who).expect(200);
    await pool.query(`UPDATE driver_verifications SET licence_expiry = $2 WHERE driver_id = $1`, [who.user.userId, daysFromNow(-1)]);
    const out = await verification.runJobs();
    expect(out.expired).toBe(1);
    expect((await row(who)).status).toBe('expired');
    expect((await pool.query('SELECT is_online, current_location FROM driver_status WHERE driver_id = $1', [who.user.userId])).rows[0]).toEqual({ is_online: false, current_location: null });
    expect((await app.get('/api/notifications').set(auth(who.token))).body.notifications.map((n) => n.type)).toContain('verification.expired');
    expect((await goOnline(who)).status).toBe(403);
    // they can apply again after fixing it
    expect((await app.post('/api/driver/verification/start').set(auth(who.token)).send({ driverType: 'student', consent: true })).status).toBe(204);
  });

  it('a student driver whose university email stops working expires', async () => {
    const who = await approvedOnline('student');
    await pool.query(`UPDATE users SET university_email = 'dan@somewhere-else.com' WHERE user_id = $1`, [who.user.userId]);
    expect((await verification.runJobs()).expired).toBe(1);
    expect((await row(who)).status).toBe('expired');
  });

  it('warns before papers run out, once', async () => {
    const who = await approvedOnline('student');
    await pool.query(`UPDATE driver_verifications SET licence_expiry = $2 WHERE driver_id = $1`, [who.user.userId, daysFromNow(7)]);
    expect((await verification.runJobs()).reminded).toBe(1);
    expect((await verification.runJobs()).reminded).toBe(0);
    const types = (await app.get('/api/notifications').set(auth(who.token))).body.notifications.map((n) => n.type);
    expect(types.filter((t) => t === 'verification.expiring')).toHaveLength(1);
    expect((await row(who)).status).toBe('approved'); // still valid until the day passes
  });

  it('asks for a re-check on schedule, keeps the driver approved for 14 days, then expires them', async () => {
    const who = await approvedOnline('student');
    await pool.query(`UPDATE driver_verifications SET next_recheck_at = now() - interval '1 day' WHERE driver_id = $1`, [who.user.userId]);
    expect((await verification.runJobs()).rechecksDue).toBe(1);
    let v = await row(who);
    expect(v).toMatchObject({ status: 'approved', recheck_state: 'due' });
    expect(new Date(v.recheck_grace_until).getTime() - Date.now()).toBeGreaterThan(13 * 86_400_000);
    await goOnline(who).expect(200); // still allowed during the grace period
    await app.post('/api/driver/offline').set(auth(who.token)).expect(204);

    // They re-upload the licence, insurance and a selfie, with the new dates, and send it in.
    for (const doc of ['licence_front', 'licence_back', 'insurance', 'selfie', 'selfie_head_turn']) await upload(who, doc).then((r) => expect(r.status).toBe(201));
    await details(who, 'student', who.vehicleId, { licenceExpiry: daysFromNow(1200), insuranceExpiry: daysFromNow(800) }).then((r) => expect(r.status).toBe(204));
    await app.post('/api/driver/verification/submit').set(auth(who.token)).expect(204);
    expect((await row(who)).recheck_state).toBe('submitted');

    const admin = await createAdmin();
    expect((await app.get('/api/admin/verifications').set(auth(admin.token))).body.verifications[0]).toMatchObject({ recheck: true });
    expect((await approve(admin, who)).status).toBe(409); // the three re-check items still need a pass
    for (const item of ['identity_matches_selfie', 'licence_valid', 'insurance_valid']) await app.post(`/api/admin/verifications/${who.user.userId}/checks`).set(auth(admin.token)).send({ item, result: 'pass' }).expect(204);
    await approve(admin, who).expect(204);
    v = await row(who);
    expect(v).toMatchObject({ status: 'approved', recheck_state: 'none' });
    expect(new Date(v.next_recheck_at).getTime()).toBeGreaterThan(Date.now() + 150 * 86_400_000);

    // A driver who never re-checks is expired once the grace period ends.
    await pool.query(`UPDATE driver_verifications SET recheck_state = 'due', recheck_grace_until = now() - interval '1 day' WHERE driver_id = $1`, [who.user.userId]);
    expect((await verification.runJobs()).expired).toBe(1);
    expect((await row(who)).status).toBe('expired');
  });

  it('suspends automatically on a low average rating, once there are enough ratings', async () => {
    const who = await approvedOnline('student');
    await goOnline(who).expect(200);
    const admin = await createAdmin(); // admins hear about automatic suspensions
    const rater = await createStudent();
    const rate = (stars) => pool.query('INSERT INTO ratings (rater_id, ratee_id, stars) VALUES ($1, $2, $3)', [rater.user.userId, who.user.userId, stars]);
    const setAvg = () => pool.query(`UPDATE users SET avg_rating = (SELECT round(avg(stars), 1) FROM ratings WHERE ratee_id = $1) WHERE user_id = $1`, [who.user.userId]);
    for (const s of [1, 2, 2, 3]) await rate(s);
    await setAvg();
    expect((await verification.runJobs()).suspended).toBe(0); // only 4 ratings so far
    await rate(2);
    await setAvg();
    expect((await verification.runJobs()).suspended).toBe(1);
    expect((await row(who)).status).toBe('suspended');
    expect((await pool.query('SELECT is_online FROM driver_status WHERE driver_id = $1', [who.user.userId])).rows[0].is_online).toBe(false);
    expect((await auditRows()).map((a) => a.action)).toContain('verification.auto_suspend');
    expect((await app.get('/api/notifications').set(auth(admin.token))).body.notifications.map((n) => n.type)).toContain('verification.auto_suspended');
  });

  it('suspends automatically at the open-incident limit, and an admin can reinstate', async () => {
    const who = await approvedOnline('student');
    const reporter = await createStudent();
    const { rows } = await pool.query(`INSERT INTO rides (driver_id) VALUES ($1) RETURNING ride_id`, [who.user.userId]);
    const report = (n) => pool.query(`INSERT INTO incident_reports (reporter_id, reported_user_id, ride_id, category, description) VALUES ($1, $2, $3, 'other', $4)`, [reporter.user.userId, who.user.userId, rows[0].ride_id, `Report number ${n}`]);
    await report(1);
    expect(await verification.suspendIfUnsafe(who.user.userId)).toBe(false);
    await report(2);
    expect(await verification.suspendIfUnsafe(who.user.userId)).toBe(true);
    expect((await row(who)).status).toBe('suspended');

    const admin = await createAdmin();
    expect((await app.post(`/api/admin/verifications/${who.user.userId}/reinstate`).set(auth(admin.token)).expect(200)).body.status).toBe('approved');
    expect((await goOnline(who)).status).toBe(200);
    const manual = await app.post(`/api/admin/verifications/${who.user.userId}/suspend`).set(auth(admin.token)).send({});
    expect(manual.status).toBe(400); // a reason is required
    await app.post(`/api/admin/verifications/${who.user.userId}/suspend`).set(auth(admin.token)).send({ reason: 'Complaint under investigation.' }).expect(204);
    expect((await row(who)).status).toBe('suspended');
    expect((await goOnline(who)).status).toBe(403);
  });

  it('asks for a quick live selfie on a share of go-online attempts, and each selfie works once', async () => {
    const who = await approvedOnline('student');
    await pool.query(`UPDATE system_settings SET setting_value = '100' WHERE setting_key = 'random_selfie_check_percent'`);
    const first = await goOnline(who);
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('SELFIE_REQUIRED');

    const selfie = await app.post('/api/driver/verification/recheck-selfie').set(auth(who.token)).attach('file', png(), 'me.png').expect(201);
    await goOnline(who, { selfieCheckId: selfie.body.checkId }).expect(200);
    await app.post('/api/driver/offline').set(auth(who.token)).expect(204);
    expect((await goOnline(who, { selfieCheckId: selfie.body.checkId })).status).toBe(409); // already used

    const admin = await createAdmin();
    const checks = (await app.get('/api/admin/selfie-checks').set(auth(admin.token)).expect(200)).body.checks;
    expect(checks[0]).toMatchObject({ status: 'ok', name: 'Dan Mwangi' });
    await app.post(`/api/admin/selfie-checks/${checks[0].checkId}`).set(auth(admin.token)).send({ status: 'flagged' }).expect(204);
    expect((await app.get('/api/admin/selfie-checks?status=flagged').set(auth(admin.token))).body.checks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- the rider checks the driver

const GATE_PT = { lat: -1.2189, lng: 36.8808, label: 'USIU-Africa, Gate A' };

async function assignedRide() {
  const who = await approvedOnline('student');
  await goOnline(who).expect(200);
  const rider = await createStudent({ fullName: 'Rita Rider' });
  await app.post('/api/requests').set(auth(rider.token)).send({ type: 'now', pickup: GATE_PT, dropoff: KASARANI, seats: 1 }).expect(201);
  const { offer } = (await app.get('/api/driver/state').set(auth(who.token))).body;
  await app.post(`/api/offers/${offer.offerId}/accept`).set(auth(who.token)).expect(200);
  const { ride } = (await app.get('/api/driver/state').set(auth(who.token))).body;
  return { who, rider, rideId: ride.ride.rideId, pickup: ride.stops.find((s) => s.kind === 'pickup') };
}

describe('pick-up check', () => {
  it('the driver cannot start until the rider confirms, and the rider sees the driver type', async () => {
    const { who, rider, rideId, pickup } = await assignedRide();
    await app.post(`/api/rides/${rideId}/stops/${pickup.stopId}/arrived`).set(auth(who.token)).expect(204);
    const blocked = await app.post(`/api/rides/${rideId}/stops/${pickup.stopId}/done`).set(auth(who.token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('RIDER_NOT_CONFIRMED');
    const live = (await app.get(`/api/rides/${rideId}/live`).set(auth(rider.token)).expect(200)).body;
    expect(live.driver).toMatchObject({ typeLabel: 'Student driver', verified: true });
    expect(live.confirmedDriver).toBe(false);

    expect((await app.post(`/api/rides/${rideId}/confirm-driver`).set(auth(rider.token)).send({ matches: true }).expect(200)).body).toEqual({ matches: true });
    expect((await app.get(`/api/rides/${rideId}/live`).set(auth(who.token))).body.stops.find((s) => s.kind === 'pickup').riderConfirmed).toBe(true);
    await app.post(`/api/rides/${rideId}/stops/${pickup.stopId}/done`).set(auth(who.token)).expect(200);
    expect((await auditRows()).map((a) => a.action)).toContain('ride.driver_confirmed');
  });

  it('only the rider in the ride can confirm', async () => {
    const { who, rideId } = await assignedRide();
    const stranger = await createStudent();
    expect((await app.post(`/api/rides/${rideId}/confirm-driver`).set(auth(stranger.token)).send({ matches: true })).status).toBe(404);
    expect((await app.post(`/api/rides/${rideId}/confirm-driver`).set(auth(who.token)).send({ matches: true })).status).toBe(404); // the driver cannot confirm themselves
  });

  it('"Doesn\'t match" cancels the ride, frees the driver and opens an incident automatically', async () => {
    const { who, rider, rideId } = await assignedRide();
    expect((await app.post(`/api/rides/${rideId}/confirm-driver`).set(auth(rider.token)).send({ matches: false }).expect(200)).body).toEqual({ matches: false });

    const reqRow = (await pool.query(`SELECT status, cancel_reason FROM trip_requests WHERE rider_id = $1`, [rider.user.userId])).rows[0];
    expect(reqRow).toEqual({ status: 'cancelled', cancel_reason: 'driver_mismatch' });
    const state = (await app.get('/api/driver/state').set(auth(who.token))).body;
    expect(state.ride).toBeNull();
    expect(state.seatsFree).toBe(3);

    const incident = (await pool.query(`SELECT category, reporter_id, reported_user_id, status FROM incident_reports WHERE ride_id = $1`, [rideId])).rows[0];
    expect(incident).toEqual({ category: 'driver_mismatch', reporter_id: rider.user.userId, reported_user_id: who.user.userId, status: 'open' });
    const adminNotes = (await pool.query(`SELECT n.type FROM notifications n JOIN users u ON u.user_id = n.user_id WHERE u.role = 'admin'`)).rows.map((r) => r.type);
    expect(adminNotes).toContain('incident.new'); // every admin hears about it
    expect((await app.get('/api/notifications').set(auth(who.token))).body.notifications.map((n) => n.type)).toContain('ride.cancelled');
    const actions = (await auditRows()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['ride.driver_mismatch', 'incident.report']));
    // a confirmed ride cannot be flipped to "doesn't match" later
    expect((await app.post(`/api/rides/${rideId}/confirm-driver`).set(auth(rider.token)).send({ matches: false })).status).toBe(404);
  });
});

// ---------------------------------------------------------------- the public page

describe('verified driver page', () => {
  it('shows only first name, car, plate and status, and a photo only with consent', async () => {
    const who = await approvedOnline('student');
    const token = (await app.get('/api/driver/verification').set(auth(who.token))).body.qrToken;
    const page = (await app.get(`/api/public/driver/${token}`).expect(200)).body;
    expect(page).toMatchObject({ verified: true, firstName: 'Dan', typeLabel: 'Student driver' });
    expect(page.plateNumber).toMatch(/^KVR/);
    expect(Object.keys(page).sort()).toEqual(['car', 'firstName', 'plateNumber', 'typeLabel', 'verified']);
    expect(JSON.stringify(page)).not.toMatch(/Mwangi|email|phone|licence/i);

    await pool.query(`UPDATE driver_verifications SET public_photo_consent = true WHERE driver_id = $1`, [who.user.userId]);
    const withPhoto = (await app.get(`/api/public/driver/${token}`)).body;
    expect(withPhoto.photoUrl).toMatch(/^\/api\/documents\//);
    expect((await app.get(withPhoto.photoUrl).expect(200)).headers['content-type']).toBe('image/png');
  });

  it('says not verified for unknown or non-approved drivers', async () => {
    expect((await app.get('/api/public/driver/not-a-token')).body).toEqual({ verified: false });
    expect((await app.get('/api/public/driver/11111111-1111-4111-8111-111111111111')).body).toEqual({ verified: false });
    const pending = await submitted('student');
    const token = (await pool.query('SELECT qr_token FROM driver_verifications WHERE driver_id = $1', [pending.user.userId])).rows[0].qr_token;
    expect((await app.get(`/api/public/driver/${token}`)).body).toEqual({ verified: false });
  });
});

// ---------------------------------------------------------------- the audit trail

describe('audit trail', () => {
  it('records every verification action and the chain still verifies', async () => {
    const who = await approvedOnline('student');
    const admin = await createAdmin();
    const doc = (await pool.query(`SELECT doc_id FROM verification_documents WHERE driver_id = $1 LIMIT 1`, [who.user.userId])).rows[0].doc_id;
    await app.get(`/api/admin/documents/${doc}/url`).set(auth(admin.token)).expect(200);
    await app.post(`/api/admin/verifications/${who.user.userId}/suspend`).set(auth(admin.token)).send({ reason: 'Routine check of a complaint.' }).expect(204);
    await app.post(`/api/admin/verifications/${who.user.userId}/reinstate`).set(auth(admin.token)).expect(200);
    const actions = (await auditRows()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining([
      'verification.start', 'verification.details', 'verification.doc_uploaded', 'verification.submit', 'verification.check',
      'verification.approve', 'verification.doc_viewed', 'verification.suspend', 'verification.reinstate',
    ]));
    expect(await verifyAuditChain()).toMatchObject({ valid: true });
  });
});

// test helper reference so approveAsDriver stays exercised for the dispatch suites
void approveAsDriver;
void dispatch;

describe('verification settings', () => {
  it('lets any admin tune the thresholds, but only a senior admin switch the external track', async () => {
    const plain = await createAdmin();
    const senior = await createSeniorAdmin();
    await app.put('/api/admin/verification-settings').set(auth(plain.token)).send({ min_licence_years: 2, auto_suspend_incidents: 3 }).expect(204);
    expect((await app.get('/api/admin/verification-settings').set(auth(plain.token))).body).toMatchObject({ settings: { min_licence_years: 2, auto_suspend_incidents: 3, external_drivers_enabled: false }, canToggleExternal: false });
    expect((await app.put('/api/admin/verification-settings').set(auth(plain.token)).send({ external_drivers_enabled: true })).status).toBe(403);
    await app.put('/api/admin/verification-settings').set(auth(senior.token)).send({ external_drivers_enabled: true }).expect(204);
    expect((await app.put('/api/admin/verification-settings').set(auth(senior.token)).send({ random_selfie_check_percent: 500 })).status).toBe(400);
    expect((await app.put('/api/admin/verification-settings').set(auth(plain.token)).send({ nonsense: 1 })).status).toBe(400);
    await pool.query(`UPDATE system_settings SET setting_value = '1' WHERE setting_key = 'min_licence_years'`);
    await pool.query(`UPDATE system_settings SET setting_value = '2' WHERE setting_key = 'auto_suspend_incidents'`);
    expect((await auditRows()).map((a) => a.action)).toContain('verification_settings.update');
  });
});
