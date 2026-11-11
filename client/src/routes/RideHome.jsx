import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { CalendarClock, Home as HomeIcon, GraduationCap, MapPin, Phone, Search, Share2, ShieldAlert, Star, X, Zap } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx'
import { TextField } from '../components/ui/Field.jsx'
import { Alert } from '../components/ui/Panel.jsx'
import { LiveMap } from '../components/ride/LiveMap.jsx'
import { PlacePicker } from '../components/rides/PlacePicker.jsx'
import { Avatar, BigPlate, MapStage, Sheet, Stars, kes, minutesUntil, nearestLabel, useNow } from '../components/ride/bits.jsx'
import { usePlaces, localInputValue } from '../components/rides/RideBits.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLive } from '../hooks/useLive.js'
import { api } from '../lib/api.js'

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']]
const TAGS = ['On time', 'Safe driving', 'Friendly', 'Clean car', 'Easy pick-up']
const ACTIVE = ['searching', 'offered', 'assigned', 'picked_up']
const HOME_KEY = 'ridemate.home'
const DISMISSED_KEY = 'ridemate.dismissed'

const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* private mode: the shortcut just will not be remembered */
    }
  },
}

/** The rider's home: a map, "Where to?", and Ride Now or Book. */
export default function RideHome() {
  const { profile } = useAuth()
  const places = usePlaces()
  const [mode, setMode] = useState('home') // 'home' | 'confirm'
  const [kind, setKind] = useState('now') // 'now' | 'scheduled'
  const [draft, setDraft] = useState({ pickup: null, dropoff: null, seats: 1, when: '', repeat: [] })
  const [pickupPlace, setPickupPlace] = useState({ place: '', building: '' })
  const [dropPlace, setDropPlace] = useState({ place: '', building: '' })
  const [dismissed, setDismissed] = useState(() => store.get(DISMISSED_KEY, []))

  const { data: reqData, reload } = useLive(api.myTripRequests, { events: ['request:update', 'ride:update'], pollMs: 4000 })
  const requests = reqData?.requests
  const active = useMemo(() => requests?.find((r) => ACTIVE.includes(r.status)), [requests])
  const recent = useMemo(() => {
    if (!requests || active) return null
    return requests.find((r) => r.type === 'now' && ['no_driver', 'completed'].includes(r.status) && !dismissed.includes(r.requestId) && Date.now() - new Date(r.createdAt).getTime() < 3 * 3600_000)
  }, [requests, active, dismissed])
  const focus = active || recent
  const next = useMemo(() => requests?.filter((r) => r.type === 'scheduled' && ['scheduled', 'searching'].includes(r.status)).sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))[0], [requests])

  const rideId = focus?.rideId
  const { data: ride, reload: reloadRide } = useLive(useCallback(() => api.rideLive(rideId), [rideId]), {
    events: ['ride:update', 'ride:location'],
    pollMs: 3000,
    enabled: Boolean(rideId),
  })

  const dismiss = (id) => {
    const nextList = [...dismissed, id]
    setDismissed(nextList)
    store.set(DISMISSED_KEY, nextList)
  }

  // Start from where the person is, when the browser can tell us.
  const askedLocation = useRef(false)
  useEffect(() => {
    if (askedLocation.current || !navigator.geolocation) return
    askedLocation.current = true
    navigator.geolocation.getCurrentPosition(
      (pos) => setDraft((d) => (d.pickup ? d : { ...d, pickup: { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Current location' } })),
      () => {},
      { timeout: 6000, maximumAge: 60_000 },
    )
  }, [])

  const labelFor = (sel) => {
    const p = places.byId[sel.place]
    if (!p) return ''
    const b = places.buildings.find((x) => x.id === sel.building)
    return b ? `${p.name} (${b.name})` : p.name
  }
  const choosePlace = (which) => (sel) => {
    const p = places.byId[sel.place]
    if (!p) return
    const point = { lat: p.lat, lng: p.lng, label: labelFor(sel) }
    if (which === 'pickup') {
      setPickupPlace(sel)
      setDraft((d) => ({ ...d, pickup: point }))
    } else {
      setDropPlace(sel)
      setDraft((d) => ({ ...d, dropoff: point }))
    }
  }
  const dragPickup = (lat, lng) => {
    setPickupPlace({ place: '', building: '' })
    setDraft((d) => ({ ...d, pickup: { lat, lng, label: nearestLabel(lat, lng, places.list) } }))
  }

  const goTo = (placeId) => {
    choosePlace('dropoff')({ place: placeId, building: '' })
  }
  const home = store.get(HOME_KEY, null)

  const markers = useMemo(() => {
    const m = []
    if (draft.pickup) m.push({ id: 'pickup', lat: draft.pickup.lat, lng: draft.pickup.lng, color: '#01c49a', text: 'A', draggable: !focus, onDrag: dragPickup })
    if (draft.dropoff && !focus) m.push({ id: 'dropoff', lat: draft.dropoff.lat, lng: draft.dropoff.lng, color: '#fb8f67', text: 'B' })
    if (focus && ride) {
      for (const s of ride.stops.filter((x) => x.mine && x.lat != null && !x.doneAt)) {
        m.push({ id: s.stopId, lat: s.lat, lng: s.lng, color: s.kind === 'pickup' ? '#01c49a' : '#fb8f67', text: s.kind === 'pickup' ? 'A' : 'B' })
      }
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.pickup, draft.dropoff, focus, ride])
  const car = ride?.driver?.location ? { lat: ride.driver.location.lat, lng: ride.driver.location.lng, heading: ride.driver.location.heading } : null
  const fitKey = focus ? `${focus.requestId}-${focus.status}-${ride ? 'r' : ''}` : `${draft.pickup ? 'p' : ''}${draft.dropoff ? 'd' : ''}${mode}`

  return (
    <MapStage>
      <LiveMap markers={markers} car={car} fitKey={fitKey} className="absolute inset-0" label="Map of your pick-up, drop-off and driver" />
      {focus ? (
        <TripSheet
          request={focus}
          ride={ride}
          onChange={() => {
            reload()
            reloadRide()
          }}
          onDismiss={() => dismiss(focus.requestId)}
          onRetry={() => {
            setKind('now')
            setDraft((d) => ({ ...d, pickup: { lat: focus.pickup.lat, lng: focus.pickup.lng, label: focus.pickup.label }, dropoff: { lat: focus.dropoff.lat, lng: focus.dropoff.lng, label: focus.dropoff.label } }))
            setMode('confirm')
            dismiss(focus.requestId)
          }}
          onBookLater={() => {
            setKind('scheduled')
            setDraft((d) => ({ ...d, pickup: { lat: focus.pickup.lat, lng: focus.pickup.lng, label: focus.pickup.label }, dropoff: { lat: focus.dropoff.lat, lng: focus.dropoff.lng, label: focus.dropoff.label }, when: localInputValue(60) }))
            setMode('confirm')
            dismiss(focus.requestId)
          }}
        />
      ) : mode === 'confirm' ? (
        <ConfirmSheet
          kind={kind}
          draft={draft}
          setDraft={setDraft}
          places={places}
          pickupPlace={pickupPlace}
          onPickup={choosePlace('pickup')}
          dropPlace={dropPlace}
          onDrop={choosePlace('dropoff')}
          onBack={() => setMode('home')}
          onDone={() => {
            setMode('home')
            reload()
          }}
        />
      ) : (
        <Sheet>
          <p className="font-display text-3xl leading-none font-semibold tracking-wide text-ink-deep uppercase">Hi, {profile?.fullName?.split(' ')[0]}</p>
          <PlacePicker
            label="Where to?"
            places={places.list}
            buildings={places.buildings}
            value={dropPlace}
            onChange={choosePlace('dropoff')}
            placeholder="Search where you are going"
          />
          <div className="flex flex-wrap gap-2">
            <Shortcut icon={GraduationCap} label="Campus" onClick={() => goTo('usiu-gate-a')} />
            {home ? (
              <Shortcut icon={HomeIcon} label={`Home: ${home.name}`} onClick={() => goTo(home.id)} onClear={() => { store.set(HOME_KEY, null); setDismissed((d) => [...d]) }} />
            ) : (
              <Shortcut
                icon={HomeIcon}
                label="Set home"
                onClick={() => {
                  if (!dropPlace.place) return
                  const p = places.byId[dropPlace.place]
                  store.set(HOME_KEY, { id: p.id, name: p.name })
                  setDismissed((d) => [...d])
                }}
                hint={dropPlace.place ? undefined : 'Pick a place first, then tap this'}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button disabled={!draft.dropoff} onClick={() => { setKind('now'); setMode('confirm') }} className="h-14! text-lg!">
              <Zap size={20} aria-hidden /> Ride Now
            </Button>
            <Button variant="secondary" disabled={!draft.dropoff} onClick={() => { setKind('scheduled'); setDraft((d) => ({ ...d, when: d.when || localInputValue(60) })); setMode('confirm') }} className="h-14! text-lg!">
              <CalendarClock size={20} aria-hidden /> Book
            </Button>
          </div>
          {next && (
            <Link to="/bookings" className="focus-ring block rounded-(--radius-control) bg-paper p-3 text-sm">
              <span className="font-medium text-ink">Next booking:</span> {next.pickup.label} to {next.dropoff.label}, {new Date(next.scheduledFor).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
            </Link>
          )}
          <p className="text-xs text-ink/85">RideMate shares the fuel cost between students going the same way. There is no commission and no surge pricing.</p>
        </Sheet>
      )}
    </MapStage>
  )
}

function Shortcut({ icon: Icon, label, onClick, onClear, hint }) {
  return (
    <span className="inline-flex items-center">
      <button type="button" onClick={onClick} title={hint} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border border-ink/30 bg-surface px-3 text-sm font-medium text-ink hover:border-ink">
        <Icon size={16} aria-hidden /> {label}
      </button>
      {onClear && (
        <button type="button" aria-label="Remove home" onClick={onClear} className="focus-ring ml-1 flex size-8 items-center justify-center rounded-full hover:bg-ink/8">
          <X size={14} aria-hidden />
        </button>
      )}
    </span>
  )
}

// ---------------------------------------------------------------- confirm

function ConfirmSheet({ kind, draft, setDraft, places, pickupPlace, onPickup, dropPlace, onDrop, onBack, onDone }) {
  const [est, setEst] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const { pickup, dropoff } = draft

  useEffect(() => {
    if (!pickup || !dropoff) return undefined
    let live = true
    const t = setTimeout(() => {
      api.estimate({ lat: pickup.lat, lng: pickup.lng }, { lat: dropoff.lat, lng: dropoff.lng }).then((r) => live && setEst(r)).catch(() => live && setEst(null))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [pickup, dropoff])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.createRequest2({
        type: kind,
        pickup,
        dropoff,
        seats: draft.seats,
        ...(kind === 'scheduled' ? { scheduledFor: new Date(draft.when).toISOString(), ...(draft.repeat.length ? { repeatDays: draft.repeat } : {}) } : {}),
      })
      onDone()
    } catch (err) {
      setError(err.details?.[0]?.message || err.message)
    } finally {
      setBusy(false)
    }
  }

  const ready = pickup && dropoff && est?.inPilotArea !== false && (kind === 'now' || draft.when)
  return (
    <Sheet>
      <div className="flex items-center justify-between">
        <p className="font-display text-2xl leading-none font-semibold tracking-wide text-ink-deep uppercase">{kind === 'now' ? 'Ride Now' : 'Book a ride'}</p>
        <button type="button" onClick={onBack} aria-label="Back" className="focus-ring flex size-11 items-center justify-center rounded-full hover:bg-ink/8">
          <X size={20} aria-hidden />
        </button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <p className="flex items-center gap-2 text-sm text-ink">
        <MapPin size={16} aria-hidden className="text-mint" /> <span className="font-medium">{pickup ? pickup.label : 'Choose a pick-up point'}</span>
      </p>
      <PlacePicker label="Pick-up" places={places.list} buildings={places.buildings} value={pickupPlace} onChange={onPickup} placeholder="Search a pick-up, or drag the green pin" />
      <PlacePicker label="Drop-off" places={places.list} buildings={places.buildings} value={dropPlace} onChange={onDrop} />
      {kind === 'scheduled' && (
        <>
          <TextField label="Pick-up time" type="datetime-local" min={localInputValue(10)} value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value })} />
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-ink">Repeat <span className="font-normal text-ink/85">(optional)</span></legend>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(([id, label]) => {
                const on = draft.repeat.includes(id)
                return (
                  <button key={id} type="button" aria-pressed={on} onClick={() => setDraft({ ...draft, repeat: on ? draft.repeat.filter((d) => d !== id) : [...draft.repeat, id] })} className={`focus-ring min-h-11 min-w-12 rounded-full border px-3 text-sm ${on ? 'border-ink bg-ink text-gold' : 'border-ink/30 bg-surface text-ink'}`}>
                    {label}
                  </button>
                )
              })}
            </div>
          </fieldset>
        </>
      )}
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">Seats</legend>
        <div className="flex gap-2">
          {[1, 2].map((n) => (
            <button key={n} type="button" aria-pressed={draft.seats === n} onClick={() => setDraft({ ...draft, seats: n })} className={`focus-ring min-h-11 flex-1 rounded-(--radius-control) border text-base font-medium ${draft.seats === n ? 'border-ink bg-ink text-gold' : 'border-ink/30 bg-surface text-ink'}`}>
              {n}
            </button>
          ))}
        </div>
      </fieldset>
      {est && !est.inPilotArea && <Alert tone="error">Outside the pilot area. RideMate covers USIU, the Thika Road area, Westlands, the CBD and nearby.</Alert>}
      {est?.inPilotArea && (
        <div className="rounded-(--radius-control) bg-paper p-3 text-sm text-ink">
          <p>
            Your share: about <strong>{kes(est.estShareKes * draft.seats)}</strong> if you ride with just the driver, and as low as <strong>{kes(est.estPooledKes * draft.seats)}</strong> if two other students join. Pay your driver after the ride.
          </p>
          {kind === 'now' && <p className="mt-1 text-ink/85">{est.driversNearby === 0 ? 'No drivers are online near you right now. You can still try, or book for later.' : `${est.driversNearby} driver${est.driversNearby === 1 ? '' : 's'} online nearby.`}</p>}
        </div>
      )}
      <Button fullWidth className="h-14! text-lg!" disabled={!ready} isLoading={busy} onClick={submit}>
        {kind === 'now' ? 'Confirm Ride Now' : draft.repeat.length ? 'Confirm repeating booking' : 'Confirm booking'}
      </Button>
    </Sheet>
  )
}

// ---------------------------------------------------------------- during and after the trip

function TripSheet({ request, ride, onChange, onDismiss, onRetry, onBookLater }) {
  const now = useNow(5000)
  const [cancelling, setCancelling] = useState(false)
  const [sosOpen, setSosOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const status = request.status

  const cancel = async () => {
    setBusy(true)
    try {
      await api.cancelTripRequest(request.requestId)
      setCancelling(false)
      onChange()
    } catch (err) {
      setNote(err.message)
      setCancelling(false)
    } finally {
      setBusy(false)
    }
  }

  if (status === 'searching' || status === 'offered') {
    return (
      <Sheet>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span aria-hidden className="relative flex size-20 items-center justify-center">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint/40" />
            <span className="absolute inline-flex size-14 animate-pulse rounded-full bg-mint/60" />
            <Search size={24} className="relative text-asphalt" />
          </span>
          <p role="status" className="font-display text-2xl leading-none font-semibold tracking-wide uppercase">Finding a driver near you…</p>
          <p className="text-sm text-ink/85">{request.pickup.label} to {request.dropoff.label}</p>
        </div>
        <Button fullWidth variant="secondary" onClick={() => setCancelling(true)}>Cancel</Button>
        <CancelDialog open={cancelling} busy={busy} onConfirm={cancel} onClose={() => setCancelling(false)} />
      </Sheet>
    )
  }

  if (status === 'no_driver') {
    return (
      <Sheet>
        <p className="font-display text-2xl leading-none font-semibold tracking-wide uppercase">No driver found</p>
        <p className="text-sm text-ink">Nobody near you could take this ride right now.</p>
        <div className="grid grid-cols-2 gap-3">
          <Button onClick={onRetry}>Try again</Button>
          <Button variant="secondary" onClick={onBookLater}>Book for later</Button>
        </div>
        <Button fullWidth variant="ghost" size="sm" onClick={onDismiss}>Close</Button>
      </Sheet>
    )
  }

  if (status === 'completed') return <EndSheet request={request} ride={ride} onDismiss={onDismiss} />

  if (!ride) {
    return (
      <Sheet>
        <p className="py-6 text-center text-sm text-ink/85">Loading your ride…</p>
      </Sheet>
    )
  }

  const myStops = ride.stops.filter((s) => s.mine && !s.doneAt)
  const nextStop = myStops[0]
  const eta = minutesUntil(nextStop?.eta, now)
  const driver = ride.driver
  const onTrip = status === 'picked_up'
  const share = () => {
    const text = `I'm riding with ${driver.firstName} in a ${driver.vehicle.colour} ${driver.vehicle.makeModel}, plate ${driver.vehicle.plateNumber}. From ${request.pickup.label} to ${request.dropoff.label}.`
    if (navigator.share) navigator.share({ title: 'My RideMate ride', text }).catch(() => {})
    else navigator.clipboard?.writeText(text).then(() => setNote('Trip details copied.')).catch(() => {})
  }
  const order = ride.stops.filter((s) => !s.doneAt)

  return (
    <Sheet>
      {note && <Alert tone="info">{note}</Alert>}
      <div className="flex items-center gap-3">
        <Avatar name={driver.fullName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-medium text-ink">{driver.firstName}</p>
          <Stars value={driver.rating} />
        </div>
        <div className="text-right">
          <p className="font-display text-3xl leading-none font-semibold text-ink-deep">{eta === null ? '' : eta <= 0 ? 'Now' : `${eta} min`}</p>
          <p className="text-xs text-ink/85">{onTrip ? 'to drop-off' : 'to pick-up'}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-control) bg-paper p-3">
        <p className="text-sm text-ink">{driver.vehicle.colour} {driver.vehicle.makeModel}</p>
        <BigPlate plate={driver.vehicle.plateNumber} />
      </div>
      <p role="status" className="text-sm font-medium text-ink">
        {onTrip ? 'You are on your way.' : nextStop?.arrivedAt ? 'Your driver has arrived.' : 'Your driver is on the way.'}
      </p>
      {ride.pooled && (
        <p className="rounded-(--radius-control) bg-paper p-3 text-sm text-ink">
          Sharing with {ride.pooledWith.length} other student{ride.pooledWith.length === 1 ? '' : 's'} going to {ride.pooledWith.map((p) => p.zone).join(' and ')}. Your fare is split for the part of the road you share.
        </p>
      )}
      {order.length > 1 && (
        <ol className="space-y-1 text-sm">
          {order.map((s, i) => (
            <li key={s.stopId} className="flex items-center gap-2">
              <span aria-hidden className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${s.mine ? 'bg-ink text-gold' : 'bg-ink/15 text-ink'}`}>{i + 1}</span>
              <span className={s.mine ? 'font-medium text-ink' : 'text-ink/85'}>{s.kind === 'pickup' ? 'Pick up' : 'Drop off'}: {s.mine ? s.label : `another student, ${s.label}`}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="grid grid-cols-3 gap-2">
        {driver.phoneNumber && (
          <Button to={`tel:${driver.phoneNumber}`} variant="secondary" size="sm"><Phone size={16} aria-hidden /> Call</Button>
        )}
        <Button variant="secondary" size="sm" onClick={share}><Share2 size={16} aria-hidden /> Share</Button>
        {onTrip ? (
          <Button variant="danger" size="sm" onClick={() => setSosOpen(true)}><ShieldAlert size={16} aria-hidden /> SOS</Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setCancelling(true)}>Cancel</Button>
        )}
      </div>
      <CancelDialog open={cancelling} busy={busy} onConfirm={cancel} onClose={() => setCancelling(false)} />
      <ConfirmDialog
        open={sosOpen}
        title="Send an SOS?"
        confirmLabel="Send SOS"
        isLoading={busy}
        onCancel={() => setSosOpen(false)}
        onConfirm={async () => {
          setBusy(true)
          try {
            await api.sos(ride.ride.rideId)
            setNote('The RideMate team has been alerted. If you are in danger, call 999 now.')
          } catch (err) {
            setNote(err.message)
          } finally {
            setBusy(false)
            setSosOpen(false)
          }
        }}
      >
        The RideMate team is alerted straight away and sees this ride. If you are in danger, call 999 as well.
      </ConfirmDialog>
    </Sheet>
  )
}

function CancelDialog({ open, busy, onConfirm, onClose }) {
  return (
    <ConfirmDialog open={open} title="Cancel this ride?" confirmLabel="Yes, cancel" isLoading={busy} onConfirm={onConfirm} onCancel={onClose}>
      Your driver is told and the ride is removed.
    </ConfirmDialog>
  )
}

/** After the ride: your share, a reminder to pay, and the rating. */
function EndSheet({ request, ride, onDismiss }) {
  const [stars, setStars] = useState(0)
  const [tags, setTags] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [rated, setRated] = useState(false)
  const mine = ride?.shares?.find((s) => s.mine)

  const submit = async () => {
    if (!stars) return setError('Choose 1 to 5 stars.')
    setBusy(true)
    setError(null)
    try {
      await api.rateRide(ride.ride.rideId, { rateeId: ride.driver.userId, stars, tags })
      setRated(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet>
      <p className="font-display text-2xl leading-none font-semibold tracking-wide uppercase">You have arrived</p>
      <p className="text-sm text-ink/85">{request.pickup.label} to {request.dropoff.label}</p>
      {mine ? (
        <div className="rounded-(--radius-control) bg-paper p-3">
          <p className="text-sm text-ink">Your share</p>
          <p className="font-display text-4xl leading-none font-semibold text-ink-deep">{kes(mine.amountKes)}</p>
          <p className="mt-1 text-sm text-ink">{mine.status === 'paid' ? 'Your driver marked this as paid.' : 'Pay your driver in cash or M-Pesa. They will mark it as paid.'}</p>
        </div>
      ) : (
        <p className="text-sm text-ink/85">Working out your share…</p>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {rated || ride?.iRatedDriver ? (
        <p className="text-sm font-medium text-ink">Thanks for rating {ride?.driver.firstName}.</p>
      ) : ride ? (
        <div className="space-y-3">
          <p className="font-medium text-ink">Rate {ride.driver.firstName}</p>
          <div role="radiogroup" aria-label="Stars" className="flex">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => setStars(n)} className="focus-ring rounded p-2">
                <Star size={30} aria-hidden className={n <= stars ? 'fill-gold text-ink' : 'text-ink'} />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {TAGS.map((t) => {
              const on = tags.includes(t)
              return (
                <button key={t} type="button" aria-pressed={on} onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])} className={`focus-ring min-h-11 rounded-full border px-3 text-sm ${on ? 'border-ink bg-ink text-gold' : 'border-ink/30 bg-surface text-ink'}`}>
                  {t}
                </button>
              )
            })}
          </div>
          <Button fullWidth size="sm" isLoading={busy} onClick={submit}>Send rating</Button>
        </div>
      ) : null}
      <Button fullWidth variant="secondary" onClick={onDismiss}>Done</Button>
    </Sheet>
  )
}
