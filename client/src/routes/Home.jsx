import { useCallback, useMemo } from 'react'
import { Link } from 'react-router'
import { Car, Hand } from 'lucide-react'
import { Alert } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Rating, SectionTitle, StatusBadge, TripLine, plural, useLiveList } from '../components/rides/RideBits.jsx'
import { FareCard, StatGrid, StatTile, kes } from '../components/payments/PaymentBits.jsx'

function ActionTile({ to, icon: Icon, title, text }) {
  return (
    <Link to={to} className="focus-ring group relative block overflow-hidden rounded-(--radius-panel) bg-asphalt p-5 pb-8 text-paper transition-colors hover:bg-ink-deep md:p-6 md:pb-9">
      <Icon size={26} aria-hidden className="text-gold" />
      <p className="mt-3 font-display text-4xl leading-none font-semibold tracking-wide text-gold uppercase md:text-5xl">{title}</p>
      <p className="mt-2 text-sm text-paper/90">{text}</p>
      <span aria-hidden className="lane-horizontal absolute inset-x-0 bottom-3 h-[3px]" />
    </Link>
  )
}

/** The rider's dashboard: upcoming rides, what they owe, and fares they can split with friends. */
export default function Home() {
  const { profile } = useAuth()

  const load = useCallback(async () => {
    const [{ requests }, pay] = await Promise.all([api.myRequests(), api.myPayments()])
    return { requests, payments: pay.payments, summary: pay.summary }
  }, [])
  const { items, error, run } = useLiveList(load)

  const trips = useMemo(() => {
    if (!items) return null
    const now = Date.now()
    return items.requests
      .filter((r) => ['open', 'matched'].includes(r.status) && new Date(r.departAt).getTime() > now)
      .sort((a, b) => new Date(a.departAt) - new Date(b.departAt))
  }, [items])

  const firstName = profile?.fullName?.split(' ')[0]
  const finished = items ? items.requests.filter((r) => r.status === 'completed').length : 0
  const payments = items?.payments ?? []
  const toPay = payments.filter((p) => p.status !== 'cancelled' && p.shares.some((s) => s.mine && s.status === 'pending'))
  const settled = payments.filter((p) => p.status === 'paid')
  const waiting = payments.filter((p) => p.status === 'pending' && !toPay.includes(p))

  const onPay = (shareId, body) => run(() => api.payShare(shareId, body))
  const onSplit = (bookingId, emails) => run(() => api.splitFare(bookingId, emails))

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-medium tracking-wider text-ink/85 uppercase">Rider dashboard</p>
          <h1 className="font-display text-5xl leading-none font-semibold tracking-wide text-ink-deep uppercase md:text-6xl">Hi, {firstName}</h1>
        </div>
        <p className="flex items-center gap-2 text-sm text-ink/85">
          {profile?.faculty} <Rating value={profile?.avgRating} />
        </p>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      {items && (
        <StatGrid>
          <StatTile label="Upcoming rides" value={trips.length} />
          <StatTile label="Trips finished" value={finished} />
          <StatTile label="You owe" value={kes(items.summary.owedKes)} tone={items.summary.owedKes > 0 ? 'alert' : 'plain'} note={items.summary.owedKes > 0 ? 'Settle it with your driver' : 'All settled'} />
          <StatTile label="Paid, last 60 days" value={kes(items.summary.paidKes)} />
        </StatGrid>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <ActionTile to="/rides/find" icon={Hand} title="Need a ride" text="Post your trip and see drivers going your way." />
        <ActionTile to="/driver" icon={Car} title="Driving somewhere" text="Open your driver dashboard to share seats and split the fuel." />
      </div>

      <section aria-labelledby="fares" className="space-y-3">
        <SectionTitle id="fares">Fares to pay</SectionTitle>
        {items === null ? (
          <Spinner />
        ) : toPay.length === 0 ? (
          <p className="text-sm text-ink/85">Nothing to pay. When a driver confirms your ride, the fare shows up here, and you can split it with friends.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {toPay.map((p) => (
              <FareCard key={p.paymentId} payment={p} onPay={onPay} onSplit={onSplit} />
            ))}
          </ul>
        )}
        {waiting.length > 0 && (
          <>
            <h3 className="pt-2 text-xs font-medium tracking-wider text-ink/85 uppercase">Waiting on friends</h3>
            <ul className="grid gap-3 md:grid-cols-2">
              {waiting.map((p) => (
                <FareCard key={p.paymentId} payment={p} onPay={onPay} onSplit={onSplit} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="next-trips" className="space-y-3">
        <SectionTitle id="next-trips">Your next rides</SectionTitle>
        {trips === null ? (
          <Spinner />
        ) : trips.length === 0 ? (
          <p className="text-sm text-ink/85">Nothing planned. Post a trip above and it will show up here.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {trips.map((t) => (
              <li key={t.requestId}>
                <Link to="/rides/find" className="focus-ring block h-full rounded-(--radius-panel) border border-ink/20 bg-surface p-4 shadow-(--shadow-contact) transition-colors hover:border-ink">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium tracking-wider text-ink/85 uppercase">{plural(t.seatsNeeded, 'seat')}</span>
                    <StatusBadge kind="request" status={t.status} />
                  </div>
                  <TripLine from={t.origin} to={t.destination} when={t.departAt} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {settled.length > 0 && (
        <section aria-labelledby="paid" className="space-y-3">
          <SectionTitle id="paid">Paid fares</SectionTitle>
          <ul className="grid gap-3 md:grid-cols-2">
            {settled.slice(0, 6).map((p) => (
              <FareCard key={p.paymentId} payment={p} onPay={onPay} onSplit={onSplit} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
