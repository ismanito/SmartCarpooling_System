import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField } from '../components/ui/Field.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { loginSchema } from '../lib/schemas.js'
import { firebaseMessage } from '../lib/firebaseErrors.js'
import { useAuth } from '../context/AuthContext.jsx'

export default function Login() {
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
      <PageTitle className="mb-6">Welcome back</PageTitle>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field
          label="Email"
          hint="The email you signed up with"
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
        <Link to="/signup" className="text-ink underline underline-offset-4">
          Create one
        </Link>
      </p>
    </Panel>
  )
}
