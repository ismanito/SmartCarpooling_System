// Runs before every test file: point the app at the test database and pin test settings.
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://ridemate:ridemate@localhost:5432/ridemate_test';
process.env.ALLOWED_EMAIL_DOMAINS = 'usiu.ac.ke';
process.env.FIREBASE_USE_EMULATOR = 'false';
