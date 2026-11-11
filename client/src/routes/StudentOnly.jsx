import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../context/AuthContext'

/** Rider screens: students and staff. Drivers and admins have their own portals. */
export default function StudentOnly() {
  const { profile } = useAuth()
  if (profile?.role === 'admin') return <Navigate to="/admin" replace />
  if (profile?.role === 'driver') return <Navigate to="/" replace />
  return <Outlet />
}
