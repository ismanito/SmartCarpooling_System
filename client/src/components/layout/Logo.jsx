import { Link } from 'react-router'

/** The wordmark is a Kenyan rear number plate. */
export function Logo({ to = '/', className = '' }) {
  return (
    <Link
      to={to}
      aria-label="RideMate home"
      className={`focus-ring inline-flex items-center rounded-(--radius-chip) border-2 border-asphalt bg-gold px-2.5 pt-1 pb-0.5 font-display text-2xl leading-none font-semibold tracking-[0.12em] text-asphalt shadow-[0_0_0_1px_var(--color-gold)] ${className}`}
    >
      RIDE&nbsp;MATE
    </Link>
  )
}
