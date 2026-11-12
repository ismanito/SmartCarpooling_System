import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CalendarClock, Repeat } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx'
import { TextField } from '../components/ui/Field.jsx'
import { Alert, PageTitle } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { Card, localInputValue } from '../components/rides/RideBits.jsx'
import { useLive } from '../hooks/useLive.js'
import { api } from '../lib/api.js'

const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }
const STATUS = { scheduled: 'Booked', searching: 'Finding a driver', offered: 'Finding a driver', assigned: 'Driver assigned', no_driver: 'No driver yet' }
const WHEN = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const toLocalInput = (iso) => {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Upcoming and repeating bookings, with edit and cancel. */
export default function Bookings() {
  const { data, error, reload } = useLive(api.myTripRequests, { events: ['request:update'], pollMs: 10000 })
  const [edit, setEdit] = useState(null)
  const [cancel, setCancel] = useState(null)
  const [wholeSeries, setWholeSeries] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)

  const groups = useMemo(() => {
    if (!data) return null
    const upcoming = data.requests.filter((r) => r.type === 'scheduled' && ['scheduled', 'searching', 'offered', 'assigned', 'no_driver'].includes(r.status) && new Date(r.scheduledFor) > Date.now() - 3600_000)
    const map = new Map()
    for (const r of upcoming.sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))) {
      const key = r.seriesId || r.requestId
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    }
    return [...map.values()]
  }, [data])

  const run = async (fn) => {
    setBusy(true)
    setProblem(null)
    try {
      await fn()
      await reload()
      return true
    } catch (err) {
      setProblem(err.details?.[0]?.message || err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle>My bookings</PageTitle>
        <Button to="/ride" variant="secondary" size="sm"><CalendarClock size={16} aria-hidden /> Book a ride</Button>
      </div>
      <p className="text-sm text-ink/85">We find your driver about 20 minutes before pick-up. Students going to the same place at the same time are pooled into one car.</p>
      {(error || problem) && <Alert tone="error">{problem || error}</Alert>}
      {!groups ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <p className="text-sm text-ink/85">
          Nothing booked. <Link to="/ride" className="underline underline-offset-4">Book a ride</Link> for later, or make it repeat for your class days.
        </p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => {
            const first = g[0]
            const series = Boolean(first.seriesId)
            return (
              <Card key={first.requestId}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{first.pickup.label} to {first.dropoff.label}</p>
                    <p className="text-sm text-ink/85">{WHEN.format(new Date(first.scheduledFor))} · {first.seats} seat{first.seats === 1 ? '' : 's'}</p>
                    {series && (
                      <p className="mt-1 inline-flex flex-wrap items-center gap-1.5 text-sm text-ink">
                        <Repeat size={14} aria-hidden /> Repeats {first.repeatDays.map((d) => DAY_LABEL[d]).join(', ')}
                        <span className="text-ink/85">· {g.length} coming up</span>
                      </p>
                    )}
                  </div>
                  <span className="rounded-(--radius-chip) border border-ink/30 px-2 py-0.5 text-xs uppercase">{STATUS[first.status]}</span>
                </div>
                {series && g.length > 1 && (
                  <ul className="mt-3 space-y-1 text-sm text-ink/85">
                    {g.slice(1, 4).map((r) => <li key={r.requestId}>{WHEN.format(new Date(r.scheduledFor))}</li>)}
                    {g.length > 4 && <li>and {g.length - 4} more</li>}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {['scheduled', 'searching', 'no_driver'].includes(first.status) && (
                    <Button size="sm" variant="secondary" onClick={() => setEdit({ request: first, when: toLocalInput(first.scheduledFor), series: false })}>Edit</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => { setWholeSeries(false); setCancel(first) }}>Cancel</Button>
                </div>
                {edit?.request.requestId === first.requestId && (
                  <form
                    className="mt-3 space-y-3 rounded-(--radius-control) bg-paper p-3"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      const ok = await run(() => api.editTripRequest(first.requestId, { scheduledFor: new Date(edit.when).toISOString(), ...(edit.series ? { series: true } : {}) }))
                      if (ok) setEdit(null)
                    }}
                  >
                    <TextField label="New pick-up time" type="datetime-local" min={localInputValue(10)} value={edit.when} onChange={(e) => setEdit({ ...edit, when: e.target.value })} />
                    {series && (
                      <label className="flex min-h-11 items-center gap-2 text-sm">
                        <input type="checkbox" checked={edit.series} onChange={(e) => setEdit({ ...edit, series: e.target.checked })} className="size-5" /> Change every repeat too
                      </label>
                    )}
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" isLoading={busy}>Save</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(null)}>Close</Button>
                    </div>
                  </form>
                )}
              </Card>
            )
          })}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(cancel)}
        title="Cancel this booking?"
        confirmLabel="Yes, cancel"
        isLoading={busy}
        onCancel={() => setCancel(null)}
        onConfirm={async () => {
          await run(() => api.cancelTripRequest(cancel.requestId, wholeSeries))
          setCancel(null)
        }}
      >
        <p>Your pick-up on {cancel && WHEN.format(new Date(cancel.scheduledFor))} will be cancelled.</p>
        {cancel?.seriesId && (
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={wholeSeries} onChange={(e) => setWholeSeries(e.target.checked)} className="size-5" /> Cancel the whole repeating booking
          </label>
        )}
      </ConfirmDialog>
    </div>
  )
}
