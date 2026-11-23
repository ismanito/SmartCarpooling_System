import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { Car, ChevronRight, MapPinned, ShieldCheck } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { Alert } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { Stars, kes } from '../components/ride/bits.jsx'
import { formatWhen } from '../components/rides/RideBits.jsx'
import { LineChart, Mini, Ring, Segmented, Tile, movingAverage } from '../components/charts/Charts.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLive } from '../hooks/useLive.js'
import { api } from '../lib/api.js'
import DriverVerification from './DriverVerification.jsx'

/** The driver's own dashboard: status, this week, money to collect, recent rides and vehicle. */
export default function DriverHome() {
  const { profile } = useAuth()
  if (profile?.driverStatus !== 'approved') return <DriverVerification />
  return <Dashboard />
}

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

function Dashboard() {
  const { profile } = useAuth()
  const { data, error, reload } = useLive(api.driverDashboard, { events: ['ride:update', 'offer:new'], pollMs: 15000 })
  const { data: vehicles } = useLive(useCallback(() => api.listVehicles().then((r) => r.vehicles), []), { pollMs: 60000 })
  const [problem, setProblem] = useState(null)
  const [metric, setMetric] = useState('kes')
  const [range, setRange] = useState(30)

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
  const acceptPct = answered > 0 ? Math.round((data.answers.accepted / answered) * 100) : null
  const recent = (data.daily || []).slice(-range)
  const dayLabel = (d) => (range <= 7 ? DAY.format(new Date(`${d.day}T12:00:00`)) : DATE.format(new Date(`${d.day}T12:00:00`)))
  const car = vehicles?.[0]
  return (
    <div className="mx-auto w-full max-w-4xl space-y-3">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wider text-ink/85 uppercase">Driver dashboard</p>
          <h1 className="truncate font-display text-4xl leading-none font-semibold tracking-wide text-ink-deep uppercase md:text-5xl">Hi, {profile.fullName.split(' ')[0]}</h1>
        </div>
        <Stars value={data.rating.average} />
      </header>
      {(error || problem) && <Alert tone="error">{problem || error}</Alert>}

      <section aria-label="Status" className={`flex items-center justify-between gap-3 rounded-(--radius-panel) px-3 py-2.5 ${data.isOnline ? 'bg-asphalt text-paper' : 'border border-ink/20 bg-surface text-ink'}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className={`size-3 shrink-0 rounded-full ${data.isOnline ? 'animate-pulse bg-mint' : 'bg-ink/40'}`} />
          <div className="min-w-0">
            <p className="truncate font-display text-2xl leading-none font-semibold tracking-wide uppercase">{data.onARide ? 'On a ride' : data.isOnline ? 'You are online' : 'You are offline'}</p>
            <p className={`truncate text-xs ${data.isOnline ? 'text-paper/85' : 'text-ink/85'}`}>
              {car ? `${car.colour} ${car.makeModel} · ${car.plateNumber}` : 'Add your car before you go online'}
            </p>
          </div>
        </div>
        {car ? (
          <Button to="/drive" size="sm" className={`shrink-0 ${data.isOnline ? 'bg-gold! text-asphalt!' : ''}`}>
            <MapPinned size={16} aria-hidden /> {data.onARide ? 'Continue' : data.isOnline ? 'Open map' : 'Go online'}
          </Button>
        ) : (
          <Button to="/vehicles" size="sm" className="shrink-0">
            <Car size={16} aria-hidden /> Add car
          </Button>
        )}
      </section>

      <div className="grid grid-cols-4 gap-2">
        <Mini label="Rides (7d)" value={data.week.rides} />
        <Mini label="Shared" value={data.week.sharedKes} note="KES" tone="good" />
        <Mini label="To collect" value={data.week.pendingKes} note="KES" tone={data.week.pendingKes > 0 ? 'alert' : 'plain'} />
        <Mini label="Rating" value={data.rating.count ? data.rating.average.toFixed(1) : 'New'} note={`${data.rating.count} rating${data.rating.count === 1 ? '' : 's'}`} />
      </div>

      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <Tile
          title={metric === 'kes' ? 'Cost shared' : 'Rides'}
          aside={
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              <Segmented label="Show" value={metric} onChange={setMetric} options={[['kes', 'KES'], ['rides', 'Rides']]} />
              <Segmented label="Period" value={range} onChange={setRange} options={[[7, '7d'], [30, '30d']]} />
            </span>
          }
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              {metric === 'kes' ? (
                <LineChart labels={recent.map(dayLabel)} series={[{ name: 'KES', values: recent.map((d) => d.sharedKes) }, { name: '7-day average', values: movingAverage((data.daily || []).map((d) => d.sharedKes)).slice(-range) }]} height={104} format={(v) => `KES ${v}`} axisFormat={(v) => v} label={`Cost shared per day, last ${range} days`} />
              ) : (
                <LineChart labels={recent.map(dayLabel)} series={[{ name: 'Rides', values: recent.map((d) => d.rides) }, { name: '7-day average', values: movingAverage((data.daily || []).map((d) => d.rides)).slice(-range) }]} height={104} label={`Rides per day, last ${range} days`} />
              )}
            </div>
            {acceptPct !== null && (
              <div className="hidden shrink-0 flex-col items-center gap-1 min-[420px]:flex">
                <Ring value={acceptPct} size={56} label={`You accepted ${acceptPct} percent of requests`}>
                  {acceptPct}%
                </Ring>
                <span className="text-[10px] leading-3 text-ink/85">accepted</span>
              </div>
            )}
          </div>
        </Tile>

        <Tile title="Money to collect" aside={data.toCollect.length > 2 ? <Link to="/drive/cost" className="underline underline-offset-4">All {data.toCollect.length}</Link> : null}>
          {data.toCollect.length === 0 ? (
            <p className="text-sm text-ink/85">Nothing waiting. Riders pay you in cash or M-Pesa; RideMate takes no commission.</p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {data.toCollect.slice(0, 2).map((c) => (
                <li key={c.shareId} className="flex min-h-11 items-center justify-between gap-2 py-1">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{c.riderName}</span>
                    <span className="block truncate text-xs text-ink/85">
                      {c.dropoff ? `To ${c.dropoff} · ` : ''}
                      {formatWhen(c.at)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-display text-xl leading-none font-semibold">{kes(c.amountKes)}</span>
                    <Button size="sm" onClick={() => settle(c.shareId)}>
                      Paid
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tile>

        <Tile title="Recent rides" aside={<Link to="/drive/history" className="underline underline-offset-4">All</Link>} className="md:col-span-2">
          {data.recent.length === 0 ? (
            <p className="text-sm text-ink/85">No rides yet. Go online to take your first one.</p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {data.recent.slice(0, 2).map((r, i) => (
                <li key={r.rideId} className={i === 1 ? 'hidden sm:block' : ''}>
                  <Link to="/drive/history" className="focus-ring flex min-h-11 items-center justify-between gap-2 py-1">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{r.places || 'Ride'}</span>
                      <span className="block truncate text-xs text-ink/85">
                        {formatWhen(r.at)} · {r.riders} rider{r.riders === 1 ? '' : 's'} · {r.status}
                      </span>
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
        RideMate is for sharing a journey you are already making, not a taxi service.
      </p>
    </div>
  )
}
