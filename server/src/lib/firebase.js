const { config } = require('../config/env');

let authInstance = null;

/** Lazily initialises the Firebase Admin SDK so tests (which inject a fake verifier) never load it. */
function getFirebaseAuth() {
  if (authInstance) return authInstance;

  const { initializeApp, applicationDefault, getApps } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');

  if (config.firebase.useEmulator) {
    // The Admin SDK reads this variable and accepts the emulator's unsigned tokens.
    process.env.FIREBASE_AUTH_EMULATOR_HOST = config.firebase.authEmulatorHost;
  } else {
    // The .env file lists the emulator address too. If it leaked into the environment the Admin SDK would
    // switch to emulator mode and reject every real token as having an invalid signature.
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  }

  const app =
    getApps()[0] ||
    initializeApp(
      config.firebase.useEmulator
        ? { projectId: config.firebase.projectId }
        : { credential: applicationDefault(), projectId: config.firebase.projectId },
    );

  authInstance = getAuth(app);
  return authInstance;
}

/**
 * Verifies a Firebase ID token.
 * @returns {Promise<{ uid: string, email: string|undefined, emailVerified: boolean }>}
 */
async function verifyIdToken(idToken) {
  const decoded = await getFirebaseAuth().verifyIdToken(idToken);
  return { uid: decoded.uid, email: decoded.email, emailVerified: decoded.email_verified === true };
}

/** Marks a Firebase account's email as verified (demo accounts only; the caller checks the domain). */
async function markEmailVerified(uid) {
  await getFirebaseAuth().updateUser(uid, { emailVerified: true });
}

module.exports = { verifyIdToken, markEmailVerified };
