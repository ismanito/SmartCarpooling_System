// Each test file gets its own module registry (and pg pool); close it so Jest can exit.
const { pool } = require('../../src/db/pool');

afterAll(async () => {
  await pool.end();
});
