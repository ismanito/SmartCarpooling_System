import { Routes, Route, Navigate } from 'react-router'
import ProtectedRoute from './routes/ProtectedRoute.jsx'
import AppShell from './components/layout/AppShell.jsx'
import AuthLayout from './components/layout/AuthLayout.jsx'
import Login from './routes/Login.jsx'
import SignUp from './routes/SignUp.jsx'
import ForgotPassword from './routes/ForgotPassword.jsx'
import VerifyEmail from './routes/VerifyEmail.jsx'
import Onboarding from './routes/Onboarding.jsx'
import Home from './routes/Home.jsx'
import Profile from './routes/Profile.jsx'
import Vehicles from './routes/Vehicles.jsx'
import FindRide from './routes/FindRide.jsx'
import OfferRide from './routes/OfferRide.jsx'
import Admin from './routes/Admin.jsx'
import DriverDashboard from './routes/DriverDashboard.jsx'
import StudentOnly from './routes/StudentOnly.jsx'
import DriverArea from './routes/DriverArea.jsx'
import ClassicLayout from './routes/ClassicLayout.jsx'
import MyRides from './routes/MyRides.jsx'
import RideHome from './routes/RideHome.jsx'
import DriverApp from './routes/DriverApp.jsx'
import Bookings from './routes/Bookings.jsx'
import RideDetails from './routes/RideDetails.jsx'

// ProtectedRoute renders <Outlet />, so it is used as a layout route around its pages.
export default function App() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route element={<ProtectedRoute need="guest" />}>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
        </Route>
        <Route element={<ProtectedRoute need="unverified" />}>
          <Route path="/verify-email" element={<VerifyEmail />} />
        </Route>
        <Route element={<ProtectedRoute need="onboarding" />}>
          <Route path="/onboarding" element={<Onboarding />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute need="profile" />}>
        <Route element={<AppShell />}>
          <Route path="/profile" element={<Profile />} />
          <Route path="/admin" element={<Admin />} />
          {/* Ride Now / Book */}
          <Route element={<StudentOnly />}>
            <Route path="/" element={<RideHome />} />
            <Route path="/bookings" element={<Bookings />} />
          </Route>
          <Route element={<DriverArea />}>
            <Route path="/drive" element={<DriverApp />} />
            <Route path="/vehicles" element={<Vehicles />} />
          </Route>
          {/* Classic carpool (deprecated): drivers post trips and riders search them. Kept until you confirm removal. */}
          <Route element={<ClassicLayout />}>
            <Route element={<StudentOnly />}>
              <Route path="/classic" element={<Home />} />
              <Route path="/rides/find" element={<FindRide />} />
            </Route>
            <Route element={<DriverArea />}>
              <Route path="/driver" element={<DriverDashboard />} />
            </Route>
            <Route element={<DriverArea needApproval />}>
              <Route path="/rides" element={<MyRides />} />
              <Route path="/rides/offer" element={<OfferRide />} />
              <Route path="/rides/:offerId" element={<RideDetails />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
