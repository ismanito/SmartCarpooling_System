import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField } from '../components/ui/Field.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { signUpSchema } from '../lib/schemas.js'
import { useEmailKind } from '../hooks/useEmailKind.js'
import { ApiError } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { firebaseMessage } from '../lib/firebaseErrors.js'

export default function SignUp() {
  const navigate = useNavigate()
  const { signUp } = useAuth()
  const [serverError, setServerError] = useState(null)
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  })

  const { kind, demo } = useEmailKind(watch('email'))
  const kindHint = {
    student: demo ? 'Demo student account. No email check needed.' : 'Student account. We will email you a link to verify it.',
    driver: 'Driver application. Verify this email, then an admin reviews your details before you can drive.',
    admin: 'Admin account.',
  }[kind]

  const onSubmit = async (data) => {
    setServerError(null)
    setIsLoading(true)
    try {
      const { verified } = await signUp(data.email, data.password)
      navigate(verified ? '/onboarding' : '/verify-email')
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message)
      } else {
        setServerError(firebaseMessage(err))
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Panel className="w-full max-w-md">
      <PageTitle className="mb-6">Create account</PageTitle>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field
          label="Email"
          hint={kindHint || 'Students: your university email. Drivers: any email, such as Gmail.'}
          error={errors.email?.message}
        >
          {({ aria }) => (
            <TextField
              id="email"
              {...aria}
              {...register('email')}
              type="email"
              autoComplete="email"
              placeholder="name@usiu.ac.ke or name@gmail.com"
            />
          )}
        </Field>
        <Field
          label="Password"
          hint="At least 8 characters"
          error={errors.password?.message}
        >
          {({ aria }) => (
            <TextField
              id="password"
              {...aria}
              {...register('password')}
              type="password"
              autoComplete="new-password"
            />
          )}
        </Field>
        <Field
          label="Confirm password"
          hint="Re-enter your password"
          error={errors.confirmPassword?.message}
        >
          {({ aria }) => (
            <TextField
              id="confirmPassword"
              {...aria}
              {...register('confirmPassword')}
              type="password"
              autoComplete="new-password"
            />
          )}
        </Field>
        <Button variant="primary" type="submit" fullWidth isLoading={isLoading} disabled={isLoading}>
          Create account
        </Button>
      </form>
      <p className="text-sm text-center mt-6">
        Already have an account?{' '}
        <Link to="/login" className="text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </Panel>
  )
}
