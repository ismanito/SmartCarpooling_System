import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Clock, ShieldCheck, ShieldX } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField } from '../components/ui/Field.jsx'
import { Alert, PageTitle, Panel } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { formatWhen, useLiveList } from '../components/rides/RideBits.jsx'

/** What a driver sees until an admin approves them: where their application stands, and how to fix it if rejected. */
export default function DriverApplication() {
  const { profile, reloadProfile } = useAuth()
  const load = useCallback(() => api.driverApplication().then((r) => r.application), [])
  const { items: app, error, reload } = useLiveList(load)

  const appStatus = app?.status
  const knownStatus = profile?.driverStatus
  useEffect(() => {
    if (appStatus && appStatus !== knownStatus) reloadProfile()
  }, [appStatus, knownStatus, reloadProfile])

  if (!app) return error ? <Alert tone="error">{error}</Alert> : <Spinner />
  const status = app.status

  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      <PageTitle>Driver application</PageTitle>
      {status === 'rejected' ? (
        <Panel className="border-coral">
          <p className="flex items-center gap-2 font-medium text-ink">
            <ShieldX size={20} aria-hidden /> Not approved
          </p>
          {app.adminNotes && <p className="mt-2 text-sm">Reason: {app.adminNotes}</p>}
          <p className="mt-2 text-sm text-ink/85">Fix your details below and send them again.</p>
        </Panel>
      ) : (
        <Panel>
          <p className="flex items-center gap-2 font-medium text-ink">
            <Clock size={20} aria-hidden /> Waiting for review
          </p>
          <p className="mt-2 text-sm text-ink/85">
            An admin is checking your details. You will get a notification and an email as soon as you are approved. Meanwhile you can{' '}
            <Link to="/vehicles" className="underline underline-offset-4">
              add your vehicle
            </Link>
            .
          </p>
        </Panel>
      )}
      {status === 'approved' && (
        <Panel>
          <p className="flex items-center gap-2 font-medium">
            <ShieldCheck size={20} aria-hidden /> Approved
          </p>
        </Panel>
      )}
      <Panel>
        <h2 className="mb-3 font-display text-2xl leading-none font-semibold tracking-wide uppercase">Your details</h2>
        {status === 'rejected' ? (
          <ReapplyForm
            app={app}
            onSent={async () => {
              await reloadProfile()
              await reload()
            }}
          />
        ) : (
          <dl className="space-y-2 text-sm">
            <Row label="Name" value={app.fullName} />
            <Row label="Email" value={app.email} />
            <Row label="Driving licence" value={app.licenceNumber} />
            <Row label="ID or passport" value={app.idNumber} />
            {app.about && <Row label="Notes" value={app.about} />}
            <Row label="Sent" value={formatWhen(app.createdAt)} />
          </dl>
        )}
      </Panel>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-ink/85">{label}</dt>
      <dd className="font-medium break-all">{value}</dd>
    </div>
  )
}

function ReapplyForm({ app, onSent }) {
  const [form, setForm] = useState({ licenceNumber: app.licenceNumber, idNumber: app.idNumber, about: app.about || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.reapplyDriver({ licenceNumber: form.licenceNumber, idNumber: form.idNumber, ...(form.about.trim() ? { about: form.about.trim() } : {}) })
      await onSent()
    } catch (err) {
      setError(err.details?.[0]?.message || err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label="Driving licence number" value={form.licenceNumber} onChange={(e) => setForm({ ...form, licenceNumber: e.target.value })} />
      <TextField label="National ID or passport number" value={form.idNumber} onChange={(e) => setForm({ ...form, idNumber: e.target.value })} />
      <Field label="Anything else we should know" optional>
        {({ aria }) => (
          <textarea {...aria} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} rows={3} maxLength={1000} className="block w-full rounded-(--radius-control) border border-ink/30 bg-surface p-3 text-base text-ink focus:outline-2 focus:outline-mint" />
        )}
      </Field>
      <Button type="submit" fullWidth isLoading={busy}>
        Apply again
      </Button>
    </form>
  )
}
