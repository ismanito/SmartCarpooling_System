const { Router } = require('express');
const { withTransaction } = require('../db/pool');
const { errors, PG } = require('../lib/errors');
const { changedFields } = require('../lib/changes');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { createProfileSchema, createStaffProfileSchema, updateProfileSchema } = require('../schemas/user');
const { appendAudit } = require('../services/audit');
const usersRepo = require('../repositories/users');

const router = Router();

const { emailKind } = require('../lib/emailDomain');
const { createDriverProfileSchema } = require('../schemas/user');
const { notifyMany, adminIds } = require('../services/notify');
const drivers = require('../repositories/drivers');

// The email address decides who you are: a university address is a student, a listed address is an admin,
// and (when driver sign-up is on) any other address applies to drive. Each gets the form that fits.
const SCHEMAS = { admin: createStaffProfileSchema, student: createProfileSchema, driver: createDriverProfileSchema };
/**
 * Who this email is. Demo-domain addresses are students by default, but may open a driver account when the person
 * asked for one, so demos need no real inbox for the driver either. Real university addresses never can.
 */
function kindOf(req) {
  const config = req.app.locals.config;
  const kind = emailKind(req.auth.email, config);
  const domain = req.auth.email.slice(req.auth.email.lastIndexOf('@') + 1);
  if (kind === 'student' && req.body?.accountType === 'driver' && (config.demoEmailDomains || []).includes(domain)) return 'driver';
  return kind;
}

const profileBody = (req, res, next) => {
  const kind = kindOf(req);
  if (!kind) return next(); // the handler below rejects it with the right error
  return validateBody(SCHEMAS[kind])(req, res, next);
};

/** Creates the RideMate profile for a freshly signed-up, verified Firebase user. */
router.post('/', requireAuth({ profile: false }), profileBody, async (req, res) => {
  if (req.user) throw errors.conflict('PROFILE_EXISTS', 'Your profile already exists.');

  // Defence in depth: requireAuth already checks this, but registration is the one place it must never slip.
  const kind = kindOf(req);
  if (!kind) {
    throw errors.forbidden('AUTH_DOMAIN_NOT_ALLOWED', 'RideMate is only open to verified university email addresses.');
  }

  try {
    const user = await withTransaction(async (client) => {
      const { licenceNumber, idNumber, about, accountType, ...profile } = req.body; // personType rides along for riders
      void accountType;
      const row = await usersRepo.create(client, {
        firebaseUid: req.auth.uid,
        email: req.auth.email,
        ...profile,
        faculty: kind === 'admin' ? 'Administration' : kind === 'driver' ? 'Driver' : profile.faculty,
        role: kind,
      });
      await appendAudit(client, {
        userId: row.user_id,
        action: 'user.create',
        entity: 'user',
        entityId: row.user_id,
        ipAddress: req.ip,
        details: { firebase_uid: req.auth.uid, role: row.role },
      });
      if (kind === 'driver') {
        const app = await drivers.createApplication(client, row.user_id, { licenceNumber, idNumber, about });
        await appendAudit(client, {
          userId: row.user_id,
          action: 'driver.apply',
          entity: 'driver_application',
          entityId: app.application_id,
          ipAddress: req.ip,
          details: { application_id: app.application_id, user_id: row.user_id },
        });
        await notifyMany(client, await adminIds(client), {
          type: 'driver.application',
          message: `${row.full_name} applied to drive. Review the application.`,
          link: '/admin?tab=drivers',
          email: true,
        });
      }
      return usersRepo.findById(row.user_id, client);
    });
    res.status(201).json({ user: usersRepo.toApi(user) });
  } catch (err) {
    if (err.code === PG.UNIQUE_VIOLATION) throw errors.conflict('PROFILE_EXISTS', 'A profile with this email already exists.');
    throw err;
  }
});

router.get('/me', requireAuth(), (req, res) => {
  res.json({ user: usersRepo.toApi(req.user.profile) });
});

router.put('/me', requireAuth(), validateBody(updateProfileSchema), async (req, res) => {
  const user = await withTransaction(async (client) => {
    const current = await usersRepo.findById(req.user.userId, client, { forUpdate: true });
    const fields = changedFields(current, req.body, usersRepo.UPDATABLE);
    if (fields.length === 0) return current;

    const updated = await usersRepo.updateProfile(client, req.user.userId, req.body);
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'user.update',
      entity: 'user',
      entityId: req.user.userId,
      ipAddress: req.ip,
      details: { fields },
    });
    return updated;
  });
  res.json({ user: usersRepo.toApi(user) });
});

module.exports = router;
