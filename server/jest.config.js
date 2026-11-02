/** Integration tests share one Postgres test DB, so they run in band (see package.json). */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup/env.js'],
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  setupFilesAfterEnv: ['<rootDir>/tests/setup/afterEnv.js'],
  testTimeout: 15000,
};
