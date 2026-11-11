import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField, SelectField } from '../components/ui/Field.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { profileSchema, staffProfileSchema } from '../lib/schemas.js'
import { applyFieldErrors } from '../lib/api.js'
import { FACULTIES } from '../constants/faculties.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Rating } from '../components/rides/RideBits.jsx'
import { api } from '../lib/api.js'

export default function Profile() {
  const { profile, updateProfile, reloadProfile } = useAuth()
  const [serverError, setServerError] = useState(null)
  const [saved, setSaved] = useState(false)
  const isStudent = profile?.role === 'student'

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(isStudent ? profileSchema : staffProfileSchema),
    defaultValues: {
      fullName: profile?.fullName ?? '',
      phoneNumber: profile?.phoneNumber ?? '',
      faculty: profile?.faculty ?? '',
    },
  })

  const onSubmit = async (data) => {
    setServerError(null)
    setSaved(false)
    try {
      await updateProfile(isStudent ? data : { fullName: data.fullName, phoneNumber: data.phoneNumber })
      setSaved(true)
    } catch (err) {
      if (!applyFieldErrors(err, setError)) setServerError(err?.message || 'Your changes were not saved. Try again.')
    }
  }

  return (
    <Panel className="mx-auto w-full max-w-xl">
      <PageTitle className="mb-1">Your profile</PageTitle>
      <p className="mb-6 flex flex-wrap items-center gap-2 text-sm text-ink/85">
        {profile?.universityEmail} · {profile?.role === 'admin' ? 'Administrator' : profile?.role === 'driver' ? 'Driver' : profile?.personType === 'staff' ? 'Staff' : 'Student'} <Rating value={profile?.avgRating} />
      </p>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      {saved && <Alert tone="info">Changes saved.</Alert>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label="Full name" error={errors.fullName?.message}>
          {({ aria }) => <TextField {...aria} {...register('fullName')} autoComplete="name" />}
        </Field>
        <Field label="Phone number" hint="Only shared with people you have a confirmed ride with" error={errors.phoneNumber?.message}>
          {({ aria }) => <TextField {...aria} {...register('phoneNumber')} type="tel" autoComplete="tel" />}
        </Field>
        {isStudent && profile.personType === 'staff' && (
          <Field label="Department or office" error={errors.faculty?.message}>
            {({ aria }) => <TextField {...aria} {...register('faculty')} />}
          </Field>
        )}
        {isStudent && profile.personType !== 'staff' && (
          <Field label="Faculty" error={errors.faculty?.message}>
            {({ aria }) => <SelectField {...aria} {...register('faculty')} options={FACULTIES} />}
          </Field>
        )}
        <Button type="submit" fullWidth isLoading={isSubmitting}>
          Save changes
        </Button>
      </form>
      {isStudent && (
        <div className="mt-6 border-t border-ink/15 pt-5">
          <label className="flex min-h-11 items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={profile.allowExternalDrivers !== false}
              onChange={async (e) => {
                try {
                  await api.setAllowExternal(e.target.checked)
                  await reloadProfile()
                } catch (err) {
                  setServerError(err.message)
                }
              }}
              className="mt-0.5 size-5"
            />
            <span>
              <span className="block font-medium">Allow external drivers</span>
              <span className="block text-ink/85">Drivers who are not students or staff, but have been checked by the RideMate team. Turn this off to be matched only with student and staff drivers.</span>
            </span>
          </label>
        </div>
      )}
    </Panel>
  )
}
