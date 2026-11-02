import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'

const COMPLETE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Asks the API whether an email's domain may register.
 * Runs only once the address looks complete (debounced) or when `force` changes (blur).
 * state: 'idle' | 'checking' | 'allowed' | 'not_allowed' | 'failed'
 */
export function useDomainCheck(email, { force = 0, delayMs = 450 } = {}) {
  const [state, setState] = useState('idle')
  const lastChecked = useRef('')

  useEffect(() => {
    const value = (email || '').trim().toLowerCase()
    if (!COMPLETE_EMAIL.test(value)) {
      setState('idle')
      lastChecked.current = ''
      return undefined
    }
    if (value === lastChecked.current) return undefined

    let cancelled = false
    const timer = setTimeout(
      async () => {
        setState('checking')
        try {
          const { allowed } = await api.checkDomain(value)
          if (cancelled) return
          lastChecked.current = value
          setState(allowed ? 'allowed' : 'not_allowed')
        } catch {
          if (!cancelled) setState('failed')
        }
      },
      force ? 0 : delayMs,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [email, force, delayMs])

  return state
}
