const { errors } = require('../lib/errors');
const { canUseApp } = require('../lib/emailDomain');
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
 *  allowUnverified is only for the demo-verify route, which runs before the email is marked verified.
 *
 * @param {{ profile?: boolean }} opts profile=true (default) also requires a completed profile.
 *   Use profile=false only for routes that run before onboarding (session, create profile).
 */
function requireAuth({ profile = true, allowUnverified = false } = {}) {
  return async function authMiddleware(req, res, next) {
    const token = bearerToken(req);
    if (!token) throw errors.unauthorized('AUTH_MISSING_TOKEN', 'Sign in to continue.');

    let identity;
    try {
      identity = await req.app.locals.verifyIdToken(token);
    } catch {
      throw errors.unauthorized('AUTH_INVALID_TOKEN', 'Your session is invalid or has expired. Sign in again.');
    }

    if (!identity.emailVerified && !allowUnverified) {
      throw errors.forbidden('AUTH_EMAIL_UNVERIFIED', 'Verify your email address before continuing.');
    }
    const { allowedEmailDomains, adminEmails = [], allowDriverSignup = false } = req.app.locals.config;
    if (!canUseApp(identity.email, allowedEmailDomains, adminEmails, allowDriverSignup)) {
      throw errors.forbidden('AUTH_DOMAIN_NOT_ALLOWED', 'RideMate is only open to verified university email addresses.');
    }

    let user = await usersRepo.findByFirebaseUid(identity.uid);
    // Local emulator accounts can be wiped while their profile survives; reconnect by verified email.
    // Never runs against real Firebase.
    if (!user && req.app.locals.config.firebase?.useEmulator) {
      user = await usersRepo.relinkByEmail(identity.uid, identity.email.toLowerCase());
    }
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
    req.user = user ? { userId: user.user_id, role: user.role, driverStatus: user.driver_status || null, profile: user } : null;
    next();
  };
}

module.exports = { requireAuth, bearerToken };
