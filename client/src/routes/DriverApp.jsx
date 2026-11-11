import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Car, History, Menu, Navigation, Phone, ShieldCheck, Star, Wallet, X } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx'
import { Alert } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { LiveMap } from '../components/ride/LiveMap.jsx'
import { Avatar, MapStage, Sheet, Stars, kes, useNow } from '../components/ride/bits.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLive } from '../hooks/useLive.js'
import { api } from '../lib/api.js'
import DriverApplication from './DriverApplication.jsx'

const SEND_MS = 6000
const DEMO_TOOLS = import.meta.env.VITE_DEMO_TOOLS === 'true'
const DEMO_SPOTS = {
  'USIU Gate A': { lat: -1.2189, lng: 36.8808 },
  'Thika Road Mall': { lat: -1.2196, lng: 36.8886 },
  Roysambu: { lat: -1.2185, lng: 36.8892 },
  Kasarani: { lat: -1.2216, lng: 36.9046 },
}
const TAGS = ['On time', 'Friendly', 'Easy pick-up']

/** A short two-tone beep for a new request. Browsers allow it because the driver tapped GO ONLINE first. */
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.value = 0.15
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.2)
      osc.stop(ctx.currentTime + i * 0.2 + 0.15)
    })
    setTimeout(() => ctx.close(), 800)
  } catch {
    /* no sound available */
  }
  navigator.vibrate?.([200, 100, 200])
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device cannot share its location.'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? 'Location is blocked. Allow location for this site in your browser settings.' : 'Could not get your location.')),
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  })
}

/** Reports the driver's position every few seconds while they are online (real GPS, or a demo spot). */
function useShareLocation(online, demoSpot) {
  const [error, setError] = useState(null)
  const last = useRef(0)
  useEffect(() => {
    if (!online) return undefined
    const send = (lat, lng, heading) => {
      api.sendDriverLocation({ lat, lng, ...(Number.isFinite(heading) ? { heading: (heading + 360) % 360 } : {}) }).then(() => setError(null)).catch((e) => setError(e.message))
    }
    if (demoSpot) {
      let jitter = 0
      const id = setInterval(() => {
        jitter += 0.00003
        send(demoSpot.lat + jitter, demoSpot.lng + jitter)
      }, SEND_MS)
      return () => clearInterval(id)
    }
    if (!navigator.geolocation) return undefined
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - last.current < SEND_MS) return
        last.current = Date.now()
        send(pos.coords.latitude, pos.coords.longitude, pos.coords.heading)
      },
      () => setError('Your location is not available. Riders cannot see you.'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(watch)
  }, [online, demoSpot])
  return error
}

export default function DriverApp() {
  const { profile } = useAuth()
  if (profile?.role === 'driver' && profile.driverStatus !== 'approved') return <DriverApplication />
  return <Driving />
}

