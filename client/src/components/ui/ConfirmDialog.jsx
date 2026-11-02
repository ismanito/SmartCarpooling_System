import { useEffect, useRef } from 'react'
import { Button } from './Button'

/** Small modal confirmation built on the native <dialog> (focus trap + Esc for free). */
export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onCancel, isLoading, error }) {
  const ref = useRef(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal?.()
    if (!open && dialog.open) dialog.close?.()
  }, [open])

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        if (!isLoading) onCancel()
      }}
      aria-labelledby="confirm-dialog-title"
      className="m-auto w-[min(420px,calc(100vw-32px))] rounded-(--radius-panel) border border-ink/30 bg-surface p-0 text-ink shadow-(--shadow-contact) backdrop:bg-ink/40"
    >
      {open && (
        <div className="flex flex-col gap-4 p-5">
          <h2 id="confirm-dialog-title" className="font-display text-2xl leading-none font-semibold uppercase">
            {title}
          </h2>
          <div className="text-base text-ink">{children}</div>
          {error && <p className="text-sm text-error" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={isLoading}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onConfirm} isLoading={isLoading}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  )
}
