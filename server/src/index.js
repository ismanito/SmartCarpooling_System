const { createApp } = require('./app');
const { config } = require('./config/env');
const { pool } = require('./db/pool');

const app = createApp();
const server = require('node:http').createServer(app);

// Live updates to the apps over Socket.IO (they also poll, so nothing breaks if the socket drops).
const { verifyIdToken } = require('./lib/firebase');
const usersRepo = require('./repositories/users');
require('./services/realtime').init(server, {
  verifyIdToken,
  findUserByFirebaseUid: (uid) => usersRepo.findByFirebaseUid(uid),
  corsOrigin: config.corsOrigin,
});
require('./services/booking').start(); // offer timeouts, scheduled bookings, stale drivers

server.listen(config.port, () => {
  const mode = config.firebase.useEmulator ? `Firebase Auth Emulator @ ${config.firebase.authEmulatorHost}` : 'Firebase (live)';
  console.log(`RideMate API on http://localhost:${config.port}  [${config.nodeEnv}, ${mode}]`);
});

function shutdown() {
  require('./services/booking').stop();
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
