import { useState } from 'react'
import { Link } from 'react-router'
import { BadgeCheck, Copy } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { TextField } from '../components/ui/Field.jsx'
import { Alert, PageTitle, Panel } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { Logo } from '../components/layout/Logo.jsx'
import { useLive } from '../hooks/useLive.js'
import { api, setApplicantToken } from '../lib/api.js'
import DriverVerification from './DriverVerification.jsx'

const KEY = 'ridemate.application'
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
}
const save = (v) => {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v))
    else localStorage.removeItem(KEY)
  } catch {
    /* the reference code on screen still works for this visit */
  }
}

/**
 * Where an external driver (not a student or staff member) registers. No account is needed: they fill in the same
 * details and documents, the RideMate team reviews them, and only an approved applicant may then create an account.
 */
export default function ApplyDriver() {
  const [app, setApp] = useState(() => {
    const saved = load()
    if (saved?.token) setApplicantToken(saved.token)
    return saved
  })
  const sign = (next) => {
    setApplicantToken(next?.token || null)
    save(next)
    setApp(next)
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8">
      <Logo to="/login" />
      {app?.token ? <Application app={app} onForget={() => sign(null)} /> : <Start onStarted={sign} />}
    </main>
  )
}

function Start({ onStarted }) {
  const [form, setForm] = useState({ fullName: '', email: '', phoneNumber: '' })
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { token } = await api.startApplication({ ...form, email: form.email.trim().toLowerCase() })
      onStarted({ token, fullName: form.fullName, email: form.email.trim().toLowerCase(), fresh: true })
    } catch (err) {
      setError(err.details?.length ? err.details.map((d) => d.message).join(' ') : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Panel>
        <PageTitle className="mb-2">Apply to drive</PageTitle>
        <p className="mb-5 text-sm text-ink/85">
          For drivers who are not USIU students or staff. Tell us who you are, then upload your documents. The RideMate team checks everything, including a visit in person, before you can create a driver account. Students and staff drivers do not need this page: they sign up with their university email and apply from inside the app.
        </p>
        {error && <Alert tone="error">{error}</Alert>}
        <form onSubmit={submit} className="space-y-4">
          <TextField label="Full name" hint="As on your ID and driving licence" value={form.fullName} onChange={set('fullName')} required />
          <TextField label="Email" type="email" hint="You will use this same email to create your account once approved" value={form.email} onChange={set('email')} required />
          <TextField label="Phone number" hint="Kenyan number, e.g. 0712 345 678" value={form.phoneNumber} onChange={set('phoneNumber')} required />
          <Button type="submit" fullWidth isLoading={busy}>Start my application</Button>
        </form>
      </Panel>
      <Panel>
        <p className="mb-2 font-medium text-ink">Already applied?</p>
        <p className="mb-3 text-sm text-ink/85">Enter the reference code you were given to continue or check the decision.</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim()) onStarted({ token: code.trim().toUpperCase(), fullName: '', email: '' })
          }}
        >
          <input aria-label="Reference code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="RM-XXXXX-XXXXX-XXXXX-XXXXX" className="h-11 w-full rounded-(--radius-control) border border-ink/30 bg-surface px-3 text-base" />
          <Button type="submit" variant="secondary">Open</Button>
        </form>
      </Panel>
      <p className="text-center text-sm text-ink/85">
        Have an account? <Link to="/login" className="underline underline-offset-4">Log in</Link>
      </p>
    </>
  )
}

function Application({ app, onForget }) {
  const { data: v, error } = useLive(api.verification, { pollMs: 15000 })
  const [copied, setCopied] = useState(false)

  if (!v) {
    if (error) {
      return (
        <Panel>
          <Alert tone="error">{error}</Alert>
          <p className="mt-3 text-sm text-ink/85">If you already created your account, log in instead.</p>
          <div className="mt-3 flex gap-2">
            <Button to="/login">Log in</Button>
            <Button variant="secondary" onClick={onForget}>Use another code</Button>
          </div>
        </Panel>
      )
    }
    return <Spinner />
  }

  const reference = (
    <div className="space-y-1 rounded-(--radius-panel) border border-ink/25 bg-surface p-4">
      <p className="text-sm font-medium text-ink">Your reference code{app.fresh ? ': save it now' : ''}</p>
      <p className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-lg font-semibold tracking-wide text-ink-deep">{app.token}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(app.token)
              setCopied(true)
            } catch {
              /* the code is on screen */
            }
          }}
          className="focus-ring inline-flex items-center gap-1 rounded px-2 text-sm underline underline-offset-4"
        >
          <Copy size={14} aria-hidden /> {copied ? 'Copied' : 'Copy'}
        </button>
      </p>
      <p className="text-xs text-ink/85">You need it to come back to this application or see the decision. We cannot show it again. It is not a password for your future account.</p>
    </div>
  )

  if (v.status === 'approved') {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-(--radius-panel) bg-asphalt p-5 text-paper">
          <BadgeCheck size={28} aria-hidden className="shrink-0 text-gold" />
          <div className="space-y-2">
            <p className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">Application approved</p>
            <p className="text-sm text-paper/90">You can now create your RideMate driver account. Use {app.email ? <strong>{app.email}</strong> : 'the same email you applied with'}: your documents and approval are already attached to it.</p>
            <Button to="/signup/driver" className="bg-gold! text-asphalt!">Create my driver account</Button>
          </div>
        </div>
        {reference}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {reference}
      {v.status === 'pending_review' && <Alert tone="info">Your application is with the RideMate team. Come back to this page with your reference code to see the decision. If it is approved you will be able to create your account.</Alert>}
      <DriverVerification applicant={{ fullName: app.fullName || '', email: app.email || '' }} title="Your application" />
    </div>
  )
}
