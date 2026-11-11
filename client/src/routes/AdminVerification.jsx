import { useEffect, useState } from 'react'
import { AlertTriangle, Check, FileText, X } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { TextField } from '../components/ui/Field.jsx'
import { Alert, Panel } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { SectionTitle, formatWhen } from '../components/rides/RideBits.jsx'
import { useLive } from '../hooks/useLive.js'
import { api } from '../lib/api.js'

const DOC_LABEL = {
  student_id: 'Student ID', staff_id: 'Staff ID', national_id_front: 'National ID, front', national_id_back: 'National ID, back', good_conduct: 'Certificate of Good Conduct',
  psv_badge: 'PSV badge', inspection_report: 'Inspection report', licence_front: 'Licence, front', licence_back: 'Licence, back', selfie: 'Selfie, straight',
  selfie_head_turn: 'Selfie, head turned', logbook: 'Logbook', owner_letter: 'Owner’s letter', insurance: 'Insurance certificate', car_front_plate: 'Car front with plate',
  car_back: 'Car back', car_interior: 'Car interior',
}
const ITEM_LABEL = {
  identity_matches_selfie: 'Identity matches the selfie', names_match: 'Names match everywhere', licence_valid: 'Licence is valid', licence_held_long_enough: 'Licence held long enough',
  vehicle_matches_plate: 'Vehicle and plate match', ownership_shown: 'Ownership or permission shown', insurance_valid: 'Insurance is valid', student_id_valid: 'Student ID is valid',
  staff_id_valid: 'Staff ID is valid', national_id_valid: 'National ID is valid', good_conduct_valid: 'Good Conduct certificate is valid (under 6 months)', psv_badge_valid: 'PSV badge is valid',
  inspection_report_valid: 'Inspection report is acceptable', insurance_covers_passengers: 'Insurance covers passengers', in_person_check_done: 'In-person check done at campus security',
}
const STATUS = { not_started: 'Not started', pending_review: 'Pending review', approved: 'Approved', rejected: 'Rejected', expired: 'Expired', suspended: 'Suspended' }
// Documents are shown in pairs so a reviewer can compare them at a glance.
const PAIRS = [['selfie', 'licence_front'], ['selfie_head_turn', 'licence_back'], ['car_front_plate', 'car_back']]

export function Verification() {
  const [tab, setTab] = useState('queue')
  const [openId, setOpenId] = useState(() => new URLSearchParams(window.location.search).get('driver'))
  if (openId) return <Review driverId={openId} onBack={() => setOpenId(null)} />
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Verification" className="flex gap-1 overflow-x-auto border-b border-ink/20">
        {[['queue', 'Waiting for review'], ['all', 'All drivers'], ['selfies', 'Selfie re-checks'], ['settings', 'Settings']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`focus-ring -mb-px min-h-11 border-b-2 px-4 text-sm font-medium whitespace-nowrap ${tab === id ? 'border-ink text-ink' : 'border-transparent text-ink/85'}`}>{label}</button>
        ))}
      </div>
      {tab === 'queue' && <Queue onOpen={setOpenId} />}
      {tab === 'all' && <AllDrivers onOpen={setOpenId} />}
      {tab === 'selfies' && <SelfieChecks />}
      {tab === 'settings' && <VerificationSettings />}
    </div>
  )
}

