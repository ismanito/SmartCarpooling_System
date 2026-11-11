const { Pool, types } = require('pg');
const { config } = require('../config/env');

// Return NUMERIC as JS numbers (ratings, distances, scores are small and safe as floats).
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

/** Runs `fn(client)` inside BEGIN/COMMIT, rolling back on any error. `client.afterCommit(fn)` queues work for after COMMIT. */
async function withTransaction(fn) {
  const client = await pool.connect();
  const afterCommit = [];
  client.afterCommit = (task) => afterCommit.push(task); // e.g. emails, which must not go out if we roll back
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    for (const task of afterCommit) Promise.resolve().then(task).catch(() => {});
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
