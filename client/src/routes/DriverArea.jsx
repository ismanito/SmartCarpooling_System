import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../context/AuthContext'

/** Driving screens: students and drivers. Admins are staff and go to their console. */
export default function DriverArea({ needApproval = false }) {
  const { profile } = useAuth()
  if (profile?.role === 'admin') return <Navigate to="/admin" replace />
  // A driver whose application is still being reviewed (or was rejected) lands on the status page.
  if (needApproval && profile?.role === 'driver' && profile.driverStatus !== 'approved') return <Navigate to="/driver" replace />
  return <Outlet />
}
