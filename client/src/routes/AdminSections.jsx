import { useEffect, useState } from 'react'
import { Download, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { SelectField, TextField } from '../components/ui/Field.jsx'
import { Alert, Panel } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { api } from '../lib/api.js'
import { SectionTitle, formatWhen } from '../components/rides/RideBits.jsx'
import { StatGrid, StatTile, kes } from '../components/payments/PaymentBits.jsx'

const WEEK = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

function useLoad(load, deps) {
  const [state, setState] = useState({ data: null, error: null })
  useEffect(() => {
    let live = true
    load()
      .then((data) => live && setState({ data, error: null }))
      .catch((err) => live && setState({ data: null, error: err.message }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

/** Rides per week as bars. A table sits behind it for screen readers. */
function WeeklyChart({ weeks }) {
  const max = Math.max(1, ...weeks.map((w) => w.rides))
  if (weeks.length === 0) return <p className="text-sm text-ink/85">No finished rides in the last 8 weeks.</p>
  return (
    <figure>
      <div role="img" aria-label={`Rides per week: ${weeks.map((w) => `${WEEK.format(new Date(w.week))} ${w.rides}`).join(', ')}`} className="flex h-40 items-end gap-2">
        {weeks.map((w) => (
          <div key={w.week} className="flex h-full min-w-0 flex-1 flex-col justify-end text-center">
            <span className="text-xs text-ink">{w.rides}</span>
            <span className="block rounded-t bg-ink" style={{ height: `${(w.rides / max) * 100}%`, minHeight: 4 }} />
            <span className="mt-1 truncate text-[11px] text-ink/85">{WEEK.format(new Date(w.week))}</span>
          </div>
        ))}
      </div>
    </figure>
  )
}

function Integrity({ chain }) {
  return (
    <div className={`flex items-start gap-3 rounded-(--radius-panel) p-4 ${chain.valid ? 'bg-asphalt text-paper' : 'bg-error text-surface'}`}>
      {chain.valid ? <ShieldCheck size={24} aria-hidden className="shrink-0 text-gold" /> : <ShieldAlert size={24} aria-hidden className="shrink-0" />}
      <div>
        <p className="font-medium">{chain.valid ? 'Audit log is intact' : 'Audit log has been altered'}</p>
        <p className="text-sm">
          {chain.valid
            ? `All ${chain.checked} entries match their hash chain.`
            : `Entry ${chain.firstBroken?.auditId} no longer matches its hash (${chain.firstBroken?.reason}).`}
        </p>
      </div>
    </div>
  )
}

export function Dashboard() {
  const { data, error } = useLoad(
    () => Promise.all([api.adminDashboard(), api.adminVerifyAudit(), api.adminPayments()]).then(([s, chain, pay]) => ({ s: s.stats, chain, pay: pay.summary })),
    [],
  )
  if (error) return <Alert tone="error">{error}</Alert>
  if (!data) return <Spinner />
  const { s, chain, pay } = data
  return (
    <div className="space-y-6">
      <Integrity chain={chain} />
      <StatGrid>
        <StatTile label="Verified students" value={s.verifiedStudents} />
        <StatTile label="Active trips" value={s.activeTrips} />
        <StatTile label="Seat requests" value={s.matches} note={`${s.requests} ride requests`} />
        <StatTile label="Completed rides" value={s.completedRides} />
        <StatTile label="Average rating" value={s.avgRating ? s.avgRating.toFixed(1) : 'None yet'} />
        <StatTile label="Estimated savings" value={kes(s.estimatedSavingsKes)} tone="good" note="Versus travelling alone" />
        <StatTile label="Open reports" value={s.openIncidents} tone={s.openIncidents > 0 ? 'alert' : 'plain'} />
        <StatTile label="Drivers" value={s.approvedDrivers} tone={s.pendingDrivers > 0 ? 'alert' : 'plain'} note={`${s.pendingDrivers} waiting for review`} />
        <StatTile label="Unpaid fares" value={kes(pay.outstandingKes)} note={`${pay.unpaidFares} fares`} />
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <SectionTitle>Rides per week</SectionTitle>
          <div className="mt-4">
            <WeeklyChart weeks={s.ridesPerWeek} />
          </div>
        </Panel>
        <Panel>
          <SectionTitle>Top routes</SectionTitle>
          {s.topRoutes.length === 0 ? (
            <p className="mt-3 text-sm text-ink/85">No trips yet.</p>
          ) : (
            <ol className="mt-3 space-y-2">
              {s.topRoutes.map((r, i) => (
                <li key={`${r.origin}-${r.destination}`} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {i + 1}. {r.origin} to {r.destination}
                  </span>
                  <span className="font-medium">{r.trips} trips</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  )
}

export function Analytics() {
  const [range, setRange] = useState({ from: '', to: '' })
  const [applied, setApplied] = useState({})
  const [busy, setBusy] = useState(false)
  const [dlError, setDlError] = useState(null)
  const { data, error } = useLoad(() => api.adminDashboard(applied).then((r) => r.stats), [applied])

  const download = async () => {
    setBusy(true)
    setDlError(null)
    try {
      await api.adminDownloadCsv(applied)
    } catch (err) {
      setDlError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          setApplied({ from: range.from, to: range.to })
        }}
      >
        <TextField label="From" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-44" />
        <TextField label="To" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-44" />
        <Button type="submit" variant="secondary">Apply</Button>
        <Button type="button" onClick={download} isLoading={busy}>
          <Download size={16} aria-hidden /> Download CSV
        </Button>
      </form>
      {(error || dlError) && <Alert tone="error">{error || dlError}</Alert>}
      {!data ? (
        <Spinner />
      ) : (
        <>
          <StatGrid>
            <StatTile label="Completed rides" value={data.completedRides} />
            <StatTile label="Seat requests" value={data.matches} />
            <StatTile label="Ride requests" value={data.requests} />
            <StatTile label="Estimated savings" value={kes(data.estimatedSavingsKes)} tone="good" />
          </StatGrid>
          <Panel>
            <SectionTitle>Rides per week</SectionTitle>
            <div className="mt-4">
              <WeeklyChart weeks={data.ridesPerWeek} />
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}

const STATUS_LABEL = { open: 'Open', in_review: 'In review', closed: 'Closed' }
const CATEGORY_LABEL = { unsafe_driving: 'Unsafe driving', no_show: 'No-show', harassment: 'Harassment', payment_demand: 'Asked for extra money', other: 'Other' }

export function Incidents({ initialId }) {
  const [status, setStatus] = useState('open')
  const [openId, setOpenId] = useState(initialId || null)
  const [tick, setTick] = useState(0)
  const { data, error } = useLoad(() => api.adminIncidents(status || undefined).then((r) => r.incidents), [status, tick])

  if (openId) return <IncidentDetail id={openId} onBack={() => { setOpenId(null); setTick((t) => t + 1) }} />
  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <SelectField
          label="Show"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          placeholder="All reports"
          options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
        />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <p className="text-sm text-ink/85">No reports here.</p>
      ) : (
        <ul className="space-y-2">
          {data.map((i) => (
            <li key={i.reportId}>
              <button type="button" onClick={() => setOpenId(i.reportId)} className="focus-ring block w-full rounded-(--radius-control) border border-ink/20 bg-surface p-3 text-left hover:border-ink">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">{CATEGORY_LABEL[i.category]}: {i.reported.fullName}</span>
                  <span className="rounded-(--radius-chip) border border-ink/30 px-2 text-xs uppercase">{STATUS_LABEL[i.status]}{i.decision ? `, ${i.decision}` : ''}</span>
                </span>
                <span className="block text-sm text-ink/85">Reported by {i.reporter.fullName} · {formatWhen(i.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function IncidentDetail({ id, onBack }) {
  const [version, setVersion] = useState(0)
  const { data: d, error } = useLoad(() => api.adminIncident(id).then((r) => r.incident), [id, version])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)

  if (error) return <Alert tone="error">{error}</Alert>
  if (!d) return <Spinner />

  const decide = async (decision) => {
    setBusy(decision)
    setActionError(null)
    try {
      await api.adminDecide(id, { decision, notes })
      setVersion((v) => v + 1)
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusy(null)
    }
  }
  const exportEvidence = async () => {
    setBusy('export')
    setActionError(null)
    try {
      await api.adminDownloadEvidence(id)
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={onBack}>Back to reports</Button>
      {actionError && <Alert tone="error">{actionError}</Alert>}
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">{CATEGORY_LABEL[d.category]}</h2>
            <p className="mt-1 text-sm text-ink/85">{formatWhen(d.createdAt)} · {STATUS_LABEL[d.status]}{d.decision ? `, ${d.decision}` : ''}</p>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-(--radius-chip) px-2 py-1 text-xs font-medium ${d.integrity.valid ? 'bg-asphalt text-gold' : 'bg-error text-surface'}`}>
            {d.integrity.valid ? <ShieldCheck size={14} aria-hidden /> : <ShieldAlert size={14} aria-hidden />}
            {d.integrity.valid ? 'Integrity verified' : 'Audit log altered'}
          </span>
        </div>
        <p className="mt-4 rounded-(--radius-control) bg-paper p-3 text-sm whitespace-pre-wrap">{d.description}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-ink/85">Reporter</dt><dd className="font-medium">{d.reporter.fullName}<span className="block font-normal break-all text-ink/85">{d.reporter.email}</span></dd></div>
          <div><dt className="text-ink/85">Reported</dt><dd className="font-medium">{d.reported.fullName} {d.reported.status === 'suspended' && '(suspended)'}<span className="block font-normal break-all text-ink/85">{d.reported.email}</span></dd></div>
          <div><dt className="text-ink/85">Ride</dt><dd className="font-medium">{d.ride ? `${d.ride.origin} to ${d.ride.destination}` : 'Unknown'}<span className="block font-normal text-ink/85">{d.ride && `${formatWhen(d.ride.departAt)} · driver ${d.ride.driver}`}</span></dd></div>
        </dl>
        {d.previousReports.length > 0 && (
          <p className="mt-4 text-sm text-ink">
            {d.reported.fullName} has {d.previousReports.length} earlier report{d.previousReports.length === 1 ? '' : 's'}: {d.previousReports.map((p) => `${CATEGORY_LABEL[p.category]} (${p.decision || p.status})`).join(', ')}.
          </p>
        )}
      </Panel>

      <section className="space-y-2">
        <SectionTitle>Audit trail for this ride</SectionTitle>
        <div className="overflow-x-auto rounded-(--radius-panel) border border-ink/20 bg-surface">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-paper-deep text-xs tracking-wider uppercase">
              <tr><th className="px-3 py-2 font-medium">#</th><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">Action</th><th className="px-3 py-2 font-medium">Hash</th></tr>
            </thead>
            <tbody>
              {d.auditTrail.map((a) => (
                <tr key={a.auditId} className="border-t border-ink/10">
                  <td className="px-3 py-2">{a.auditId}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatWhen(a.createdAt)}</td>
                  <td className="px-3 py-2 font-medium">{a.action}</td>
                  <td className="px-3 py-2 font-mono text-xs">{a.entryHash.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="secondary" size="sm" onClick={exportEvidence} isLoading={busy === 'export'}>
          <Download size={16} aria-hidden /> Export evidence
        </Button>
      </section>

      {d.status !== 'closed' ? (
        <Panel>
          <SectionTitle>Decision</SectionTitle>
          <div className="mt-3 space-y-3">
            <TextField label="Notes (kept with the report)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" isLoading={busy === 'dismissed'} onClick={() => decide('dismissed')}>Dismiss</Button>
              <Button variant="secondary" isLoading={busy === 'warning'} onClick={() => decide('warning')}>Warn</Button>
              <Button variant="danger" isLoading={busy === 'suspended'} onClick={() => decide('suspended')}>Suspend {d.reported.fullName}</Button>
            </div>
          </div>
        </Panel>
      ) : (
        <p className="text-sm text-ink">Decision: <strong>{d.decision}</strong>{d.adminNotes && `. Notes: ${d.adminNotes}`}</p>
      )}
    </div>
  )
}

const APP_STATUS = { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected' }

/** Drivers who signed up with their own email apply here; an admin checks them before they can drive students. */
export function DriverApplications() {
  const [status, setStatus] = useState('pending')
  const [tick, setTick] = useState(0)
  const { data, error } = useLoad(() => api.adminDrivers(status || undefined).then((r) => r.applications), [status, tick])
  const [notes, setNotes] = useState({})
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)

  const decide = async (a, decision) => {
    setBusy(`${a.applicationId}${decision}`)
    setActionError(null)
    try {
      await api.adminDriverDecision(a.applicationId, { decision, notes: notes[a.applicationId] || undefined })
      setTick((t) => t + 1)
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <SelectField
          label="Show"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          placeholder="All applications"
          options={Object.entries(APP_STATUS).map(([value, label]) => ({ value, label }))}
        />
      </div>
      {(error || actionError) && <Alert tone="error">{error || actionError}</Alert>}
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <p className="text-sm text-ink/85">No applications here.</p>
      ) : (
        <ul className="space-y-3">
          {data.map((a) => (
            <li key={a.applicationId}>
              <Panel>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{a.fullName}</p>
                    <p className="text-sm break-all text-ink/85">{a.email} · {a.phoneNumber}</p>
                  </div>
                  <span className="rounded-(--radius-chip) border border-ink/30 px-2 text-xs uppercase">{APP_STATUS[a.status]}</span>
                </div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-ink/85">Driving licence</dt><dd className="font-medium">{a.licenceNumber}</dd></div>
                  <div><dt className="text-ink/85">ID or passport</dt><dd className="font-medium">{a.idNumber}</dd></div>
                  {a.about && <div className="sm:col-span-2"><dt className="text-ink/85">Notes from the driver</dt><dd>{a.about}</dd></div>}
                  <div><dt className="text-ink/85">Applied</dt><dd>{formatWhen(a.createdAt)}</dd></div>
                </dl>
                {a.status === 'pending' ? (
                  <div className="mt-4 space-y-3">
                    <TextField
                      label="Notes (the driver sees these if you reject)"
                      value={notes[a.applicationId] || ''}
                      onChange={(e) => setNotes({ ...notes, [a.applicationId]: e.target.value })}
                      maxLength={2000}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button isLoading={busy === `${a.applicationId}approved`} onClick={() => decide(a, 'approved')}>Approve</Button>
                      <Button variant="secondary" isLoading={busy === `${a.applicationId}rejected`} onClick={() => decide(a, 'rejected')}>Reject</Button>
                    </div>
                  </div>
                ) : (
                  a.adminNotes && <p className="mt-3 text-sm">Notes: {a.adminNotes}</p>
                )}
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
