import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField, SelectField } from '../components/ui/Field.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { profileSchema } from '../lib/schemas.js'
import { applyFieldErrors } from '../lib/api.js'
import { ApiError } from '../lib/api.js'
import { FACULTIES } from '../constants/faculties.js'
import { useAuth } from '../context/AuthContext.jsx'

export default function Onboarding() {
  const { createProfile } = useAuth()
  const [serverError, setServerError] = useState(null)
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: '', phoneNumber: '', faculty: '' },
  })

  const onSubmit = async (data) => {
    setServerError(null)
    setIsLoading(true)
    try {
      await createProfile(data)
      navigate('/')
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setServerError(err?.message || 'Something went wrong. Please try again.')
      } else if (!applyFieldErrors(err, setError)) {
        setServerError(err.message || 'Something went wrong. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Panel className="w-full max-w-md mx-auto mt-10">
      <PageTitle className="mb-6">Complete your profile</PageTitle>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field
          label="Full name"
          hint="As it appears on your university records"
          error={errors.fullName?.message}
        >
          {({ aria }) => (
            <TextField
              id="fullName"
              {...aria}
              {...register('fullName')}
              autoComplete="name"
              placeholder="Jane Doe"
            />
          )}
        </Field>
        <Field
          label="Phone number"
          hint="Kenyan number, e.g. 0712 345 678"
          error={errors.phoneNumber?.message}
        >
          {({ aria }) => (
            <TextField
              id="phoneNumber"
              {...aria}
              {...register('phoneNumber')}
              type="tel"
              autoComplete="tel"
              placeholder="0712 345 678"
            />
          )}
        </Field>
        <Field
          label="Faculty"
          hint="Choose your school"
          error={errors.faculty?.message}
        >
          {({ aria }) => (
            <SelectField
              id="faculty"
              {...aria}
              {...register('faculty')}
              options={FACULTIES}
              placeholder="Choose…"
            />
          )}
        </Field>
        <Button variant="primary" type="submit" fullWidth isLoading={isLoading} disabled={isLoading}>
          Complete profile
        </Button>
      </form>
      <p className="text-sm text-center mt-6">
        Already have a profile?{' '}
        <Link to="/login" className="text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </Panel>
  )
}
