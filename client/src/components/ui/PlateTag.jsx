import { formatPlate } from '../../lib/schemas'

/** Number plate styled like a Kenyan rear plate (e.g. "KDA 123A"). */
export function PlateTag({ plate, className = '' }) {
  return (
    <span className={`text-spec inline-flex items-center rounded-(--radius-chip) border border-asphalt/60 bg-gold px-2 py-0.5 text-sm text-asphalt ${className}`}>
      {formatPlate(plate)}
    </span>
  )
}
