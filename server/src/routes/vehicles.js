const { Router } = require('express');
const { withTransaction } = require('../db/pool');
const { errors, PG } = require('../lib/errors');
const { changedFields } = require('../lib/changes');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { memberOrApplicant } = require('../middleware/applicant');
const { validateBody, uuidParam } = require('../middleware/validate');
const { createVehicleSchema, updateVehicleSchema } = require('../schemas/vehicle');
const { appendAudit } = require('../services/audit');
const vehiclesRepo = require('../repositories/vehicles');
const ridesRepo = require('../repositories/rides');

const router = Router();
router.use(memberOrApplicant('student', 'driver'));

function plateConflict(err) {
  if (err.code === PG.UNIQUE_VIOLATION) {
    return errors.conflict('PLATE_TAKEN', 'A vehicle with this number plate is already registered.');
  }
  return err;
}

router.get('/mine', async (req, res) => {
  const rows = await vehiclesRepo.listByOwner(req.user.userId);
  res.json({ vehicles: rows.map(vehiclesRepo.toApi) });
});

router.post('/', validateBody(createVehicleSchema), async (req, res) => {
  try {
    const vehicle = await withTransaction(async (client) => {
      const row = await vehiclesRepo.create(client, req.user.userId, req.body);
      await appendAudit(client, {
        userId: req.user.userId,
        action: 'vehicle.create',
        entity: 'vehicle',
        entityId: row.vehicle_id,
        ipAddress: req.ip,
        details: { plate_number: row.plate_number, seat_capacity: row.seat_capacity },
      });
      return row;
    });
    res.status(201).json({ vehicle: vehiclesRepo.toApi(vehicle) });
  } catch (err) {
    throw plateConflict(err);
  }
});

// Non-owners get 404, not 403, so vehicle ids belonging to other students are not confirmed to exist.
router.put('/:id', uuidParam('id'), validateBody(updateVehicleSchema), async (req, res) => {
  try {
    const vehicle = await withTransaction(async (client) => {
      const current = await vehiclesRepo.findOwned(client, req.params.id, req.user.userId);
      if (!current) throw errors.notFound('Vehicle not found.');

      const fields = changedFields(current, req.body, vehiclesRepo.UPDATABLE);
      if (fields.length === 0) return current;

      const updated = await vehiclesRepo.update(client, req.params.id, req.user.userId, req.body);
      await appendAudit(client, {
        userId: req.user.userId,
        action: 'vehicle.update',
        entity: 'vehicle',
        entityId: updated.vehicle_id,
        ipAddress: req.ip,
        details: { fields },
      });
      return updated;
    });
    res.json({ vehicle: vehiclesRepo.toApi(vehicle) });
  } catch (err) {
    throw plateConflict(err);
  }
});

router.delete('/:id', uuidParam('id'), async (req, res) => {
  await withTransaction(async (client) => {
    const current = await vehiclesRepo.findOwned(client, req.params.id, req.user.userId);
    if (!current) throw errors.notFound('Vehicle not found.');
    if ((await ridesRepo.countActiveOffersForVehicle(client, current.vehicle_id)) > 0) {
      throw errors.conflict('VEHICLE_IN_USE', 'This vehicle has upcoming ride offers. Cancel them first.');
    }
    await vehiclesRepo.remove(client, req.params.id, req.user.userId);
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'vehicle.delete',
      entity: 'vehicle',
      entityId: current.vehicle_id,
      ipAddress: req.ip,
      details: { plate_number: current.plate_number },
    });
  });
  res.status(204).end();
});

module.exports = router;
