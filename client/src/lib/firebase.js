import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'

let auth = null

/** Lazily initialised so tests and module imports never touch Firebase. */
export function getFirebaseAuth() {
  if (auth) return auth
  const env = import.meta.env
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID || undefined,
  })
  auth = getAuth(app)
  if (env.VITE_FIREBASE_USE_EMULATOR === 'true') {
    connectAuthEmulator(auth, env.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9099', {
      disableWarnings: true,
    })
  }
  return auth
}
