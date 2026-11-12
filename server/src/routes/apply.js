const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { validateBody } = require('../middleware/validate');
const { applicantAuth } = require('../middleware/applicant');
const { createDriverProfileSchema } = require('../schemas/user');
const applicants = require('../services/applicants');
const verificationRoutes = require('./verification');

const router = Router();
const limiter = rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many applications from this connection. Try again later.' } } });

const startSchema = createDriverProfileSchema.extend({ email: z.string().trim().min(3).max(254) }).strict();

/** Starts an external driver application. No account is needed. */
router.post('/', limiter, validateBody(startSchema), async (req, res) => {
  const out = await applicants.create({ email: req.body.email, fullName: req.body.fullName, phoneNumber: req.body.phoneNumber, config: req.app.locals.config, ip: req.ip });
  res.status(201).json(out);
});

// The same verification wizard endpoints a signed-in driver uses, reached with the reference code instead.
router.use(applicantAuth);
router.use('/verification', verificationRoutes.driver);
router.use('/vehicles', require('./vehicles'));

module.exports = router;
