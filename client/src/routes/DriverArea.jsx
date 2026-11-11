import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../context/AuthContext'

/**
 * Driver screens. Only driver accounts belong here: riders go back to their own home and admins to the console.
 * A driver whose application is still being reviewed (or was rejected) sees the application page instead.
 */
export default function DriverArea({ needApproval = false }) {
  const { profile } = useAuth()
  if (profile?.role === 'admin') return <Navigate to="/admin" replace />
  if (profile?.role !== 'driver') return <Navigate to="/" replace />
  if (needApproval && profile.driverStatus !== 'approved') return <Navigate to="/" replace />
  return <Outlet />
}
