import { initializeApp } from 'firebase/app'
import { confirmPasswordReset, connectAuthEmulator, getAuth } from 'firebase/auth'

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

/** True when the app talks to the local Firebase Auth Emulator (never in production). */
export const usingAuthEmulator = import.meta.env.VITE_FIREBASE_USE_EMULATOR === 'true'

/**
 * Emulator only: marks the signed-in user's email as verified, since the emulator
 * never sends real emails. Uses the emulator's admin ("Bearer owner") REST API.
 */
export async function emulatorVerifyEmail() {
  if (!usingAuthEmulator) throw new Error('Only available with the Auth Emulator.')
  const user = getFirebaseAuth().currentUser
  if (!user) throw new Error('Sign in first.')
  const env = import.meta.env
  const base = env.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9099'
  const res = await fetch(
    `${base}/identitytoolkit.googleapis.com/v1/projects/${env.VITE_FIREBASE_PROJECT_ID}/accounts:update`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ localId: user.uid, emailVerified: true }),
    },
  )
  if (!res.ok) throw new Error('Could not verify the email in the emulator.')
}

/**
 * Emulator only: the emulator has no reset page (its link just returns JSON), so for local demos the app
 * looks up the reset code it created and lets the person choose a new password right here.
 * With real Firebase the emailed link opens Firebase's own reset page instead.
 */
export async function emulatorResetPassword(email, newPassword) {
  if (!usingAuthEmulator) throw new Error('Only available with the Auth Emulator.')
  const env = import.meta.env
  const base = env.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9099'
  const res = await fetch(`${base}/emulator/v1/projects/${env.VITE_FIREBASE_PROJECT_ID}/oobCodes`)
  if (!res.ok) throw new Error('Could not reach the local sign-in emulator.')
  const { oobCodes = [] } = await res.json()
  const match = oobCodes.filter((c) => c.requestType === 'PASSWORD_RESET' && c.email?.toLowerCase() === email.toLowerCase()).at(-1)
  if (!match) throw new Error('No reset request found for that email. Send the reset link first.')
  await confirmPasswordReset(getFirebaseAuth(), match.oobCode, newPassword)
}
