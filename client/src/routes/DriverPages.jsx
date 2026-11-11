import { Navigate, useParams } from 'react-router'
import { Alert, PageTitle } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { Stars, kes } from '../components/ride/bits.jsx'
import { Card, formatWhen } from '../components/rides/RideBits.jsx'
import { StatGrid, StatTile } from '../components/payments/PaymentBits.jsx'
import { useLive } from '../hooks/useLive.js'
import { api } from '../lib/api.js'

const SECTIONS = {
  history: { title: 'Ride history', Body: History },
  cost: { title: 'Cost shared', Body: Cost },
  ratings: { title: 'Ratings', Body: Ratings },
  safety: { title: 'Safety', Body: Safety },
}

/** The driver's secondary pages: ride history, cost shared, ratings and safety, each on its own screen. */
export default function DriverPages() {
  const { section } = useParams()
  const page = SECTIONS[section]
  if (!page) return <Navigate to="/" replace />
  const { Body } = page
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageTitle>{page.title}</PageTitle>
      <Body />
    </div>
  )
}

function History() {
  const { data, error } = useLive(api.driverHistory, { pollMs: 30000 })
  const { data: st } = useLive(api.driverState, { pollMs: 30000 })
  if (error && !data) return <Alert tone="error">{error}</Alert>
  if (!data || !st) return <Spinner />
  return (
    <div className="space-y-4">
      <Card>
        <p className="font-medium text-ink">Your answers to requests</p>
        <p className="text-sm text-ink/85">Accepted {st.stats.accepted} · Declined {st.stats.declined} · Expired {st.stats.expired}. Only you see this, and nothing is penalised.</p>
      </Card>
      {data.rides.length === 0 ? (
        <p className="text-sm text-ink/85">No rides yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.rides.map((r) => (
            <Card key={r.rideId} muted={r.status === 'cancelled'}>
              <p className="font-medium text-ink">{r.places || 'Ride'}</p>
              <p className="text-sm text-ink/85">{formatWhen(r.at)} · {r.riders} rider{r.riders === 1 ? '' : 's'} · {r.status}</p>
              {r.status === 'completed' && <p className="text-sm text-ink">Shared {kes(r.totalKes)}, paid {kes(r.paidKes)}</p>}
            </Card>
          ))}
        </ul>
      )}
    </div>
  )
}

function Cost() {
  const { data, error } = useLive(api.driverDashboard, { pollMs: 30000 })
  const { data: st } = useLive(api.driverState, { pollMs: 30000 })
  if (error && !data) return <Alert tone="error">{error}</Alert>
  if (!data || !st) return <Spinner />
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatTile label="Rides, all time" value={st.totals.rides} />
        <StatTile label="Riders paid you" value={kes(st.totals.sharedKes)} tone="good" />
        <StatTile label="Shared this week" value={kes(data.week.sharedKes)} />
        <StatTile label="Still to collect" value={kes(data.week.pendingKes)} tone={data.week.pendingKes > 0 ? 'alert' : 'plain'} />
      </StatGrid>
      <p className="text-sm text-ink/85">This is fuel cost shared by your riders, split by the part of the road each of them was in the car. RideMate takes no commission.</p>
    </div>
  )
}

function Ratings() {
  const { data, error } = useLive(api.driverHistory, { pollMs: 60000 })
  if (error && !data) return <Alert tone="error">{error}</Alert>
  if (!data) return <Spinner />
  if (data.ratings.length === 0) return <p className="text-sm text-ink/85">No ratings yet.</p>
  return (
    <ul className="space-y-2">
      {data.ratings.map((r, i) => (
        <Card key={i}>
          <Stars value={r.stars} /> {r.tags?.length > 0 && <span className="text-sm text-ink/85">· {r.tags.join(', ')}</span>}
          {r.comment && <p className="mt-1 text-sm text-ink">{r.comment}</p>}
          <p className="text-xs text-ink/85">{formatWhen(r.at)}</p>
        </Card>
      ))}
    </ul>
  )
}

function Safety() {
  return (
    <ul className="space-y-3 text-sm text-ink">
      <li>Confirm the rider's name before they get in. Never take someone who does not match the request.</li>
      <li>RideMate is for students and staff sharing a journey you are already making. Do not ask for more than the share shown.</li>
      <li>Riders have an SOS button. It alerts the RideMate team and shows them your ride.</li>
      <li>If something goes wrong, report it from the ride after it ends. Reports and the ride record are kept as evidence.</li>
      <li>Your location is shared only while you are online and only with riders in your ride. It is never stored as a history.</li>
    </ul>
  )
}
