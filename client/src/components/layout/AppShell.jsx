import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { EllipsisVertical, LogOut } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { Logo } from './Logo.jsx'
import { NotificationBell } from './NotificationBell.jsx'
import { InstallButton } from './InstallButton.jsx'

/**
 * Three separate portals, each with its own menu and look:
 *  - riders (students and staff): dashboard, ride, bookings, ride history
 *  - drivers: dashboard, the map, history, cost shared, ratings, vehicles (side menu on larger screens)
 *  - admins: the console
 *
 * On a phone only the first few links sit in the bar; the rest, Install and Log out live in the three-dot menu.
 */
const RIDER_LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/ride', label: 'Ride' },
  { to: '/bookings', label: 'Bookings' },
  { to: '/my-rides', label: 'My rides' },
  { to: '/become-driver', label: 'Become a driver' },
  { to: '/profile', label: 'Profile' },
]
// A student or staff member who has been verified as a driver can switch to driving and back.
const RIDER_WHO_DRIVE_LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/ride', label: 'Ride' },
  { to: '/bookings', label: 'Bookings' },
  { to: '/my-rides', label: 'My rides' },
  { to: '/drive/dashboard', label: 'Driver mode' },
  { to: '/profile', label: 'Profile' },
]

const DRIVER_LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/drive', label: 'Drive', end: true },
  { to: '/drive/history', label: 'Ride history' },
  { to: '/drive/cost', label: 'Cost shared' },
  { to: '/drive/ratings', label: 'Ratings' },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/become-driver', label: 'Verification' },
  { to: '/drive/safety', label: 'Safety' },
  { to: '/profile', label: 'Profile' },
]
// The same menu for a rider in driver mode: the dashboard lives at /drive/dashboard and there is a way back.
const DRIVER_MODE_LINKS = [
  { to: '/drive/dashboard', label: 'Dashboard', end: true },
  { to: '/drive', label: 'Drive', end: true },
  { to: '/drive/history', label: 'Ride history' },
  { to: '/drive/cost', label: 'Cost shared' },
  { to: '/drive/ratings', label: 'Ratings' },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/become-driver', label: 'Verification' },
  { to: '/', label: 'Rider mode', end: true },
  { to: '/profile', label: 'Profile' },
]

// Until a driver is approved they see their application, their vehicle and their profile.
const PENDING_DRIVER_LINKS = [
  { to: '/', label: 'Verification', end: true },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/profile', label: 'Profile' },
]

const ADMIN_LINKS = [
  { to: '/admin', label: 'Admin console' },
  { to: '/profile', label: 'Profile' },
]

const PHONE_VISIBLE = 3 // links kept in the bar on a phone; the rest go in the three-dot menu

function portalFor(profile, path) {
  if (profile?.role === 'admin') return { id: 'admin', label: 'Admin', chip: 'bg-coral', links: ADMIN_LINKS }
  const verified = profile?.driverStatus === 'approved'
  if (profile?.role === 'student' && verified) {
    const inDriverMode = path.startsWith('/drive') || path.startsWith('/vehicles')
    return inDriverMode
      ? { id: 'driver', label: 'Driver', chip: 'bg-mint', links: DRIVER_MODE_LINKS, sidebar: true }
      : { id: 'rider', label: profile.personType === 'staff' ? 'Staff' : 'Student', chip: 'bg-gold', links: RIDER_WHO_DRIVE_LINKS }
  }
  if (profile?.role === 'driver') {
    return { id: 'driver', label: 'Driver', chip: 'bg-mint', links: profile.driverStatus === 'approved' ? DRIVER_LINKS : PENDING_DRIVER_LINKS, sidebar: true }
  }
  return { id: 'rider', label: profile?.personType === 'staff' ? 'Staff' : 'Student', chip: 'bg-gold', links: RIDER_LINKS }
}

const topLink = ({ isActive }) =>
  `focus-ring whitespace-nowrap rounded-(--radius-control) px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-gold text-asphalt' : 'text-paper hover:bg-white/10'}`
const pill = ({ isActive }) =>
  `focus-ring flex min-h-9 flex-1 items-center justify-center rounded-full px-2 text-[13px] font-medium whitespace-nowrap transition-colors ${isActive ? 'bg-gold text-asphalt' : 'bg-white/10 text-paper'}`
