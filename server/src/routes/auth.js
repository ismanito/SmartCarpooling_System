const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const { withTransaction } = require('../db/pool');
const { emailDomain, isAllowedEmail } = require('../lib/emailDomain');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { checkDomainSchema } = require('../schemas/user');
const { appendAudit } = require('../services/audit');
const usersRepo = require('../repositories/users');

const router = Router();

// Public endpoints are rate-limited to slow down probing.
const publicLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.app.locals.config.isTest,
  handler: (req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again in a minute.' } }),
});

/** Public: domains students may register with (used for the sign-up notice). */
router.get('/domains', publicLimiter, (req, res) => {
  res.json({ allowedDomains: req.app.locals.config.allowedEmailDomains });
});

/** Public: whether an email's domain may register. */
router.post('/check-domain', publicLimiter, validateBody(checkDomainSchema), (req, res) => {
  const { allowedEmailDomains } = req.app.locals.config;
  res.json({
    allowed: isAllowedEmail(req.body.email, allowedEmailDomains),
    domain: emailDomain(req.body.email),
    allowedDomains: allowedEmailDomains,
  });
});

/**
 * Called by the client right after Firebase sign-in. Records the sign-in in the audit log
 * and tells the client whether onboarding is still needed.
 */
router.post('/session', requireAuth({ profile: false }), async (req, res) => {
  const profile = req.user?.profile || null;
  await withTransaction((client) =>
    appendAudit(client, {
      userId: req.user?.userId ?? null,
      action: 'auth.sign_in',
      entity: 'user',
      entityId: req.user?.userId ?? req.auth.uid,
      ipAddress: req.ip,
      details: { firebase_uid: req.auth.uid, has_profile: Boolean(profile), user_agent: req.get('user-agent') || null },
    }),
  );
  res.json({ user: usersRepo.toApi(profile), needsProfile: !profile });
});

module.exports = router;
