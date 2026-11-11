const { Router } = require('express');
const { pool } = require('../db/pool');
const { errors } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const { uuidParam } = require('../middleware/validate');

const router = Router();
router.use(requireAuth()); // every signed-in person, admins included, has a bell

const toApi = (n) => ({
  notificationId: n.notification_id,
  type: n.type,
  message: n.message,
  link: n.link,
  isRead: n.is_read,
  createdAt: n.created_at,
});

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30',
    [req.user.userId],
  );
  const { rows: unread } = await pool.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = false', [req.user.userId]);
  res.json({ notifications: rows.map(toApi), unreadCount: unread[0].n });
});

router.post('/read-all', async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [req.user.userId]);
  res.status(204).end();
});

router.post('/:id/read', uuidParam('id'), async (req, res) => {
  const { rowCount } = await pool.query('UPDATE notifications SET is_read = true WHERE notification_id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
  if (rowCount === 0) throw errors.notFound('Notification not found.');
  res.status(204).end();
});

module.exports = router;
