import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button.jsx'
import { Alert, PageTitle } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { api } from '../lib/api.js'
import { Card, Rating, Route, SectionTitle, StatusBadge, formatWhen, plural, useLiveList } from '../components/rides/RideBits.jsx'
import { kes } from '../components/payments/PaymentBits.jsx'

const TABS = [
  { id: 'requests', label: 'Requests' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
]

/** Everything you are part of, as driver or rider: requests to answer, rides coming up, and rides done. */
export default function MyRides() {
  const [tab, setTab] = useState('requests')
  const load = useCallback(async () => {
    const [{ offers }, { requests }] = await Promise.all([api.myOffers(), api.myRequests()])
    return { offers, requests }
  }, [])
  const { items, error, run } = useLiveList(load)

  const view = useMemo(() => {
    if (!items) return null
    const now = Date.now()
    const future = (x) => new Date(x.departAt).getTime() > now
    const incoming = items.offers.filter((o) => o.status === 'open').flatMap((o) =>
      o.bookings.filter((b) => b.status === 'pending' && b.initiatedBy === 'rider').map((b) => ({ ...b, offer: o })),
    )
    const invites = items.requests.filter((r) => r.status === 'open').flatMap((r) =>
      r.bookings.filter((b) => b.status === 'pending' && b.initiatedBy === 'driver').map((b) => ({ ...b, request: r })),
    )
    const outgoing = items.requests.filter((r) => r.status === 'open').flatMap((r) =>
      r.bookings.filter((b) => ['pending', 'declined'].includes(b.status) && b.initiatedBy === 'rider').map((b) => ({ ...b, request: r })),
    )
    const driving = items.offers.filter((o) => o.status === 'open' && future(o))
    const riding = items.requests.filter((r) => r.status === 'matched' && future(r)).map((r) => ({ ...r, booking: r.bookings.find((b) => b.status === 'accepted') })).filter((r) => r.booking)
    const pastDriving = items.offers.filter((o) => o.status !== 'open' || !future(o))
    const pastRiding = items.requests
      .filter((r) => ['completed', 'cancelled'].includes(r.status))
      .map((r) => ({ ...r, booking: r.bookings.find((b) => b.status === 'accepted') }))
    return { incoming, invites, outgoing, driving, riding, pastDriving, pastRiding }
  }, [items])

  const count = view ? view.incoming.length + view.invites.length : 0
  const answer = (bookingId, action) => run(() => api.bookingAction(bookingId, action))

  return (
    <div className="space-y-6">
      <PageTitle>My rides</PageTitle>
      <div role="tablist" aria-label="My rides" className="flex gap-1 overflow-x-auto border-b border-ink/20">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`focus-ring -mb-px min-h-11 border-b-2 px-4 text-sm font-medium whitespace-nowrap ${tab === t.id ? 'border-ink text-ink' : 'border-transparent text-ink/85 hover:text-ink'}`}
          >
            {t.label}
            {t.id === 'requests' && count > 0 && <span className="ml-2 rounded-full bg-coral px-2 text-xs text-asphalt">{count}</span>}
          </button>
        ))}
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {!view ? (
        <Spinner />
      ) : tab === 'requests' ? (
        <div className="space-y-8">
          <section aria-labelledby="incoming" className="space-y-3">
            <SectionTitle id="incoming">Incoming, for your rides</SectionTitle>
            {view.incoming.length === 0 ? (
              <Empty>No riders are waiting on you.</Empty>
            ) : (
              <ul className="space-y-2">
                {view.incoming.map((b) => (
                  <Card key={b.bookingId}>
                    <Row
                      title={
                        <>
                          {b.rider.fullName} <Rating value={b.rider.rating} /> wants {plural(b.seats, 'seat')}
                        </>
                      }
                      from={b.offer.origin}
                      to={b.offer.destination}
                      when={b.offer.departAt}
                      extra={`About ${kes(b.offer.costPerSeatKes * b.seats)}`}
                    >
                      <Button size="sm" onClick={() => answer(b.bookingId, 'accept')}>Accept</Button>
                      <Button size="sm" variant="secondary" onClick={() => answer(b.bookingId, 'decline')}>Decline</Button>
                    </Row>
                  </Card>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="outgoing" className="space-y-3">
            <SectionTitle id="outgoing">Outgoing, your seat requests</SectionTitle>
            {view.invites.length + view.outgoing.length === 0 ? (
              <Empty>
                Nothing sent. <Link className="underline underline-offset-4" to="/rides/find">Find a ride</Link> and ask for a seat.
              </Empty>
            ) : (
              <ul className="space-y-2">
                {view.invites.map((b) => (
                  <Card key={b.bookingId}>
                    <Row title={<>{b.driver.fullName} offered you {plural(b.seats, 'seat')}</>} from={b.trip.origin} to={b.trip.destination} when={b.trip.departAt} extra={`About ${kes(b.costPerSeatKes * b.seats)}`}>
                      <Button size="sm" onClick={() => answer(b.bookingId, 'accept')}>Accept</Button>
                      <Button size="sm" variant="secondary" onClick={() => answer(b.bookingId, 'decline')}>Decline</Button>
                    </Row>
                  </Card>
                ))}
                {view.outgoing.map((b) => (
                  <Card key={b.bookingId} muted={b.status === 'declined'}>
                    <Row title={<>Asked {b.driver.fullName} for {plural(b.seats, 'seat')}</>} from={b.trip.origin} to={b.trip.destination} when={b.trip.departAt} badge={<StatusBadge status={b.status} />}>
                      {b.status === 'pending' && (
                        <Button size="sm" variant="secondary" onClick={() => run(() => api.cancelBooking(b.bookingId))}>Withdraw</Button>
                      )}
                    </Row>
                  </Card>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : tab === 'upcoming' ? (
        <div className="space-y-8">
          <RideGroup title="Driving" empty="No upcoming trips you are driving.">
            {view.driving.map((o) => {
              const aboard = o.bookings.filter((b) => b.status === 'accepted').length
              return (
                <Card key={o.offerId}>
                  <Row title={aboard === 0 ? 'No passengers yet' : plural(aboard, 'passenger')} from={o.origin} to={o.destination} when={o.departAt} badge={<StatusBadge kind="offer" status={o.status} />}>
                    <Button size="sm" variant="secondary" to={`/rides/${o.offerId}`}>Ride details</Button>
                  </Row>
                </Card>
              )
            })}
          </RideGroup>
          <RideGroup title="Riding" empty="No upcoming rides as a passenger.">
            {view.riding.map((r) => (
              <Card key={r.requestId}>
                <Row title={`With ${r.booking.driver.fullName}`} from={r.origin} to={r.destination} when={r.departAt} badge={<StatusBadge kind="request" status={r.status} />}>
                  <Button size="sm" variant="secondary" to={`/rides/${r.booking.offerId}`}>Ride details</Button>
                </Row>
              </Card>
            ))}
          </RideGroup>
        </div>
      ) : (
        <div className="space-y-8">
          <RideGroup title="Driven" empty="No past trips as a driver.">
            {view.pastDriving.map((o) => (
              <Card key={o.offerId} muted={o.status === 'cancelled'}>
                <Row title={plural(o.bookings.filter((b) => b.status === 'accepted').length, 'passenger')} from={o.origin} to={o.destination} when={o.departAt} badge={<StatusBadge kind="offer" status={o.status} />}>
                  <Button size="sm" variant="secondary" to={`/rides/${o.offerId}`}>Ride details</Button>
                </Row>
              </Card>
            ))}
          </RideGroup>
          <RideGroup title="Ridden" empty="No past rides as a passenger.">
            {view.pastRiding.map((r) => (
              <Card key={r.requestId} muted={r.status === 'cancelled'}>
                <Row title={r.booking ? `With ${r.booking.driver.fullName}` : 'No ride was confirmed'} from={r.origin} to={r.destination} when={r.departAt} badge={<StatusBadge kind="request" status={r.status} />}>
                  {r.status === 'completed' && r.booking && (
                    <Button size="sm" variant="secondary" to={`/rides/${r.booking.offerId}`}>Ride details</Button>
                  )}
                </Row>
              </Card>
            ))}
          </RideGroup>
        </div>
      )}
    </div>
  )
}

function Empty({ children }) {
  return <p className="text-sm text-ink/85">{children}</p>
}

function RideGroup({ title, empty, children }) {
  const items = Array.isArray(children) ? children : [children]
  return (
    <section className="space-y-3">
      <SectionTitle>{title}</SectionTitle>
      {items.length === 0 ? <Empty>{empty}</Empty> : <ul className="grid gap-3 md:grid-cols-2">{children}</ul>}
    </section>
  )
}

/** Title, route, time and buttons laid out so they stack on a phone. */
function Row({ title, from, to, when, extra, badge, children }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
          {title} {badge}
        </p>
        <Route from={from} to={to} className="text-sm" />
        <p className="text-sm text-ink/85">
          {formatWhen(when)}
          {extra && ` · ${extra}`}
        </p>
      </div>
      {children && <div className="flex shrink-0 flex-wrap gap-2">{children}</div>}
    </div>
  )
}
