// Usage: npm run migrate          (DATABASE_URL)
//        npm run migrate:test     (TEST_DATABASE_URL)
const { config } = require('../src/config/env');
const { migrate } = require('../src/db/migrator');

const useTest = process.argv.includes('--test');
const url = useTest ? config.testDatabaseUrl : config.databaseUrl;

if (!url) {
  console.error(useTest ? 'TEST_DATABASE_URL is not set' : 'DATABASE_URL is not set');
  process.exit(1);
}

migrate(url, { log: (m) => console.log(m) })
  .then((ran) => {
    console.log(ran.length ? `Done – ${ran.length} migration(s) applied.` : 'Database is up to date.');
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
