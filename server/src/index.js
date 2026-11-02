const { createApp } = require('./app');
const { config } = require('./config/env');
const { pool } = require('./db/pool');

const app = createApp();
const server = app.listen(config.port, () => {
  const mode = config.firebase.useEmulator ? `Firebase Auth Emulator @ ${config.firebase.authEmulatorHost}` : 'Firebase (live)';
  console.log(`RideMate API on http://localhost:${config.port}  [${config.nodeEnv}, ${mode}]`);
});

function shutdown() {
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
