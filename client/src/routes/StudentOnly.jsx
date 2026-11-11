import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../context/AuthContext'

/** Rider screens are for students. Admins go to their console and drivers to their dashboard. */
export default function StudentOnly() {
  const { profile } = useAuth()
  if (profile?.role === 'admin') return <Navigate to="/admin" replace />
  if (profile?.role === 'driver') return <Navigate to="/driver" replace />
  return <Outlet />
}
