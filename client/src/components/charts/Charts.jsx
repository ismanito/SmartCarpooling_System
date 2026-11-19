import { useId } from 'react'

/** Small, dependency-free charts that scale to their box. Colours come from the theme. */

/** A row of bars with a value above each and a label below. `highlight` marks one bar (e.g. today). */
export function BarChart({ data, height = 96, highlight = data.length - 1, format = (v) => v, label }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const summary = data.map((d) => `${d.label} ${format(d.value)}`).join(', ')
  return (
    <div role="img" aria-label={`${label}: ${summary}`} className="flex w-full items-end gap-1.5" style={{ height }}>
      {data.map((d, i) => (
        <div key={`${d.label}-${i}`} className="flex h-full min-w-0 flex-1 flex-col justify-end text-center">
          <span className="truncate text-[10px] leading-4 text-ink/85">{d.value > 0 ? format(d.value) : ''}</span>
          <span
            className={`block w-full rounded-t-md ${i === highlight ? 'bg-mint' : 'bg-ink/70'}`}
            style={{ height: `${Math.max((d.value / max) * 100, d.value > 0 ? 6 : 2)}%`, minHeight: 3, opacity: d.value > 0 ? 1 : 0.25 }}
          />
          <span className="mt-1 truncate text-[10px] leading-3 text-ink/85">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

/** A filled line for a trend over time. */
export function Trend({ values, height = 56, label, className = '' }) {
  const id = useId()
  if (values.length < 2) return null
  const max = Math.max(1, ...values)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 36 - (v / max) * 32])
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <svg role="img" aria-label={label} viewBox="0 0 100 40" preserveAspectRatio="none" className={`w-full ${className}`} style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-mint)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--color-mint)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,40 ${line} 100,40`} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** A progress ring: `value` out of `max`, with the figure in the middle. */
export function Ring({ value, max = 100, size = 64, stroke = 7, children, label }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const frac = Math.min(Math.max(value / max, 0), 1)
  return (
    <div role="img" aria-label={label} className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-paper-deep)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-mint)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-xl leading-none font-semibold text-ink-deep">{children}</span>
    </div>
  )
}

/** A compact headline figure for a row of four. */
export function Mini({ label, value, tone = 'plain', note }) {
  const border = tone === 'alert' ? 'border-coral' : tone === 'good' ? 'border-mint' : 'border-ink/15'
  return (
    <div className={`min-w-0 rounded-(--radius-control) border bg-surface px-2.5 py-2 ${border}`}>
      <p className="truncate text-[11px] leading-4 text-ink/85">{label}</p>
      <p className="truncate font-display text-2xl leading-none font-semibold text-ink-deep">{value}</p>
      {note && <p className="truncate text-[10px] leading-4 text-ink/85">{note}</p>}
    </div>
  )
}

/** A titled card that holds a chart or a short list. */
export function Tile({ title, aside, children, className = '' }) {
  return (
    <section className={`min-w-0 rounded-(--radius-panel) border border-ink/15 bg-surface p-3 shadow-(--shadow-contact) ${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-xl leading-none font-semibold tracking-wide text-ink-deep uppercase">{title}</h2>
        {aside && <span className="text-xs text-ink/85">{aside}</span>}
      </div>
      {children}
    </section>
  )
}
