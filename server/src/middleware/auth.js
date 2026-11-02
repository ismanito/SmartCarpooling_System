const { errors } = require('../lib/errors');
const { isAllowedEmail } = require('../lib/emailDomain');
const usersRepo = require('../repositories/users');

function bearerToken(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/**
 * Authentication middleware.
 *  1. verifies the Firebase ID token (verifier injected via app.locals for testability)
 *  2. rejects unverified emails and non-university domains
 *  3. loads the user's profile + role from Postgres and attaches req.user
 *
 * @param {{ profile?: boolean }} opts profile=true (default) also requires a completed profile.
 *   Use profile=false only for routes that run before onboarding (session, create profile).
 */
function requireAuth({ profile = true } = {}) {
  return async function authMiddleware(req, res, next) {
    const token = bearerToken(req);
    if (!token) throw errors.unauthorized('AUTH_MISSING_TOKEN', 'Sign in to continue.');

    let identity;
    try {
      identity = await req.app.locals.verifyIdToken(token);
    } catch {
      throw errors.unauthorized('AUTH_INVALID_TOKEN', 'Your session is invalid or has expired. Sign in again.');
    }

    if (!identity.emailVerified) {
      throw errors.forbidden('AUTH_EMAIL_UNVERIFIED', 'Verify your email address before continuing.');
    }
    const { allowedEmailDomains } = req.app.locals.config;
    if (!isAllowedEmail(identity.email, allowedEmailDomains)) {
      throw errors.forbidden('AUTH_DOMAIN_NOT_ALLOWED', 'RideMate is only open to verified university email addresses.');
    }

    let user = await usersRepo.findByFirebaseUid(identity.uid);
    if (user && user.status === 'suspended') {
      throw errors.forbidden('USER_SUSPENDED', 'Your account has been suspended. Contact the RideMate team.');
    }
    if (user && !user.is_verified) {
      user = await usersRepo.markVerified(user.user_id);
    }
    if (profile && !user) {
      throw errors.forbidden('PROFILE_REQUIRED', 'Complete your profile first.');
    }

    req.auth = { uid: identity.uid, email: identity.email.toLowerCase() };
    req.user = user ? { userId: user.user_id, role: user.role, profile: user } : null;
    next();
  };
}

module.exports = { requireAuth, bearerToken };
