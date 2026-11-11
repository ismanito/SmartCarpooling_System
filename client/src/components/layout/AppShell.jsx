import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../../context/AuthContext.jsx'
import { Logo } from './Logo.jsx'
import { NotificationBell } from './NotificationBell.jsx'
import { InstallButton } from './InstallButton.jsx'

/**
 * Three separate portals, each with its own menu and look:
 *  - riders (students and staff): ask for rides, bookings, ride history
 *  - drivers: dashboard, the map, history, cost shared, ratings, vehicles (side menu on larger screens)
 *  - admins: the console
 */
const RIDER_LINKS = [
  { to: '/', label: 'Ride', end: true },
  { to: '/bookings', label: 'My bookings' },
  { to: '/my-rides', label: 'My rides' },
  { to: '/profile', label: 'Profile' },
]

const DRIVER_LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/drive', label: 'Drive', end: true },
  { to: '/drive/history', label: 'Ride history' },
  { to: '/drive/cost', label: 'Cost shared' },
  { to: '/drive/ratings', label: 'Ratings' },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/drive/safety', label: 'Safety' },
  { to: '/profile', label: 'Profile' },
]

// Until a driver is approved they see their application, their vehicle and their profile.
const PENDING_DRIVER_LINKS = [
  { to: '/', label: 'My application', end: true },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/profile', label: 'Profile' },
]

const ADMIN_LINKS = [
  { to: '/admin', label: 'Admin console' },
  { to: '/profile', label: 'Profile' },
]

function portalFor(profile) {
  if (profile?.role === 'admin') return { id: 'admin', label: 'Admin', chip: 'bg-coral', links: ADMIN_LINKS }
  if (profile?.role === 'driver') {
    return { id: 'driver', label: 'Driver', chip: 'bg-mint', links: profile.driverStatus === 'approved' ? DRIVER_LINKS : PENDING_DRIVER_LINKS, sidebar: true }
  }
  return { id: 'rider', label: profile?.personType === 'staff' ? 'Staff' : 'Student', chip: 'bg-gold', links: RIDER_LINKS }
}

const topLink = ({ isActive }) =>
  `focus-ring whitespace-nowrap rounded-(--radius-control) px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-gold text-asphalt' : 'text-paper hover:bg-white/10'}`
const sideLink = ({ isActive }) =>
  `focus-ring block rounded-(--radius-control) px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? 'bg-ink text-gold' : 'text-ink hover:bg-ink/8'}`

export default function AppShell() {
  const { profile, logOut } = useAuth()
  const portal = portalFor(profile)

  return (
    <div className="flex min-h-dvh flex-col pb-[env(safe-area-inset-bottom)]">
      <header className="bg-asphalt">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Logo />
          <span className={`rounded-(--radius-chip) px-2 py-0.5 text-xs font-semibold tracking-wider text-asphalt uppercase ${portal.chip}`}>{portal.label}</span>
          {/* On phones every portal gets a scrolling menu; larger screens give drivers a side menu instead. */}
          <nav aria-label="Main" className={`order-3 -mx-1 flex w-full gap-1 overflow-x-auto px-1 pb-1 md:order-2 md:flex-1 md:pb-0 ${portal.sidebar ? 'md:hidden' : 'md:w-auto'}`}>
            {portal.links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={topLink}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="order-2 ml-auto flex items-center gap-1 md:order-3">
            <InstallButton className="hidden sm:inline-flex" />
            <NotificationBell />
            <button type="button" onClick={logOut} className="focus-ring min-h-11 rounded-(--radius-control) px-3 text-sm text-paper underline-offset-4 hover:underline">
              Log out
            </button>
          </div>
        </div>
        <div className="lane-horizontal h-[3px]" aria-hidden />
      </header>

      <div className={`mx-auto flex w-full max-w-6xl flex-1 ${portal.sidebar ? 'md:gap-8' : ''}`}>
        {portal.sidebar && (
          <aside className="hidden w-56 shrink-0 border-r border-ink/15 px-4 py-8 md:block">
            <nav aria-label="Driver menu" className="sticky top-6 space-y-1">
              {portal.links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className={sideLink}>
                  {l.label}
                </NavLink>
              ))}
            </nav>
          </aside>
        )}
        <main className="min-w-0 flex-1 px-4 py-6 md:py-10">
          <Outlet />
        </main>
      </div>
      <div className="px-4 pb-6 sm:hidden">
        <InstallButton className="w-full justify-center border-ink/40! text-ink!" />
      </div>
    </div>
  )
}
