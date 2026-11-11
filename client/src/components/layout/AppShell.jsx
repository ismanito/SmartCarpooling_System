import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../../context/AuthContext.jsx'
import { Logo } from './Logo.jsx'
import { NotificationBell } from './NotificationBell.jsx'
import { InstallButton } from './InstallButton.jsx'

const STUDENT_LINKS = [
  { to: '/', label: 'Ride', end: true },
  { to: '/bookings', label: 'My bookings' },
  { to: '/drive', label: 'Drive' },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/classic', label: 'Classic carpool (old)' },
  { to: '/profile', label: 'Profile' },
]

// Vetted drivers (not students) only drive. Until they are approved they just see their application and vehicles.
const DRIVER_LINKS = [
  { to: '/drive', label: 'Drive', end: true },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/classic', label: 'Classic carpool (old)' },
  { to: '/profile', label: 'Profile' },
]
const PENDING_DRIVER_LINKS = [
  { to: '/drive', label: 'My application', end: true },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/profile', label: 'Profile' },
]

// Admins are staff, not students: no rides, no vehicles.
const ADMIN_LINKS = [
  { to: '/admin', label: 'Admin' },
  { to: '/profile', label: 'Profile' },
]

const linkClass = ({ isActive }) =>
  `focus-ring whitespace-nowrap rounded-(--radius-control) px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-gold text-asphalt' : 'text-paper hover:bg-white/10'
  }`

export default function AppShell() {
  const { profile, logOut } = useAuth()
  const links =
    profile?.role === 'admin'
      ? ADMIN_LINKS
      : profile?.role === 'driver'
        ? profile.driverStatus === 'approved'
          ? DRIVER_LINKS
          : PENDING_DRIVER_LINKS
        : STUDENT_LINKS

  return (
    <div className="flex min-h-dvh flex-col pb-[env(safe-area-inset-bottom)]">
      <header className="bg-asphalt">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Logo />
          <nav aria-label="Main" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto px-1 pb-1 md:order-2 md:w-auto md:flex-1 md:pb-0">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="order-2 ml-auto flex items-center gap-1 md:order-3 md:ml-0">
            <InstallButton className="hidden sm:inline-flex" />
            <NotificationBell />
            <button
              type="button"
              onClick={logOut}
              className="focus-ring min-h-11 rounded-(--radius-control) px-3 text-sm text-paper underline-offset-4 hover:underline"
            >
              Log out
            </button>
          </div>
        </div>
        <div className="lane-horizontal h-[3px]" aria-hidden />
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:py-10">
        <Outlet />
      </main>
      <div className="px-4 pb-6 sm:hidden">
        <InstallButton className="w-full justify-center border-ink/40! text-ink!" />
      </div>
    </div>
  )
}
