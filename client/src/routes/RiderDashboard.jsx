import { Link } from 'react-router'
import { CalendarClock, MapPin, ShieldCheck } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { Alert } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { kes } from '../components/ride/bits.jsx'
import { Card, Route, SectionTitle, formatWhen } from '../components/rides/RideBits.jsx'
import { StatGrid, StatTile } from '../components/payments/PaymentBits.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLive } from '../hooks/useLive.js'
import { api } from '../lib/api.js'

const LIVE = ['searching', 'offered', 'assigned', 'en_route', 'arrived', 'on_trip', 'in_progress']
const LABEL = { completed: 'Completed', cancelled: 'Cancelled', no_driver: 'No driver found' }

/** The rider's own dashboard: the first screen after login. The map lives at /ride. */
export default function RiderDashboard() {
  const { profile } = useAuth()
  const history = useLive(api.requestHistory, { events: ['request:update'], pollMs: 20000 })
  const requests = useLive(api.myTripRequests, { events: ['request:update'], pollMs: 15000 })

  if (!history.data || !requests.data) return history.error ? <Alert tone="error">{history.error}</Alert> : <Spinner />
  const { summary, rides } = history.data
  const now = requests.data.requests
  const live = now.find((r) => r.type !== 'scheduled' && LIVE.includes(r.status))
  const upcoming = now
    .filter((r) => r.type === 'scheduled' && ['scheduled', 'searching', 'offered', 'assigned', 'no_driver'].includes(r.status) && new Date(r.scheduledFor) > Date.now() - 3600_000)
    .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wider text-ink/85 uppercase">{profile.personType === 'staff' ? 'Staff' : 'Student'} dashboard</p>
          <h1 className="font-display text-5xl leading-none font-semibold tracking-wide text-ink-deep uppercase md:text-6xl">Hi, {profile.fullName.split(' ')[0]}</h1>
        </div>
        <div className="flex gap-2">
          <Button to="/ride"><MapPin size={18} aria-hidden /> Ride now</Button>
          <Button to="/ride" variant="secondary"><CalendarClock size={18} aria-hidden /> Book for later</Button>
        </div>
      </header>

      {live && (
        <section aria-label="Current ride" className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-panel) bg-asphalt p-5 text-paper">
          <div>
            <p className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">You have a ride in progress</p>
            <p className="mt-1 text-sm text-paper/85">{live.pickup?.label} to {live.dropoff?.label}</p>
          </div>
          <Button to="/ride" className="bg-gold! text-asphalt!">Open the map</Button>
        </section>
      )}

      <StatGrid>
        <StatTile label="Rides taken" value={summary.ridesTaken} />
        <StatTile label="Your shares, total" value={kes(summary.sharedKes)} tone="good" />
        <StatTile label="You owe" value={kes(summary.owedKes)} tone={summary.owedKes > 0 ? 'alert' : 'good'} note={summary.owedKes > 0 ? 'Pay your driver, who marks it paid' : 'All paid'} />
        <StatTile label="Coming up" value={upcoming.length} note="booked rides" />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="up" className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle id="up">Upcoming bookings</SectionTitle>
            <Link to="/bookings" className="text-sm underline underline-offset-4">Manage</Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-ink/85">Nothing booked. Book a ride for later, or make it repeat for your class days.</p>
          ) : (
            <ul className="space-y-2">
              {upcoming.slice(0, 3).map((r) => (
                <Card key={r.requestId}>
                  <p className="font-medium text-ink">{r.pickup.label} to {r.dropoff.label}</p>
                  <p className="text-sm text-ink/85">{formatWhen(r.scheduledFor)} · {r.seats} seat{r.seats === 1 ? '' : 's'}</p>
                </Card>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="rec" className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle id="rec">Recent rides</SectionTitle>
            <Link to="/my-rides" className="text-sm underline underline-offset-4">All rides</Link>
          </div>
          {rides.length === 0 ? (
            <p className="text-sm text-ink/85">No rides yet. Tap Ride now to ask for your first one.</p>
          ) : (
            <ul className="space-y-2">
              {rides.slice(0, 3).map((r) => (
                <Card key={r.requestId} muted={r.status !== 'completed'}>
                  <Route from={r.pickup} to={r.dropoff} />
                  <p className="text-sm text-ink/85">{formatWhen(r.at)}{r.driverFirstName ? ` · with ${r.driverFirstName}` : ''} · {LABEL[r.status]}{r.shareKes !== null ? ` · ${kes(r.shareKes)}` : ''}</p>
                </Card>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="flex items-start gap-2 text-sm text-ink/85">
        <ShieldCheck size={16} aria-hidden className="mt-0.5 shrink-0" />
        Every driver is checked by the RideMate team. Confirm the driver and number plate before you get in.
      </p>
    </div>
  )
}
