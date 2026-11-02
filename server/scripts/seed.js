// Syncs settings that come from the environment into system_settings,
// then runs every db/seed/*.sql file in order.
const fs = require('node:fs');
const path = require('node:path');
const { config } = require('../src/config/env');
const { pool } = require('../src/db/pool');

const SEED_DIR = path.join(__dirname, '..', '..', 'db', 'seed');

async function main() {
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value) VALUES ('allowed_email_domains', $1)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
    [config.allowedEmailDomains.join(',')],
  );
  console.log(`allowed_email_domains = ${config.allowedEmailDomains.join(',')}`);

  const files = fs.existsSync(SEED_DIR)
    ? fs.readdirSync(SEED_DIR).filter((f) => f.endsWith('.sql')).sort()
    : [];
  for (const file of files) {
    await pool.query(fs.readFileSync(path.join(SEED_DIR, file), 'utf8'));
    console.log(`seeded ${file}`);
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
