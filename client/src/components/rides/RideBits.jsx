import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Clock, MapPin, Phone, Star, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { PlateTag } from '../ui/PlateTag'

// ---------------------------------------------------------------- formatting

const WHEN = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function formatWhen(iso) {
  return WHEN.format(new Date(iso))
}

/** Value for a datetime-local input, `minutes` from now, in local time. */
export function localInputValue(minutes = 60) {
  const d = new Date(Date.now() + minutes * 60_000)
  d.setSeconds(0, 0)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function timeDiffLabel(min) {
  if (min === 0) return 'same time'
  return `${Math.abs(min)} min ${min > 0 ? 'later' : 'earlier'}`
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// ---------------------------------------------------------------- data

/** Loads the pick-up / drop-off list once per page. */
export function usePlaces() {
  const [list, setList] = useState([])
  const [buildings, setBuildings] = useState([])
  const [error, setError] = useState(null)
  useEffect(() => {
    let live = true
    api
      .places()
      .then(({ places, campusBuildings }) => {
        if (!live) return
        setList(places)
        setBuildings(campusBuildings || [])
      })
      .catch((err) => live && setError(err.message || 'Could not load places.'))
    return () => {
      live = false
    }
  }, [])
  const options = useMemo(() => list.filter((p) => !p.hidden).map((p) => ({ value: p.id, label: p.name })), [list])
  const byId = useMemo(() => Object.fromEntries(list.map((p) => [p.id, p])), [list])
  return { options, byId, list, buildings, error }
}

const REFRESH_MS = 20_000

/** Loads a list, refreshes it every 20 seconds, and runs actions that refresh it afterwards. */
export function useLiveList(load) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const reload = useCallback(async () => {
    try {
      setItems(await load())
      setRefreshKey((k) => k + 1)
    } catch (err) {
      setError(err.message || 'Could not load this page. Reload to try again.')
    }
  }, [load])

  useEffect(() => {
    reload()
    const id = setInterval(reload, REFRESH_MS)
    return () => clearInterval(id)
  }, [reload])

  const run = useCallback(
    async (action) => {
      setError(null)
      try {
        await action()
      } catch (err) {
        setError(err.message || 'That did not work. Try again.')
      }
      await reload()
    },
    [reload],
  )

  return { items, error, setError, refreshKey, reload, run }
}

// ---------------------------------------------------------------- pieces

/** The signature: a trip drawn as a stretch of road between two stops. */
export function TripLine({ from, to, when }) {
  return (
    <div className="grid grid-cols-[20px_1fr] gap-x-3">
      <div aria-hidden className="relative row-span-2 my-1 w-5 rounded-full bg-asphalt">
        <span className="lane-vertical absolute inset-y-3 left-1/2 w-0.5 -translate-x-1/2" />
        <span className="absolute top-1 left-1/2 size-3 -translate-x-1/2 rounded-full bg-mint" />
        <span className="absolute bottom-1 left-1/2 size-3 -translate-x-1/2 rounded-full bg-coral" />
      </div>
      <div className="pb-4">
        <p className="font-display text-2xl leading-none font-medium tracking-wide text-ink-deep">{from}</p>
        {when && (
          <p className="mt-1 inline-flex items-center gap-1 text-sm text-ink/85">
            <Clock size={14} aria-hidden /> {formatWhen(when)}
          </p>
        )}
      </div>
      <p className="self-end font-display text-2xl leading-none font-medium tracking-wide text-ink-deep">
        <span className="sr-only">to </span>
        {to}
      </p>
    </div>
  )
}

/** One-line route for use inside lists. */
export function Route({ from, to, className = '' }) {
  return (
    <p className={`flex flex-wrap items-center gap-x-2 font-medium text-ink ${className}`}>
      <span>{from}</span>
      <ArrowRight size={14} aria-label="to" />
      <span>{to}</span>
    </p>
  )
}

export function Meta({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm text-ink/85">
      <Icon size={14} aria-hidden /> {children}
    </span>
  )
}

const BADGE = {
  open: 'border-mint text-ink',
  matched: 'border-ink bg-ink text-gold',
  pending: 'border-coral text-ink',
  accepted: 'border-ink bg-ink text-gold',
  completed: 'border-ink/50 bg-paper-deep text-ink',
  declined: 'border-ink/30 text-ink/85',
  cancelled: 'border-ink/30 text-ink/85',
}
const REQUEST_TEXT = { open: 'Looking', matched: 'Ride confirmed', completed: 'Finished', cancelled: 'Cancelled' }
const OFFER_TEXT = { open: 'Open', completed: 'Finished', cancelled: 'Cancelled' }
const BOOKING_TEXT = { pending: 'Waiting', accepted: 'Confirmed', declined: 'Declined', cancelled: 'Cancelled' }

export function StatusBadge({ status, kind = 'booking' }) {
  const text = { request: REQUEST_TEXT, offer: OFFER_TEXT, booking: BOOKING_TEXT }[kind][status] || status
  return (
    <span className={`inline-flex items-center rounded-(--radius-chip) border px-2 py-0.5 text-xs font-medium tracking-wide uppercase ${BADGE[status] || ''}`}>
      {text}
    </span>
  )
}

export function MatchScore({ score }) {
  const pct = Math.round(score * 100)
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium text-ink" title="Based on route overlap, timing and detour">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-ink/15" aria-hidden>
        <span className="block h-full bg-mint" style={{ width: `${pct}%` }} />
      </span>
      {pct}% match
    </span>
  )
}

