import { useCallback, useEffect, useRef, useState } from 'react'
import { LocateFixed, Navigation, Radio, Square } from 'lucide-react'
import { Button } from '../ui/Button.jsx'
import { api } from '../../lib/api.js'

const POLL_MS = 4000
const SEND_MS = 4000
const STEP_MS = 2000
const DEMO_TOOLS = import.meta.env.VITE_DEMO_TOOLS === 'true'

/** Straight-line distance in km between two points. */
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

function bearing(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  return (Math.atan2(y, x) * 180) / Math.PI + 360
}

/** Polls the car's position every few seconds while the ride is open. */
export function useLiveLocation(offerId, enabled) {
  const [state, setState] = useState({ sharing: false, location: null })
  useEffect(() => {
    if (!enabled) return undefined
    let live = true
    const tick = () =>
      api
        .tripLocation(offerId)
        .then((r) => live && setState(r))
        .catch(() => {})
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [offerId, enabled])
  return enabled ? state : { sharing: false, location: null }
}

/** What a rider sees under the map: is the car moving, and how far from the drop-off. */
export function RiderStatus({ live, destination }) {
  if (!live.sharing || !live.location) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink/85">
        <Radio size={16} aria-hidden /> The driver is not sharing a live location yet. The map updates by itself once they start.
      </p>
    )
  }
  const km = distanceKm(live.location, destination.point)
  const speed = live.location.speedKmh
  const minutes = speed && speed >= 5 ? Math.max(1, Math.round((km / speed) * 60)) : null
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-ink" role="status">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-mint" />
        </span>
        Live
      </span>
      <span>
        {km < 0.1 ? `At ${destination.name}` : `${km.toFixed(1)} km from ${destination.name}`}
        {minutes ? `, about ${minutes} min` : ''}
      </span>
      <span className="font-normal text-ink/85">· updated {live.location.ageSeconds}s ago</span>
    </p>
  )
}

/** The driver's side: turns on GPS sharing (or a demo drive) and posts the position every few seconds. */
export function ShareLocation({ offerId, origin, destination }) {
  const [mode, setMode] = useState(null) // null | 'gps' | 'demo'
  const [error, setError] = useState(null)
  const lastSent = useRef(0)

  const stop = useCallback(() => {
    setMode(null)
    api.stopLocation(offerId).catch(() => {})
  }, [offerId])

  // Real GPS.
  useEffect(() => {
    if (mode !== 'gps') return undefined
    if (!navigator.geolocation) {
      setError('This device cannot share its location.')
      setMode(null)
      return undefined
    }
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now()
        if (now - lastSent.current < SEND_MS) return
        lastSent.current = now
        const { latitude, longitude, heading, speed } = pos.coords
        api
          .sendLocation(offerId, {
            lat: latitude,
            lng: longitude,
            ...(Number.isFinite(heading) ? { heading: (heading + 360) % 360 } : {}),
            ...(Number.isFinite(speed) ? { speedKmh: Math.max(0, speed * 3.6) } : {}),
          })
          .then(() => setError(null))
          .catch((err) => setError(err.message))
      },
      (err) => {
        setError(err.code === 1 ? 'Location is blocked. Allow location for this site in your browser settings, then try again.' : 'Could not get your location.')
        setMode(null)
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    )
    return () => navigator.geolocation.clearWatch(watch)
  }, [mode, offerId])

  // Demo drive: the car travels from the pick-up to the drop-off in a minute or so.
  useEffect(() => {
    if (mode !== 'demo') return undefined
    const STEPS = 40
    let i = 0
    const id = setInterval(() => {
      const t = Math.min(1, i / STEPS)
      const point = { lat: origin.lat + (destination.lat - origin.lat) * t, lng: origin.lng + (destination.lng - origin.lng) * t }
      api
        .sendLocation(offerId, { ...point, heading: bearing(origin, destination) % 360, speedKmh: t < 1 ? 38 : 0 })
        .then(() => setError(null))
        .catch((err) => {
          setError(err.message)
          setMode(null)
        })
      i += 1
      if (i > STEPS + 1) clearInterval(id)
    }, STEP_MS)
    return () => clearInterval(id)
  }, [mode, offerId, origin, destination])

  // Stop sharing when the page is left.
  useEffect(
    () => () => {
      api.stopLocation(offerId).catch(() => {})
    },
    [offerId],
  )

  return (
    <div className="space-y-2 rounded-(--radius-control) bg-paper p-3">
      <p className="text-sm text-ink">
        Share your live location so riders can watch the car on the map. It stops when you stop sharing or finish the ride.
      </p>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {mode ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-mint" /> Sharing{mode === 'demo' ? ' (demo drive)' : ''}
          </span>
          <Button size="sm" variant="secondary" onClick={stop}>
            <Square size={14} aria-hidden /> Stop sharing
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { setError(null); lastSent.current = 0; setMode('gps') }}>
            <LocateFixed size={16} aria-hidden /> Share my live location
          </Button>
          {DEMO_TOOLS && (
            <Button size="sm" variant="secondary" onClick={() => { setError(null); setMode('demo') }}>
              <Navigation size={16} aria-hidden /> Simulate a drive (demo)
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
