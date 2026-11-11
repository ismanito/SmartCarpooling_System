import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, BadgeCheck, CheckCircle2, Clock, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { Alert, PageTitle, Panel } from '../components/ui/Panel.jsx'
import { TextField } from '../components/ui/Field.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { LiveSelfie } from '../components/verification/LiveSelfie.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLive } from '../hooks/useLive.js'
import { api } from '../lib/api.js'

const TYPES = {
  student: { label: 'Student driver', text: 'You study at the university. We check your student ID.' },
  staff: { label: 'Staff driver', text: 'You work at the university. We check your staff ID.' },
  external: { label: 'External driver', text: 'You are not a student or staff (an alumnus, parent or community driver). This track has more checks, including an in-person check at campus security.' },
}

const yearsSince = (iso) => {
  const d = new Date(iso)
  const now = new Date()
  let y = now.getFullYear() - d.getFullYear()
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) y -= 1
  return y
}

/** The "Become a driver" page: shows where your verification stands, and walks you through it. */
export default function DriverVerification() {
  const { profile, reloadProfile } = useAuth()
  const { data: v, error, reload } = useLive(api.verification, { pollMs: 20000 })
  const refresh = useCallback(async () => {
    await reload()
    await reloadProfile()
  }, [reload, reloadProfile])

  if (!v) return error ? <Alert tone="error">{error}</Alert> : <Spinner />

  const wizard = !v.started || ['not_started', 'rejected', 'expired'].includes(v.status)
  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <PageTitle>Become a driver</PageTitle>
      {v.expiring?.length > 0 && v.status === 'approved' && (
        <Alert tone="info">
          {v.expiring.map((e) => `Your ${e.item.replace('_', ' ')} runs out on ${e.date}`).join('. ')}. Update it before then so you can keep driving.
        </Alert>
      )}
      {v.started && <StatusCard v={v} />}
      {wizard && <Wizard v={v} profile={profile} refresh={refresh} />}
      {v.status === 'approved' && v.recheckState === 'due' && <Recheck v={v} refresh={refresh} />}
      {v.status === 'approved' && v.recheckState === 'submitted' && <Alert tone="info">Your re-check is with the RideMate team. You can keep driving meanwhile.</Alert>}
    </div>
  )
}

// ---------------------------------------------------------------- where you stand

function StatusCard({ v }) {
  const t = TYPES[v.driverType]
  const base = 'flex items-start gap-3 rounded-(--radius-panel) p-4'
  if (v.status === 'approved') {
    return (
      <div className={`${base} bg-asphalt text-paper`}>
        <BadgeCheck size={28} aria-hidden className="shrink-0 text-gold" />
        <div>
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="rounded-(--radius-chip) bg-gold px-2 py-0.5 text-sm font-semibold text-asphalt">✓ Verified Driver</span> {t.label}
          </p>
          <p className="mt-1 text-sm text-paper/90">You can go online and take ride requests. Papers are re-checked every few months.</p>
          <p className="mt-2 flex flex-wrap gap-3 text-sm">
            <Link to="/drive" className="underline underline-offset-4">Go to the map</Link>
            <Link to="/drive/sticker" className="underline underline-offset-4">Print your windscreen sticker</Link>
          </p>
        </div>
      </div>
    )
  }
  if (v.status === 'pending_review') {
    return (
      <div className={`${base} border border-ink/25 bg-surface`}>
        <Clock size={26} aria-hidden className="shrink-0" />
        <div>
          <p className="font-medium text-ink">Pending review</p>
          <p className="text-sm text-ink/85">The RideMate team is checking your documents. You will get a notification and an email as soon as there is a decision. Nothing can be changed while it is being reviewed.</p>
        </div>
      </div>
    )
  }
  if (v.status === 'rejected') {
    return (
      <div className={`${base} border border-coral bg-surface`}>
        <AlertTriangle size={26} aria-hidden className="shrink-0" />
        <div>
          <p className="font-medium text-ink">Not approved</p>
          <p className="text-sm text-ink">Reason: {v.rejectionReason}</p>
          <p className="mt-1 text-sm text-ink/85">Fix the problem below and send it again.</p>
        </div>
      </div>
    )
  }
  if (v.status === 'expired') {
    return (
      <div className={`${base} border border-coral bg-surface`}>
        <AlertTriangle size={26} aria-hidden className="shrink-0" />
        <div>
          <p className="font-medium text-ink">Expired</p>
          <p className="text-sm text-ink/85">A document or your university access has run out, so you are offline. Update your documents below and send them in again.</p>
        </div>
      </div>
    )
  }
  if (v.status === 'suspended') {
    return (
      <div className={`${base} border border-error bg-surface`}>
        <AlertTriangle size={26} aria-hidden className="shrink-0 text-error" />
        <div>
          <p className="font-medium text-ink">Suspended</p>
          <p className="text-sm text-ink">{v.suspendedReason}</p>
          <p className="mt-1 text-sm text-ink/85">Contact the RideMate team if you think this is a mistake.</p>
        </div>
      </div>
    )
  }
  return null
}

