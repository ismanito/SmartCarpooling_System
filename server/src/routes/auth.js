const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const { withTransaction } = require('../db/pool');
const { emailDomain, canUseApp, isAdminEmail, emailKind } = require('../lib/emailDomain');
const { errors } = require('../lib/errors');
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
  const { allowedEmailDomains, adminEmails = [], allowDriverSignup = false, demoEmailDomains = [] } = req.app.locals.config;
  const kind = emailKind(req.body.email, req.app.locals.config);
  res.json({
    allowed: canUseApp(req.body.email, allowedEmailDomains, adminEmails, allowDriverSignup),
    staff: isAdminEmail(req.body.email, adminEmails),
    kind, // 'student' | 'driver' | 'admin' | null
    demo: kind === 'student' && demoEmailDomains.includes(emailDomain(req.body.email)),
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

/**
 * Demo accounts only: marks the signed-in person's email as verified without an inbox.
 * Works only for domains listed in DEMO_EMAIL_DOMAINS, which should stay empty in production.
 */
router.post('/demo-verify', requireAuth({ profile: false, allowUnverified: true }), async (req, res) => {
  const { demoEmailDomains = [] } = req.app.locals.config;
  if (!demoEmailDomains.includes(emailDomain(req.auth.email))) {
    throw errors.forbidden('DEMO_NOT_ALLOWED', 'Demo verification is not available for this email address.');
  }
  await req.app.locals.markEmailVerified(req.auth.uid);
  await withTransaction((client) =>
    appendAudit(client, {
      userId: req.user?.userId ?? null,
      action: 'auth.demo_verify',
      entity: 'user',
      entityId: req.user?.userId ?? req.auth.uid,
      ipAddress: req.ip,
      details: { firebase_uid: req.auth.uid, domain: emailDomain(req.auth.email) },
    }),
  );
  res.json({ verified: true });
});

module.exports = router;
