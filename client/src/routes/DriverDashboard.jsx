import { useCallback, useMemo } from 'react'
import { Link } from 'react-router'
import { Car, PlusCircle } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { Alert } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Card, Contact, Rating, Route, SectionTitle, StatusBadge, SubItem, SubList, TripLine, formatWhen, plural, useLiveList } from '../components/rides/RideBits.jsx'
import { PayChip, StatGrid, StatTile, kes } from '../components/payments/PaymentBits.jsx'
import DriverVerification from './DriverVerification.jsx'

/** The driver's dashboard: trips, requests waiting for an answer, and the money passengers owe. */
export default function DriverDashboard() {
  const { profile } = useAuth()
  if (profile?.role === 'driver' && profile.driverStatus !== 'approved') return <DriverVerification />
  return <ApprovedDriverDashboard />
}

function ApprovedDriverDashboard() {
  const { profile } = useAuth()

  const load = useCallback(async () => {
    const [{ offers }, earnings, { vehicles }] = await Promise.all([api.myOffers(), api.myEarnings(), api.listVehicles()])
    return { offers, earnings, vehicles }
  }, [])
  const { items, error, run } = useLiveList(load)

  const view = useMemo(() => {
    if (!items) return null
    const now = Date.now()
    const upcoming = items.offers.filter((o) => o.status === 'open' && new Date(o.departAt).getTime() > now)
    const answerNow = upcoming.flatMap((o) =>
      o.bookings.filter((b) => b.status === 'pending' && b.initiatedBy === 'rider').map((b) => ({ ...b, offer: o })),
    )
    const fareByBooking = new Map(items.earnings.payments.map((p) => [p.bookingId, p]))
    const seatsOffered = upcoming.reduce((n, o) => n + o.seatsTotal, 0)
    const seatsFilled = upcoming.reduce((n, o) => n + (o.seatsTotal - o.seatsAvailable), 0)
    return { upcoming, answerNow, fareByBooking, seatsOffered, seatsFilled }
  }, [items])

  const firstName = profile?.fullName?.split(' ')[0]

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wider text-ink/85 uppercase">Driver dashboard</p>
          <h1 className="font-display text-5xl leading-none font-semibold tracking-wide text-ink-deep uppercase md:text-6xl">Hi, {firstName}</h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-ink/85">
            Your rating <Rating value={profile?.avgRating} />
          </p>
        </div>
        <Button to="/rides/offer">
          <PlusCircle size={18} aria-hidden /> Offer a ride
        </Button>
      </header>

      {error && <Alert tone="error">{error}</Alert>}
      {!view ? (
        <Spinner />
      ) : (
        <>
          {items.vehicles.length === 0 && (
            <Alert tone="info">
              You have not added a vehicle yet. <Link className="font-medium underline underline-offset-4" to="/vehicles">Add one</Link> before you offer a ride.
            </Alert>
          )}

          <StatGrid>
            <StatTile label="Trips coming up" value={view.upcoming.length} />
            <StatTile
              label="Seats filled"
              value={view.seatsOffered === 0 ? '0' : `${view.seatsFilled}/${view.seatsOffered}`}
              note={view.seatsOffered === 0 ? 'No open trips' : 'Across your open trips'}
            />
            <StatTile label="Collected" value={kes(items.earnings.summary.collectedKes)} tone="good" note="Paid by passengers" />
            <StatTile
              label="Still to collect"
              value={kes(items.earnings.summary.pendingKes)}
              tone={items.earnings.summary.pendingKes > 0 ? 'alert' : 'plain'}
              note="Confirmed fares not yet paid"
            />
          </StatGrid>

          <section aria-labelledby="answer" className="space-y-3">
            <SectionTitle id="answer">Needs your answer</SectionTitle>
            {view.answerNow.length === 0 ? (
              <p className="text-sm text-ink/85">No riders are waiting on you.</p>
            ) : (
              <ul className="space-y-2">
                {view.answerNow.map((b) => (
                  <Card key={b.bookingId}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-ink">
                          {b.rider.fullName} <Rating value={b.rider.rating} /> wants {plural(b.seats, 'seat')}
                        </p>
                        <Route from={b.offer.origin} to={b.offer.destination} className="text-sm" />
                        <p className="text-sm text-ink/85">
                          {formatWhen(b.offer.departAt)} · about {kes(b.offer.costPerSeatKes * b.seats)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => run(() => api.bookingAction(b.bookingId, 'accept'))}>
                          Accept
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => run(() => api.bookingAction(b.bookingId, 'decline'))}>
                          Decline
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="trips" className="space-y-3">
            <SectionTitle id="trips">Your trips</SectionTitle>
            {view.upcoming.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-ink/85">
                <Car size={16} aria-hidden /> No open trips. Offer a ride and riders going your way will find it.
              </p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {view.upcoming.map((o) => {
                  const riders = o.bookings.filter((b) => b.status === 'accepted')
                  return (
                    <Card key={o.offerId}>
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium tracking-wider text-ink/85 uppercase">
                          {o.seatsAvailable} of {plural(o.seatsTotal, 'seat')} free · {kes(o.costPerSeatKes)} each
                        </span>
                        <StatusBadge kind="offer" status={o.status} />
                      </div>
                      <TripLine from={o.origin} to={o.destination} when={o.departAt} />
                      {riders.length > 0 && (
                        <SubList title="Passengers">
                          {riders.map((b) => {
                            const fare = view.fareByBooking.get(b.bookingId)
                            return (
                              <SubItem key={b.bookingId}>
                                <div>
                                  <p className="text-sm font-medium text-ink">
                                    {b.rider.fullName} · {plural(b.seats, 'seat')}
                                  </p>
                                  <Contact label="Phone" phone={b.rider.phoneNumber} />
                                </div>
                                {fare && (
                                  <div className="text-sm sm:text-right">
                                    <p>
                                      {kes(fare.paidKes)} of {kes(fare.totalKes)}
                                    </p>
                                    <PayChip status={fare.status} />
                                  </div>
                                )}
                              </SubItem>
                            )
                          })}
                        </SubList>
                      )}
                      <div className="mt-4">
                        <Button to="/rides/offer" variant="secondary" size="sm">
                          Manage trip
                        </Button>
                      </div>
                    </Card>
                  )
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="earnings" className="space-y-3">
            <SectionTitle id="earnings">Fares from passengers</SectionTitle>
            {items.earnings.payments.length === 0 ? (
              <p className="text-sm text-ink/85">Fares appear here once you confirm a rider.</p>
            ) : (
              <div className="overflow-x-auto rounded-(--radius-panel) border border-ink/20 bg-surface">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-paper-deep text-xs tracking-wider uppercase">
                    <tr>
                      <th className="px-3 py-2 font-medium">Trip</th>
                      <th className="px-3 py-2 font-medium">Rider</th>
                      <th className="px-3 py-2 font-medium">Paid</th>
                      <th className="px-3 py-2 font-medium">Fare</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.earnings.payments.map((p) => (
                      <tr key={p.paymentId} className="border-t border-ink/10 align-top">
                        <td className="px-3 py-2">
                          {p.trip.origin} to {p.trip.destination}
                          <span className="block text-ink/85">{formatWhen(p.trip.departAt)}</span>
                        </td>
                        <td className="px-3 py-2">
                          {p.rider.fullName}
                          {p.shares.length > 1 && <span className="block text-ink/85">split {p.shares.length} ways</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{kes(p.paidKes)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{kes(p.totalKes)}</td>
                        <td className="px-3 py-2">
                          <PayChip status={p.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
