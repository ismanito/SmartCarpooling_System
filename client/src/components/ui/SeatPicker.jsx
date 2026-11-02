import { useId, useRef } from 'react'

const SEATS = [1, 2, 3, 4, 5, 6, 7]

/** Segmented radio group for an exact seat count (1–7). Arrow keys move the selection. */
export function SeatPicker({ label = 'Seat capacity', value, onChange, error, hint }) {
  const id = useId()
  const refs = useRef([])

  function onKeyDown(e, index) {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!delta) return
    e.preventDefault()
    const next = (index + delta + SEATS.length) % SEATS.length
    onChange(SEATS[next])
    refs.current[next]?.focus()
  }

  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  const focusIndex = value ? SEATS.indexOf(value) : 0

  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-medium text-ink">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className="bg-stipple grid grid-cols-7 gap-1.5 rounded-(--radius-control) p-1.5"
      >
        {SEATS.map((n, i) => {
          const selected = value === n
          return (
            <button
              key={n}
              ref={(el) => (refs.current[i] = el)}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${n} ${n === 1 ? 'seat' : 'seats'}`}
              tabIndex={i === focusIndex ? 0 : -1}
              onClick={() => onChange(n)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`focus-ring h-12 rounded-(--radius-control) border text-lg font-medium transition-colors md:h-11 ${
                selected
                  ? 'border-ink bg-ink text-gold'
                  : 'border-ink/25 bg-surface text-ink hover:border-ink'
              }`}
            >
              {n}
              {selected && <span className="ml-1 inline-block size-1.5 rounded-full bg-mint align-middle" aria-hidden />}
            </button>
          )
        })}
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-ink/85">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
