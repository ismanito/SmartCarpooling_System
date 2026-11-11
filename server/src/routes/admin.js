const { Router } = require('express');
const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const { errors } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { validateBody, uuidParam } = require('../middleware/validate');
const { verifyAuditChain, appendAudit } = require('../services/audit');
const admin = require('../repositories/admin');
const paymentsRepo = require('../repositories/payments');
const incidents = require('../services/incidents');
const driversRepo = require('../repositories/drivers');
const rides = require('../repositories/rides');
const { notify } = require('../services/notify');

const router = Router();
router.use(requireAuth(), requireRole('admin'));

const dateParam = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

async function loadDashboard(query) {
  const settings = await rides.loadMatchSettings();
  return admin.dashboard({ from: dateParam(query.from), to: dateParam(query.to), fuelRate: settings.fuelRateKesPerKm });
}

router.get('/stats', async (req, res) => {
  res.json({ stats: { ...(await admin.stats()), ...(await loadDashboard(req.query)) } });
});

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

router.get('/stats.csv', async (req, res) => {
  const d = await loadDashboard(req.query);
  const lines = [
    ['metric', 'value'],
    ['verified_students', d.verifiedStudents],
    ['active_trips', d.activeTrips],
    ['matches', d.matches],
    ['requests', d.requests],
    ['completed_rides', d.completedRides],
    ['average_rating', d.avgRating],
    ['estimated_savings_kes', d.estimatedSavingsKes],
    [],
    ['top_route', 'trips'],
    ...d.topRoutes.map((x) => [`${x.origin} to ${x.destination}`, x.trips]),
    [],
    ['week_starting', 'completed_rides'],
    ...d.ridesPerWeek.map((x) => [new Date(x.week).toISOString().slice(0, 10), x.rides]),
  ];
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="ridemate-stats.csv"');
  res.send(lines.map((l) => l.map(csvCell).join(',')).join('\r\n'));
});

/** Money overview: what has been billed, collected and is still owed, plus the latest fares. */
router.get('/payments', async (req, res) => {
  const [summary, rows] = await Promise.all([paymentsRepo.adminSummary(), paymentsRepo.adminRecent(50)]);
  res.json({
    summary,
    recent: rows.map((r) => ({
      paymentId: r.payment_id,
      totalKes: r.amount_kes,
      paidKes: r.paid_kes,
      status: r.status,
      seats: r.seats,
      rider: r.rider_name,
      driver: r.driver_name,
      trip: { origin: r.origin_name, destination: r.destination_name, departAt: r.depart_at },
      createdAt: r.created_at,
    })),
  });
});

/** Recomputes the audit hash chain and reports the first broken entry, if any. */
router.get('/audit/verify', async (req, res) => {
  const startedAt = Date.now();
  const result = await verifyAuditChain();
  res.json({ ...result, durationMs: Date.now() - startedAt });
});

router.get('/audit', async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  const before = /^\d+$/.test(req.query.before || '') ? req.query.before : null;
  const userId = /^[0-9a-f-]{36}$/i.test(req.query.userId || '') ? req.query.userId : null;
  const action = typeof req.query.action === 'string' && req.query.action.trim() ? req.query.action.trim().slice(0, 60) : null;
  res.json({ entries: await admin.listAudit({ limit, before, userId, action, from: dateParam(req.query.from), to: dateParam(req.query.to) }) });
});

router.get('/users', async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const status = ['active', 'suspended'].includes(req.query.status) ? req.query.status : null;
  const role = ['student', 'driver', 'admin'].includes(req.query.role) ? req.query.role : null;
  res.json({ users: await admin.listUsers(search, undefined, { status, role }) });
});

const statusSchema = z.object({ status: z.enum(['active', 'suspended']) }).strict();

async function changeStatus(req, res, status) {
  if (req.params.id === req.user.userId) {
    throw errors.conflict('CANNOT_CHANGE_SELF', 'You cannot suspend your own account.');
  }
  const user = await withTransaction((client) => incidents.setUserStatus(client, { adminId: req.user.userId, userId: req.params.id, status, ip: req.ip }));
  res.json({ user: { userId: user.user_id, status: user.status } });
}

router.post('/users/:id/status', uuidParam('id'), validateBody(statusSchema), (req, res) => changeStatus(req, res, req.body.status));
router.post('/users/:id/suspend', uuidParam('id'), (req, res) => changeStatus(req, res, 'suspended'));
router.post('/users/:id/reinstate', uuidParam('id'), (req, res) => changeStatus(req, res, 'active'));

