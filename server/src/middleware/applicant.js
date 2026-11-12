const { requireAuth } = require('./auth');
const { requireRole } = require('./requireRole');
const { errors } = require('../lib/errors');
const applicants = require('../services/applicants');

/**
 * Applicants have no sign-in yet. They prove who they are with the reference code they were given when they
 * applied, sent in the X-Application-Token header. It reaches only their own application.
 */
async function applicantAuth(req, res, next) {
  const applicant = await applicants.byToken(req.get('x-application-token'));
  if (!applicant) throw errors.unauthorized('APPLICANT_INVALID', 'That reference code was not recognised, or the account was already created. Log in instead.');
  req.isApplicant = true;
  req.auth = { uid: null, email: applicant.university_email };
  req.user = { userId: applicant.user_id, role: 'driver', adminLevel: null, driverStatus: null, driverType: 'external', profile: { ...applicant, role: 'driver', person_type: 'student' } };
  next();
}

/** For routes shared between signed-in people and applicants: applicants skip the sign-in check. */
function memberOrApplicant(...roles) {
  const signedIn = requireAuth();
  const allowed = requireRole(...roles);
  return (req, res, next) => {
    if (req.isApplicant) return next();
    return Promise.resolve(signedIn(req, res, (err) => (err ? next(err) : Promise.resolve(allowed(req, res, next)).catch(next)))).catch(next);
  };
}

module.exports = { applicantAuth, memberOrApplicant };