const sideLink = ({ isActive }) =>
  `focus-ring block rounded-(--radius-control) px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? 'bg-ink text-gold' : 'text-ink hover:bg-ink/8'}`
const menuLink = ({ isActive }) =>
  `focus-ring flex min-h-11 items-center rounded-(--radius-control) px-3 text-sm font-medium ${isActive ? 'bg-ink text-gold' : 'text-ink hover:bg-ink/8'}`

/** The three-dot menu: the rest of the links on a phone, plus Install and Log out. */
function MoreMenu({ links, logOut }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return undefined
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !box.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex size-11 items-center justify-center rounded-full text-paper hover:bg-white/10"
      >
        <EllipsisVertical size={22} aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="More" className="absolute top-full right-0 z-50 mt-1 w-56 max-w-[calc(100vw-1.5rem)] rounded-(--radius-panel) border border-ink/20 bg-surface p-1.5 shadow-xl">
          {links.map((l) => (
            <NavLink key={l.to + l.label} to={l.to} end={l.end} role="menuitem" className={menuLink}>
              {l.label}
            </NavLink>
          ))}
          {links.length > 0 && <div className="my-1 border-t border-ink/15" />}
          <InstallButton className="w-full justify-start border-0! text-ink!" />
          <button type="button" role="menuitem" onClick={logOut} className="focus-ring flex min-h-11 w-full items-center gap-2 rounded-(--radius-control) px-3 text-sm font-medium text-ink hover:bg-ink/8">
            <LogOut size={16} aria-hidden /> Log out
          </button>
        </div>
      )}
    </div>
  )
}

export default function AppShell() {
  const { profile, logOut } = useAuth()
  const { pathname } = useLocation()
  const portal = portalFor(profile, pathname)
  const bar = portal.links.slice(0, PHONE_VISIBLE)
  const rest = portal.links.slice(PHONE_VISIBLE)

  return (
    <div className="flex min-h-dvh flex-col pb-[env(safe-area-inset-bottom)]">
      <header className="sticky top-0 z-40 bg-asphalt">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-x-3 px-3 py-1.5 md:px-4 md:py-3">
          <Logo />
          <span className={`rounded-(--radius-chip) px-2 py-0.5 text-[11px] font-semibold tracking-wider text-asphalt uppercase md:text-xs ${portal.chip}`}>{portal.label}</span>
          {/* Larger screens: every link in the bar (drivers get a side menu instead). */}
          <nav aria-label="Main" className={`hidden flex-1 gap-1 md:flex ${portal.sidebar ? 'md:hidden' : ''}`}>
            {portal.links.map((l) => (
              <NavLink key={l.to + l.label} to={l.to} end={l.end} className={topLink}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-0.5">
            <NotificationBell />
            <button type="button" onClick={logOut} className="focus-ring hidden min-h-11 rounded-(--radius-control) px-3 text-sm text-paper underline-offset-4 hover:underline md:block">
              Log out
            </button>
            {/* Phones: Install, Log out and the extra links sit in the three-dot menu. */}
            <div className="md:hidden">
              <MoreMenu links={rest} logOut={logOut} />
            </div>
            <div className="hidden md:block">
              <InstallButton />
            </div>
          </div>
        </div>
        {/* Phones: the most important links stay visible as a compact row. */}
        <nav aria-label="Main" className="mx-auto flex w-full max-w-6xl gap-1.5 px-3 pb-2 md:hidden">
          {bar.map((l) => (
            <NavLink key={l.to + l.label} to={l.to} end={l.end} className={pill}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="lane-horizontal h-[3px]" aria-hidden />
      </header>

      <div className={`mx-auto flex w-full max-w-6xl flex-1 ${portal.sidebar ? 'md:gap-8' : ''}`}>
        {portal.sidebar && (
          <aside className="hidden w-56 shrink-0 border-r border-ink/15 px-4 py-8 md:block">
            <nav aria-label="Driver menu" className="sticky top-24 space-y-1">
              {portal.links.map((l) => (
                <NavLink key={l.to + l.label} to={l.to} end={l.end} className={sideLink}>
                  {l.label}
                </NavLink>
              ))}
            </nav>
          </aside>
        )}
        <main className="min-w-0 flex-1 px-3 py-3 md:px-4 md:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
