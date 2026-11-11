const { Router } = require('express');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { errors } = require('../lib/errors');
const rules = require('../lib/verification');
const files = require('../lib/files');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { validateBody, uuidParam } = require('../middleware/validate');
const verification = require('../services/verification');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: files.MAX_BYTES, files: 1 } });
/** Reads one file, turning multer's own errors into ours. */
const oneFile = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(errors.badRequest('FILE_TOO_LARGE', 'That file is over 5 MB.'));
    return next(errors.badRequest('VALIDATION_ERROR', 'Could not read that upload.'));
  });

// ---------------------------------------------------------------- the driver (/api/driver/verification)
// Each person can only ever reach their own record, because every call uses the signed-in user's id.
const driver = Router();
driver.use(requireAuth(), requireRole('student', 'driver'));

const user = (req) => ({ userId: req.user.userId, role: req.user.role, profile: req.user.profile });

driver.get('/', async (req, res) => res.json(await verification.ownView(user(req))));

const startSchema = z
  .object({ driverType: z.enum(rules.DRIVER_TYPES, { message: 'Choose student, staff or external driver' }), consent: z.boolean(), publicPhotoConsent: z.boolean().optional() })
  .strict();
driver.post('/start', validateBody(startSchema), async (req, res) => {
  await verification.start({ user: user(req), driverType: req.body.driverType, consent: req.body.consent, publicPhotoConsent: req.body.publicPhotoConsent, ip: req.ip });
  res.status(204).end();
});

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-03-31').refine((v) => !Number.isNaN(Date.parse(v)), 'Not a real date');
const detailsSchema = z
  .object({
    licenceNumber: z.string().trim().min(4).max(30),
    licenceHolderName: z.string().trim().min(2).max(120),
    licenceExpiry: date,
    licenceHeldSince: date.refine((v) => new Date(v) <= new Date(), 'The date cannot be in the future'),
    insuranceProvider: z.string().trim().min(2).max(80),
    insurancePolicyNo: z.string().trim().min(2).max(60),
    insuranceExpiry: date,
    insuranceCoversPassengers: z.boolean(),
    vehicleId: z.uuid(),
    ownerRelationship: z.enum(['self', 'parent', 'other']),
    idExpiry: date,
    nationalId: z.string().trim().min(6, 'Enter your national ID or passport number').max(20),
    goodConductIssued: date,
    psvBadgeNo: z.string().trim().min(2).max(40),
    psvBadgeExpiry: date,
    inspectionDate: date,
    inspectedBy: z.string().trim().min(2).max(80),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field' });
driver.put('/details', validateBody(detailsSchema), async (req, res) => {
  await verification.saveDetails({ user: user(req), details: req.body, ip: req.ip });
  res.status(204).end();
});

const docTypes = z.enum(['student_id', 'staff_id', 'national_id_front', 'national_id_back', 'good_conduct', 'psv_badge', 'inspection_report', 'licence_front', 'licence_back', 'selfie', 'selfie_head_turn', 'logbook', 'owner_letter', 'insurance', 'car_front_plate', 'car_back', 'car_interior']);
driver.post('/documents', oneFile, async (req, res) => {
  const type = docTypes.safeParse(req.body?.docType);
  if (!type.success) throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [{ field: 'docType', message: 'Choose a document type' }]);
  if (!req.file) throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [{ field: 'file', message: 'Choose a file to upload' }]);
  const saved = await verification.uploadDoc({ user: user(req), docType: type.data, buffer: req.file.buffer, capturedLive: req.body.capturedLive === 'true', ip: req.ip });
  res.status(201).json(saved);
});

driver.post('/submit', async (req, res) => {
  await verification.submit({ user: user(req), ip: req.ip });
  res.status(204).end();
});

/** The quick live selfie asked for when going online. */
driver.post('/recheck-selfie', oneFile, async (req, res) => {
  if (!req.file) throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [{ field: 'file', message: 'Take a selfie' }]);
  res.status(201).json(await verification.submitRecheckSelfie({ user: user(req), buffer: req.file.buffer, ip: req.ip }));
});

