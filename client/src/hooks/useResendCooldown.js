import { useCallback, useEffect, useState } from 'react'

export const RESEND_COOLDOWN_SECONDS = 60
const key = (uid) => `ridemate:verify-sent:${uid}`

/** Remembers when a verification email was last sent, so remounts don't reset the cooldown. */
export function markVerificationSent(uid) {
  try {
    sessionStorage.setItem(key(uid), String(Date.now()))
  } catch {
    /* storage unavailable – cooldown just won't survive reloads */
  }
}

function secondsLeft(uid) {
  try {
    const sentAt = Number(sessionStorage.getItem(key(uid)) || 0)
    const left = Math.ceil((sentAt + RESEND_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000)
    return Math.max(0, left)
  } catch {
    return 0
  }
}

/** Seconds until another verification email may be sent; ticks once per second. */
export function useResendCooldown(uid) {
  const [remaining, setRemaining] = useState(() => (uid ? secondsLeft(uid) : 0))

  useEffect(() => {
    if (!uid) return undefined
    setRemaining(secondsLeft(uid))
    const id = setInterval(() => setRemaining(secondsLeft(uid)), 1000)
    return () => clearInterval(id)
  }, [uid])

  const restart = useCallback(() => {
    if (uid) setRemaining(secondsLeft(uid))
  }, [uid])

  return { remaining, restart }
}
