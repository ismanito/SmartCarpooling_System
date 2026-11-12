import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { getFirebaseAuth } from '../lib/firebase'
import { api, ApiError, DEAD_SESSION_CODES } from '../lib/api'
import { markVerificationSent } from '../hooks/useResendCooldown'

export const AuthContext = createContext(null)

/**
 * Holds Firebase identity + RideMate profile.
 * status: 'loading' while either is being resolved, then 'ready'.
 */
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading')
  const [firebaseUser, setFirebaseUser] = useState(null)
  const [emailVerified, setEmailVerified] = useState(false)
  const [profile, setProfile] = useState(null)
  const [profileError, setProfileError] = useState(null)

  const loadProfile = useCallback(async () => {
    setProfileError(null)
    try {
      const { user } = await api.getMe()
      setProfile(user)
    } catch (err) {
      setProfile(null)
      if (!(err instanceof ApiError && err.code === 'PROFILE_REQUIRED')) setProfileError(err)
    }
  }, [])

  useEffect(() => {
    const auth = getFirebaseAuth()
    return onAuthStateChanged(auth, async (user) => {
      setStatus('loading')
      if (user) {
        try {
          // Asks Firebase whether the account still exists; a cached token alone can look valid for up to an hour.
          await user.reload()
          await user.getIdToken()
        } catch (err) {
          if (DEAD_SESSION_CODES.has(err?.code)) {
            await signOut(auth) // fires this listener again with user = null
            return
          }
        }
      }
      setFirebaseUser(user)
      setEmailVerified(Boolean(user?.emailVerified))
      if (user?.emailVerified) await loadProfile()
      else setProfile(null)
      setStatus('ready')
    })
  }, [loadProfile])

  /** Records the sign-in on the server (audit log) and picks up the profile. */
  const startSession = useCallback(async () => {
    const { user } = await api.startSession()
    setProfile(user)
    setProfileError(null)
    return user
  }, [])

  const signUp = useCallback(async (email, password) => {
    const { allowed, demo, needsApplication } = await api.checkDomain(email)
    if (needsApplication) throw new ApiError(403, 'AUTH_DRIVER_NOT_APPROVED', 'External drivers must apply and be approved before creating an account. Go to Apply to drive (the /apply page).')
    if (!allowed) throw new ApiError(403, 'AUTH_DOMAIN_NOT_ALLOWED', 'Use your university email to create a student account. External drivers must apply first at /apply.')
    const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password)
    if (demo) {
      // Demo accounts have no real inbox: the server verifies them, then we pick that up.
      await api.demoVerify()
      await checkVerificationRef.current()
      return { user, verified: true }
    }
    await sendEmailVerification(user)
    markVerificationSent(user.uid)
    return { user, verified: false }
  }, [])

  const logIn = useCallback(
    async (email, password) => {
      const { user } = await signInWithEmailAndPassword(getFirebaseAuth(), email, password)
      if (!user.emailVerified) return { verified: false, profile: null }
      const p = await startSession()
      return { verified: true, profile: p }
    },
    [startSession],
  )

  const logOut = useCallback(async () => {
    await signOut(getFirebaseAuth())
    setProfile(null)
  }, [])

  const resendVerification = useCallback(async () => {
    const user = getFirebaseAuth().currentUser
    if (!user) return
    await sendEmailVerification(user)
    markVerificationSent(user.uid)
  }, [])

  const checkVerificationRef = useRef(async () => false)

  /** Re-reads verification state from Firebase. Returns true once the email is verified. */
  const checkVerification = useCallback(async () => {
    const user = getFirebaseAuth().currentUser
    if (!user) return false
    await user.reload()
    if (!user.emailVerified) return false
    await user.getIdToken(true) // refresh so the API sees email_verified=true
    setEmailVerified(true)
    await startSession()
    return true
  }, [startSession])

  useEffect(() => {
    checkVerificationRef.current = checkVerification
  }, [checkVerification])

  const sendReset = useCallback((email) => sendPasswordResetEmail(getFirebaseAuth(), email), [])

  const createProfile = useCallback(async (data) => {
    const { user } = await api.createProfile(data)
    setProfile(user)
    return user
  }, [])

  const updateProfile = useCallback(async (changes) => {
    const { user } = await api.updateProfile(changes)
    setProfile(user)
    return user
  }, [])

  const value = useMemo(
    () => ({
      status,
      firebaseUser,
      email: firebaseUser?.email || null,
      emailVerified,
      profile,
      profileError,
      signUp,
      logIn,
      logOut,
      resendVerification,
      checkVerification,
      sendReset,
      createProfile,
      updateProfile,
      reloadProfile: loadProfile,
    }),
    [status, firebaseUser, emailVerified, profile, profileError, signUp, logIn, logOut, resendVerification, checkVerification, sendReset, createProfile, updateProfile, loadProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
