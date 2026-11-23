import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CalendarClock, ChevronRight, MapPin, ShieldCheck } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { Alert } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { kes } from '../components/ride/bits.jsx'
import { formatWhen } from '../components/rides/RideBits.jsx'
import { LineChart, Mini, Ring, Segmented, Tile } from '../components/charts/Charts.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLive } from '../hooks/useLive.js'
import { api } from '../lib/api.js'

const LIVE = ['searching', 'offered', 'assigned', 'en_route', 'arrived', 'on_trip', 'in_progress']
const SHORT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const WEEKS = 8

/** Completed rides and money shared in each of the last six weeks (weeks start on Monday). */
function weekly(rides) {
  const monday = new Date()
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const starts = Array.from({ length: WEEKS }, (_, i) => new Date(monday.getTime() - (WEEKS - 1 - i) * 7 * 86_400_000))
  return starts.map((start, i) => {
    const end = i === WEEKS - 1 ? Infinity : starts[i + 1].getTime()
    const all = rides.filter((r) => new Date(r.at) >= start && new Date(r.at) < end)
    const inWeek = all.filter((r) => r.status === 'completed')
    return {
      label: SHORT.format(start),
      rides: inWeek.length,
      cancelled: all.filter((r) => r.status === 'cancelled').length,
      none: all.filter((r) => r.status === 'no_driver').length,
      kes: inWeek.reduce((s, r) => s + (r.shareKes || 0), 0),
      avg: inWeek.length ? Math.round(inWeek.reduce((s, r) => s + (r.shareKes || 0), 0) / inWeek.length) : 0,
    }
  })
}

