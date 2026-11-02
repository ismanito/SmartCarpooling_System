import { useId } from 'react'

/** Accessible switch (role="switch") with a visible label. */
export function Toggle({ label, checked, onChange, hint }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 rounded-(--radius-control) border border-ink/20 bg-surface px-4 py-3">
      <div className="flex flex-col">
        <label htmlFor={id} className="cursor-pointer text-base font-medium text-ink">
          {label}
        </label>
        {hint && <span className="text-sm text-ink/85">{hint}</span>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`focus-ring relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-ink' : 'bg-ink/25'
        }`}
      >
        <span
          className={`inline-block size-5 rounded-full shadow-(--shadow-contact) transition-transform ${
            checked ? 'translate-x-6 bg-gold' : 'translate-x-1 bg-surface'
          }`}
        />
      </button>
    </div>
  )
}
