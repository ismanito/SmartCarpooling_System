/** White record panel: one hairline rim + a restrained contact shadow. */
export function Panel({ as: Tag = 'section', className = '', children, ...rest }) {
  return (
    <Tag className={`rounded-(--radius-panel) border border-ink/20 bg-surface shadow-(--shadow-contact) ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

/**
 * The one emphasised status container: dual keyline, recessed well, raised lip, cut corner.
 * Used for email verification and the domain check – nowhere else.
 */
export function StatusPane({ className = '', children, ...rest }) {
  return (
    <div className={`clip-corner bg-ink/70 p-px ${className}`} {...rest}>
      <div className="clip-corner bg-surface p-[3px]">
        <div className="clip-corner bg-ink/25 p-px">
          <div className="clip-corner bg-paper-deep px-4 py-3.5 shadow-[inset_0_-2px_0_rgb(21_96_100/0.12)]">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** Form-level message (not field errors). */
export function Alert({ tone = 'error', children }) {
  const tones = {
    error: 'border-error/40 bg-surface text-error',
    info: 'border-ink/25 bg-surface text-ink',
  }
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-(--radius-control) border px-3 py-2.5 text-sm ${tones[tone]}`}>
      {children}
    </div>
  )
}

export function PageTitle({ children, className = '' }) {
  return <h1 className={`font-display text-[32px] leading-none font-semibold tracking-wide uppercase md:text-[34px] ${className}`}>{children}</h1>
}