// ---------------------------------------------------------------- driver applications

router.get('/drivers', async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  res.json({ applications: await driversRepo.list(status) });
});

const driverDecisionSchema = z
  .object({
    decision: z.enum(['approved', 'rejected'], { message: 'Choose approve or reject' }),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

router.post('/drivers/:id/decision', uuidParam('id'), validateBody(driverDecisionSchema), async (req, res) => {
  await withTransaction(async (client) => {
    const app = await driversRepo.findForUpdate(client, req.params.id);
    if (!app) throw errors.notFound('Application not found.');
    if (app.status !== 'pending') throw errors.conflict('APPLICATION_CLOSED', `This application is already ${app.status}.`);
    await driversRepo.decide(client, app.application_id, { status: req.body.decision, notes: req.body.notes, adminId: req.user.userId });
    await appendAudit(client, {
      userId: req.user.userId,
      action: req.body.decision === 'approved' ? 'driver.approve' : 'driver.reject',
      entity: 'driver_application',
      entityId: app.application_id,
      ipAddress: req.ip,
      details: { application_id: app.application_id, user_id: app.user_id, decision: req.body.decision },
    });
    await notify(client, {
      userId: app.user_id,
      type: req.body.decision === 'approved' ? 'driver.approved' : 'driver.rejected',
      message:
        req.body.decision === 'approved'
          ? 'Your driver application was approved. You can now add your vehicle and offer rides.'
          : `Your driver application was not approved.${req.body.notes ? ` Reason: ${req.body.notes}` : ''} You can fix your details and apply again.`,
      link: '/driver',
      email: true,
    });
  });
  res.json({ applications: await driversRepo.list(null) });
});

// ---------------------------------------------------------------- incident reports

router.get('/incidents', async (req, res) => {
  const status = ['open', 'in_review', 'closed'].includes(req.query.status) ? req.query.status : null;
  res.json({ incidents: await incidents.list(status) });
});

router.get('/incidents/:id', uuidParam('id'), async (req, res) => {
  const detail = await incidents.detail(req.params.id);
  if (!detail) throw errors.notFound('Report not found.');
  res.json({ incident: detail });
});

const decisionSchema = z
  .object({
    decision: z.enum(['dismissed', 'warning', 'suspended'], { message: 'Choose a decision' }),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

router.post('/incidents/:id/decision', uuidParam('id'), validateBody(decisionSchema), async (req, res) => {
  await withTransaction((client) =>
    incidents.decide(client, { adminId: req.user.userId, reportId: req.params.id, decision: req.body.decision, notes: req.body.notes, ip: req.ip }),
  );
  res.json({ incident: await incidents.detail(req.params.id) });
});

/** The audit entries tied to one report, plus the chain check, as a file with its own SHA-256. */
router.get('/incidents/:id/evidence', uuidParam('id'), async (req, res) => {
  const pack = await incidents.evidence(req.params.id);
  if (!pack) throw errors.notFound('Report not found.');
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="evidence-${req.params.id}.json"`);
  res.set('X-Evidence-SHA256', pack.sha256);
  res.send(pack.body);
});

router.get('/settings', async (req, res) => {
  res.json({ settings: await admin.listSettings(), limits: admin.MATCH_SETTINGS });
});

const settingsSchema = z
  .object(
    Object.fromEntries(
      Object.entries(admin.MATCH_SETTINGS).map(([key, { min, max }]) => [
        key,
        z.coerce.number().min(min, `Must be at least ${min}`).max(max, `Must be at most ${max}`).optional(),
      ]),
    ),
  )
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Change at least one setting' });

router.put('/settings', validateBody(settingsSchema), async (req, res) => {
  const changes = Object.entries(req.body).filter(([, v]) => v !== undefined);
  await withTransaction(async (client) => {
    for (const [key, value] of changes) await admin.saveSetting(client, key, value, req.user.userId);
    const after = await admin.listSettings(client);
    const weightSum = after.w_overlap + after.w_time + after.w_detour;
    if (weightSum <= 0) {
      throw errors.badRequest('VALIDATION_ERROR', 'At least one matching weight must be above 0.');
    }
    if (Math.abs(weightSum - 1) > 0.011) {
      throw errors.badRequest('VALIDATION_ERROR', `The three weights must add up to 1 (they add up to ${Math.round(weightSum * 100) / 100}).`);
    }
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'settings.update',
      entity: 'system_settings',
      ipAddress: req.ip,
      details: Object.fromEntries(changes),
    });
  });
  res.json({ settings: await admin.listSettings() });
});

module.exports = router;
