import { forwardRef, useId } from 'react'

const CONTROL =
  'block w-full rounded-(--radius-control) border bg-surface px-3 text-base text-ink placeholder:text-ink/55 transition-colors focus:outline-2 focus:outline-offset-0 focus:outline-mint disabled:bg-paper-deep disabled:text-ink/85 h-12 md:h-11'

function controlBorder(error) {
  return error ? 'border-error' : 'border-ink/30 hover:border-ink/60'
}

/** Label + control + hint/error wiring shared by all inputs. */
export function FieldShell({ id, label, hint, error, children, optional }) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {optional && <span className="font-normal text-ink/85"> (optional)</span>}
      </label>
      {children({ 'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined, 'aria-invalid': error ? true : undefined })}
      {hint && !error && (
        <p id={hintId} className="text-sm text-ink/85">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Render-prop wrapper: renders label/hint/error and passes `{ aria }` to the child,
 * which spreads it onto its control. `aria` includes the id so the label stays linked.
 */
export function Field({ id, label, hint, error, optional, children }) {
  const autoId = useId()
  const fieldId = id || autoId
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} optional={optional}>
      {(aria) => children({ aria: { ...aria, id: fieldId } })}
    </FieldShell>
  )
}

export const TextField = forwardRef(function TextField({ label, hint, error, optional, className = '', id, ...rest }, ref) {
  const autoId = useId()
  const fieldId = id || autoId
  // Without a label, render only the control (used inside <Field>).
  if (!label) {
    return <input ref={ref} id={fieldId} className={`${CONTROL} read-only:bg-paper-deep ${controlBorder(rest['aria-invalid'])} ${className}`} {...rest} />
  }
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} optional={optional}>
      {(aria) => <input ref={ref} id={fieldId} className={`${CONTROL} ${controlBorder(error)} ${className}`} {...aria} {...rest} />}
    </FieldShell>
  )
})

export const SelectField = forwardRef(function SelectField(
  { label, hint, error, options, placeholder = 'Choose…', className = '', id, ...rest },
  ref,
) {
  const autoId = useId()
  const fieldId = id || autoId
  const renderSelect = (aria, invalid) => (
    <select ref={ref} id={fieldId} className={`${CONTROL} ${controlBorder(invalid)} pr-9 ${className}`} {...aria} {...rest}>
      <option value="">{placeholder}</option>
      {options.map((o) => {
        // Options may be plain strings or { value, label } pairs.
        const { value, label: text } = typeof o === 'string' ? { value: o, label: o } : o
        return (
          <option key={value} value={value}>
            {text}
          </option>
        )
      })}
    </select>
  )
  // Without a label, render only the control (used inside <Field>).
  if (!label) return renderSelect({}, rest['aria-invalid'])
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error}>
      {(aria) => renderSelect(aria, error)}
    </FieldShell>
  )
})
