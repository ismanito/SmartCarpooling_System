const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { config: defaultConfig } = require('./config/env');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

/**
 * Builds the Express app without listening, so tests can drive it with Supertest.
 * @param {object} [deps]
 * @param {Function} [deps.verifyIdToken] token verifier; defaults to the Firebase Admin SDK
 * @param {Function} [deps.markEmailVerified] marks an email verified (demo accounts); defaults to the Admin SDK
 * @param {object} [deps.config] overrides the environment config
 */
function createApp({ verifyIdToken, markEmailVerified, config = defaultConfig } = {}) {
  const app = express();

  app.locals.config = config;
  app.locals.verifyIdToken = verifyIdToken || require('./lib/firebase').verifyIdToken;
  app.locals.markEmailVerified = markEmailVerified || ((uid) => require('./lib/firebase').markEmailVerified(uid));

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', require('./routes/health'));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/vehicles', require('./routes/vehicles'));
  // Ride Now / Book. These run before the classic carpool routes, which stay mounted below.
  const driverRoutes = require('./routes/driverApp');
  app.use('/api/requests', require('./routes/requests'));
  const verificationRoutes = require('./routes/verification');
  app.use('/api/apply', require('./routes/apply')); // external drivers applying before they have an account
  app.use('/api/driver/verification', verificationRoutes.driver); // before /api/driver: unverified people must reach it
  app.use('/api/driver', driverRoutes.driver);
  app.use('/api/offers', driverRoutes.offers);
  app.use('/api/rides', driverRoutes.rides);
  app.use('/api/ride-shares', driverRoutes.shares);
  app.use('/api/rides', require('./routes/rides'));
  app.use('/api/rides', require('./routes/rideDetails'));
  app.use('/api/notifications', require('./routes/notifications'));
  app.use('/api/payments', require('./routes/payments'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/admin', require('./routes/adminDispatch'));
  app.use('/api/admin', verificationRoutes.admin);
  app.use('/api', verificationRoutes.pub);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
