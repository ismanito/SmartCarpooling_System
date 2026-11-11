// Pure-function tests only; no database or global migration step.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/unit.test.js', '<rootDir>/tests/dispatch.unit.test.js', '<rootDir>/tests/verification.unit.test.js'],
  setupFiles: ['<rootDir>/tests/setup/env.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/afterEnv.js'],
};
