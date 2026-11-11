import { useState } from 'react'
import { useNavigate, Link, Navigate, useParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField } from '../components/ui/Field.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { signUpSchema } from '../lib/schemas.js'
import { useEmailKind } from '../hooks/useEmailKind.js'
import { api, ApiError } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { firebaseMessage } from '../lib/firebaseErrors.js'

// What each account type is, who may open one, and what to tell them.
export const ACCOUNT_TYPES = {
  student: {
    title: 'Student or staff',
    intro: 'Rides to and from campus. Use your university email.',
    placeholder: 'name@usiu.ac.ke',
    hint: 'Your university email address',
    allows: (kind) => kind === 'student',
    wrong: 'University email addresses are the only ones that can open a student or staff account.',
  },
  driver: {
    title: 'Driver',
    intro: 'Share a journey you are already making. Any email works, such as Gmail. The RideMate team checks your details before you can drive.',
    placeholder: 'name@gmail.com',
    hint: 'Any email except a university address. You verify it, then apply to drive.',
    allows: (kind, demo) => kind === 'driver' || (kind === 'student' && demo),
    wrong: 'University emails are for students and staff. Use a different email to apply as a driver.',
  },
  admin: {
    title: 'Administrator',
    intro: 'For the RideMate team. Only email addresses on the administrator list can sign up here.',
    placeholder: 'name@example.com',
    hint: 'The email address the RideMate team registered for you',
    allows: (kind) => kind === 'admin',
    wrong: 'This email is not on the administrator list.',
  },
}

export default function SignUp() {
  const { type } = useParams()
  const account = ACCOUNT_TYPES[type]
  if (!account) return <Navigate to="/signup" replace />
  return <SignUpForm type={type} account={account} />
}

function SignUpForm({ type, account }) {
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
  const mismatch = kind !== undefined && !account.allows(kind, demo)
  const kindHint = mismatch ? undefined : kind === undefined ? undefined : demo ? 'Demo account. No email check needed.' : 'We will email you a link to verify it.'

  const onSubmit = async (data) => {
    setServerError(null)
    setIsLoading(true)
    try {
      const check = await api.checkDomain(data.email)
      if (!account.allows(check.kind, check.demo)) {
        setServerError(account.wrong)
        return
      }
      try {
        sessionStorage.setItem('ridemate.accountType', type)
      } catch {
        /* the profile form falls back to what the email says */
      }
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
      <PageTitle className="mb-2">{account.title} account</PageTitle>
      <p className="mb-5 text-sm text-ink/85">{account.intro}</p>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field
          label="Email"
          hint={kindHint || account.hint}
          error={errors.email?.message || (mismatch ? account.wrong : undefined)}
        >
          {({ aria }) => (
            <TextField
              id="email"
              {...aria}
              {...register('email')}
              type="email"
              autoComplete="email"
              placeholder={account.placeholder}
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
        Wrong account type?{' '}
        <Link to="/signup" className="text-ink underline underline-offset-4">
          Choose again
        </Link>
        <br />
        Already have an account?{' '}
        <Link to="/login" className="text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </Panel>
  )
}