/** The rider's own dashboard: the first screen after login. Compact enough to see at a glance on a phone. The map lives at /ride. */
export default function RiderDashboard() {
  const { profile } = useAuth()
  const history = useLive(api.requestHistory, { events: ['request:update'], pollMs: 20000 })
  const requests = useLive(api.myTripRequests, { events: ['request:update'], pollMs: 15000 })
  const rides = history.data?.rides
  const weeks = useMemo(() => (rides ? weekly(rides) : []), [rides])
  const [metric, setMetric] = useState('rides')

  if (!history.data || !requests.data) return history.error ? <Alert tone="error">{history.error}</Alert> : <Spinner />
  const { summary } = history.data
  const now = requests.data.requests
  const live = now.find((r) => r.type !== 'scheduled' && LIVE.includes(r.status))
  const upcoming = now
    .filter((r) => r.type === 'scheduled' && ['scheduled', 'searching', 'offered', 'assigned', 'no_driver'].includes(r.status) && new Date(r.scheduledFor) > Date.now() - 3600_000)
    .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))
  const paidPct = summary.sharedKes > 0 ? Math.round(((summary.sharedKes - summary.owedKes) / summary.sharedKes) * 100) : null
  const done = rides.filter((r) => r.status === 'completed')

  // One short list: the next booking first, then the latest rides.
  const rows = [
    ...upcoming.slice(0, 1).map((r) => ({ key: r.requestId, title: `${r.pickup.label} to ${r.dropoff.label}`, sub: `Booked · ${formatWhen(r.scheduledFor)}`, to: '/bookings' })),
    ...done.slice(0, upcoming.length ? 2 : 3).map((r) => ({ key: r.requestId, title: `${r.pickup} to ${r.dropoff}`, sub: `${formatWhen(r.at)}${r.driverFirstName ? ` · ${r.driverFirstName}` : ''}${r.shareKes !== null ? ` · ${kes(r.shareKes)}` : ''}`, to: '/my-rides' })),
  ]

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wider text-ink/85 uppercase">{profile.personType === 'staff' ? 'Staff' : 'Student'} dashboard</p>
          <h1 className="truncate font-display text-4xl leading-none font-semibold tracking-wide text-ink-deep uppercase md:text-5xl">Hi, {profile.fullName.split(' ')[0]}</h1>
        </div>
        <div className="hidden gap-2 sm:flex">
          <Button to="/ride" size="sm"><MapPin size={16} aria-hidden /> Ride now</Button>
          <Button to="/ride" size="sm" variant="secondary"><CalendarClock size={16} aria-hidden /> Book for later</Button>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        <Button to="/ride" size="sm"><MapPin size={16} aria-hidden /> Ride now</Button>
        <Button to="/ride" size="sm" variant="secondary"><CalendarClock size={16} aria-hidden /> Book for later</Button>
      </div>

      {live && (
        <Link to="/ride" className="focus-ring flex items-center justify-between gap-2 rounded-(--radius-panel) bg-asphalt px-3 py-2.5 text-paper">
          <span className="min-w-0">
            <span className="block font-display text-xl leading-none font-semibold tracking-wide uppercase">Ride in progress</span>
            <span className="block truncate text-xs text-paper/85">{live.pickup?.label} to {live.dropoff?.label}</span>
          </span>
          <span className="flex shrink-0 items-center text-sm text-gold">Open map <ChevronRight size={16} aria-hidden /></span>
        </Link>
      )}
      {profile.driverStatus === 'approved' && (
        <Link to="/drive/dashboard" className="focus-ring flex items-center justify-between gap-2 rounded-(--radius-panel) border border-mint bg-surface px-3 py-2 text-ink">
          <span className="text-sm font-medium">✓ You are a Verified Driver</span>
          <span className="flex shrink-0 items-center text-sm underline underline-offset-4">Driver dashboard <ChevronRight size={16} aria-hidden /></span>
        </Link>
      )}

      <div className="grid grid-cols-4 gap-2">
        <Mini label="Rides" value={summary.ridesTaken} />
        <Mini label="Shared" value={kes(summary.sharedKes).replace('KES ', '')} note="KES" tone="good" />
        <Mini label="You owe" value={kes(summary.owedKes).replace('KES ', '')} note="KES" tone={summary.owedKes > 0 ? 'alert' : 'plain'} />
        <Mini label="Booked" value={upcoming.length} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Tile
          title={metric === 'rides' ? 'Your requests' : 'Your spending'}
          aside={<Segmented label="Show" value={metric} onChange={setMetric} options={[['rides', 'Rides'], ['spent', 'Spent']]} />}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              {metric === 'rides' ? (
                <LineChart labels={weeks.map((w) => w.label)} series={[{ name: 'Completed', values: weeks.map((w) => w.rides) }, { name: 'Cancelled', values: weeks.map((w) => w.cancelled) }, { name: 'No driver', values: weeks.map((w) => w.none) }]} height={104} label="Your requests per week over the last 8 weeks" />
              ) : (
                <LineChart labels={weeks.map((w) => w.label)} series={[{ name: 'Spent', values: weeks.map((w) => w.kes) }, { name: 'Per ride', values: weeks.map((w) => w.avg) }]} height={104} format={(v) => `KES ${v}`} label="What you paid per week over the last 8 weeks" />
              )}
            </div>
            {paidPct !== null && (
              <div className="hidden shrink-0 flex-col items-center gap-1 min-[420px]:flex">
                <Ring value={paidPct} size={56} label={`${paidPct} percent of your shares are paid`}>{paidPct}%</Ring>
                <span className="text-[10px] leading-3 text-ink/85">paid up</span>
              </div>
            )}
          </div>
        </Tile>

        <Tile title={upcoming.length ? 'Up next' : 'Recent rides'} aside={<Link to="/my-rides" className="underline underline-offset-4">All</Link>}>
          {rows.length === 0 ? (
            <p className="text-sm text-ink/85">No rides yet. Tap Ride now to ask for your first one.</p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {rows.map((r) => (
                <li key={r.key}>
                  <Link to={r.to} className="focus-ring flex min-h-11 items-center justify-between gap-2 py-1">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
                      <span className="block truncate text-xs text-ink/85">{r.sub}</span>
                    </span>
                    <ChevronRight size={16} aria-hidden className="shrink-0 text-ink/60" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Tile>
      </div>

      <p className="hidden items-start gap-1.5 text-xs text-ink/85 sm:flex">
        <ShieldCheck size={14} aria-hidden className="mt-0.5 shrink-0" />
        Every driver is checked. Confirm the driver and number plate before you get in.
      </p>
    </div>
  )
}
