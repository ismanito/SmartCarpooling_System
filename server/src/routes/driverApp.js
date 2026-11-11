const { Router } = require('express');
const { errors } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { validateBody, uuidParam } = require('../middleware/validate');
const { onlineSchema, locationSchema, rateSchema } = require('../schemas/dispatch');
const driverApp = require('../services/driverApp');
const dispatch = require('../services/dispatch');
const rideOps = require('../services/rideOps');

const authed = [requireAuth(), requireRole('student', 'driver')];
const me = (req) => ({ userId: req.user.userId, role: req.user.role, driverStatus: req.user.driverStatus });
const studentsCanDrive = (req) => req.app.locals.config.studentsCanDrive !== false;

/** The driving screens belong to driver accounts. Rider accounts get in only while STUDENTS_CAN_DRIVE is on. */
function driversOnly(req, res, next) {
  if (req.user.role === 'student' && !studentsCanDrive(req)) throw errors.forbidden('DRIVERS_ONLY', 'This area is for driver accounts.');
  next();
}

// ---------------------------------------------------------------- the driver's own screen (/api/driver)
const driver = Router();
driver.use(...authed, driversOnly);

driver.get('/state', async (req, res) => res.json(await driverApp.state(me(req), studentsCanDrive(req))));
driver.get('/dashboard', async (req, res) => res.json(await driverApp.dashboard(req.user.userId)));
driver.get('/history', async (req, res) => res.json(await driverApp.history(req.user.userId)));

driver.post('/online', validateBody(onlineSchema), async (req, res) => {
  res.json(await driverApp.goOnline({ user: me(req), vehicleId: req.body.vehicleId, lat: req.body.lat, lng: req.body.lng, ip: req.ip, studentsCanDrive: studentsCanDrive(req) }));
});
driver.post('/offline', async (req, res) => {
  await driverApp.goOffline({ userId: req.user.userId, ip: req.ip });
  res.status(204).end();
});
driver.post('/location', validateBody(locationSchema), async (req, res) => {
  await driverApp.updateLocation({ userId: req.user.userId, ...req.body });
  res.status(204).end();
});

// ---------------------------------------------------------------- answering an offer (/api/offers)
const offers = Router();
offers.use(...authed, driversOnly);
offers.post('/:id/accept', uuidParam('id'), async (req, res) => {
  res.json(await dispatch.acceptOffer({ offerId: req.params.id, driverId: req.user.userId, ip: req.ip }));
});
offers.post('/:id/decline', uuidParam('id'), async (req, res) => {
  await dispatch.declineOffer({ offerId: req.params.id, driverId: req.user.userId, ip: req.ip });
  res.status(204).end();
});

// ---------------------------------------------------------------- inside a ride (/api/rides/:id/...)
const rides = Router();
rides.use(...authed);
const act = (name, fn) => async (req, res) => {
  const out = await fn(req);
  void name;
  if (out === undefined) res.status(204).end();
  else res.json(out);
};

rides.get('/:id/live', uuidParam('id'), act('live', (req) => rideOps.liveView({ rideId: req.params.id, userId: req.user.userId })));
rides.post('/:id/stops/:stopId/arrived', uuidParam('id'), uuidParam('stopId'), act('arrived', (req) => rideOps.arrived({ rideId: req.params.id, stopId: req.params.stopId, driverId: req.user.userId, ip: req.ip })));
rides.post('/:id/stops/:stopId/done', uuidParam('id'), uuidParam('stopId'), act('done', (req) => rideOps.done({ rideId: req.params.id, stopId: req.params.stopId, driverId: req.user.userId, ip: req.ip })));
rides.post('/:id/stops/:stopId/no-show', uuidParam('id'), uuidParam('stopId'), act('no-show', (req) => rideOps.noShow({ rideId: req.params.id, stopId: req.params.stopId, driverId: req.user.userId, ip: req.ip })));
rides.post('/:id/complete', uuidParam('id'), act('complete', (req) => rideOps.completeRide({ rideId: req.params.id, driverId: req.user.userId, ip: req.ip })));
rides.post('/:id/ratings', uuidParam('id'), validateBody(rateSchema), async (req, res) => {
  await rideOps.rate({ rideId: req.params.id, raterId: req.user.userId, rateeId: req.body.rateeId, stars: req.body.stars, tags: req.body.tags, comment: req.body.comment, ip: req.ip });
  res.status(201).json({ stars: req.body.stars });
});
rides.post('/:id/sos', uuidParam('id'), act('sos', (req) => rideOps.sos({ rideId: req.params.id, userId: req.user.userId, ip: req.ip })));

// ---------------------------------------------------------------- paying (/api/ride-shares)
const shares = Router();
shares.use(...authed, driversOnly);
shares.post('/:id/settle', uuidParam('id'), act('settle', (req) => rideOps.settleShare({ shareId: req.params.id, driverId: req.user.userId, ip: req.ip })));

module.exports = { driver, offers, rides, shares };
