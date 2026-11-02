const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { verifyAuditChain } = require('../services/audit');

const router = Router();
router.use(requireAuth(), requireRole('admin'));

/** Recomputes the audit hash chain and reports the first broken entry, if any. */
router.get('/audit/verify', async (req, res) => {
  const startedAt = Date.now();
  const result = await verifyAuditChain();
  res.json({ ...result, durationMs: Date.now() - startedAt });
});

module.exports = router;
