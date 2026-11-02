import { Routes, Route, Navigate } from 'react-router'
import './App.css'
import { ProtectedRoute } from './routes/ProtectedRoute.jsx'
import Login from './routes/Login.jsx'
import SignUp from './routes/SignUp.jsx'
import VerifyEmail from './routes/VerifyEmail.jsx'
import Onboarding from './routes/Onboarding.jsx'
import Home from './routes/Home.jsx'
import Profile from './routes/Profile.jsx'
import Vehicles from './routes/Vehicles.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute need="onboarding">
            <Onboarding />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute need="profile">
            <Profile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vehicles"
        element={
          <ProtectedRoute need="profile">
            <Vehicles />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute need="profile">
            <Home />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
