import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { Car, MapPinned, ShieldCheck } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { Alert } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { Stars, kes } from '../components/ride/bits.jsx'
import { Card, SectionTitle, formatWhen } from '../components/rides/RideBits.jsx'
import { StatGrid, StatTile } from '../components/payments/PaymentBits.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLive } from '../hooks/useLive.js'
import { api } from '../lib/api.js'
import DriverApplication from './DriverApplication.jsx'

/** The driver's own dashboard: status, this week, money to collect, recent rides and vehicle. */
export default function DriverHome() {
  const { profile } = useAuth()
  if (profile?.driverStatus !== 'approved') return <DriverApplication />
  return <Dashboard />
}

function Dashboard() {
  const { profile } = useAuth()
  const { data, error, reload } = useLive(api.driverDashboard, { events: ['ride:update', 'offer:new'], pollMs: 15000 })
  const { data: vehicles } = useLive(useCallback(() => api.listVehicles().then((r) => r.vehicles), []), { pollMs: 60000 })
  const [problem, setProblem] = useState(null)

  const settle = async (shareId) => {
    setProblem(null)
    try {
      await api.settleRideShare(shareId)
      await reload()
    } catch (err) {
      setProblem(err.message)
    }
  }

  if (!data) return error ? <Alert tone="error">{error}</Alert> : <Spinner />
  const answered = data.answers.accepted + data.answers.declined + data.answers.expired
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wider text-ink/85 uppercase">Driver dashboard</p>
          <h1 className="font-display text-5xl leading-none font-semibold tracking-wide text-ink-deep uppercase md:text-6xl">Hi, {profile.fullName.split(' ')[0]}</h1>
        </div>
        <Stars value={data.rating.average} />
      </header>
      {(error || problem) && <Alert tone="error">{problem || error}</Alert>}

      <section aria-label="Status" className={`flex flex-wrap items-center justify-between gap-4 rounded-(--radius-panel) p-5 ${data.isOnline ? 'bg-asphalt text-paper' : 'bg-surface text-ink border border-ink/20'}`}>
        <div className="flex items-center gap-3">
          <span aria-hidden className={`size-3 rounded-full ${data.isOnline ? 'animate-pulse bg-mint' : 'bg-ink/40'}`} />
          <div>
            <p className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">{data.onARide ? 'On a ride' : data.isOnline ? 'You are online' : 'You are offline'}</p>
            <p className={`mt-1 text-sm ${data.isOnline ? 'text-paper/85' : 'text-ink/85'}`}>
              {data.onARide ? 'Open the map to continue your stops.' : data.isOnline ? 'Riders near you can be matched with you. Keep the map open so you hear requests.' : 'Go online on the map to start receiving requests.'}
            </p>
          </div>
        </div>
        <Button to="/drive" className={data.isOnline ? 'bg-gold! text-asphalt!' : ''}>
          <MapPinned size={18} aria-hidden /> {data.onARide ? 'Continue ride' : data.isOnline ? 'Open the map' : 'Go online'}
        </Button>
      </section>

      <StatGrid>
        <StatTile label="Rides this week" value={data.week.rides} />
        <StatTile label="Riders carried" value={data.week.riders} />
        <StatTile label="Cost shared" value={kes(data.week.sharedKes)} tone="good" note={`${kes(data.week.paidKes)} paid`} />
        <StatTile label="Still to collect" value={kes(data.week.pendingKes)} tone={data.week.pendingKes > 0 ? 'alert' : 'plain'} />
        <StatTile label="Your rating" value={data.rating.count ? data.rating.average.toFixed(1) : 'New'} note={`${data.rating.count} rating${data.rating.count === 1 ? '' : 's'}`} />
        <StatTile label="Requests answered" value={answered} note={`${data.answers.accepted} accepted · ${data.answers.declined} declined · ${data.answers.expired} expired`} />
      </StatGrid>

      <section aria-labelledby="collect" className="space-y-3">
        <SectionTitle id="collect">Money to collect</SectionTitle>
        <p className="text-sm text-ink/85">Riders pay you their share in cash or M-Pesa. Mark it as paid once you have it. RideMate takes no commission.</p>
        {data.toCollect.length === 0 ? (
          <p className="text-sm text-ink/85">Nothing waiting. Finished rides show up here until they are paid.</p>
        ) : (
          <ul className="space-y-2">
            {data.toCollect.map((c) => (
              <Card key={c.shareId}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{c.riderName}</p>
                    <p className="text-sm text-ink/85">{c.dropoff ? `To ${c.dropoff} · ` : ''}{formatWhen(c.at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="font-display text-3xl leading-none font-semibold">{kes(c.amountKes)}</p>
                    <Button size="sm" onClick={() => settle(c.shareId)}>Mark as paid</Button>
                  </div>
                </div>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="recent" className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle id="recent">Recent rides</SectionTitle>
            <Link to="/drive/history" className="text-sm underline underline-offset-4">All rides</Link>
          </div>
          {data.recent.length === 0 ? (
            <p className="text-sm text-ink/85">No rides yet. Go online to take your first one.</p>
          ) : (
            <ul className="space-y-2">
              {data.recent.map((r) => (
                <Card key={r.rideId} muted={r.status === 'cancelled'}>
                  <p className="font-medium text-ink">{r.places || 'Ride'}</p>
                  <p className="text-sm text-ink/85">{formatWhen(r.at)} · {r.riders} rider{r.riders === 1 ? '' : 's'} · {r.status}</p>
                </Card>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="vehicle" className="space-y-3">
          <SectionTitle id="vehicle">My vehicle</SectionTitle>
          {!vehicles ? (
            <Spinner />
          ) : vehicles.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-ink/85">Add your car before you go online.</p>
              <Button to="/vehicles"><Car size={18} aria-hidden /> Add a vehicle</Button>
            </div>
          ) : (
            <ul className="space-y-2">
              {vehicles.map((v) => (
                <Card key={v.vehicleId}>
                  <p className="font-medium text-ink">{v.colour} {v.makeModel}</p>
                  <p className="text-sm text-ink/85">{v.plateNumber} · {v.seatCapacity} passenger seat{v.seatCapacity === 1 ? '' : 's'}</p>
                </Card>
              ))}
              <li><Link to="/vehicles" className="text-sm underline underline-offset-4">Manage vehicles</Link></li>
            </ul>
          )}
          <p className="flex items-start gap-2 text-sm text-ink/85">
            <ShieldCheck size={16} aria-hidden className="mt-0.5 shrink-0" />
            RideMate is for sharing a journey you are already making, not a taxi service.
          </p>
        </section>
      </div>
    </div>
  )
}
