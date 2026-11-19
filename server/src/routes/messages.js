const { Router } = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { validateBody, uuidParam } = require('../middleware/validate');
const messages = require('../services/messages');

const router = Router();
const authed = [requireAuth(), requireRole('student', 'driver')];
const slow = rateLimit({
  windowMs: 60_000,
  limit: 30,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'You are sending messages too fast. Wait a moment.' } },
});
const riderQuery = z.uuid().optional();

router.get('/:id/messages', ...authed, uuidParam('id'), async (req, res) => {
  const riderId = riderQuery.safeParse(req.query.riderId).data;
  res.json(await messages.list({ rideId: req.params.id, userId: req.user.userId, riderId, markRead: req.query.read === '1' }));
});

router.get('/:id/messages/unread', ...authed, uuidParam('id'), async (req, res) => {
  res.json(await messages.unread({ rideId: req.params.id, userId: req.user.userId }));
});

const sendSchema = z.object({ body: z.string().trim().min(1, 'Write a message first').max(300, 'Keep it under 300 characters'), riderId: z.uuid().optional() }).strict();
router.post('/:id/messages', ...authed, slow, uuidParam('id'), validateBody(sendSchema), async (req, res) => {
  res.status(201).json(await messages.send({ rideId: req.params.id, userId: req.user.userId, riderId: req.body.riderId, body: req.body.body }));
});

module.exports = router;
