import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field, TextField } from '../components/ui/Field.jsx'
import { SeatPicker } from '../components/ui/SeatPicker.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx'
import { PlateTag } from '../components/ui/PlateTag.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { vehicleSchema, formatPlate } from '../lib/schemas.js'
import { api, applyFieldErrors } from '../lib/api.js'
import { SectionTitle, plural } from '../components/rides/RideBits.jsx'

const EMPTY = { makeModel: '', plateNumber: '', colour: '', seatCapacity: 4 }

export default function Vehicles() {
  const [vehicles, setVehicles] = useState(null)
  const [serverError, setServerError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const {
    register, handleSubmit, setError, reset, watch, setValue,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(vehicleSchema), defaultValues: EMPTY })

  const load = useCallback(async () => {
    try {
      const { vehicles: vs } = await api.listVehicles()
      setVehicles(vs)
    } catch (err) {
      setVehicles([])
      setServerError(err.message || 'Could not load your vehicles. Reload to try again.')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const startEdit = (v) => {
    setServerError(null)
    setEditingId(v.vehicleId)
    reset({ makeModel: v.makeModel, plateNumber: formatPlate(v.plateNumber), colour: v.colour, seatCapacity: v.seatCapacity })
  }

  const stopEdit = () => {
    setEditingId(null)
    reset(EMPTY)
  }

  const onSubmit = async (data) => {
    setServerError(null)
    try {
      if (editingId) await api.updateVehicle(editingId, data)
      else await api.createVehicle(data)
      stopEdit()
      await load()
    } catch (err) {
      if (err.code === 'PLATE_TAKEN') setError('plateNumber', { message: err.message })
      else if (!applyFieldErrors(err, setError)) setServerError(err.message || 'Your vehicle was not saved. Try again.')
    }
  }

  const confirmDelete = async () => {
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await api.deleteVehicle(deleting.vehicleId)
      if (editingId === deleting.vehicleId) stopEdit()
      setDeleting(null)
      await load()
    } catch (err) {
      setDeleteError(err.message || 'The vehicle was not deleted. Try again.')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Panel>
        <PageTitle className="mb-6">{editingId ? 'Edit vehicle' : 'Add a vehicle'}</PageTitle>
        {serverError && <Alert tone="error">{serverError}</Alert>}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Make and model" error={errors.makeModel?.message}>
            {({ aria }) => <TextField {...aria} {...register('makeModel')} placeholder="Toyota Corolla" />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Number plate" error={errors.plateNumber?.message}>
              {({ aria }) => <TextField {...aria} {...register('plateNumber')} placeholder="KDA 123A" className="uppercase" />}
            </Field>
            <Field label="Colour" error={errors.colour?.message}>
              {({ aria }) => <TextField {...aria} {...register('colour')} placeholder="Silver" />}
            </Field>
          </div>
          <SeatPicker
            label="Passenger seats"
            value={Number(watch('seatCapacity')) || 4}
            onChange={(v) => setValue('seatCapacity', v, { shouldValidate: true })}
            error={errors.seatCapacity?.message}
          />
          <div className="flex gap-2">
            <Button type="submit" fullWidth isLoading={isSubmitting}>
              {editingId ? 'Save changes' : 'Add vehicle'}
            </Button>
            {editingId && (
              <Button variant="secondary" onClick={stopEdit}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Panel>

      <section aria-labelledby="my-vehicles" className="space-y-3">
        <SectionTitle id="my-vehicles">My vehicles</SectionTitle>
        {vehicles === null ? (
          <Spinner />
        ) : vehicles.length === 0 ? (
          <p className="text-sm text-ink/85">No vehicles yet. Add one to start offering rides.</p>
        ) : (
          <ul className="space-y-3">
            {vehicles.map((v) => (
              <li key={v.vehicleId} className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-panel) border border-ink/20 bg-surface p-4 shadow-(--shadow-contact)">
                <div className="flex flex-col items-start gap-2">
                  <PlateTag plate={v.plateNumber} className="text-base" />
                  <p className="text-sm text-ink">
                    {v.colour} {v.makeModel} · {plural(v.seatCapacity, 'passenger seat')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => startEdit(v)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setDeleteError(null); setDeleting(v) }}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this vehicle?"
        confirmLabel="Delete vehicle"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        isLoading={deleteBusy}
        error={deleteError}
      >
        {deleting && `${deleting.makeModel} (${formatPlate(deleting.plateNumber)}) will be removed from your account.`}
      </ConfirmDialog>
    </div>
  )
}
