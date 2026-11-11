import { useCallback, useEffect, useRef, useState } from 'react'
import { connectSocket } from '../lib/socket.js'

/**
 * Keeps data fresh two ways: the server pushes "something changed" events over the socket, and a timer polls as a
 * fallback (so it still works if the socket drops). `events` are socket event names that trigger a reload.
 */
export function useLive(load, { events = [], pollMs = 5000, enabled = true } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current())
      setError(null)
    } catch (err) {
      setError(err.message || 'Could not refresh. Retrying.')
    }
  }, [])

  const eventKey = events.join('|')
  useEffect(() => {
    if (!enabled) return undefined
    reload()
    const timer = setInterval(reload, pollMs)
    const socket = connectSocket()
    const names = eventKey ? eventKey.split('|') : []
    for (const name of names) socket.on(name, reload)
    return () => {
      clearInterval(timer)
      for (const name of names) socket.off(name, reload)
    }
  }, [reload, pollMs, eventKey, enabled])

  return { data, error, reload, setData }
}
