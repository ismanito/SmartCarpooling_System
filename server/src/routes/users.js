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
const { z } = require('zod');

const { emailKind } = require('../lib/emailDomain');
const { createDriverProfileSchema } = require('../schemas/user');

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
        adminLevel: kind === 'admin' && (req.app.locals.config.seniorAdminEmails || []).includes(req.auth.email) ? 'senior_admin' : 'admin',
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
        // The verification wizard does the rest. Nothing to review until they submit it.
        await client.query(`INSERT INTO driver_verifications (driver_id, driver_type) VALUES ($1, 'external') ON CONFLICT DO NOTHING`, [row.user_id]);
      }
      return usersRepo.findById(row.user_id, client);
    });
    res.status(201).json({ user: usersRepo.toApi(user) });
  } catch (err) {
    if (err.code === PG.UNIQUE_VIOLATION) throw errors.conflict('PROFILE_EXISTS', 'A profile with this email already exists.');
    throw err;
  }
});

/** A rider's own choices. Right now: whether external (non-university) drivers may be matched with them. */
router.put('/me/settings', requireAuth(), validateBody(z.object({ allowExternalDrivers: z.boolean() }).strict()), async (req, res) => {
  const user = await withTransaction(async (client) => {
    const row = await usersRepo.setAllowExternal(client, req.user.userId, req.body.allowExternalDrivers);
    await appendAudit(client, { userId: req.user.userId, action: 'user.settings', entity: 'user', entityId: req.user.userId, ipAddress: req.ip, details: { allow_external_drivers: req.body.allowExternalDrivers } });
    return row;
  });
  res.json({ user: usersRepo.toApi(user) });
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
