import { useEffect, useState } from 'react'
import { api } from '../lib/api'

const COMPLETE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Asks the API who an email address belongs to once it looks complete (debounced).
 * kind: 'student' | 'driver' | 'admin' | null (not allowed); undefined while unknown or checking.
 */
export function useEmailKind(email, { delayMs = 400 } = {}) {
  const value = (email || '').trim().toLowerCase()
  const [result, setResult] = useState({ email: '', kind: undefined, demo: false })

  useEffect(() => {
    if (!COMPLETE_EMAIL.test(value)) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .checkDomain(value)
        .then((r) => !cancelled && setResult({ email: value, kind: r.kind ?? null, demo: Boolean(r.demo) }))
        .catch(() => {})
    }, delayMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [value, delayMs])

  return result.email === value ? result : { email: value, kind: undefined, demo: false }
}