export function MatchFacts({ match }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <Meta icon={MapPin}>
        Pick-ups {match.pickupKm} km apart, drop-offs {match.dropoffKm} km apart
      </Meta>
      <Meta icon={Clock}>Leaves {timeDiffLabel(match.timeDiffMin)}</Meta>
    </div>
  )
}

export function Rating({ value }) {
  if (!value) return <span className="text-xs text-ink/85">New member</span>
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-ink/85">
      <Star size={12} aria-hidden className="fill-gold text-ink" /> {Number(value).toFixed(1)}
    </span>
  )
}

/** Five stars to rate someone after a finished trip. */
export function RateTrip({ name, myStars, onRate, busy }) {
  if (myStars) {
    return (
      <p className="inline-flex items-center gap-1 text-sm text-ink">
        You rated {name} {myStars} <Star size={14} aria-label="stars" className="fill-gold text-ink" />
      </p>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-ink">Rate {name}</span>
      <span className="flex">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy}
            aria-label={plural(n, 'star')}
            onClick={() => onRate(n)}
            className="focus-ring group rounded p-1 disabled:opacity-60"
          >
            <Star size={22} aria-hidden className="text-ink transition-colors group-hover:fill-gold" />
          </button>
        ))}
      </span>
    </div>
  )
}

export function Vehicle({ vehicle }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm text-ink/85">
      {vehicle.colour} {vehicle.makeModel} <PlateTag plate={vehicle.plateNumber} />
    </span>
  )
}

export function Contact({ label, phone }) {
  if (!phone) return null
  return (
    <p className="inline-flex items-center gap-1.5 text-sm text-ink">
      <Phone size={14} aria-hidden /> {label}:{' '}
      <a className="font-medium underline underline-offset-4" href={`tel:${phone}`}>
        {phone}
      </a>
    </p>
  )
}

export function Seats({ children }) {
  return <Meta icon={Users}>{children}</Meta>
}

export function Card({ children, muted = false }) {
  return (
    <li className={`rounded-(--radius-panel) border border-ink/20 bg-surface p-4 shadow-(--shadow-contact) md:p-5 ${muted ? 'opacity-70' : ''}`}>
      {children}
    </li>
  )
}

export function SubList({ title, children }) {
  return (
    <div className="mt-4 border-t border-ink/15 pt-3">
      <h3 className="mb-2 text-xs font-medium tracking-wider text-ink/85 uppercase">{title}</h3>
      <ul className="space-y-2">{children}</ul>
    </div>
  )
}

export function SubItem({ children }) {
  return <li className="flex flex-col gap-3 rounded-(--radius-control) bg-paper px-3 py-3 sm:flex-row sm:items-center sm:justify-between">{children}</li>
}

export function SectionTitle({ children, id }) {
  return (
    <h2 id={id} className="font-display text-3xl leading-none font-semibold tracking-wide text-ink-deep uppercase">
      {children}
    </h2>
  )
}
