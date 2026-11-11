import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Flag, Star } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx'
import { Field, SelectField, TextField } from '../components/ui/Field.jsx'
import { Alert, Panel } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { RouteMap } from '../components/rides/RouteMap.jsx'
import { RiderStatus, ShareLocation, useLiveLocation } from '../components/rides/LiveTracking.jsx'
import { api } from '../lib/api.js'
import { Contact, Rating, SectionTitle, StatusBadge, TripLine, Vehicle, plural, useLiveList } from '../components/rides/RideBits.jsx'
import { PayChip, kes } from '../components/payments/PaymentBits.jsx'

const FINISH_WINDOW_MS = 60 * 60 * 1000
const TAGS = ['On time', 'Safe driving', 'Friendly', 'Clean car', 'Easy pick-up']
const CATEGORIES = [
  { value: 'unsafe_driving', label: 'Unsafe driving' },
  { value: 'no_show', label: 'No-show' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'payment_demand', label: 'Asked for extra money' },
  { value: 'other', label: 'Something else' },
]

export default function RideDetails() {
  const { offerId } = useParams()
  const navigate = useNavigate()
  const load = useCallback(() => api.tripDetails(offerId), [offerId])
  const { items: d, error, run } = useLiveList(load)
  const [confirm, setConfirm] = useState(null) // 'cancel' | 'complete'
  const [busy, setBusy] = useState(false)
  // Keyed on the place names so the map keeps its view when the page refreshes itself.
  /* eslint-disable react-hooks/exhaustive-deps */
  const from = useMemo(() => (d ? { ...d.trip.originPoint, name: d.trip.origin } : null), [d?.trip.origin])
  const to = useMemo(() => (d ? { ...d.trip.destinationPoint, name: d.trip.destination } : null), [d?.trip.destination])
  /* eslint-enable react-hooks/exhaustive-deps */
  const live = useLiveLocation(offerId, d?.trip.status === 'open')
  const car = useMemo(() => (live.sharing && live.location ? { lat: live.location.lat, lng: live.location.lng, heading: live.location.heading } : null), [live])

  if (error && !d) {
    return (
      <div className="space-y-4">
        <Alert tone="error">{error}</Alert>
        <Button to="/rides" variant="secondary">Back to my rides</Button>
      </div>
    )
  }
  if (!d) return <Spinner />

  const { trip, people, fare, role } = d
  const me = people.find((p) => p.isMe)
  const others = people.filter((p) => !p.isMe)
  const isDriver = role === 'driver'
  const open = trip.status === 'open'
  const finished = trip.status === 'completed'
  const canFinishNow = new Date(trip.departAt).getTime() - Date.now() <= FINISH_WINDOW_MS

  const confirmAction = async () => {
    setBusy(true)
    await run(async () => {
      if (confirm === 'complete') await api.completeOffer(trip.offerId)
      else if (isDriver) await api.cancelOffer(trip.offerId)
      else await api.cancelBooking(me.bookingId)
    })
    setBusy(false)
    const leave = confirm === 'cancel'
    setConfirm(null)
    if (leave) navigate('/rides')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wider text-ink/85 uppercase">
            <Link to="/rides" className="underline underline-offset-4">My rides</Link> / {isDriver ? 'You are driving' : 'You are riding'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-4xl leading-none font-semibold tracking-wide text-ink-deep uppercase md:text-5xl">
              {trip.origin} to {trip.destination}
            </h1>
            <StatusBadge kind="offer" status={trip.status} />
          </div>
          <p className="mt-2 text-sm text-ink/85">
            <Vehicle vehicle={trip.vehicle} /> · {trip.routeKm} km
          </p>
        </div>
        {open && (
          <div className="flex flex-wrap gap-2">
            {isDriver && (
              <Button onClick={() => setConfirm('complete')} disabled={!canFinishNow} title={canFinishNow ? undefined : 'Available from one hour before departure'}>
                Mark completed
              </Button>
            )}
            <Button variant="secondary" onClick={() => setConfirm('cancel')}>
              {isDriver ? 'Cancel ride' : 'Cancel my seat'}
            </Button>
          </div>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <TripLine from={trip.origin} to={trip.destination} when={trip.departAt} />
          <SectionTitle>In the car</SectionTitle>
          <ul className="mt-3 space-y-3">
            {people.map((p) => (
              <li key={p.userId} className="rounded-(--radius-control) bg-paper px-3 py-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  {p.isMe ? 'You' : p.fullName} <Rating value={p.rating} />
                  <span className="rounded-(--radius-chip) border border-ink/30 px-1.5 text-xs uppercase">{p.role}</span>
                  {p.role === 'rider' && <span className="text-xs text-ink/85">{plural(p.seats, 'seat')}</span>}
                </p>
                <Contact label="Phone" phone={p.phoneNumber} />
              </li>
            ))}
          </ul>
        </Panel>
        <div className="flex flex-col gap-3">
          <RouteMap from={from} to={to} live={car} className="h-72 flex-1 lg:h-full" />
          {open && !isDriver && <RiderStatus live={live} destination={{ point: trip.destinationPoint, name: trip.destination }} />}
          {open && isDriver && <ShareLocation offerId={trip.offerId} origin={trip.originPoint} destination={trip.destinationPoint} />}
        </div>
      </div>

      <FareTable fare={fare} isDriver={isDriver} finished={finished} onSettle={(id) => run(() => api.settleShare(id))} />

      {finished && (
        <section aria-labelledby="rate" className="space-y-3">
          <SectionTitle id="rate">Rate your ride</SectionTitle>
          <ul className="grid gap-3 md:grid-cols-2">
            {others.map((p) => (
              <RatePanel key={p.userId} person={p} bookingId={isDriver ? p.bookingId : me.bookingId} onDone={() => run(async () => {})} />
            ))}
          </ul>
        </section>
      )}

      {others.length > 0 && trip.status !== 'cancelled' && (
        <ReportPanel people={others} bookingFor={(p) => (isDriver ? p.bookingId : me.bookingId)} />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'complete' ? 'Mark ride completed?' : isDriver ? 'Cancel this ride?' : 'Cancel your seat?'}
        confirmLabel={confirm === 'complete' ? 'Mark completed' : 'Yes, cancel'}
        onConfirm={confirmAction}
        onCancel={() => setConfirm(null)}
        isLoading={busy}
      >
        {confirm === 'complete'
          ? 'Everyone in the car shares the fuel cost and is asked to rate the ride.'
          : isDriver
            ? 'Everyone in the car is told and the ride is removed.'
            : 'The driver is told and your seat is freed.'}
      </ConfirmDialog>
    </div>
  )
}

function FareTable({ fare, isDriver, finished, onSettle }) {
  if (fare.totalKes === 0) return null
  return (
    <section aria-labelledby="fare" className="space-y-3">
      <SectionTitle id="fare">{finished ? 'Fare breakdown' : 'Estimated fare'}</SectionTitle>
      <p className="text-sm text-ink/85">
        Total fuel cost {kes(fare.totalKes)}, shared by everyone in the car including the driver. RideMate takes no commission.
        {!finished && ' The final shares are worked out when the driver finishes the ride.'}
      </p>
      <div className="overflow-x-auto rounded-(--radius-panel) border border-ink/20 bg-surface">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead className="bg-paper-deep text-xs tracking-wider uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium">Share</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {isDriver && (
              <tr className="border-t border-ink/10">
                <td className="px-3 py-2">You (driver)</td>
                <td className="px-3 py-2 whitespace-nowrap">{kes(fare.driverShareKes)}</td>
                <td className="px-3 py-2 text-ink/85">Your own share</td>
                <td />
              </tr>
            )}
            {fare.shares.map((s) => (
              <tr key={s.shareId} className="border-t border-ink/10">
                <td className="px-3 py-2">{s.mine ? 'You' : s.payerName}</td>
                <td className="px-3 py-2 whitespace-nowrap">{kes(s.amountKes)}</td>
                <td className="px-3 py-2">
                  <PayChip status={s.status === 'pending' ? 'pending' : s.status} />
                </td>
                <td className="px-3 py-2 text-right">
                  {isDriver && s.status === 'pending' && (
                    <Button size="sm" variant="secondary" onClick={() => onSettle(s.shareId)}>
                      Mark as paid
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** 1 to 5 stars, quick tags and an optional comment for one person. */
function RatePanel({ person, bookingId, onDone }) {
  const [stars, setStars] = useState(0)
  const [tags, setTags] = useState([])
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(person.iRated)

  if (done) {
    return (
      <li className="rounded-(--radius-panel) border border-ink/20 bg-surface p-4 text-sm">
        You rated {person.fullName}. Thank you.
      </li>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!stars) return setError('Choose 1 to 5 stars.')
    setBusy(true)
    setError(null)
    try {
      await api.rate(bookingId, { stars, tags, ...(comment.trim() ? { comment: comment.trim() } : {}) })
      setDone(true)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-(--radius-panel) border border-ink/20 bg-surface p-4">
      <form onSubmit={submit} className="space-y-3">
        <p className="font-medium text-ink">How was {person.fullName}?</p>
        {error && <Alert tone="error">{error}</Alert>}
        <div role="radiogroup" aria-label={`Stars for ${person.fullName}`} className="flex">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={plural(n, 'star')} onClick={() => setStars(n)} className="focus-ring rounded p-2">
              <Star size={28} aria-hidden className={n <= stars ? 'fill-gold text-ink' : 'text-ink'} />
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {TAGS.map((t) => {
            const on = tags.includes(t)
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
                className={`focus-ring min-h-11 rounded-full border px-3 text-sm ${on ? 'border-ink bg-ink text-gold' : 'border-ink/30 bg-surface text-ink'}`}
              >
                {t}
              </button>
            )
          })}
        </div>
        <TextField label="Comment" optional value={comment} onChange={(e) => setComment(e.target.value)} maxLength={300} />
        <Button type="submit" size="sm" isLoading={busy}>Send rating</Button>
      </form>
    </li>
  )
}

/** A separate, deliberate route to tell the RideMate team about a safety problem. */
function ReportPanel({ people, bookingFor }) {
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState(people.length === 1 ? people[0].userId : '')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const person = people.find((p) => p.userId === who)
    if (!person || !category || description.trim().length < 5) return setError('Choose who, a category, and describe what happened.')
    setBusy(true)
    setError(null)
    try {
      await api.reportIncident(bookingFor(person), { reportedUserId: who, category, description: description.trim() })
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel as="section" aria-labelledby="report" className="border-coral">
      <h2 id="report" className="flex items-center gap-2 font-display text-2xl leading-none font-semibold tracking-wide uppercase">
        <Flag size={20} aria-hidden /> Report a safety problem
      </h2>
      {sent ? (
        <p className="mt-3 text-sm">Thank you. The RideMate team has been told and will review it.</p>
      ) : !open ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink/85">Something went wrong in this ride? This goes to the RideMate team, not to the other person.</p>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Report a problem</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Who is this about?">
            {({ aria }) => <SelectField {...aria} value={who} onChange={(e) => setWho(e.target.value)} options={people.map((p) => ({ value: p.userId, label: p.fullName }))} />}
          </Field>
          <Field label="What kind of problem?">
            {({ aria }) => <SelectField {...aria} value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORIES} />}
          </Field>
          <Field label="What happened?">
            {({ aria }) => (
              <textarea {...aria} value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={2000} className="block w-full rounded-(--radius-control) border border-ink/30 bg-surface p-3 text-base text-ink focus:outline-2 focus:outline-mint" />
            )}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" isLoading={busy}>Send report</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </form>
      )}
    </Panel>
  )
}
