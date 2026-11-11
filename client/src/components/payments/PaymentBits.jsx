import { useState } from 'react'
import { Banknote, Smartphone, Users } from 'lucide-react'
import { Button } from '../ui/Button.jsx'
import { TextField } from '../ui/Field.jsx'
import { Card, Route, formatWhen } from '../rides/RideBits.jsx'

const KES = new Intl.NumberFormat('en-KE')
export const kes = (n) => `KES ${KES.format(n || 0)}`

/** One headline figure. Used by all three dashboards so they read the same. */
export function StatTile({ label, value, note, tone = 'plain' }) {
  const tones = {
    plain: 'border-ink/20 bg-surface',
    alert: 'border-coral bg-surface',
    good: 'border-mint bg-surface',
  }
  return (
    <div className={`rounded-(--radius-panel) border p-4 ${tones[tone]}`}>
      <dt className="text-sm text-ink/85">{label}</dt>
      <dd className="font-display text-4xl leading-none font-semibold text-ink-deep">{value}</dd>
      {note && <p className="mt-1 text-xs text-ink/85">{note}</p>}
    </div>
  )
}

export function StatGrid({ children }) {
  return <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</dl>
}

const CHIP = {
  pending: ['Unpaid', 'border-coral text-ink'],
  paid: ['Paid', 'border-ink bg-ink text-gold'],
  cancelled: ['Cancelled', 'border-ink/30 text-ink/85'],
  refunded: ['Refunded', 'border-ink/30 text-ink/85'],
}

export function PayChip({ status }) {
  const [text, cls] = CHIP[status] || [status, '']
  return <span className={`inline-flex items-center rounded-(--radius-chip) border px-2 py-0.5 text-xs font-medium tracking-wide uppercase ${cls}`}>{text}</span>
}

/** Who has paid which part of a fare. */
export function ShareList({ shares }) {
  return (
    <ul className="space-y-1">
      {shares.map((s) => (
        <li key={s.shareId} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-ink">
            {s.mine ? 'You' : s.payerName}
            {s.status === 'paid' && s.method && <span className="text-ink/85"> · {s.method === 'mpesa' ? 'M-Pesa' : 'cash'}</span>}
          </span>
          <span className="flex items-center gap-2">
            {kes(s.amountKes)} <PayChip status={s.status} />
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Choose how you paid the driver, then record it. */
function PayForm({ share, onPay }) {
  const [method, setMethod] = useState('mpesa')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await onPay(share.shareId, { method, ...(method === 'mpesa' ? { reference } : {}) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-(--radius-control) bg-paper p-3">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 text-sm font-medium text-ink">Pay your {kes(share.amountKes)} share</legend>
        {[
          ['mpesa', 'M-Pesa', Smartphone],
          ['cash', 'Cash', Banknote],
        ].map(([value, label, Icon]) => (
          <label
            key={value}
            className={`focus-within:outline-2 focus-within:outline-mint inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-(--radius-control) border px-3 text-sm font-medium ${method === value ? 'border-ink bg-ink text-gold' : 'border-ink/30 bg-surface text-ink'}`}
          >
            <input type="radio" name={`method-${share.shareId}`} value={value} checked={method === value} onChange={() => setMethod(value)} className="sr-only" />
            <Icon size={16} aria-hidden /> {label}
          </label>
        ))}
      </fieldset>
      {method === 'mpesa' && (
        <TextField
          label="M-Pesa confirmation code"
          hint="Send the money to the driver on M-Pesa, then enter the code from the message"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="SJK12ABC34"
          autoCapitalize="characters"
          maxLength={12}
          required
        />
      )}
      <Button type="submit" size="sm" isLoading={busy}>
        I have paid
      </Button>
    </form>
  )
}

/** The booker picks friends to chip in; the fare is divided evenly. */
function SplitForm({ payment, onSplit, onClose }) {
  const [text, setText] = useState(() =>
    payment.shares
      .filter((s) => !s.mine)
      .map((s) => s.email || '')
      .filter(Boolean)
      .join(', '),
  )
  const [busy, setBusy] = useState(false)
  const emails = [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))]
  const each = Math.floor(payment.totalKes / (emails.length + 1))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await onSplit(payment.bookingId, emails)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-(--radius-control) bg-paper p-3">
      <TextField
        label="Friends to share the fare with"
        hint="Their RideMate student emails, separated by commas. Up to 5 people."
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="amina@usiu.ac.ke, brian@usiu.ac.ke"
      />
      <p className="text-sm text-ink">
        {emails.length === 0 ? `You pay all of it: ${kes(payment.totalKes)}.` : `${emails.length + 1} people each pay about ${kes(each)}.`}
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" isLoading={busy}>
          {emails.length === 0 ? 'Pay alone' : 'Split the fare'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </form>
  )
}

/** A rider's view of one fare: what it is, who owes what, and the buttons to pay or share it. */
export function FareCard({ payment, onPay, onSplit }) {
  const [open, setOpen] = useState(null) // 'pay' | 'split' | null
  const mine = payment.shares.find((s) => s.mine)
  const canSplit = payment.isBooker && payment.status === 'pending' && payment.shares.every((s) => s.status === 'pending')
  const people = payment.shares.length

  return (
    <Card muted={payment.status === 'cancelled'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Route from={payment.trip.origin} to={payment.trip.destination} />
          <p className="text-sm text-ink/85">
            {formatWhen(payment.trip.departAt)} · Driver {payment.driver.fullName}
            {!payment.isBooker && ` · Booked by ${payment.rider.fullName}`}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl leading-none font-semibold text-ink-deep">{kes(payment.totalKes)}</p>
          <PayChip status={payment.status} />
        </div>
      </div>

      <div className="mt-3 border-t border-ink/15 pt-3">
        {people > 1 && (
          <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium tracking-wider text-ink/85 uppercase">
            <Users size={14} aria-hidden /> Split {people} ways
          </p>
        )}
        <ShareList shares={payment.shares} />
      </div>

      {payment.status !== 'cancelled' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {mine?.status === 'pending' && (
            <Button size="sm" onClick={() => setOpen(open === 'pay' ? null : 'pay')} aria-expanded={open === 'pay'}>
              Pay {kes(mine.amountKes)}
            </Button>
          )}
          {canSplit && (
            <Button variant="secondary" size="sm" onClick={() => setOpen(open === 'split' ? null : 'split')} aria-expanded={open === 'split'}>
              {people > 1 ? 'Change split' : 'Split with friends'}
            </Button>
          )}
        </div>
      )}
      {open === 'pay' && mine && (
        <div className="mt-3">
          <PayForm
            share={mine}
            onPay={async (id, body) => {
              await onPay(id, body)
              setOpen(null)
            }}
          />
        </div>
      )}
      {open === 'split' && (
        <div className="mt-3">
          <SplitForm payment={payment} onSplit={onSplit} onClose={() => setOpen(null)} />
        </div>
      )}
    </Card>
  )
}
