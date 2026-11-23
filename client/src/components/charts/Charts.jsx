import { useId, useRef, useState } from 'react'

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

// ---------------------------------------------------------------- line charts

const W = 320
const PAD = { left: 30, right: 12, top: 12, bottom: 22 }

/** A smooth curve through the points that never overshoots them. */
function smooth(pts) {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`
  const dx = []
  const slope = []
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = pts[i + 1][0] - pts[i][0]
    slope[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]
  }
  const t = [slope[0]]
  for (let i = 1; i < n - 1; i += 1) t[i] = slope[i - 1] * slope[i] <= 0 ? 0 : 2 / (1 / slope[i - 1] + 1 / slope[i])
  t[n - 1] = slope[n - 2]
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i] / 3
    d += `C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`
  }
  return d
}

/** Axis ticks with round steps (1, 2, 2.5, 5, 10 times a power of ten), about four of them, from zero. */
function scale(max) {
  if (max <= 4) return { step: 1, top: Math.max(1, Math.ceil(max)) }
  const raw = max / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  const f = raw / p
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p
  return { step, top: step * Math.ceil(max / step) }
}

// Navy, teal and orange, so up to three lines are easy to tell apart.
export const LINE_COLORS = ['#2f2b7c', '#0aa89c', '#d9803f']

/**
 * A line chart for trends: smooth coloured lines with a dot on every point, light gridlines, date labels, a legend
 * and a readout that follows a finger or the mouse. `series` is up to three lines: [{ name, values }].
 */
export function LineChart({ labels, series, height = 150, format = (v) => v, axisFormat = (v) => v, label, legend = true }) {
  const id = useId()
  const box = useRef(null)
  const [hover, setHover] = useState(null)
  const n = labels.length
  const H = height
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const { step, top } = scale(Math.max(0, ...series.flatMap((s) => s.values)))
  const x = (i) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v) => PAD.top + innerH - (v / top) * innerH
  const lines = series.map((s) => s.values.map((v, i) => [x(i), y(v)]))
  const grid = []
  for (let g = 0; g <= top + 1e-9; g += step) grid.push(g)
  const dots = n <= 14 // a dot on every point while there are few; otherwise only the one being looked at

  // About six date labels, always ending on the last day, without the last two touching.
  const tickEvery = Math.max(1, Math.ceil(n / 6))
  const ticks = []
  for (let i = 0; i < n; i += tickEvery) ticks.push(i)
  if (n > 0 && ticks[ticks.length - 1] !== n - 1) {
    if (n - 1 - ticks[ticks.length - 1] >= tickEvery * 0.9) ticks.push(n - 1)
    else ticks[ticks.length - 1] = n - 1
  }
  const summary = `${label}. ${series.map((s) => `${s.name}: from ${format(s.values[0])} to ${format(s.values[n - 1])}, highest ${format(Math.max(...s.values))}`).join('. ')}`

  const move = (e) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect || n === 0) return
    const px = ((e.clientX - rect.left) / rect.width) * W
    setHover(Math.min(n - 1, Math.max(0, Math.round(((px - PAD.left) / innerW) * (n - 1)))))
  }
  const shown = hover ?? n - 1
  const single = series.length === 1

  return (
    <div className="w-full">
      <div className="mb-1 flex min-h-5 flex-wrap items-center justify-between gap-x-3 text-xs text-ink">
        <span className="font-medium" aria-live="polite">
          {labels[shown]}
          {series.map((s, k) => (
            <span key={s.name} className="ml-2 inline-flex items-center gap-1">
              <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: LINE_COLORS[k] }} />
              {format(s.values[shown])}
              {series.length > 1 && !String(format(s.values[shown])).toLowerCase().includes(s.name.toLowerCase()) ? ` ${s.name.toLowerCase()}` : ''}
            </span>
          ))}
        </span>
        <span className="text-ink/70">{hover === null ? 'latest' : ''}</span>
      </div>
      <svg
        ref={box}
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-pan-y select-none"
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={LINE_COLORS[0]} stopOpacity="0.16" />
            <stop offset="1" stopColor={LINE_COLORS[0]} stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((g) => (
          <g key={g}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} stroke="var(--color-ink)" strokeOpacity={g === 0 ? 0.3 : 0.1} />
            <text x={PAD.left - 6} y={y(g) + 3} textAnchor="end" fontSize="9" fontWeight="600" fill="var(--color-ink)" fillOpacity="0.8">
              {axisFormat(Math.round(g * 10) / 10)}
            </text>
          </g>
        ))}
        {ticks.map((i) => (
          <text key={`${labels[i]}-${i}`} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize="9" fontWeight="600" fill="var(--color-ink)" fillOpacity="0.8">
            {labels[i]}
          </text>
        ))}
        {single && lines[0].length > 1 && <path d={`${smooth(lines[0])} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${id}-fill)`} />}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--color-ink)" strokeOpacity="0.25" />}
        {lines.map((pts, k) => (
          <path key={series[k].name} d={smooth(pts)} fill="none" stroke={LINE_COLORS[k]} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {lines.map((pts, k) =>
          pts.map(([px, py], i) =>
            dots || i === shown ? <circle key={`${series[k].name}-${i}`} cx={px} cy={py} r={i === shown ? 4.2 : 3.2} fill={LINE_COLORS[k]} stroke={i === shown ? 'var(--color-surface)' : 'none'} strokeWidth="1.6" /> : null,
          ),
        )}
        {n > 0 && Math.max(...series.flatMap((s) => s.values)) === 0 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="11" fill="var(--color-ink)" fillOpacity="0.7">
            No data in this period yet
          </text>
        )}
      </svg>
      {legend && series.length > 1 && (
        <ul className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1">
          {series.map((s, k) => (
            <li key={s.name} className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-ink-deep uppercase">
              <span aria-hidden className="inline-block size-3" style={{ background: LINE_COLORS[k] }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Small pill buttons for switching what a chart shows. */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-paper-deep p-0.5">
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`focus-ring min-h-8 rounded-full px-2.5 text-xs font-medium ${value === id ? 'bg-ink text-gold' : 'text-ink'}`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/** The average of each value and the six before it: the trend underneath the day-to-day ups and downs. */
export function movingAverage(values, window = 7) {
  return values.map((_, i) => {
    const part = values.slice(Math.max(0, i - window + 1), i + 1)
    return Math.round((part.reduce((a, b) => a + b, 0) / part.length) * 10) / 10
  })
}
