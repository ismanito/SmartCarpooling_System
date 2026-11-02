const { errors } = require('../lib/errors');

/** Use after requireAuth(). Allows the request only if req.user.role is one of `roles`. */
function requireRole(...roles) {
  return function roleMiddleware(req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      throw errors.forbidden('FORBIDDEN_ROLE', 'You do not have permission to do this.');
    }
    next();
  };
}

module.exports = { requireRole };
