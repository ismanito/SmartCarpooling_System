// Applies all migrations to the test database once per test run.
module.exports = async function globalSetup() {
  require('./env');
  const { migrate } = require('../../src/db/migrator');
  try {
    await migrate(process.env.DATABASE_URL);
  } catch (err) {
    throw new Error(
      `Could not migrate the test database (${process.env.DATABASE_URL}).\n` +
        `Is Postgres running? Try: docker compose up -d\n${err.message}`,
    );
  }
};
