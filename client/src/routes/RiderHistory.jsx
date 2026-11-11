import { Link } from 'react-router'
import { Alert, PageTitle } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { kes } from '../components/ride/bits.jsx'
import { Card, Route, formatWhen } from '../components/rides/RideBits.jsx'
import { PayChip, StatGrid, StatTile } from '../components/payments/PaymentBits.jsx'
import { useLive } from '../hooks/useLive.js'
import { api } from '../lib/api.js'

const LABEL = { completed: 'Completed', cancelled: 'Cancelled', no_driver: 'No driver found' }

/** The rider's own history: rides taken, what each cost, and what is still owed to a driver. */
export default function RiderHistory() {
  const { data, error } = useLive(api.requestHistory, { events: ['request:update'], pollMs: 20000 })
  if (error && !data) return <Alert tone="error">{error}</Alert>
  if (!data) return <Spinner />
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageTitle>My rides</PageTitle>
      <StatGrid>
        <StatTile label="Rides taken" value={data.summary.ridesTaken} />
        <StatTile label="Your shares, total" value={kes(data.summary.sharedKes)} />
        <StatTile label="You owe" value={kes(data.summary.owedKes)} tone={data.summary.owedKes > 0 ? 'alert' : 'good'} note={data.summary.owedKes > 0 ? 'Pay your driver, who marks it paid' : 'All paid'} />
      </StatGrid>
      {data.rides.length === 0 ? (
        <p className="text-sm text-ink/85">
          No rides yet. <Link to="/" className="underline underline-offset-4">Ask for your first ride</Link>.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.rides.map((r) => (
            <Card key={r.requestId} muted={r.status !== 'completed'}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Route from={r.pickup} to={r.dropoff} />
                  <p className="text-sm text-ink/85">{formatWhen(r.at)}{r.driverFirstName ? ` · with ${r.driverFirstName}` : ''} · {LABEL[r.status]}</p>
                </div>
                {r.shareKes !== null && (
                  <div className="text-right">
                    <p className="font-display text-2xl leading-none font-semibold">{kes(r.shareKes)}</p>
                    <PayChip status={r.shareStatus} />
                  </div>
                )}
              </div>
            </Card>
          ))}
        </ul>
      )}
    </div>
  )
}
