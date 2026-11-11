import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Bell } from 'lucide-react'
import { api } from '../../lib/api.js'

const REFRESH_MS = 30_000
const WHEN = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Bell with an unread count; opens a dropdown of the latest notifications. */
export function NotificationBell() {
  const navigate = useNavigate()
  const [data, setData] = useState({ notifications: [], unreadCount: 0 })
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  const load = useCallback(() => api.notifications().then(setData).catch(() => {}), [])

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    if (!open) return undefined
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !box.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const openOne = async (n) => {
    setOpen(false)
    if (!n.isRead) await api.markRead(n.notificationId).catch(() => {})
    load()
    if (n.link) navigate(n.link)
  }

  const readAll = async () => {
    await api.markAllRead().catch(() => {})
    load()
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={data.unreadCount > 0 ? `Notifications, ${data.unreadCount} unread` : 'Notifications'}
        className="focus-ring relative flex size-11 items-center justify-center rounded-(--radius-control) text-paper hover:bg-white/10"
      >
        <Bell size={20} aria-hidden />
        {data.unreadCount > 0 && (
          <span aria-hidden className="absolute top-1 right-1 flex min-w-5 items-center justify-center rounded-full bg-coral px-1 text-xs font-semibold text-asphalt">
            {data.unreadCount > 9 ? '9+' : data.unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-16 z-40 max-h-[70dvh] overflow-y-auto rounded-(--radius-panel) border border-ink/20 bg-surface text-ink shadow-xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between border-b border-ink/15 px-4 py-3">
            <p className="font-medium">Notifications</p>
            {data.unreadCount > 0 && (
              <button type="button" onClick={readAll} className="focus-ring rounded px-1 text-sm underline underline-offset-4">
                Mark all read
              </button>
            )}
          </div>
          {data.notifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink/85">Nothing yet. Requests, answers and ride updates show up here.</p>
          ) : (
            <ul>
              {data.notifications.map((n) => (
                <li key={n.notificationId} className="border-b border-ink/10 last:border-0">
                  <button
                    type="button"
                    onClick={() => openOne(n)}
                    className={`focus-ring block w-full px-4 py-3 text-left hover:bg-paper ${n.isRead ? '' : 'bg-paper-deep'}`}
                  >
                    <span className="block text-sm">{n.message}</span>
                    <span className="text-xs text-ink/85">{WHEN.format(new Date(n.createdAt))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
