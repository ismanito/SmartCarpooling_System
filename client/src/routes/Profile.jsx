import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField, SelectField } from '../components/ui/Field.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { updateProfileSchema } from '../lib/schemas.js'
import { applyFieldErrors } from '../lib/api.js'
import { FACULTIES } from '../constants/faculties.js'
import { useAuth } from '../context/AuthContext.jsx'

export default function Profile() {
  const { profile, updateProfile } = useAuth()
  const [serverError, setServerError] = useState(null)
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      fullName: profile?.fullName ?? '',
      phoneNumber: profile?.phoneNumber ?? '',
      faculty: profile?.faculty ?? '',
    },
  })

  const onSubmit = async (data) => {
    setServerError(null)
    setIsLoading(true)
    try {
      await updateProfile(data)
    } catch (err) {
      if (!(err instanceof Error && err.name === 'ApiError')) {
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
      <PageTitle className="mb-6">Edit profile</PageTitle>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field
          label="Full name"
          error={errors.fullName?.message}
        >
          {({ aria }) => (
            <TextField
              id="fullName"
              {...aria}
              {...register('fullName')}
              autoComplete="name"
              defaultValue={profile?.fullName || ''}
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
              defaultValue={profile?.phoneNumber || ''}
            />
          )}
        </Field>
        <Field
          label="Faculty"
          error={errors.faculty?.message}
        >
          {({ aria }) => (
            <SelectField
              id="faculty"
              {...aria}
              {...register('faculty')}
              options={FACULTIES}
              placeholder="Choose…"
              defaultValue={profile?.faculty || ''}
            />
          )}
        </Field>
        <Button variant="primary" type="submit" fullWidth isLoading={isLoading} disabled={isLoading}>
          Save changes
        </Button>
      </form>
    </Panel>
  )
}
