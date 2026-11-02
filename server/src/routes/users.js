const { Router } = require('express');
const { withTransaction } = require('../db/pool');
const { errors, PG } = require('../lib/errors');
const { changedFields } = require('../lib/changes');
const { isAllowedEmail } = require('../lib/emailDomain');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { createProfileSchema, updateProfileSchema } = require('../schemas/user');
const { appendAudit } = require('../services/audit');
const usersRepo = require('../repositories/users');

const router = Router();

/** Creates the RideMate profile for a freshly signed-up, verified Firebase user. */
router.post('/', requireAuth({ profile: false }), validateBody(createProfileSchema), async (req, res) => {
  if (req.user) throw errors.conflict('PROFILE_EXISTS', 'Your profile already exists.');

  // Defence in depth: requireAuth already checks this, but registration is the one place it must never slip.
  if (!isAllowedEmail(req.auth.email, req.app.locals.config.allowedEmailDomains)) {
    throw errors.forbidden('AUTH_DOMAIN_NOT_ALLOWED', 'RideMate is only open to verified university email addresses.');
  }

  try {
    const user = await withTransaction(async (client) => {
      const row = await usersRepo.create(client, { firebaseUid: req.auth.uid, email: req.auth.email, ...req.body });
      await appendAudit(client, {
        userId: row.user_id,
        action: 'user.create',
        entity: 'user',
        entityId: row.user_id,
        ipAddress: req.ip,
        details: { firebase_uid: req.auth.uid },
      });
      return row;
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
