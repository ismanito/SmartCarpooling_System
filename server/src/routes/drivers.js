const { Router } = require('express');
const { withTransaction } = require('../db/pool');
const { errors } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { validateBody } = require('../middleware/validate');
const { driverApplicationSchema } = require('../schemas/user');
const { appendAudit } = require('../services/audit');
const { notifyMany, adminIds } = require('../services/notify');
const drivers = require('../repositories/drivers');

const router = Router();
router.use(requireAuth(), requireRole('driver'));

router.get('/application', async (req, res) => {
  res.json({ application: await drivers.findByUser(req.user.userId) });
});

/** A rejected driver corrects their details and applies again. */
router.post('/application', validateBody(driverApplicationSchema), async (req, res) => {
  await withTransaction(async (client) => {
    const app = await drivers.resubmit(client, req.user.userId, req.body);
    if (!app) throw errors.conflict('NOT_REJECTED', 'You can only apply again after an application was rejected.');
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'driver.reapply',
      entity: 'driver_application',
      entityId: app.application_id,
      ipAddress: req.ip,
      details: { application_id: app.application_id, user_id: req.user.userId },
    });
    await notifyMany(client, await adminIds(client), {
      type: 'driver.application',
      message: `${req.user.profile.full_name} sent a new driver application.`,
      link: '/admin?tab=drivers',
    });
  });
  res.status(204).end();
});

module.exports = router;
