import { useState } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField } from '../components/ui/Field.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { loginSchema } from '../lib/schemas.js'
import { firebaseMessage } from '../lib/firebaseErrors.js'
import { useAuth } from '../context/AuthContext.jsx'

const PORTALS = [
  { id: 'student', label: 'Student / staff', heading: 'Student or staff sign in', hint: 'Your university email' },
  { id: 'driver', label: 'Driver', heading: 'Driver sign in', hint: 'The email you applied with' },
  { id: 'admin', label: 'Admin', heading: 'Administrator sign in', hint: 'Your administrator email' },
]

export default function Login() {
  const [params, setParams] = useSearchParams()
  const portal = PORTALS.find((p) => p.id === params.get('as')) || PORTALS[0]
  const navigate = useNavigate()
  const { logIn } = useAuth()
  const [serverError, setServerError] = useState(null)
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (data) => {
    setServerError(null)
    setIsLoading(true)
    try {
      const { verified } = await logIn(data.email, data.password)
      navigate(verified ? '/' : '/verify-email')
    } catch (err) {
      setServerError(err?.name === 'ApiError' ? err.message : firebaseMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Panel className="w-full max-w-md">
      <div role="tablist" aria-label="Account type" className="mb-5 flex gap-1 rounded-(--radius-control) bg-paper-deep p-1">
        {PORTALS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={portal.id === p.id}
            onClick={() => setParams(p.id === 'student' ? {} : { as: p.id }, { replace: true })}
            className={`focus-ring min-h-11 flex-1 rounded-(--radius-control) px-2 text-sm font-medium ${portal.id === p.id ? 'bg-ink text-gold' : 'text-ink hover:bg-ink/8'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <PageTitle className="mb-6">{portal.heading}</PageTitle>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field
          label="Email"
          hint={portal.hint}
          error={errors.email?.message}
        >
          {({ aria }) => (
            <TextField
              id="email"
              {...aria}
              {...register('email')}
              type="email"
              autoComplete="email"
              placeholder="name@usiu.ac.ke"
            />
          )}
        </Field>
        <Field label="Password" error={errors.password?.message}>
          {({ aria }) => (
            <TextField
              id="password"
              {...aria}
              {...register('password')}
              type="password"
              autoComplete="current-password"
            />
          )}
        </Field>
        <p className="text-right text-sm">
          <Link to="/forgot-password" className="text-ink underline underline-offset-4">
            Forgot your password?
          </Link>
        </p>
        <Button variant="primary" type="submit" fullWidth isLoading={isLoading} disabled={isLoading}>
          Sign in
        </Button>
      </form>
      <p className="text-sm text-center mt-6">
        Don't have an account?{' '}
        <Link to={`/signup/${portal.id}`} className="text-ink underline underline-offset-4">
          Create one
        </Link>
      </p>
    </Panel>
  )
}
