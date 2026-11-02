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

module.exports = { verifyIdToken };