// ---------------------------------------------------------------- one upload slot

function DocSlot({ label, docType, v, refresh, hint, accept = 'image/jpeg,image/png,application/pdf', after }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const have = v.uploaded?.find((u) => u.docType === docType)
  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await api.uploadVerificationDoc(docType, file, false)
      await refresh()
      after?.()
    } catch (err) {
      setError(err.details?.[0]?.message || err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="rounded-(--radius-control) border border-ink/20 bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">{label}</p>
          {hint && <p className="text-xs text-ink/85">{hint}</p>}
        </div>
        {have ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-ink"><CheckCircle2 size={16} aria-hidden className="text-mint" /> Uploaded</span>
        ) : (
          <span className="text-xs text-ink/85">Required</span>
        )}
      </div>
      <label className="focus-within:outline-2 focus-within:outline-mint mt-2 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-(--radius-control) border border-ink/40 bg-paper px-3 text-sm font-medium text-ink hover:border-ink">
        <Upload size={16} aria-hidden /> {busy ? 'Uploading…' : have ? 'Replace file' : 'Choose a photo or PDF'}
        <input type="file" accept={accept} onChange={onFile} disabled={busy} className="sr-only" aria-label={`${label}: choose a file`} />
      </label>
      {error && <p role="alert" className="mt-1 text-sm text-error">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- the steps

function Wizard({ v, profile, refresh }) {
  const type = v.started ? v.driverType : profile.personType === 'staff' ? 'staff' : profile.role === 'driver' ? 'external' : 'student'
  const steps = ['intro', 'identity', 'licence', 'selfie', 'vehicle', 'insurance', ...(type === 'external' ? ['external'] : []), 'review']
  const [i, setI] = useState(v.consent ? 1 : 0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState(() => ({
    driverType: type,
    consent: Boolean(v.consent),
    publicPhotoConsent: Boolean(v.publicPhotoConsent),
    idExpiry: v.idExpiry || '',
    nationalId: '',
    licenceNumber: v.licenceNumber || '',
    licenceHolderName: v.licenceHolderName || profile.fullName,
    licenceExpiry: v.licenceExpiry || '',
    licenceHeldSince: v.licenceHeldSince || '',
    vehicleId: v.vehicleId || '',
    ownerRelationship: v.ownerRelationship || 'self',
    insuranceProvider: v.insuranceProvider || '',
    insurancePolicyNo: v.insurancePolicyNo || '',
    insuranceExpiry: v.insuranceExpiry || '',
    insuranceCoversPassengers: Boolean(v.insuranceCoversPassengers),
    goodConductIssued: v.goodConductIssued || '',
    psvBadgeNo: v.psvBadgeNo || '',
    psvBadgeExpiry: v.psvBadgeExpiry || '',
    inspectionDate: v.inspectionDate || '',
    inspectedBy: v.inspectedBy || '',
  }))
  const set = (k, val) => setF((x) => ({ ...x, [k]: val }))
  const step = steps[i]
  const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, x]) => x !== '' && x !== undefined))

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (err) {
      setError(err.details?.length ? err.details.map((d) => d.message).join(' ') : err.message)
      return false
    } finally {
      setBusy(false)
    }
  }
  const next = () => setI((n) => Math.min(n + 1, steps.length - 1))
  const saveAndNext = (fields) => async () => {
    const ok = await run(async () => {
      const body = clean(fields)
      if (Object.keys(body).length > 0) await api.saveVerificationDetails(body)
      await refresh()
    })
    if (ok) next()
  }

  const heldYears = f.licenceHeldSince ? yearsSince(f.licenceHeldSince) : null
  const tooNew = heldYears !== null && heldYears < v.minLicenceYears
  const ownershipDoc = f.ownerRelationship === 'self' ? 'logbook' : 'owner_letter'

  return (
    <Panel>
      <ol aria-label="Steps" className="mb-4 flex gap-1">
        {steps.map((s, n) => (
          <li key={s} aria-current={n === i ? 'step' : undefined} className={`h-1.5 flex-1 rounded-full ${n < i ? 'bg-mint' : n === i ? 'bg-ink' : 'bg-ink/15'}`} />
        ))}
      </ol>
      <p className="mb-3 text-xs font-medium tracking-wider text-ink/85 uppercase">Step {i + 1} of {steps.length}</p>
      {error && <Alert tone="error">{error}</Alert>}

      {step === 'intro' && (
        <div className="space-y-4">
          <h2 className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">Before you start</h2>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-ink">What kind of driver are you?</legend>
            {Object.entries(TYPES).map(([id, t]) => {
              const allowed = id === 'external' ? v.externalEnabled && profile.role !== 'admin' : id === type
              return (
                <label key={id} className={`flex cursor-pointer gap-3 rounded-(--radius-control) border p-3 ${f.driverType === id ? 'border-ink bg-paper' : 'border-ink/25'} ${allowed ? '' : 'opacity-50'}`}>
                  <input type="radio" name="driverType" value={id} checked={f.driverType === id} disabled={!allowed} onChange={() => set('driverType', id)} className="mt-1 size-5" />
                  <span>
                    <span className="block font-medium text-ink">{t.label}{id === 'external' && !v.externalEnabled ? ' (not open yet)' : ''}</span>
                    <span className="block text-sm text-ink/85">{t.text}</span>
                  </span>
                </label>
              )
            })}
          </fieldset>
          <div className="rounded-(--radius-control) bg-paper p-3 text-sm text-ink">
            <p className="font-medium">What we collect, and why</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Your ID, driving licence, insurance, vehicle papers and photos, and a live selfie, to check you are who you say you are and that you may drive passengers.</li>
              <li>Only RideMate administrators can open them, each time through a link that works for 5 minutes. Every view is logged.</li>
              <li>The files are deleted {v.retentionDays} days after you are approved (30 days if you are not). We keep the hashes, dates and the checklist result.</li>
              <li>We keep only the last 4 digits of a national ID number, never the whole number.</li>
            </ul>
          </div>
          <label className="flex min-h-11 items-start gap-3 text-sm text-ink">
            <input type="checkbox" checked={f.consent} onChange={(e) => set('consent', e.target.checked)} className="mt-0.5 size-5" /> I have read this and agree to RideMate collecting and checking these documents.
          </label>
          <label className="flex min-h-11 items-start gap-3 text-sm text-ink">
            <input type="checkbox" checked={f.publicPhotoConsent} onChange={(e) => set('publicPhotoConsent', e.target.checked)} className="mt-0.5 size-5" /> Show my selfie on my public “Verified driver” page (the one on the windscreen sticker). Optional.
          </label>
          <Button fullWidth disabled={!f.consent} isLoading={busy} onClick={async () => { if (await run(async () => { await api.startVerification({ driverType: f.driverType, consent: true, publicPhotoConsent: f.publicPhotoConsent }); await refresh() })) next() }}>
            Agree and continue
          </Button>
        </div>
      )}

      {step === 'identity' && (
        <div className="space-y-4">
          <h2 className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">Your identity</h2>
          {type === 'student' && <DocSlot label="Student ID, front" docType="student_id" v={v} refresh={refresh} hint="A clear photo of the front" />}
          {type === 'staff' && <DocSlot label="Staff ID, front" docType="staff_id" v={v} refresh={refresh} hint="A clear photo of the front" />}
          {type !== 'external' && <TextField label="ID expiry date" type="date" value={f.idExpiry} onChange={(e) => set('idExpiry', e.target.value)} />}
          {type === 'external' && (
            <>
              <DocSlot label="National ID or passport, front" docType="national_id_front" v={v} refresh={refresh} />
              <DocSlot label="National ID or passport, back" docType="national_id_back" v={v} refresh={refresh} />
              <TextField label="ID or passport number" hint="We keep only the last 4 characters" value={f.nationalId} onChange={(e) => set('nationalId', e.target.value)} autoComplete="off" />
            </>
          )}
          <Nav back={() => setI(i - 1)} next={saveAndNext({ idExpiry: type !== 'external' ? f.idExpiry : '', nationalId: type === 'external' ? f.nationalId : '' })} busy={busy} />
        </div>
      )}

      {step === 'licence' && (
        <div className="space-y-4">
          <h2 className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">Driving licence</h2>
          <DocSlot label="Licence, front" docType="licence_front" v={v} refresh={refresh} />
          <DocSlot label="Licence, back" docType="licence_back" v={v} refresh={refresh} />
          <TextField label="Licence number" value={f.licenceNumber} onChange={(e) => set('licenceNumber', e.target.value)} autoComplete="off" />
          <TextField label="Name as printed on the licence" value={f.licenceHolderName} onChange={(e) => set('licenceHolderName', e.target.value)} />
          <TextField label="Licence expiry date" type="date" value={f.licenceExpiry} onChange={(e) => set('licenceExpiry', e.target.value)} />
          <TextField label="Licence held since" type="date" value={f.licenceHeldSince} onChange={(e) => set('licenceHeldSince', e.target.value)} max={new Date().toISOString().slice(0, 10)} />
          {tooNew && <Alert tone="error">You need to have held your licence for at least {v.minLicenceYears} year{v.minLicenceYears === 1 ? '' : 's'} to drive passengers. You have held it for {heldYears}.</Alert>}
          <Nav back={() => setI(i - 1)} next={saveAndNext({ licenceNumber: f.licenceNumber, licenceHolderName: f.licenceHolderName, licenceExpiry: f.licenceExpiry, licenceHeldSince: f.licenceHeldSince })} busy={busy} disabled={tooNew} />
        </div>
      )}

      {step === 'selfie' && (
        <div className="space-y-4">
          <h2 className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">A live selfie</h2>
          <p className="text-sm text-ink/85">Two quick photos from your camera: one looking straight at it, one with your head turned slightly. They must be taken now, not picked from your gallery.</p>
          {v.uploaded?.some((u) => u.docType === 'selfie') && v.uploaded?.some((u) => u.docType === 'selfie_head_turn') ? (
            <p className="inline-flex items-center gap-2 text-sm font-medium text-ink"><CheckCircle2 size={16} aria-hidden className="text-mint" /> Selfies uploaded. You can retake them below.</p>
          ) : null}
          <LiveSelfie
            busy={busy}
            prompts={['Look straight at the camera', 'Now turn your head slightly to one side']}
            onDone={async (files) => {
              await run(async () => {
                await api.uploadVerificationDoc('selfie', files[0], true)
                await api.uploadVerificationDoc('selfie_head_turn', files[1], true)
                await refresh()
              })
            }}
          />
          <Nav back={() => setI(i - 1)} next={next} busy={busy} disabled={!(v.uploaded?.some((u) => u.docType === 'selfie') && v.uploaded?.some((u) => u.docType === 'selfie_head_turn'))} />
        </div>
      )}

      {step === 'vehicle' && <VehicleStep v={v} f={f} set={set} refresh={refresh} ownershipDoc={ownershipDoc} back={() => setI(i - 1)} next={saveAndNext({ vehicleId: f.vehicleId, ownerRelationship: f.ownerRelationship })} busy={busy} />}

      {step === 'insurance' && (
        <div className="space-y-4">
          <h2 className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">Insurance</h2>
          <DocSlot label="Insurance certificate" docType="insurance" v={v} refresh={refresh} />
          <TextField label="Insurance company" value={f.insuranceProvider} onChange={(e) => set('insuranceProvider', e.target.value)} />
          <TextField label="Policy number" value={f.insurancePolicyNo} onChange={(e) => set('insurancePolicyNo', e.target.value)} autoComplete="off" />
          <TextField label="Expiry date" type="date" value={f.insuranceExpiry} onChange={(e) => set('insuranceExpiry', e.target.value)} />
          <label className="flex min-h-11 items-start gap-3 text-sm text-ink">
            <input type="checkbox" checked={f.insuranceCoversPassengers} onChange={(e) => set('insuranceCoversPassengers', e.target.checked)} className="mt-0.5 size-5" /> My cover includes passengers.
          </label>
          <p className="text-sm text-ink/85">Make sure your cover includes passengers. Ordinary private cover often does not when you carry people for a shared fare.</p>
          <Nav back={() => setI(i - 1)} next={saveAndNext({ insuranceProvider: f.insuranceProvider, insurancePolicyNo: f.insurancePolicyNo, insuranceExpiry: f.insuranceExpiry, insuranceCoversPassengers: f.insuranceCoversPassengers })} busy={busy} />
        </div>
      )}

      {step === 'external' && (
        <div className="space-y-4">
          <h2 className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">Extra checks for external drivers</h2>
          <DocSlot label="Certificate of Good Conduct (DCI)" docType="good_conduct" v={v} refresh={refresh} hint="Issued in the last 6 months" />
          <TextField label="Certificate issue date" type="date" value={f.goodConductIssued} onChange={(e) => set('goodConductIssued', e.target.value)} />
          <DocSlot label="PSV badge / NTSA driver authorisation" docType="psv_badge" v={v} refresh={refresh} />
          <TextField label="Badge number" value={f.psvBadgeNo} onChange={(e) => set('psvBadgeNo', e.target.value)} />
          <TextField label="Badge expiry date" type="date" value={f.psvBadgeExpiry} onChange={(e) => set('psvBadgeExpiry', e.target.value)} />
          <DocSlot label="Vehicle inspection report" docType="inspection_report" v={v} refresh={refresh} />
          <TextField label="Inspection date" type="date" value={f.inspectionDate} onChange={(e) => set('inspectionDate', e.target.value)} />
          <TextField label="Inspected by" value={f.inspectedBy} onChange={(e) => set('inspectedBy', e.target.value)} />
          <p className="text-sm text-ink/85">You will also be asked to come to campus security for an in-person check before you can be approved. Your insurance must be commercial (PSV or private-hire) cover that includes passengers.</p>
          <Nav back={() => setI(i - 1)} next={saveAndNext({ goodConductIssued: f.goodConductIssued, psvBadgeNo: f.psvBadgeNo, psvBadgeExpiry: f.psvBadgeExpiry, inspectionDate: f.inspectionDate, inspectedBy: f.inspectedBy })} busy={busy} />
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <h2 className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">Review and submit</h2>
          {v.missing?.length > 0 ? (
            <div className="rounded-(--radius-control) border border-coral p-3">
              <p className="text-sm font-medium text-ink">Still needed before you can submit:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink">
                {v.missing.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          ) : (
            <p className="inline-flex items-center gap-2 text-sm font-medium text-ink"><CheckCircle2 size={18} aria-hidden className="text-mint" /> Everything is in. Send it to the RideMate team for review.</p>
          )}
          <p className="text-sm text-ink/85">After you submit, you cannot change anything until the team has decided. They normally reply within a few days.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setI(i - 1)}>Back</Button>
            <Button fullWidth disabled={v.missing?.length > 0} isLoading={busy} onClick={() => run(async () => { await api.submitVerification(); await refresh() })}>Submit for review</Button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function Nav({ back, next, busy, disabled }) {
  return (
    <div className="flex gap-2">
      <Button variant="secondary" onClick={back}>Back</Button>
      <Button fullWidth isLoading={busy} disabled={disabled} onClick={next}>Save and continue</Button>
    </div>
  )
}

function VehicleStep({ v, f, set, refresh, ownershipDoc, back, next, busy }) {
  const { data: vehicles, reload } = useLive(useCallback(() => api.listVehicles().then((r) => r.vehicles), []), { pollMs: 60000 })
  const [adding, setAdding] = useState(false)
  const [nv, setNv] = useState({ makeModel: '', plateNumber: '', colour: '', seatCapacity: 3 })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (vehicles && !f.vehicleId && vehicles.length === 1) set('vehicleId', vehicles[0].vehicleId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles])

  const add = async () => {
    setSaving(true)
    setError(null)
    try {
      const { vehicle } = await api.createVehicle({ ...nv, seatCapacity: Number(nv.seatCapacity) })
      await reload()
      set('vehicleId', vehicle.vehicleId)
      setAdding(false)
    } catch (err) {
      setError(err.details?.[0]?.message || err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">Your vehicle</h2>
      {!vehicles ? <Spinner /> : (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-ink">Which car will you drive?</legend>
          {vehicles.map((x) => (
            <label key={x.vehicleId} className={`flex cursor-pointer items-center gap-3 rounded-(--radius-control) border p-3 text-sm ${f.vehicleId === x.vehicleId ? 'border-ink bg-paper' : 'border-ink/25'}`}>
              <input type="radio" name="vehicle" checked={f.vehicleId === x.vehicleId} onChange={() => set('vehicleId', x.vehicleId)} className="size-5" />
              <span>{x.colour} {x.makeModel} · {x.plateNumber} · {x.seatCapacity} seat{x.seatCapacity === 1 ? '' : 's'}</span>
            </label>
          ))}
          {!adding && <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>Add a vehicle</Button>}
        </fieldset>
      )}
      {adding && (
        <div className="space-y-3 rounded-(--radius-control) bg-paper p-3">
          {error && <Alert tone="error">{error}</Alert>}
          <TextField label="Make and model" value={nv.makeModel} onChange={(e) => setNv({ ...nv, makeModel: e.target.value })} placeholder="Toyota Axio" />
          <TextField label="Number plate" value={nv.plateNumber} onChange={(e) => setNv({ ...nv, plateNumber: e.target.value })} placeholder="KDA 123A" />
          <TextField label="Colour" value={nv.colour} onChange={(e) => setNv({ ...nv, colour: e.target.value })} />
          <TextField label="Passenger seats" type="number" min="1" max="7" value={nv.seatCapacity} onChange={(e) => setNv({ ...nv, seatCapacity: e.target.value })} />
          <div className="flex gap-2">
            <Button size="sm" isLoading={saving} onClick={add}>Save vehicle</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}
      <DocSlot label="Front of the car, number plate visible" docType="car_front_plate" v={v} refresh={refresh} hint="The plate must be readable. We compare it with the number you typed." />
      <DocSlot label="Back of the car" docType="car_back" v={v} refresh={refresh} />
      <DocSlot label="Inside the car" docType="car_interior" v={v} refresh={refresh} />
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">Whose car is it?</legend>
        <div className="flex flex-wrap gap-2">
          {[['self', 'Mine'], ['parent', 'A parent’s'], ['other', 'Someone else’s']].map(([id, label]) => (
            <label key={id} className={`focus-within:outline-2 focus-within:outline-mint inline-flex min-h-11 cursor-pointer items-center rounded-(--radius-control) border px-3 text-sm font-medium ${f.ownerRelationship === id ? 'border-ink bg-ink text-gold' : 'border-ink/30 text-ink'}`}>
              <input type="radio" name="owner" className="sr-only" checked={f.ownerRelationship === id} onChange={() => set('ownerRelationship', id)} /> {label}
            </label>
          ))}
        </div>
      </fieldset>
      <DocSlot label={ownershipDoc === 'logbook' ? 'Logbook' : 'Letter from the owner giving permission'} docType={ownershipDoc} v={v} refresh={refresh} />
      <Nav back={back} next={next} busy={busy} disabled={!f.vehicleId} />
    </div>
  )
}

// ---------------------------------------------------------------- the periodic re-check

function Recheck({ v, refresh }) {
  const [camera, setCamera] = useState(false)
  const [d, setD] = useState({ licenceExpiry: v.licenceExpiry || '', insuranceExpiry: v.insuranceExpiry || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.saveVerificationDetails({ licenceExpiry: d.licenceExpiry, insuranceExpiry: d.insuranceExpiry })
      await api.submitVerification()
      await refresh()
    } catch (err) {
      setError(err.details?.map((x) => x.message).join(' ') || err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel className="border-coral">
      <h2 className="font-display text-2xl leading-none font-semibold tracking-wide uppercase">Time for your re-check</h2>
      <p className="mt-1 mb-3 text-sm text-ink">
        Upload your licence, insurance and a fresh selfie by {new Date(v.recheckGraceUntil).toLocaleDateString()}. You can keep driving until then.
        {v.rejectionReason ? ` Last time: ${v.rejectionReason}` : ''}
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="space-y-3">
        <DocSlot label="Licence, front" docType="licence_front" v={v} refresh={refresh} />
        <DocSlot label="Licence, back" docType="licence_back" v={v} refresh={refresh} />
        <DocSlot label="Insurance certificate" docType="insurance" v={v} refresh={refresh} />
        <TextField label="Licence expiry date" type="date" value={d.licenceExpiry} onChange={(e) => setD({ ...d, licenceExpiry: e.target.value })} />
        <TextField label="Insurance expiry date" type="date" value={d.insuranceExpiry} onChange={(e) => setD({ ...d, insuranceExpiry: e.target.value })} />
        {camera ? (
          <LiveSelfie
            prompts={['Look straight at the camera', 'Now turn your head slightly']}
            onCancel={() => setCamera(false)}
            onDone={async (files) => {
              await api.uploadVerificationDoc('selfie', files[0], true)
              await api.uploadVerificationDoc('selfie_head_turn', files[1], true)
              setCamera(false)
              await refresh()
            }}
          />
        ) : (
          <Button variant="secondary" onClick={() => setCamera(true)}>Take a new selfie</Button>
        )}
        <Button fullWidth isLoading={busy} onClick={submit}>Send for re-check</Button>
      </div>
    </Panel>
  )
}