function Queue({ onOpen }) {
  const { data, error } = useLive(() => api.adminVerifications().then((r) => r.verifications), { events: [], pollMs: 15000 })
  if (error && !data) return <Alert tone="error">{error}</Alert>
  if (!data) return <Spinner />
  if (data.length === 0) return <p className="text-sm text-ink/85">Nobody is waiting for review.</p>
  return (
    <ul className="space-y-2">
      {data.map((q) => (
        <li key={q.driverId}>
          <button type="button" onClick={() => onOpen(q.driverId)} className="focus-ring flex w-full flex-wrap items-center justify-between gap-2 rounded-(--radius-control) border border-ink/20 bg-surface p-3 text-left hover:border-ink">
            <span>
              <span className="block font-medium text-ink">{q.name} {q.recheck && <span className="ml-1 rounded-(--radius-chip) border border-ink px-1.5 text-xs">Re-check</span>}</span>
              <span className="block text-sm text-ink/85">{q.typeLabel} · {q.email}</span>
            </span>
            <span className="text-sm text-ink">Waiting {q.waitingHours < 48 ? `${q.waitingHours} h` : `${Math.round(q.waitingHours / 24)} days`}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function AllDrivers({ onOpen }) {
  const [status, setStatus] = useState('approved')
  return (
    <div className="space-y-3">
      <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
        Show
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="focus-ring h-11 rounded-(--radius-control) border border-ink/30 bg-surface px-2 font-normal">
          {Object.entries(STATUS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <StatusList key={status} status={status} onOpen={onOpen} />
    </div>
  )
}

function StatusList({ status, onOpen }) {
  const { data, error } = useLive(() => api.adminVerifications(status).then((r) => r.verifications), { pollMs: 30000 })
  if (error && !data) return <Alert tone="error">{error}</Alert>
  if (!data) return <Spinner />
  if (data.length === 0) return <p className="text-sm text-ink/85">None.</p>
  return (
    <ul className="space-y-2">
      {data.map((q) => (
        <li key={q.driverId}>
          <button type="button" onClick={() => onOpen(q.driverId)} className="focus-ring block w-full rounded-(--radius-control) border border-ink/20 bg-surface p-3 text-left hover:border-ink">
            <span className="font-medium text-ink">{q.name}</span> <span className="text-sm text-ink/85">· {q.typeLabel} · {q.email}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function SelfieChecks() {
  const { data, error, reload } = useLive(() => api.adminSelfieChecks().then((r) => r.checks), { pollMs: 20000 })
  const [shown, setShown] = useState({})
  const view = async (docId) => {
    const { url } = await api.adminDocumentUrl(docId)
    setShown((s) => ({ ...s, [docId]: url }))
  }
  if (error && !data) return <Alert tone="error">{error}</Alert>
  if (!data) return <Spinner />
  if (data.length === 0) return <p className="text-sm text-ink/85">No selfie re-checks yet. A share of drivers is asked for one each time they go online.</p>
  return (
    <ul className="space-y-3">
      {data.map((c) => (
        <li key={c.checkId} className="rounded-(--radius-panel) border border-ink/20 bg-surface p-3">
          <p className="font-medium text-ink">{c.name} <span className="text-sm font-normal text-ink/85">· {formatWhen(c.createdAt)} · {c.status}</span></p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[['Re-check selfie', c.docId], ['Original selfie', c.originalDocId]].map(([label, id]) => (
              <div key={label}>
                <p className="text-xs text-ink/85">{label}</p>
                {id && shown[id] ? <img src={shown[id]} alt={`${label} of ${c.name}`} className="aspect-[4/3] w-full rounded object-cover" /> : <Button size="sm" variant="secondary" disabled={!id} onClick={() => view(id)}>View</Button>}
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="secondary" onClick={async () => { await api.adminReviewSelfie(c.checkId, 'cleared'); reload() }}>Same person</Button>
            <Button size="sm" variant="danger" onClick={async () => { await api.adminReviewSelfie(c.checkId, 'flagged'); reload() }}>Looks different, flag</Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

const SETTING_LABELS = {
  external_drivers_enabled: ['Accept external drivers', ''],
  min_licence_years: ['Licence must be held for at least', 'years'],
  expiry_warning_days: ['Remind drivers before papers expire', 'days'],
  recheck_months: ['Re-check every', 'months'],
  doc_retention_days: ['Delete files after approval', 'days'],
  auto_suspend_rating: ['Suspend below this average rating', 'stars'],
  auto_suspend_min_ratings: ['…once there are at least', 'ratings'],
  auto_suspend_incidents: ['Suspend at this many open incident reports', 'reports'],
  random_selfie_check_percent: ['Ask for a live selfie when going online', '% of the time'],
}

function VerificationSettings() {
  const [data, setData] = useState(null)
  const [values, setValues] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    api.adminVerificationSettings().then((r) => { setData(r); setValues(r.settings) }).catch((e) => setError(e.message))
  }, [])
  if (!values) return error ? <Alert tone="error">{error}</Alert> : <Spinner />
  const save = async (e) => {
    e.preventDefault()
    setError(null)
    setSaved(false)
    try {
      await api.adminSaveVerificationSettings(values)
      setSaved(true)
    } catch (err) {
      setError(err.details?.[0] ? `${err.details[0].field}: ${err.details[0].message}` : err.message)
    }
  }
  return (
    <Panel className="max-w-xl">
      <p className="mb-4 text-sm text-ink/85">Every change is written to the audit log. Only a senior administrator can switch the external driver track on or off.</p>
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="info">Saved.</Alert>}
      <form onSubmit={save} className="space-y-3">
        {Object.entries(SETTING_LABELS).map(([key, [label, unit]]) =>
          key === 'external_drivers_enabled' ? (
            <label key={key} className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink">
              <input type="checkbox" checked={Boolean(values[key])} disabled={!data.canToggleExternal} onChange={(e) => setValues({ ...values, [key]: e.target.checked })} className="size-5" />
              {label} {!data.canToggleExternal && <span className="font-normal text-ink/85">(senior administrators only)</span>}
            </label>
          ) : (
            <TextField key={key} label={`${label} (${unit})`} type="number" step="any" min={data.limits[key]?.[0]} max={data.limits[key]?.[1]} value={values[key] ?? ''} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
          ),
        )}
        <Button type="submit">Save settings</Button>
      </form>
    </Panel>
  )
}

// ---------------------------------------------------------------- the review page

function Review({ driverId, onBack }) {
  const { data: d, error, reload } = useLive(() => api.adminVerification(driverId), { pollMs: 60000 })
  const [urls, setUrls] = useState({})
  const [busy, setBusy] = useState(null)
  const [problem, setProblem] = useState(null)
  const [note, setNote] = useState({})
  const [reason, setReason] = useState('')
  const [inPerson, setInPerson] = useState({ date: new Date().toISOString().slice(0, 10), officer: '' })
  const refresh = reload

  const act = async (key, fn) => {
    setBusy(key)
    setProblem(null)
    try {
      await fn()
      refresh()
    } catch (err) {
      setProblem(err.details?.length ? `${err.message} ${err.details.map((x) => x.message).join('; ')}` : err.message)
    } finally {
      setBusy(null)
    }
  }
  const loadDocs = () =>
    act('docs', async () => {
      const next = {}
      for (const doc of d.documents.filter((x) => !x.deleted)) {
        const { url } = await api.adminDocumentUrl(doc.docId)
        next[doc.docId] = { url, mime: doc.mimeType }
      }
      setUrls(next)
    })

  if (!d) return error ? <Alert tone="error">{error}</Alert> : <Spinner />
  const v = d.verification
  const byType = Object.fromEntries(d.documents.filter((x) => !x.deleted).map((x) => [x.docType, x]))
  const waiting = v.status === 'pending_review' || v.recheckState === 'submitted'
  const allPass = d.checklist.every((c) => c.result === 'pass')

  const Doc = ({ type }) => {
    const doc = byType[type]
    if (!doc) return <div className="flex aspect-[4/3] items-center justify-center rounded border border-dashed border-ink/30 text-xs text-ink/85">{DOC_LABEL[type]}: not provided</div>
    const loaded = urls[doc.docId]
    return (
      <figure>
        <figcaption className="mb-1 text-xs font-medium text-ink">{DOC_LABEL[type]} <span className="font-normal text-ink/85">· {doc.sha256Prefix}{doc.capturedLive ? ' · live' : ''}</span></figcaption>
        {!loaded ? <div className="flex aspect-[4/3] items-center justify-center rounded bg-paper-deep text-xs text-ink/85">Not loaded</div> : doc.mimeType === 'application/pdf' ? (
          <a href={loaded.url} target="_blank" rel="noreferrer" className="flex aspect-[4/3] items-center justify-center gap-2 rounded bg-paper-deep text-sm underline"><FileText size={18} aria-hidden /> Open PDF</a>
        ) : (
          <img src={loaded.url} alt={DOC_LABEL[type]} className="aspect-[4/3] w-full rounded object-cover" />
        )}
      </figure>
    )
  }

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={onBack}>Back to the list</Button>
      {problem && <Alert tone="error">{problem}</Alert>}
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">{d.driver.name}</h2>
            <p className="mt-1 text-sm text-ink/85 break-all">{d.driver.email} · {d.driver.phone}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{v.typeLabel}</p>
            <p className="rounded-(--radius-chip) border border-ink/30 px-2 text-xs uppercase">{STATUS[v.status]}{v.recheckState === 'submitted' ? ' · re-check' : ''}</p>
          </div>
        </div>
        {d.flags.length > 0 && (
          <ul className="mt-4 space-y-1">
            {d.flags.map((f) => (
              <li key={f.code} className="flex items-start gap-2 rounded-(--radius-control) bg-paper p-2 text-sm text-ink"><AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-coral" /> {f.text}</li>
            ))}
          </ul>
        )}
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          {[
            ['Licence number', v.licenceNumber], ['Name on licence', v.licenceHolderName], ['Licence expires', v.licenceExpiry], ['Licence held since', v.licenceHeldSince],
            ['Insurance', `${v.insuranceProvider || ''} ${v.insurancePolicyNo || ''}`], ['Insurance expires', v.insuranceExpiry], ['Covers passengers', v.insuranceCoversPassengers ? 'Yes' : 'No'],
            ['Vehicle', d.vehicle ? `${d.vehicle.colour} ${d.vehicle.makeModel}` : null], ['Typed plate number', d.vehicle?.plateNumber], ['Car belongs to', v.ownerRelationship],
            ...(v.driverType === 'external' ? [['ID last 4', v.nationalIdLast4], ['Good Conduct issued', v.goodConductIssued], ['PSV badge', `${v.psvBadgeNo || ''} (to ${v.psvBadgeExpiry || '?'})`], ['Inspection', `${v.inspectionDate || ''} by ${v.inspectedBy || ''}`]] : [['University ID expires', v.idExpiry]]),
          ].map(([k, val]) => (
            <div key={k}><dt className="text-ink/85">{k}</dt><dd className="font-medium text-ink">{val || 'Not given'}</dd></div>
          ))}
        </dl>
      </Panel>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>Documents side by side</SectionTitle>
          <Button size="sm" variant="secondary" isLoading={busy === 'docs'} onClick={loadDocs}>Load documents</Button>
        </div>
        <p className="text-xs text-ink/85">Each file opens through a link that works for 5 minutes. Every time you load them it is logged under your name.</p>
        {PAIRS.map(([a, b]) => (
          <div key={a} className="grid gap-3 sm:grid-cols-2">
            <Doc type={a} />
            <Doc type={b} />
          </div>
        ))}
        {byType.car_front_plate && d.vehicle && <p className="text-sm text-ink">Typed plate number: <strong>{d.vehicle.plateNumber}</strong>. Check it matches the plate in the photo above.</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          {['student_id', 'staff_id', 'national_id_front', 'national_id_back', 'insurance', 'logbook', 'owner_letter', 'car_interior', 'good_conduct', 'psv_badge', 'inspection_report'].filter((t) => byType[t]).map((t) => <Doc key={t} type={t} />)}
        </div>
      </section>

      {v.driverType === 'external' && waiting && (
        <Panel>
          <SectionTitle>In-person check at campus security</SectionTitle>
          <p className="mt-1 text-sm text-ink/85">{v.inPersonCheckedAt ? `Recorded: ${v.inPersonCheckedAt}, ${v.inPersonOfficer}.` : 'Required before an external driver can be approved.'}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <TextField label="Date" type="date" value={inPerson.date} onChange={(e) => setInPerson({ ...inPerson, date: e.target.value })} />
            <TextField label="Officer’s name" value={inPerson.officer} onChange={(e) => setInPerson({ ...inPerson, officer: e.target.value })} />
            <div className="flex items-end"><Button isLoading={busy === 'inperson'} disabled={!inPerson.officer} onClick={() => act('inperson', () => api.adminInPerson(driverId, inPerson))}>Record check</Button></div>
          </div>
        </Panel>
      )}

      {waiting && (
        <section className="space-y-3">
          <SectionTitle>Checklist</SectionTitle>
          <ul className="space-y-2">
            {d.checklist.map((c) => (
              <li key={c.item} className="rounded-(--radius-control) border border-ink/20 bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{ITEM_LABEL[c.item] || c.item}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant={c.result === 'pass' ? 'primary' : 'secondary'} aria-pressed={c.result === 'pass'} onClick={() => act(c.item, () => api.adminVerificationCheck(driverId, { item: c.item, result: 'pass', note: note[c.item] || undefined }))}><Check size={14} aria-hidden /> Pass</Button>
                    <Button size="sm" variant={c.result === 'fail' ? 'danger' : 'secondary'} aria-pressed={c.result === 'fail'} onClick={() => act(c.item, () => api.adminVerificationCheck(driverId, { item: c.item, result: 'fail', note: note[c.item] || undefined }))}><X size={14} aria-hidden /> Fail</Button>
                  </div>
                </div>
                <input aria-label={`Note for ${ITEM_LABEL[c.item] || c.item}`} placeholder="Note (optional)" value={note[c.item] ?? c.note ?? ''} onChange={(e) => setNote({ ...note, [c.item]: e.target.value })} className="mt-2 block h-10 w-full rounded-(--radius-control) border border-ink/25 bg-paper px-3 text-sm" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <SectionTitle>Decision</SectionTitle>
        {waiting && (
          <div className="space-y-3">
            <TextField label="Reason (required to reject, and shown to the driver)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            <div className="flex flex-wrap gap-2">
              <Button isLoading={busy === 'approve'} disabled={!allPass} onClick={() => act('approve', () => api.adminApproveVerification(driverId))}>Approve</Button>
              <Button variant="danger" isLoading={busy === 'reject'} disabled={reason.trim().length < 5} onClick={() => act('reject', () => api.adminRejectVerification(driverId, reason))}>Reject</Button>
            </div>
            {!allPass && <p className="text-xs text-ink/85">Approve unlocks when every checklist item is marked Pass.</p>}
            {d.needsSeniorAdmin && <p className="text-xs text-ink/85">External drivers can only be approved by a senior administrator.</p>}
          </div>
        )}
        {v.status === 'approved' && (
          <div className="space-y-3">
            <TextField label="Reason for suspending" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            <Button variant="danger" isLoading={busy === 'suspend'} disabled={reason.trim().length < 5} onClick={() => act('suspend', () => api.adminSuspendVerification(driverId, reason))}>Suspend driver</Button>
          </div>
        )}
        {v.status === 'suspended' && (
          <div className="space-y-2">
            <p className="text-sm text-ink">Suspended: {v.suspendedReason}</p>
            <Button isLoading={busy === 'reinstate'} onClick={() => act('reinstate', () => api.adminReinstateVerification(driverId))}>Reinstate</Button>
          </div>
        )}
        {!waiting && !['approved', 'suspended'].includes(v.status) && <p className="text-sm text-ink/85">Nothing to decide: this driver is {STATUS[v.status].toLowerCase()}.{v.rejectionReason ? ` Reason given: ${v.rejectionReason}` : ''}</p>}
      </section>
    </div>
  )
}
