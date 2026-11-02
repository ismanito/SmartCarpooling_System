import { formatPlate } from '../../lib/schemas'

/** Number plate rendered for quick scanning (e.g. "KDA 123A"). */
export function PlateTag({ plate, className = '' }) {
  return (
    <span className={`text-spec inline-flex items-center rounded-(--radius-chip) border border-ink/70 bg-surface px-2 py-0.5 text-sm text-ink ${className}`}>
      {formatPlate(plate)}
    </span>
  )
}
