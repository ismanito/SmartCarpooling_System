import { Navigate } from 'react-router'
import { useAuth } from '../context/AuthContext'
import RideHome from './RideHome.jsx'
import DriverHome from './DriverHome.jsx'

/** "/" is each portal's own home: the rider's map, the driver's dashboard, or the admin console. */
export default function HomeByRole() {
  const { profile } = useAuth()
  if (profile?.role === 'admin') return <Navigate to="/admin" replace />
  if (profile?.role === 'driver') return <DriverHome />
  return <RideHome />
}
