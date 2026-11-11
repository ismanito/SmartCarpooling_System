import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { PlateTag } from '../ui/PlateTag.jsx'

export const kes = (n) => `KES ${new Intl.NumberFormat('en-KE').format(n || 0)}`

/** Initials in a circle: the stand-in for a photo. */
export function Avatar({ name, size = 48 }) {
  const initials = (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-asphalt font-display font-semibold tracking-wide text-gold"
    >
      {initials}
    </span>
  )
}

export function Stars({ value }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-sm text-ink">
      <Star size={14} aria-hidden className="fill-gold text-ink" /> {value ? Number(value).toFixed(1) : 'New'}
    </span>
  )
}

/** Plate number, big and clear, so the rider can match the car at the kerb. */
export function BigPlate({ plate }) {
  return <PlateTag plate={plate} className="px-3! py-1! text-2xl! tracking-widest" />
}

/** Bottom sheet that sits over a full-screen map. */
export function Sheet({ children, className = '' }) {
  return (
    <div className={`absolute inset-x-0 bottom-0 z-[500] max-h-[62%] space-y-3 overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(11,51,54,0.25)] md:inset-x-auto md:left-4 md:bottom-4 md:w-[26rem] md:rounded-2xl ${className}`}>
      <span aria-hidden className="mx-auto block h-1 w-10 rounded-full bg-ink/25 md:hidden" />
      {children}
    </div>
  )
}

/** Full-screen map area: the map fills it and sheets float on top. */
export function MapStage({ children }) {
  return <div className="relative -mx-4 -mt-6 h-[calc(100dvh-8.25rem)] min-h-[32rem] overflow-hidden md:mx-0 md:mt-0 md:rounded-(--radius-panel) md:border md:border-ink/20">{children}</div>
}

/** Minutes from now until an ISO time (never negative). */
export function minutesUntil(iso, now = Date.now()) {
  if (!iso) return null
  return Math.max(0, Math.round((new Date(iso).getTime() - now) / 60000))
}

/** Re-renders every second, for countdowns. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Rough place name for a map position: the nearest known place within 500 m, else a generic label. */
export function nearestLabel(lat, lng, places) {
  let best = null
  for (const p of places) {
    if (p.hidden) continue
    const d = Math.hypot(p.lat - lat, p.lng - lng) * 111
    if (!best || d < best.d) best = { d, name: p.name }
  }
  return best && best.d <= 0.5 ? best.name : 'Pinned location'
}
