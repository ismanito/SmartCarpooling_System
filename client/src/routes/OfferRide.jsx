import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField, SelectField } from '../components/ui/Field.jsx'
import { SeatPicker } from '../components/ui/SeatPicker.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { RouteMap } from '../components/rides/RouteMap.jsx'
import { PlacePicker } from '../components/rides/PlacePicker.jsx'
import { api, applyFieldErrors } from '../lib/api.js'
import { rideOfferSchema, localToIso, formatPlate } from '../lib/schemas.js'
import {
  Card, Contact, MatchFacts, MatchScore, RateTrip, Rating, Route, SectionTitle, Seats, StatusBadge, SubItem, SubList, TripLine, Vehicle,
  localInputValue, plural, useLiveList, usePlaces,
} from '../components/rides/RideBits.jsx'

const loadOffers = () => api.myOffers().then((r) => r.offers)
const FINISH_WINDOW_MS = 60 * 60 * 1000

export default function OfferRide() {
  const places = usePlaces()
  const { items: offers, error, setError, refreshKey, reload, run } = useLiveList(loadOffers)
  const [vehicles, setVehicles] = useState(null)
  const [route, setRoute] = useState({})

  useEffect(() => {
    api
      .listVehicles()
      .then(({ vehicles: vs }) => setVehicles(vs))
      .catch((err) => {
        setVehicles([])
        setError(err.message || 'Could not load your vehicles. Reload to try again.')
      })
  }, [setError])

  return (
    <div className="space-y-8">
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PageTitle className="mb-2">Offer a ride</PageTitle>
          <p className="mb-5 text-sm text-ink/85">Post your trip and we'll suggest students heading the same way. You choose who rides with you.</p>
          {(places.error || error) && <Alert tone="error">{places.error || error}</Alert>}
          {vehicles === null || places.options.length === 0 ? (
            <Spinner />
          ) : vehicles.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-ink">Add a vehicle before offering a ride.</p>
              <Button to="/vehicles">Add a vehicle</Button>
            </div>
          ) : (
            <OfferForm places={places} vehicles={vehicles} onCreated={reload} onRouteChange={setRoute} />
          )}
        </Panel>
        <RouteMap from={route.from} to={route.to} className="h-full" />
      </div>

      <section aria-labelledby="my-offers" className="space-y-3">
        <SectionTitle id="my-offers">My ride offers</SectionTitle>
        {offers === null ? (
          <Spinner />
        ) : offers.length === 0 ? (
          <p className="text-sm text-ink/85">No ride offers yet. Post one above to see students going your way.</p>
        ) : (
          <ul className="space-y-3">
            {offers.map((o) => (
              <OfferCard key={o.offerId} offer={o} refreshKey={refreshKey} run={run} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function OfferForm({ places, vehicles, onCreated, onRouteChange }) {
  const [serverError, setServerError] = useState(null)
  const {
    register, handleSubmit, setError, reset, watch, setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(rideOfferSchema),
    defaultValues: {
      vehicleId: vehicles[0].vehicleId,
      origin: 'usiu-gate-a',
      destination: '',
      originBuilding: '',
      destinationBuilding: '',
      departAt: localInputValue(60),
      seats: Math.min(3, vehicles[0].seatCapacity),
    },
  })

  const vehicle = vehicles.find((v) => v.vehicleId === watch('vehicleId'))
  const seats = Number(watch('seats')) || 1
  const origin = watch('origin')
  const destination = watch('destination')

  useEffect(() => {
    onRouteChange({ from: places.byId[origin], to: places.byId[destination] })
  }, [origin, destination, places.byId, onRouteChange])

  const onSubmit = async (data) => {
    setServerError(null)
    if (vehicle && data.seats > vehicle.seatCapacity) {
      setError('seats', { message: `Your ${vehicle.makeModel} has ${plural(vehicle.seatCapacity, 'passenger seat')}` })
      return
    }
    try {
      await api.createOffer({ ...data, departAt: localToIso(data.departAt) })
      reset({ ...data, departAt: localInputValue(60) })
      await onCreated()
    } catch (err) {
      if (!applyFieldErrors(err, setError)) setServerError(err.message || 'Your ride was not posted. Try again.')
    }
  }

  const vehicleOptions = vehicles.map((v) => ({
    value: v.vehicleId,
    label: `${v.makeModel} · ${formatPlate(v.plateNumber)} · ${plural(v.seatCapacity, 'seat')}`,
  }))

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <Field label="Vehicle" error={errors.vehicleId?.message}>
        {({ aria }) => <SelectField {...aria} {...register('vehicleId')} options={vehicleOptions} placeholder="Choose a vehicle" />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <PlacePicker
          label="Starting from"
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
          label="Going to"
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
        label="Seats offered"
        hint={vehicle ? `Up to ${vehicle.seatCapacity} in this vehicle` : undefined}
        value={seats}
        onChange={(v) => setValue('seats', v, { shouldValidate: true })}
        error={errors.seats?.message}
      />
      <Button type="submit" fullWidth isLoading={isSubmitting}>
        Post ride
      </Button>
    </form>
  )
}

function OfferCard({ offer: o, refreshKey, run }) {
  const [matches, setMatches] = useState(null)
  const [busy, setBusy] = useState(null)
  const isOpen = o.status === 'open'
  const finished = o.status === 'completed'
  const leavesInMs = new Date(o.departAt).getTime() - Date.now()
  const live = o.bookings.filter((b) => b.status === 'pending' || b.status === 'accepted')
  const past = o.bookings.filter((b) => b.status === 'declined' || b.status === 'cancelled')
  const showSuggestions = isOpen && leavesInMs > 0 && o.seatsAvailable > 0

  useEffect(() => {
    if (!showSuggestions) return undefined
    let alive = true
    api
      .offerMatches(o.offerId)
      .then(({ matches: m }) => alive && setMatches(m))
      .catch(() => alive && setMatches([]))
    return () => {
      alive = false
    }
  }, [showSuggestions, o.offerId, refreshKey])

  const act = (key, fn) => async () => {
    setBusy(key)
    await run(fn)
    setBusy(null)
  }

  return (
    <Card muted={o.status === 'cancelled'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col items-start gap-2">
          <TripLine from={o.origin} to={o.destination} when={o.departAt} />
          <Seats>
            {o.seatsAvailable} of {plural(o.seatsTotal, 'seat')} free
          </Seats>
          <Vehicle vehicle={o.vehicle} />
          <p className="text-sm text-ink/85">
            {o.routeKm} km · suggested fuel share KES {o.costPerSeatKes} per seat
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="offer" status={o.status} />
          {isOpen && leavesInMs < FINISH_WINDOW_MS && (
            <Button size="sm" isLoading={busy === 'finish'} onClick={act('finish', () => api.completeOffer(o.offerId))}>
              Finish trip
            </Button>
          )}
          {isOpen && (
            <Button variant="ghost" size="sm" isLoading={busy === 'cancel'} onClick={act('cancel', () => api.cancelOffer(o.offerId))}>
              Cancel ride
            </Button>
          )}
        </div>
      </div>

      {live.length > 0 && (
        <SubList title="Passengers">
          {live.map((b) => (
            <SubItem key={b.bookingId}>
              <div className="flex flex-col items-start gap-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  {b.rider.fullName} <Rating value={b.rider.rating} /> {!finished && <StatusBadge status={b.status} />}
                </p>
                <p className="text-sm text-ink/85">
                  {b.rider.faculty} · {plural(b.seats, 'seat')}
                </p>
                <Route from={b.trip.origin} to={b.trip.destination} className="text-sm" />
                {b.status === 'pending' && (
                  <p className="text-sm text-ink/85">{b.initiatedBy === 'rider' ? 'Wants a seat on your ride.' : 'Invite sent. Waiting for the rider.'}</p>
                )}
                <Contact label="Rider" phone={b.rider.phoneNumber} />
                {finished && b.status === 'accepted' && (
                  <RateTrip name={b.rider.fullName} myStars={b.myStars} busy={busy === `r${b.bookingId}`} onRate={(stars) => act(`r${b.bookingId}`, () => api.rateBooking(b.bookingId, stars))()} />
                )}
              </div>
              {!finished && (
                <div className="flex shrink-0 gap-2">
                  {b.status === 'pending' && b.initiatedBy === 'rider' ? (
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
                      {b.status === 'accepted' ? 'Remove passenger' : 'Withdraw invite'}
                    </Button>
                  )}
                </div>
              )}
            </SubItem>
          ))}
        </SubList>
      )}

      {showSuggestions && (
        <SubList title="Students heading your way">
          {matches === null ? (
            <li><Spinner size={16} /></li>
          ) : matches.length === 0 ? (
            <li className="text-sm text-ink/85">No matching ride requests yet. This list updates every 20 seconds.</li>
          ) : (
            matches.map(({ request: r, match }) => (
              <SubItem key={r.requestId}>
                <div className="flex flex-col items-start gap-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {r.rider.fullName} <Rating value={r.rider.rating} />
                  </p>
                  <p className="text-sm text-ink/85">
                    {r.rider.faculty} · {plural(r.seatsNeeded, 'seat')}
                  </p>
                  <Route from={r.origin} to={r.destination} className="text-sm" />
                  <MatchFacts match={{ ...match, timeDiffMin: -match.timeDiffMin }} />
                </div>
                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                  <MatchScore score={match.score} />
                  <Button size="sm" isLoading={busy === `i${r.requestId}`} onClick={act(`i${r.requestId}`, () => api.book(o.offerId, r.requestId))}>
                    Invite
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
