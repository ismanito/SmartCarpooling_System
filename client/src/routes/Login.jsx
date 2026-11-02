import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField } from '../components/ui/Field.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { loginSchema } from '../lib/schemas.js'
import { firebaseMessage } from '../lib/firebaseErrors.js'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { getFirebaseAuth } from '../lib/firebase.js'

export default function Login() {
  const navigate = useNavigate()
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
      await signInWithEmailAndPassword(getFirebaseAuth(), data.email, data.password)
      navigate('/')
    } catch (err) {
      setServerError(firebaseMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Panel className="w-full max-w-md mx-auto mt-10">
      <PageTitle className="mb-6">Welcome back</PageTitle>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field
          label="University email"
          hint="Sign in with your university email address"
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