// ---------------------------------------------------------------- the admin (/api/admin/...)
const admin = Router();
admin.use(requireAuth(), requireRole('admin'));
const adminUser = (req) => ({ userId: req.user.userId, adminLevel: req.user.adminLevel });

admin.get('/verifications', async (req, res) => {
  const status = rules.STATUSES.includes(req.query.status) ? req.query.status : null;
  res.json({ verifications: await verification.queue(status) });
});
admin.get('/verifications/:id', uuidParam('id'), async (req, res) => res.json(await verification.detail(req.params.id)));

const checkSchema = z.object({ item: z.string().min(2).max(60), result: z.enum(['pass', 'fail']), note: z.string().trim().max(500).optional() }).strict();
admin.post('/verifications/:id/checks', uuidParam('id'), validateBody(checkSchema), async (req, res) => {
  await verification.recordCheck({ admin: adminUser(req), driverId: req.params.id, ...req.body, ip: req.ip });
  res.status(204).end();
});

const inPersonSchema = z.object({ date, officer: z.string().trim().min(2).max(80) }).strict();
admin.post('/verifications/:id/in-person', uuidParam('id'), validateBody(inPersonSchema), async (req, res) => {
  await verification.recordInPerson({ admin: adminUser(req), driverId: req.params.id, date: req.body.date, officer: req.body.officer, ip: req.ip });
  res.status(204).end();
});

admin.post('/verifications/:id/approve', uuidParam('id'), async (req, res) => {
  await verification.approve({ admin: adminUser(req), driverId: req.params.id, ip: req.ip });
  res.status(204).end();
});
const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();
admin.post('/verifications/:id/reject', uuidParam('id'), validateBody(reasonSchema), async (req, res) => {
  await verification.reject({ admin: adminUser(req), driverId: req.params.id, reason: req.body.reason, ip: req.ip });
  res.status(204).end();
});
admin.post('/verifications/:id/suspend', uuidParam('id'), validateBody(reasonSchema), async (req, res) => {
  await verification.suspend({ admin: adminUser(req), driverId: req.params.id, reason: req.body.reason, ip: req.ip });
  res.status(204).end();
});
admin.post('/verifications/:id/reinstate', uuidParam('id'), async (req, res) => {
  res.json({ status: await verification.reinstate({ admin: adminUser(req), driverId: req.params.id, ip: req.ip }) });
});

admin.get('/documents/:docId/url', uuidParam('docId'), async (req, res) => res.json(await verification.documentUrl({ admin: adminUser(req), docId: req.params.docId, ip: req.ip })));

admin.get('/selfie-checks', async (req, res) => {
  const status = ['ok', 'flagged', 'cleared'].includes(req.query.status) ? req.query.status : null;
  res.json({ checks: await verification.listSelfieChecks(status) });
});
admin.post('/selfie-checks/:id', uuidParam('id'), validateBody(z.object({ status: z.enum(['flagged', 'cleared']) }).strict()), async (req, res) => {
  await verification.reviewSelfieCheck({ admin: adminUser(req), checkId: req.params.id, status: req.body.status, ip: req.ip });
  res.status(204).end();
});

// ---------------------------------------------------------------- public: signed document links, and the QR page
const pub = Router();
const limiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.app.locals.config.isTest,
  handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again in a minute.' } }),
});

/** Minimal public facts for the sticker's QR code: first name, car, plate, status. Nothing else. */
pub.get('/public/driver/:token', limiter, async (req, res) => res.json(await verification.publicDriver(req.params.token)));

/** Files, only with a link the API signed, valid for 5 minutes. There is no other way to a document. */
pub.get('/documents/:docId', limiter, uuidParam('docId'), async (req, res) => {
  const { buffer, mime } = await verification.serveDocument(req.params.docId, { exp: req.query.exp, who: req.query.who, sig: req.query.sig });
  res.set('Content-Type', mime);
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Disposition', 'inline');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(buffer);
});

module.exports = { driver, admin, pub };
