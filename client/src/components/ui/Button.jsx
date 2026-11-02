import { Link } from 'react-router'
import { Spinner } from './Spinner'

const BASE =
  'focus-ring inline-flex items-center justify-center gap-2 rounded-(--radius-control) font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 select-none'

const VARIANTS = {
  primary: 'bg-ink text-gold hover:bg-ink-deep',
  secondary: 'border border-ink/40 bg-surface text-ink hover:border-ink hover:bg-paper',
  ghost: 'text-ink hover:bg-ink/8',
  danger: 'bg-error text-surface hover:bg-error/90',
  link: 'text-ink underline underline-offset-4 decoration-ink/40 hover:decoration-ink h-auto! px-0!',
}

const SIZES = {
  md: 'h-12 px-5 text-base md:h-11',
  sm: 'h-11 px-3 text-sm md:h-9',
}

export function buttonClasses({ variant = 'primary', size = 'md', fullWidth = false, className = '' } = {}) {
  return [BASE, VARIANTS[variant], SIZES[size], fullWidth ? 'w-full' : '', className].join(' ')
}

/** Button with loading state. Pass `to` to render a router Link styled the same way. */
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  isLoading = false,
  loadingLabel,
  to,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}) {
  const classes = buttonClasses({ variant, size, fullWidth, className })
  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {children}
      </Link>
    )
  }
  return (
    <button type={type} className={classes} disabled={disabled || isLoading} aria-busy={isLoading || undefined} {...rest}>
      {isLoading && <Spinner size={16} label={loadingLabel || 'Working'} />}
      {isLoading && loadingLabel ? loadingLabel : children}
    </button>
  )
}
