import { useState } from 'react'
import { Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField } from '../components/ui/Field.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { resetSchema } from '../lib/schemas.js'
import { firebaseMessage } from '../lib/firebaseErrors.js'
import { emulatorResetPassword, usingAuthEmulator } from '../lib/firebase.js'
import { useAuth } from '../context/AuthContext.jsx'

export default function ForgotPassword() {
  const { sendReset } = useAuth()
  const [sentTo, setSentTo] = useState(null)
  const [serverError, setServerError] = useState(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(resetSchema), defaultValues: { email: '' } })

  const onSubmit = async ({ email }) => {
    setServerError(null)
    try {
      await sendReset(email)
      setSentTo(email)
    } catch (err) {
      // Same answer whether or not the account exists, so this page can't reveal who has signed up.
      if (err?.code === 'auth/user-not-found') setSentTo(email)
      else setServerError(firebaseMessage(err))
    }
  }

  return (
    <Panel className="w-full max-w-md">
      <PageTitle className="mb-6">Reset your password</PageTitle>
      {sentTo ? (
        <div className="space-y-3">
          <Alert tone="info">If {sentTo} has an account, a reset link is on its way. Open it to choose a new password.</Alert>
          {usingAuthEmulator && <LocalReset email={sentTo} />}
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {serverError && <Alert tone="error">{serverError}</Alert>}
          <Field label="University email" error={errors.email?.message}>
            {({ aria }) => <TextField {...aria} {...register('email')} type="email" autoComplete="email" placeholder="name@usiu.ac.ke" />}
          </Field>
          <Button type="submit" fullWidth isLoading={isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-ink underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </Panel>
  )
}

/** Local test mode only: no real email is sent, so choose the new password right here. */
function LocalReset({ email }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  if (done) {
    return (
      <Alert tone="info">
        Password changed. <Link to="/login" className="font-medium underline underline-offset-4">Sign in with the new password</Link>.
      </Alert>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    if (password.length < 8) return setError('Use at least 8 characters')
    setBusy(true)
    setError(null)
    try {
      await emulatorResetPassword(email, password)
      setDone(true)
    } catch (err) {
      setError(firebaseMessage(err) || err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-(--radius-control) bg-paper p-3" noValidate>
      <p className="text-sm text-ink">Local test mode sends no real email, so choose the new password here.</p>
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button type="submit" fullWidth isLoading={busy}>
        Set new password
      </Button>
    </form>
  )
}
