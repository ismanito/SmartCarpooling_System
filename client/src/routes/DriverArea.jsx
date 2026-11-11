import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../context/AuthContext'

/**
 * Driver screens. Driver accounts, and student or staff accounts that have been verified as drivers, belong here.
 * Everyone else is sent to the verification page (or their own home), and admins to the console.
 */
export default function DriverArea({ needApproval = false }) {
  const { profile } = useAuth()
  if (profile?.role === 'admin') return <Navigate to="/admin" replace />
  const approved = profile?.driverStatus === 'approved'
  if (needApproval && !approved) return <Navigate to={profile?.role === 'driver' ? '/' : '/become-driver'} replace />
  if (!needApproval && profile?.role !== 'driver' && !approved) return <Navigate to="/become-driver" replace />
  return <Outlet />
}
