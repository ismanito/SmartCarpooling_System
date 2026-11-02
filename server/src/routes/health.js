const { Router } = require('express');
const { pool } = require('../db/pool');

const router = Router();

// Public. Reports API liveness and whether Postgres is reachable.
router.get('/', async (req, res) => {
  let db = 'up';
  try {
    await pool.query('SELECT 1');
  } catch {
    db = 'down';
  }
  res.status(db === 'up' ? 200 : 503).json({ status: db === 'up' ? 'ok' : 'degraded', db, time: new Date().toISOString() });
});

module.exports = router;