function Driving() {
  const { data: st, error, reload } = useLive(api.driverState, { events: ['offer:new', 'offer:gone', 'ride:update'], pollMs: 4000 })
  const [view, setView] = useState('map')
  const [menu, setMenu] = useState(false)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const [spot, setSpot] = useState(DEMO_TOOLS ? 'USIU Gate A' : '')
  const [summaryRide, setSummaryRide] = useState(null)
  const demoSpot = spot ? DEMO_SPOTS[spot] : null

  const gpsError = useShareLocation(Boolean(st?.isOnline), demoSpot)

  // A new offer: sound and vibration, once.
  const lastOffer = useRef(null)
  useEffect(() => {
    if (st?.offer && st.offer.offerId !== lastOffer.current) {
      lastOffer.current = st.offer.offerId
      beep()
    }
  }, [st?.offer])

  const act = async (fn) => {
    setBusy(true)
    setProblem(null)
    try {
      const out = await fn()
      await reload()
      return out
    } catch (err) {
      setProblem(err.message)
      await reload()
      return null
    } finally {
      setBusy(false)
    }
  }

  const goOnline = async () => {
    setConsent(false)
    await act(async () => {
      const here = demoSpot || (await currentPosition())
      await api.goOnline({ lat: here.lat, lng: here.lng, ...(st.vehicle?.vehicleId ? { vehicleId: st.vehicle.vehicleId } : {}) })
    })
  }

  const markers = useMemo(() => {
    if (!st?.ride) return []
    return st.ride.stops
      .filter((s) => !s.doneAt && s.lat != null)
      .map((s, i) => ({ id: s.stopId, lat: s.lat, lng: s.lng, color: s.kind === 'pickup' ? '#01c49a' : '#fb8f67', text: String(i + 1), pulse: i === 0 }))
  }, [st?.ride])
  const car = st?.ride?.driver?.location
  const fitKey = st?.ride ? `${st.ride.ride.rideId}-${st.ride.stops.length}` : st?.isOnline ? 'online' : 'offline'

  if (!st) return error ? <Alert tone="error">{error}</Alert> : <Spinner />
  if (!st.canDrive) return <Alert tone="error">Your driver application has not been approved yet.</Alert>

  return (
    <>
      <MapStage>
        <LiveMap markers={markers} car={car ? { lat: car.lat, lng: car.lng, heading: car.heading } : null} fitKey={fitKey} className="absolute inset-0" label="Map of your stops" />

        <div className="absolute inset-x-0 top-0 z-[500] flex items-center gap-2 p-3">
          <button type="button" aria-label="Menu" onClick={() => setMenu(true)} className="focus-ring flex size-12 items-center justify-center rounded-full bg-surface shadow-lg">
            <Menu size={22} aria-hidden />
          </button>
          <span className={`inline-flex min-h-12 flex-1 items-center gap-2 rounded-full px-4 text-sm font-medium shadow-lg ${st.isOnline ? 'bg-asphalt text-gold' : 'bg-surface text-ink'}`} role="status">
            <span aria-hidden className={`size-2.5 rounded-full ${st.isOnline ? 'animate-pulse bg-mint' : 'bg-ink/40'}`} />
            {st.isOnline ? 'Online – sharing location' : 'Offline'}
          </span>
        </div>

        {(problem || gpsError) && (
          <div className="absolute inset-x-3 top-20 z-[500]">
            <Alert tone="error">{problem || gpsError}</Alert>
          </div>
        )}

        {st.offer ? (
          <OfferCard offer={st.offer} busy={busy} onAccept={() => act(() => api.acceptOffer(st.offer.offerId))} onDecline={() => act(() => api.declineOffer(st.offer.offerId))} />
        ) : st.ride ? (
          <ActiveRide st={st} act={act} onComplete={(rideId) => setSummaryRide(rideId)} busy={busy} />
        ) : summaryRide ? (
          <Summary rideId={summaryRide} onDone={() => setSummaryRide(null)} />
        ) : (
          <Sheet>
            {!st.isOnline ? (
              <>
                {st.vehicles.length === 0 ? (
                  <div className="space-y-2">
                    <p className="font-medium text-ink">Add your vehicle to go online.</p>
                    <Button to="/vehicles" fullWidth><Car size={18} aria-hidden /> Add a vehicle</Button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-ink">{st.vehicles[0].colour} {st.vehicles[0].makeModel} · {st.vehicles[0].plateNumber}</p>
                    {DEMO_TOOLS && (
                      <label className="flex flex-col gap-1 text-sm">
                        Demo location
                        <select value={spot} onChange={(e) => setSpot(e.target.value)} className="focus-ring h-11 rounded-(--radius-control) border border-ink/30 bg-surface px-2">
                          <option value="">Use my real location</option>
                          {Object.keys(DEMO_SPOTS).map((k) => <option key={k}>{k}</option>)}
                        </select>
                      </label>
                    )}
                    <Button fullWidth className="h-16! text-xl! tracking-wide" isLoading={busy} onClick={() => setConsent(true)}>GO ONLINE</Button>
                  </>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-ink">Waiting for a request near you. Keep this screen open so you hear it.</p>
                <p className="text-sm text-ink/85">{st.seatsFree} seat{st.seatsFree === 1 ? '' : 's'} free · {st.vehicle?.plateNumber}</p>
                <Button fullWidth variant="secondary" className="h-14!" isLoading={busy} onClick={() => act(() => api.goOffline())}>GO OFFLINE</Button>
              </>
            )}
            <p className="text-xs text-ink/85">RideMate is for students who are already making the journey to share the cost. It is not a taxi service.</p>
          </Sheet>
        )}
      </MapStage>

      <ConfirmDialog open={consent} title="Go online?" confirmLabel="Go online" isLoading={busy} onConfirm={goOnline} onCancel={() => setConsent(false)}>
        While you are online, RideMate shares your position with the riders you are matched with, and checks it every few seconds. It is never kept as a history, and it stops when you go offline. You are not a taxi: you are sharing a journey you were making anyway.
      </ConfirmDialog>

      {menu && <Drawer view={view} setView={setView} onClose={() => setMenu(false)} />}
      {view !== 'map' && <Panel view={view} st={st} onClose={() => setView('map')} />}
    </>
  )
}

// ---------------------------------------------------------------- incoming request

function OfferCard({ offer, onAccept, onDecline, busy }) {
  const now = useNow(250)
  const total = useRef(offer.seconds || 20)
  const left = Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - now) / 1000))
  const R = 28
  const C = 2 * Math.PI * R
  const fraction = Math.min(1, left / Math.max(1, total.current))
  return (
    <Sheet className="animate-[slide-up_0.25s_ease-out]">
      <div className="flex items-center gap-3">
        <Avatar name={offer.rider.firstName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-medium text-ink">{offer.rider.firstName} <span className="ml-1 inline-flex items-center gap-1 rounded-(--radius-chip) bg-ink px-1.5 text-xs text-gold"><ShieldCheck size={12} aria-hidden /> Verified</span></p>
          <Stars value={offer.rider.rating} />
        </div>
        <p className="font-display text-3xl leading-none font-semibold text-ink-deep">{offer.pickupEtaMin} min</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-(--radius-control) bg-paper p-2"><dt className="text-ink/85">Pick-up</dt><dd className="font-medium">{offer.pickup.label}</dd></div>
        <div className="rounded-(--radius-control) bg-paper p-2"><dt className="text-ink/85">Going to</dt><dd className="font-medium">{offer.dropoffLabel}</dd></div>
        <div className="rounded-(--radius-control) bg-paper p-2"><dt className="text-ink/85">Their share</dt><dd className="font-medium">about {kes(offer.estShareKes * offer.seats)}</dd></div>
        <div className="rounded-(--radius-control) bg-paper p-2"><dt className="text-ink/85">{offer.pooled ? 'Pooled' : 'Seats'}</dt><dd className="font-medium">{offer.pooled ? `+${offer.extraMinutes} min for riders aboard` : `${offer.seats} seat${offer.seats === 1 ? '' : 's'}`}</dd></div>
      </dl>
      <div className="flex items-center gap-3">
        <Button variant="secondary" className="h-14! flex-1" disabled={busy} onClick={onDecline}>Decline</Button>
        <button type="button" onClick={onAccept} disabled={busy || left === 0} className="focus-ring relative flex h-16 flex-[1.4] items-center justify-center rounded-(--radius-control) bg-ink font-display text-2xl font-semibold tracking-wide text-gold uppercase disabled:opacity-60">
          <svg aria-hidden viewBox="0 0 64 64" className="absolute left-1.5 size-12 -rotate-90">
            <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(248,225,108,.25)" strokeWidth="5" />
            <circle cx="32" cy="32" r={R} fill="none" stroke="#f8e16c" strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - fraction)} />
          </svg>
          <span className="pl-8">Accept <span className="text-base">{left}s</span></span>
        </button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------- the ride in progress

