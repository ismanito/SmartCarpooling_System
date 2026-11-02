import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../context/AuthContext'
import { FullPageSpinner } from '../components/ui/Spinner'

/**
 * Sends each visitor to the one screen they belong on.
 *  need="guest"      signed-out only (login, sign-up)
 *  need="unverified" signed in, email not yet verified
 *  need="onboarding" verified, no profile yet
 *  need="profile"    verified with a completed profile (the app)
 */
export default function ProtectedRoute({ need = 'profile' }) {
  const { status, firebaseUser, emailVerified, profile } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageSpinner />

  const signedIn = Boolean(firebaseUser)
  const home = !signedIn ? '/login' : !emailVerified ? '/verify-email' : !profile ? '/onboarding' : '/'

  const allowed = {
    guest: !signedIn,
    unverified: signedIn && !emailVerified,
    onboarding: signedIn && emailVerified && !profile,
    profile: signedIn && emailVerified && Boolean(profile),
  }[need]

  if (allowed) return <Outlet />
  return <Navigate to={home} replace state={need === 'profile' ? { from: location.pathname } : undefined} />
}
