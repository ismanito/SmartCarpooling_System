const path = require('node:path');
const { z } = require('zod');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const boolFromString = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  TRUST_PROXY: boolFromString,
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),
  ALLOWED_EMAIL_DOMAINS: z.string().min(1, 'ALLOWED_EMAIL_DOMAINS is required'),
  FIREBASE_PROJECT_ID: z.string().default('demo-ridemate'),
  FIREBASE_USE_EMULATOR: boolFromString,
  FIREBASE_AUTH_EMULATOR_HOST: z.string().default('127.0.0.1:9099'),
  GOOGLE_MAPS_SERVER_KEY: z.string().optional().default(''),
  MATCHER_URL: z.string().default('http://localhost:8000'),
  MATCHER_INTERNAL_KEY: z.string().optional().default(''),
});

/** Parses "usiu.ac.ke, Example.org" → ['usiu.ac.ke', 'example.org'] */
function parseDomains(raw) {
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

function loadConfig(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = parsed.data;
  return {
    nodeEnv: env.NODE_ENV,
    isTest: env.NODE_ENV === 'test',
    port: env.PORT,
    corsOrigin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    trustProxy: env.TRUST_PROXY,
    databaseUrl: env.DATABASE_URL,
    testDatabaseUrl: env.TEST_DATABASE_URL,
    allowedEmailDomains: parseDomains(env.ALLOWED_EMAIL_DOMAINS),
    firebase: {
      projectId: env.FIREBASE_PROJECT_ID,
      useEmulator: env.FIREBASE_USE_EMULATOR,
      authEmulatorHost: env.FIREBASE_AUTH_EMULATOR_HOST,
    },
    googleMapsKey: env.GOOGLE_MAPS_SERVER_KEY,
    matcher: { url: env.MATCHER_URL, internalKey: env.MATCHER_INTERNAL_KEY },
  };
}

const config = loadConfig();

module.exports = { config, loadConfig, parseDomains };