function SlideToConfirm({ label, onConfirm, disabled }) {
  const [v, setV] = useState(0)
  return (
    <div className={`relative h-14 overflow-hidden rounded-full bg-asphalt ${disabled ? 'opacity-50' : ''}`}>
      <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium tracking-wide text-gold uppercase">{label}</span>
      <input
        type="range"
        min="0"
        max="100"
        value={v}
        disabled={disabled}
        aria-label={`${label}: slide all the way to the end`}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (n >= 98) {
            setV(0)
            onConfirm()
          } else setV(n)
        }}
        onPointerUp={() => setV(0)}
        onKeyUp={() => setV(0)}
        className="absolute inset-0 h-full w-full cursor-grab opacity-0"
      />
      <span aria-hidden className="pointer-events-none absolute top-1 left-1 flex size-12 items-center justify-center rounded-full bg-gold text-asphalt" style={{ left: `calc(4px + (100% - 3.25rem) * ${v / 100})` }}>
        →
      </span>
    </div>
  )
}

function ActiveRide({ st, act, onComplete, busy }) {
  const { ride } = st
  const rideId = ride.ride.rideId
  const now = useNow(1000)
  const [confirmPick, setConfirmPick] = useState(null)
  const open = ride.stops.filter((s) => !s.doneAt)
  const next = open[0]
  const rider = next && ride.riders.find((r) => r.requestId === next.requestId)
  const waited = next?.arrivedAt ? Math.floor((now - new Date(next.arrivedAt).getTime()) / 1000) : 0
  const waitLeft = Math.max(0, st.noShowWaitS - waited)
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <Sheet>
      <div className="flex items-center justify-between">
        <p className="font-display text-2xl leading-none font-semibold tracking-wide uppercase">{open.length ? 'Your stops' : 'All stops done'}</p>
        <p className="text-sm text-ink/85">{ride.riders.length} rider{ride.riders.length === 1 ? '' : 's'} · {st.seatsFree} seat{st.seatsFree === 1 ? '' : 's'} free</p>
      </div>
      <ol className="space-y-2">
        {open.map((s, i) => (
          <li key={s.stopId} className={`rounded-(--radius-control) border p-3 ${i === 0 ? 'border-ink bg-paper' : 'border-ink/15'}`}>
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-ink text-xs text-gold">{i + 1}</span>
              {s.kind === 'pickup' ? 'Pick up' : 'Drop off'} {s.riderName?.split(' ')[0]}
              <span className="font-normal text-ink/85">· {s.label}</span>
            </p>
            {i === 0 && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Button to={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`} target="_blank" rel="noreferrer" size="sm"><Navigation size={16} aria-hidden /> Navigate</Button>
                  {s.riderPhone ? <Button to={`tel:${s.riderPhone}`} variant="secondary" size="sm"><Phone size={16} aria-hidden /> Call</Button> : <span />}
                </div>
                {s.kind === 'pickup' ? (
                  !s.arrivedAt ? (
                    <Button fullWidth disabled={busy} onClick={() => act(() => api.stopStep(rideId, s.stopId, 'arrived'))}>Arrived</Button>
                  ) : (
                    <>
                      <p role="status" className="text-sm text-ink">Waiting for {s.riderName?.split(' ')[0]}: {waitLeft > 0 ? fmt(waitLeft) : 'wait is over'}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button disabled={busy} onClick={() => setConfirmPick(s)}>Picked up</Button>
                        <Button variant="secondary" disabled={busy || waitLeft > 0} onClick={() => act(() => api.stopStep(rideId, s.stopId, 'no-show'))}>No-show</Button>
                      </div>
                    </>
                  )
                ) : (
                  <Button fullWidth disabled={busy} onClick={() => act(() => api.stopStep(rideId, s.stopId, 'done'))}>Dropped off</Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <SlideToConfirm
        label="Slide to complete ride"
        disabled={open.length > 0 || busy}
        onConfirm={async () => {
          const out = await act(() => api.completeRide(rideId))
          if (out) onComplete(rideId)
        }}
      />
      <ConfirmDialog
        open={Boolean(confirmPick)}
        title="Confirm the rider"
        confirmLabel="Yes, picked up"
        isLoading={busy}
        onCancel={() => setConfirmPick(null)}
        onConfirm={async () => {
          const s = confirmPick
          setConfirmPick(null)
          await act(() => api.stopStep(rideId, s.stopId, 'done'))
        }}
      >
        Confirm this is <strong>{rider?.fullName}</strong> before they get in.
      </ConfirmDialog>
    </Sheet>
  )
}

/** After the ride: each rider's share, mark paid, and rate them. */
function Summary({ rideId, onDone }) {
  const { data, reload } = useLive(useCallback(() => api.rideLive(rideId), [rideId]), { pollMs: 8000 })
  const [problem, setProblem] = useState(null)
  const [rate, setRate] = useState({})
  if (!data) return <Sheet><Spinner /></Sheet>
  const run = async (fn) => {
    setProblem(null)
    try {
      await fn()
      await reload()
    } catch (e) {
      setProblem(e.message)
    }
  }
  return (
    <Sheet>
      <p className="font-display text-2xl leading-none font-semibold tracking-wide uppercase">Ride complete</p>
      <p className="text-sm text-ink/85">Riders share the fuel cost for the part of the road they were in the car. RideMate takes no commission.</p>
      {problem && <Alert tone="error">{problem}</Alert>}
      <ul className="space-y-2">
        {data.riders.map((r) => {
          const share = data.shares.find((s) => s.requestId === r.requestId)
          return (
            <li key={r.userId} className="space-y-2 rounded-(--radius-control) bg-paper p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-ink">{r.fullName}</p>
                <p className="font-display text-2xl leading-none font-semibold">{share ? kes(share.amountKes) : '—'}</p>
              </div>
              {share && share.status === 'pending' && <Button size="sm" onClick={() => run(() => api.settleRideShare(share.shareId))}>Mark as paid</Button>}
              {share?.status === 'paid' && <p className="text-sm font-medium text-ink">Paid</p>}
              {r.status === 'completed' && !r.iRated && (
                <div className="flex flex-wrap items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" aria-label={`${n} stars for ${r.fullName}`} onClick={() => run(async () => { await api.rateRide(rideId, { rateeId: r.userId, stars: n, tags: rate[r.userId] || [] }) })} className="focus-ring rounded p-1.5">
                      <Star size={24} aria-hidden className="text-ink hover:fill-gold" />
                    </button>
                  ))}
                  {TAGS.map((t) => {
                    const on = (rate[r.userId] || []).includes(t)
                    return <button key={t} type="button" aria-pressed={on} onClick={() => setRate({ ...rate, [r.userId]: on ? rate[r.userId].filter((x) => x !== t) : [...(rate[r.userId] || []), t] })} className={`focus-ring min-h-9 rounded-full border px-2 text-xs ${on ? 'border-ink bg-ink text-gold' : 'border-ink/30'}`}>{t}</button>
                  })}
                </div>
              )}
              {r.iRated && <p className="text-sm text-ink/85">You rated {r.fullName.split(' ')[0]}.</p>}
            </li>
          )
        })}
      </ul>
      <Button fullWidth variant="secondary" onClick={onDone}>Done</Button>
    </Sheet>
  )
}

// ---------------------------------------------------------------- side menu and its screens

const MENU = [
  ['map', 'Online', Car],
  ['history', 'Ride history', History],
  ['cost', 'Cost shared', Wallet],
  ['ratings', 'Ratings', Star],
  ['safety', 'Safety', ShieldCheck],
]

function Drawer({ view, setView, onClose }) {
  return (
    <div className="fixed inset-0 z-[1000]">
      <button type="button" aria-label="Close menu" onClick={onClose} className="absolute inset-0 bg-ink/50" />
      <nav aria-label="Driver menu" className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-surface p-4 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-display text-2xl font-semibold tracking-wide uppercase">Drive</p>
          <button type="button" aria-label="Close" onClick={onClose} className="focus-ring flex size-11 items-center justify-center rounded-full hover:bg-ink/8"><X size={20} aria-hidden /></button>
        </div>
        <ul className="space-y-1">
          {MENU.map(([id, label, Icon]) => (
            <li key={id}>
              <button type="button" onClick={() => { setView(id); onClose() }} aria-current={view === id ? 'page' : undefined} className={`focus-ring flex min-h-12 w-full items-center gap-3 rounded-(--radius-control) px-3 text-left font-medium ${view === id ? 'bg-ink text-gold' : 'text-ink hover:bg-ink/8'}`}>
                <Icon size={18} aria-hidden /> {label}
              </button>
            </li>
          ))}
          <li>
            <Link to="/vehicles" onClick={onClose} className="focus-ring flex min-h-12 items-center gap-3 rounded-(--radius-control) px-3 font-medium text-ink hover:bg-ink/8"><Car size={18} aria-hidden /> My vehicle</Link>
          </li>
        </ul>
      </nav>
    </div>
  )
}

function Panel({ view, st, onClose }) {
  const { data } = useLive(api.driverHistory, { pollMs: 30000, enabled: ['history', 'ratings', 'cost'].includes(view) })
  const WHEN = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const titles = { history: 'Ride history', cost: 'Cost shared', ratings: 'Ratings', safety: 'Safety' }
  if (!titles[view]) return null
  return (
    <div className="fixed inset-0 z-[900] overflow-y-auto bg-paper p-4 md:left-auto md:w-[30rem] md:shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-3xl font-semibold tracking-wide text-ink-deep uppercase">{titles[view]}</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="focus-ring flex size-11 items-center justify-center rounded-full hover:bg-ink/8"><X size={20} aria-hidden /></button>
      </div>
      {view === 'safety' && (
        <ul className="space-y-3 text-sm text-ink">
          <li>Confirm the rider's name before they get in. Never take someone who does not match the request.</li>
          <li>RideMate is for students sharing a journey they are already making. Do not ask for more than the share shown.</li>
          <li>Riders have an SOS button. It alerts the RideMate team and shows them your ride.</li>
          <li>If something goes wrong, report it from the ride after it ends. Reports and the ride record are kept as evidence.</li>
          <li>Your location is shared only while you are online and only with riders in your ride. It is never stored as a history.</li>
        </ul>
      )}
      {view !== 'safety' && !data && <Spinner />}
      {view === 'history' && data && (
        <div className="space-y-3">
          <div className="rounded-(--radius-panel) border border-ink/20 bg-surface p-3 text-sm">
            <p className="font-medium text-ink">Your answers to requests</p>
            <p className="text-ink/85">Accepted {st.stats.accepted} · Declined {st.stats.declined} · Expired {st.stats.expired}. Only you see this, and nothing is penalised.</p>
          </div>
          {data.rides.length === 0 ? <p className="text-sm text-ink/85">No rides yet.</p> : (
            <ul className="space-y-2">
              {data.rides.map((r) => (
                <li key={r.rideId} className="rounded-(--radius-panel) border border-ink/20 bg-surface p-3 text-sm">
                  <p className="font-medium text-ink">{r.places || 'Ride'}</p>
                  <p className="text-ink/85">{WHEN.format(new Date(r.at))} · {r.riders} rider{r.riders === 1 ? '' : 's'} · {r.status}</p>
                  {r.status === 'completed' && <p className="text-ink">Shared {kes(r.totalKes)}, paid {kes(r.paidKes)}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {view === 'cost' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-(--radius-panel) border border-ink/20 bg-surface p-3"><p className="text-sm text-ink/85">Rides</p><p className="font-display text-4xl leading-none font-semibold">{st.totals.rides}</p></div>
            <div className="rounded-(--radius-panel) border border-ink/20 bg-surface p-3"><p className="text-sm text-ink/85">Riders paid you</p><p className="font-display text-4xl leading-none font-semibold">{kes(st.totals.sharedKes)}</p></div>
          </div>
          <p className="text-sm text-ink/85">This is fuel cost shared by your riders. RideMate takes no commission.</p>
        </div>
      )}
      {view === 'ratings' && data && (
        <ul className="space-y-2">
          {data.ratings.length === 0 ? <li className="text-sm text-ink/85">No ratings yet.</li> : data.ratings.map((r, i) => (
            <li key={i} className="rounded-(--radius-panel) border border-ink/20 bg-surface p-3 text-sm">
              <Stars value={r.stars} /> {r.tags?.length > 0 && <span className="text-ink/85">· {r.tags.join(', ')}</span>}
              {r.comment && <p className="mt-1 text-ink">{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
