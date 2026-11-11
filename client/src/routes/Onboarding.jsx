import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField, SelectField } from '../components/ui/Field.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { driverProfileSchema, profileSchema, staffProfileSchema } from '../lib/schemas.js'
import { applyFieldErrors, ApiError } from '../lib/api.js'
import { useEmailKind } from '../hooks/useEmailKind.js'
import { FACULTIES } from '../constants/faculties.js'
import { useAuth } from '../context/AuthContext.jsx'

const stripEmpty = (data) => Object.fromEntries(Object.entries(data).filter(([, v]) => v !== '' && v !== undefined))

export default function Onboarding() {
  const { createProfile, logOut, email } = useAuth()
  const [serverError, setServerError] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  // Who you are follows from your email and the account type you chose: a student or staff member, a driver
  // applying to drive, or an administrator. Demo addresses may be drivers when that is what they signed up as.
  const { kind, demo } = useEmailKind(email)
  let wanted = null
  try {
    wanted = sessionStorage.getItem('ridemate.accountType')
  } catch {
    /* fall back to what the email says */
  }
  const staff = kind === 'admin'
  const driver = kind === 'driver' || (kind === 'student' && demo && wanted === 'driver')
  const [personType, setPersonType] = useState('student')
  const schema = staff ? staffProfileSchema : driver ? driverProfileSchema : profileSchema

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: (values, ctx, opts) => zodResolver(schema)(values, ctx, opts),
    defaultValues: { fullName: '', phoneNumber: '', faculty: '', licenceNumber: '', idNumber: '', about: '' },
  })

  const onSubmit = async (data) => {
    setServerError(null)
    setIsLoading(true)
    try {
      await createProfile(staff ? { fullName: data.fullName, phoneNumber: data.phoneNumber } : driver ? { ...stripEmpty(data), ...(kind === 'student' ? { accountType: 'driver' } : {}) } : { ...stripEmpty(data), personType }) // ProtectedRoute redirects home once the profile exists
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
    <Panel className="w-full max-w-md">
      <PageTitle className="mb-2">{driver ? 'Apply to drive' : staff ? 'Administrator profile' : 'Complete your profile'}</PageTitle>
      {driver && <p className="mb-6 text-sm text-ink/85">An admin checks these details before you can offer rides. You will be told by notification and email.</p>}
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field
          label="Full name"
          hint={staff ? 'Your name as it should appear to the team' : 'As it appears on your university records'}
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
        {driver && (
          <>
            <Field label="Driving licence number" error={errors.licenceNumber?.message}>
              {({ aria }) => <TextField {...aria} {...register('licenceNumber')} autoComplete="off" />}
            </Field>
            <Field label="National ID or passport number" error={errors.idNumber?.message}>
              {({ aria }) => <TextField {...aria} {...register('idNumber')} autoComplete="off" />}
            </Field>
            <Field label="Anything else we should know" optional error={errors.about?.message}>
              {({ aria }) => <textarea {...aria} {...register('about')} rows={3} maxLength={1000} className="block w-full rounded-(--radius-control) border border-ink/30 bg-surface p-3 text-base text-ink focus:outline-2 focus:outline-mint" />}
            </Field>
          </>
        )}
        {!staff && !driver && (
          <>
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-ink">I am a</legend>
              <div className="flex gap-2">
                {[['student', 'Student'], ['staff', 'Staff member']].map(([id, label]) => (
                  <label key={id} className={`focus-within:outline-2 focus-within:outline-mint inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-(--radius-control) border px-3 text-sm font-medium ${personType === id ? 'border-ink bg-ink text-gold' : 'border-ink/30 bg-surface text-ink'}`}>
                    <input type="radio" name="personType" value={id} checked={personType === id} onChange={() => setPersonType(id)} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {personType === 'staff' ? (
              <Field label="Department or office" hint="For example Registrar, Library or Finance" error={errors.faculty?.message}>
                {({ aria }) => <TextField {...aria} {...register('faculty')} placeholder="Registrar office" />}
              </Field>
            ) : (
              <Field label="Faculty" hint="Choose your school" error={errors.faculty?.message}>
                {({ aria }) => <SelectField id="faculty" {...aria} {...register('faculty')} options={FACULTIES} placeholder="Choose…" />}
              </Field>
            )}
          </>
        )}
        <Button variant="primary" type="submit" fullWidth isLoading={isLoading} disabled={isLoading}>
          {driver ? 'Send application' : 'Complete profile'}
        </Button>
      </form>
      <p className="text-sm text-center mt-6">
        Signed in as {email}. Not you, or already have a profile?{' '}
        <button type="button" onClick={logOut} className="text-ink underline underline-offset-4">
          Log out
        </button>
      </p>
    </Panel>
  )
}
