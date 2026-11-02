import { useEffect, useState } from 'react'
import { api } from '../lib/api'

const FALLBACK = ['usiu.ac.ke']

/** Domains students may register with, as configured on the server. */
export function useAllowedDomains() {
  const [domains, setDomains] = useState(FALLBACK)

  useEffect(() => {
    let active = true
    api
      .allowedDomains()
      .then(({ allowedDomains }) => active && allowedDomains?.length && setDomains(allowedDomains))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  return domains
}
