import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { Alert } from '../ui/Panel.jsx'
import { Button } from '../ui/Button.jsx'
import { useLive } from '../../hooks/useLive.js'
import { api } from '../../lib/api.js'
import { playMessage } from '../../lib/sound.js'

const RIDER_QUICK = ['I am here', 'Running 2 min late', 'I can see you', 'Please wait for me']
const DRIVER_QUICK = ['On my way', 'I have arrived', 'Where exactly are you?', 'I am at the gate']
const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/**
 * A chat between a rider and their driver, as a sheet over the page.
 * Riders have one thread per ride. A driver opens one thread per rider (riderId).
 */
export function ChatSheet({ rideId, riderId, name, isDriver, onClose }) {
  const { data, error, reload } = useLive(() => api.rideMessages(rideId, riderId, true), { events: ['message:new'], pollMs: 6000 })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const end = useRef(null)
  const lastCount = useRef(null)

  // Scroll to the newest message, and ping when the other person writes.
  useEffect(() => {
    if (!data) return
    end.current?.scrollIntoView({ block: 'end' })
    if (lastCount.current !== null && data.messages.length > lastCount.current && !data.messages[data.messages.length - 1].mine) playMessage()
    lastCount.current = data.messages.length
  }, [data])

  const send = async (body) => {
    const value = (body ?? text).trim()
    if (!value || busy) return
    setBusy(true)
    setProblem(null)
    try {
      await api.sendRideMessage(rideId, value, riderId)
      if (body === undefined) setText('') // a quick reply must not wipe what is being typed
      await reload()
    } catch (err) {
      setProblem(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-asphalt/50 sm:items-center" role="dialog" aria-modal="true" aria-label={`Messages with ${name}`}>
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-(--radius-panel) bg-surface shadow-2xl sm:rounded-(--radius-panel)">
        <header className="flex items-center justify-between gap-2 border-b border-ink/15 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-display text-2xl leading-none font-semibold tracking-wide text-ink-deep uppercase">{name}</p>
            <p className="text-xs text-ink/85">{isDriver ? 'Rider' : 'Your driver'} · messages stay between you two</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close messages" className="focus-ring flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-ink/8">
            <X size={20} aria-hidden />
          </button>
        </header>

        <div className="min-h-40 flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
          {error && !data && <Alert tone="error">{error}</Alert>}
          {data && data.messages.length === 0 && <p className="py-6 text-center text-sm text-ink/85">No messages yet. Say hello, or tap a quick reply below.</p>}
          {data?.messages.map((m) => (
            <div key={m.messageId} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.mine ? 'rounded-br-sm bg-ink text-paper' : 'rounded-bl-sm bg-paper-deep text-ink'}`}>
                <p className="break-words whitespace-pre-wrap">{m.body}</p>
                <p className={`mt-0.5 text-[10px] ${m.mine ? 'text-paper/70' : 'text-ink/70'}`}>
                  {TIME.format(new Date(m.at))}
                  {m.mine && m.read ? ' · seen' : ''}
                </p>
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>

        {data?.open === false ? (
          <p className="border-t border-ink/15 px-4 py-3 text-center text-sm text-ink/85">This ride is over, so new messages are closed.</p>
        ) : (
          <div className="space-y-2 border-t border-ink/15 px-3 py-3">
            {problem && <p role="alert" className="text-sm text-error">{problem}</p>}
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {(isDriver ? DRIVER_QUICK : RIDER_QUICK).map((q) => (
                <button key={q} type="button" disabled={busy} onClick={() => send(q)} className="focus-ring shrink-0 rounded-full border border-ink/30 px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/8">
                  {q}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={300}
                placeholder="Write a message"
                aria-label="Message"
                className="h-11 min-w-0 flex-1 rounded-full border border-ink/30 bg-surface px-4 text-base focus:outline-2 focus:outline-mint"
              />
              <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="focus-ring flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-gold disabled:opacity-50">
                <Send size={18} aria-hidden />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

/** "Message" button with an unread count. Opens the chat sheet. */
export function MessageButton({ rideId, riderId, name, isDriver = false, label = 'Message', size = 'sm', fullWidth = false }) {
  const [open, setOpen] = useState(false)
  const { data } = useLive(() => api.rideUnread(rideId), { events: ['message:new'], pollMs: 8000 })
  const unread = data ? (isDriver ? data.byRider?.[riderId] || 0 : data.total) : 0
  const wasUnread = useRef(0)
  useEffect(() => {
    if (unread > wasUnread.current && !open) playMessage()
    wasUnread.current = unread
  }, [unread, open])
  return (
    <>
      <Button variant="secondary" size={size} fullWidth={fullWidth} onClick={() => setOpen(true)} className="relative">
        <MessageCircle size={16} aria-hidden /> {label}
        {unread > 0 && <span aria-label={`${unread} unread`} className="absolute -top-1.5 -right-1.5 flex min-w-5 items-center justify-center rounded-full bg-coral px-1 text-[11px] font-bold text-asphalt">{unread}</span>}
      </Button>
      {open && <ChatSheet rideId={rideId} riderId={riderId} name={name} isDriver={isDriver} onClose={() => setOpen(false)} />}
    </>
  )
}
