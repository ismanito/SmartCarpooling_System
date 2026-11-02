const { errors } = require('../lib/errors');

function toFieldErrors(issues) {
  return issues.map((i) => ({ field: i.path.join('.') || null, message: i.message }));
}

/** Validates and replaces req.body with the parsed (normalised) value from a zod schema. */
function validateBody(schema) {
  return function validateMiddleware(req, res, next) {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', toFieldErrors(result.error.issues));
    }
    req.body = result.data;
    next();
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 404s on malformed ids so they never reach Postgres as invalid uuid input. */
function uuidParam(name) {
  return function uuidParamMiddleware(req, res, next) {
    if (!UUID_RE.test(req.params[name] || '')) throw errors.notFound();
    next();
  };
}

module.exports = { validateBody, uuidParam, toFieldErrors };
