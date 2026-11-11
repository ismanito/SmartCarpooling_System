import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField } from '../components/ui/Field.jsx'
import { SeatPicker } from '../components/ui/SeatPicker.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { RouteMap } from '../components/rides/RouteMap.jsx'
import { PlacePicker } from '../components/rides/PlacePicker.jsx'
import { api, applyFieldErrors } from '../lib/api.js'
import { rideRequestSchema, localToIso } from '../lib/schemas.js'
import {
  Card, Contact, MatchFacts, MatchScore, RateTrip, Rating, Route, SectionTitle, Seats, StatusBadge, SubItem, SubList, TripLine, Vehicle,
  formatWhen, localInputValue, plural, useLiveList, usePlaces,
} from '../components/rides/RideBits.jsx'

const loadRequests = () => api.myRequests().then((r) => r.requests)

export default function FindRide() {
  const places = usePlaces()
  const { items: requests, error, refreshKey, reload, run } = useLiveList(loadRequests)
  const [route, setRoute] = useState({})

  return (
    <div className="space-y-8">
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PageTitle className="mb-2">Find a ride</PageTitle>
          <p className="mb-5 text-sm text-ink/85">Say where and when you're going. We'll show drivers on a similar route at a similar time.</p>
          {(places.error || error) && <Alert tone="error">{places.error || error}</Alert>}
          {places.options.length === 0 ? <Spinner /> : <RequestForm places={places} onCreated={reload} onRouteChange={setRoute} />}
        </Panel>
        <RouteMap from={route.from} to={route.to} className="h-full" />
      </div>

      <section aria-labelledby="my-requests" className="space-y-3">
        <SectionTitle id="my-requests">My ride requests</SectionTitle>
        {requests === null ? (
          <Spinner />
        ) : requests.length === 0 ? (
          <p className="text-sm text-ink/85">No ride requests yet. Post one above to see matching drivers.</p>
        ) : (
          <ul className="space-y-3">
            {requests.map((r) => (
              <RequestCard key={r.requestId} request={r} refreshKey={refreshKey} run={run} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function RequestForm({ places, onCreated, onRouteChange }) {
  const [serverError, setServerError] = useState(null)
  const {
    register, handleSubmit, setError, reset, watch, setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(rideRequestSchema),
    defaultValues: { origin: '', destination: 'usiu-gate-a', originBuilding: '', destinationBuilding: '', departAt: localInputValue(60), seats: 1 },
  })

  const origin = watch('origin')
  const destination = watch('destination')
  useEffect(() => {
    onRouteChange({ from: places.byId[origin], to: places.byId[destination] })
  }, [origin, destination, places.byId, onRouteChange])

  const onSubmit = async (data) => {
    setServerError(null)
    try {
      await api.createRequest({ ...data, departAt: localToIso(data.departAt) })
      reset({ ...data, departAt: localInputValue(60) })
      await onCreated()
    } catch (err) {
      if (!applyFieldErrors(err, setError)) setServerError(err.message || 'Your request was not posted. Try again.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <PlacePicker
          label="Pick-up point"
          places={places.list}
          buildings={places.buildings}
          value={{ place: origin, building: watch('originBuilding') || '' }}
          onChange={({ place, building }) => {
            setValue('origin', place, { shouldValidate: true })
            setValue('originBuilding', building)
          }}
          error={errors.origin?.message || errors.originBuilding?.message}
          placeholder="Search where from, e.g. Roysambu"
        />
        <PlacePicker
          label="Drop-off point"
          places={places.list}
          buildings={places.buildings}
          value={{ place: destination, building: watch('destinationBuilding') || '' }}
          onChange={({ place, building }) => {
            setValue('destination', place, { shouldValidate: true })
            setValue('destinationBuilding', building)
          }}
          error={errors.destination?.message || errors.destinationBuilding?.message}
          placeholder="Search where to, e.g. USIU or Westlands"
        />
        <input type="hidden" {...register('origin')} />
        <input type="hidden" {...register('destination')} />
        <input type="hidden" {...register('originBuilding')} />
        <input type="hidden" {...register('destinationBuilding')} />
      </div>
      <Field label="Leaving at" error={errors.departAt?.message}>
        {({ aria }) => <TextField {...aria} {...register('departAt')} type="datetime-local" min={localInputValue(1)} />}
      </Field>
      <SeatPicker
        label="Seats needed"
        value={Number(watch('seats')) || 1}
        onChange={(v) => setValue('seats', v, { shouldValidate: true })}
        error={errors.seats?.message}
      />
      <Button type="submit" fullWidth isLoading={isSubmitting}>
        Find matching drivers
      </Button>
    </form>
  )
}

function RequestCard({ request: r, refreshKey, run }) {
  const [matches, setMatches] = useState(null)
  const [busy, setBusy] = useState(null)
  const open = r.status === 'open'
  const finished = r.status === 'completed'
  const live = r.bookings.filter((b) => b.status === 'pending' || b.status === 'accepted')
  const past = r.bookings.filter((b) => b.status === 'declined' || b.status === 'cancelled')

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    api
      .requestMatches(r.requestId)
      .then(({ matches: m }) => alive && setMatches(m))
      .catch(() => alive && setMatches([]))
    return () => {
      alive = false
    }
  }, [open, r.requestId, refreshKey])

  const act = (key, fn) => async () => {
    setBusy(key)
    await run(fn)
    setBusy(null)
  }

  return (
    <Card muted={r.status === 'cancelled'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <TripLine from={r.origin} to={r.destination} when={r.departAt} />
          <Seats>{plural(r.seatsNeeded, 'seat')}</Seats>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge kind="request" status={r.status} />
          {(open || r.status === 'matched') && (
            <Button variant="ghost" size="sm" isLoading={busy === 'cancel'} onClick={act('cancel', () => api.cancelRequest(r.requestId))}>
              Cancel request
            </Button>
          )}
        </div>
      </div>

      {live.length > 0 && (
        <SubList title={finished ? 'Your trip' : 'Your bookings'}>
          {live.map((b) => (
            <SubItem key={b.bookingId}>
              <div className="flex flex-col items-start gap-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  {b.driver.fullName} <Rating value={b.driver.rating} /> {!finished && <StatusBadge status={b.status} />}
                </p>
                <Vehicle vehicle={b.vehicle} />
                <p className="text-sm text-ink/85">
                  {formatWhen(b.trip.departAt)} · about KES {b.costPerSeatKes} per seat for fuel
                </p>
                {b.status === 'pending' && (
                  <p className="text-sm text-ink/85">{b.initiatedBy === 'rider' ? 'Waiting for the driver to accept.' : 'The driver invited you. Accept to confirm.'}</p>
                )}
                <Contact label="Driver" phone={b.driver.phoneNumber} />
                {finished && (
                  <RateTrip name={b.driver.fullName} myStars={b.myStars} busy={busy === `r${b.bookingId}`} onRate={(stars) => act(`r${b.bookingId}`, () => api.rateBooking(b.bookingId, stars))()} />
                )}
              </div>
              {!finished && (
                <div className="flex shrink-0 gap-2">
                  {b.status === 'pending' && b.initiatedBy === 'driver' ? (
                    <>
                      <Button size="sm" isLoading={busy === `a${b.bookingId}`} onClick={act(`a${b.bookingId}`, () => api.bookingAction(b.bookingId, 'accept'))}>
                        Accept
                      </Button>
                      <Button variant="secondary" size="sm" isLoading={busy === `d${b.bookingId}`} onClick={act(`d${b.bookingId}`, () => api.bookingAction(b.bookingId, 'decline'))}>
                        Decline
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" isLoading={busy === `c${b.bookingId}`} onClick={act(`c${b.bookingId}`, () => api.bookingAction(b.bookingId, 'cancel'))}>
                      {b.status === 'accepted' ? 'Cancel ride' : 'Withdraw'}
                    </Button>
                  )}
                </div>
              )}
            </SubItem>
          ))}
        </SubList>
      )}

      {open && (
        <SubList title="Suggested drivers">
          {matches === null ? (
            <li><Spinner size={16} /></li>
          ) : matches.length === 0 ? (
            <li className="text-sm text-ink/85">No matching drivers yet. This list updates every 20 seconds.</li>
          ) : (
            matches.map(({ offer: o, match }) => (
              <SubItem key={o.offerId}>
                <div className="flex flex-col items-start gap-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {o.driver.fullName} <Rating value={o.driver.rating} />
                  </p>
                  <Route from={o.origin} to={o.destination} className="text-sm" />
                  <p className="text-sm text-ink/85">
                    {formatWhen(o.departAt)} · {plural(o.seatsAvailable, 'seat')} left · about KES {o.costPerSeatKes} per seat
                  </p>
                  <Vehicle vehicle={o.vehicle} />
                  <MatchFacts match={match} />
                </div>
                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                  <MatchScore score={match.score} />
                  <Button size="sm" isLoading={busy === `b${o.offerId}`} onClick={act(`b${o.offerId}`, () => api.book(o.offerId, r.requestId))}>
                    Request seat
                  </Button>
                </div>
              </SubItem>
            ))
          )}
        </SubList>
      )}

      {past.length > 0 && <p className="mt-3 text-xs text-ink/85">{plural(past.length, 'earlier booking')} declined or cancelled.</p>}
    </Card>
  )
}
