import { LoaderCircle } from 'lucide-react'

export function Spinner({ size = 18, label = 'Loading', className = '' }) {
  return (
    <LoaderCircle
      role="status"
      aria-label={label}
      size={size}
      strokeWidth={1.75}
      className={`animate-spin text-current ${className}`}
    />
  )
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center text-ink">
      <Spinner size={28} />
    </div>
  )
}
