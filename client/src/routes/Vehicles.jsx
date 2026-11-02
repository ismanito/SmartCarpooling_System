import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/Button.jsx'
import { Field } from '../components/ui/Field.jsx'
import { SeatPicker } from '../components/ui/SeatPicker.jsx'
import { Panel, Alert, PageTitle, ConfirmDialog } from '../components/ui/Panel.jsx'
import { PlateTag } from '../components/ui/PlateTag.jsx'
import { vehicleSchema } from '../lib/schemas.js'
import { applyFieldErrors } from '../lib/api.js'

export default function Vehicles() {
  const [vehicles, setVehicles] = useState([])
  const [serverError, setServerError] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [openDialog, setOpenDialog] = useState(false)
  const [deleteId, setDeleteId] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(vehicleSchema),
    defaultValues: { makeModel: '', plateNumber: '', colour: '', seatCapacity: 4 },
  })

  const loadVehicles = async () => {
    try {
      const { vehicles: vs } = await api.listVehicles()
      setVehicles(vs)
    } catch (err) {
      setServerError(err?.message || 'Could not load vehicles.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadVehicles()
  }, [])

  const onCreate = async (data) => {
    setServerError(null)
    setIsLoading(true)
    try {
      await api.createVehicle(data)
      reset()
      await loadVehicles()
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

  const onUpdate = async (id, data) => {
    setServerError(null)
    setIsLoading(true)
    try {
      await api.updateVehicle(id, data)
      setEditingId(null)
      reset({ makeModel: '', plateNumber: '', colour: '', seatCapacity: 4 })
      await loadVehicles()
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

  const onDelete = async (id) => {
    setDeleteLoading(true)
    try {
      await api.deleteVehicle(id)
      await loadVehicles()
    } catch (err) {
      setServerError(err?.message || 'Could not delete vehicle.')
    } finally {
      setDeleteLoading(false)
      setOpenDialog(false)
      setDeleteId(null)
    }
  }

  return (
    <Panel className="w-full max-w-3xl mx-auto mt-10">
      <PageTitle className="mb-6">My vehicles</PageTitle>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <form onSubmit={handleSubmit(onCreate)} className="space-y-4 mb-6">
        <Field
          label="Make and model"
          error={errors.makeModel?.message}
        >
          {({ aria }) => (
            <input
              id="makeModel"
              {...aria}
              {...register('makeModel')}
              className="block w-full rounded-(--radius-control) border bg-surface px-3 text-base text-ink placeholder:text-ink/55 transition-colors focus:outline-2 focus:outline-offset-0 focus:outline-mint h-12 md:h-11"
              placeholder="Toyota Corolla"
              defaultValue=""
            />
          )}
        </Field>
        <Field
          label="Number plate"
          hint="e.g. KDA 123A"
          error={errors.plateNumber?.message}
        >
          {({ aria }) => (
            <input
              id="plateNumber"
              {...aria}
              {...register('plateNumber')}
              className="block w-full rounded-(--radius-control) border bg-surface px-3 text-base text-ink placeholder:text-ink/55 transition-colors focus:outline-2 focus:outline-offset-0 focus:outline-mint h-12 md:h-11"
              placeholder="KDA 123A"
              defaultValue=""
            />
          )}
        </Field>
        <Field label="Colour" error={errors.colour?.message}>
          {({ aria }) => (
            <input
              id="colour"
              {...aria}
              {...register('colour')}
              className="block w-full rounded-(--radius-control) border bg-surface px-3 text-base text-ink placeholder:text-ink/55 transition-colors focus:outline-2 focus:outline-offset-0 focus:outline-mint h-12 md:h-11"
              placeholder="Silver"
              defaultValue=""
            />
          )}
        </Field>
        <SeatPicker
          label="Seat capacity"
          value={Number(register('seatCapacity').value) || 4}
          onChange={(v) => register('seatCapacity').onChange({ target: { value: String(v) } })}
          error={errors.seatCapacity?.message}
        />
        <Button variant="primary" type="submit" fullWidth isLoading={isLoading} disabled={isLoading}>
          Add vehicle
        </Button>
      </form>

      <div className="space-y-3">
        {vehicles.length === 0 ? (
          <p className="text-sm text-ink/85 text-center">No vehicles registered yet.</p>
        ) : (
          <ul className="space-y-2">
            {vehicles.map((v) => (
              <li
                key={v.vehicleId}
                className="flex items-center justify-between gap-3 border border-ink/20 rounded-(--radius-panel) bg-surface p-4 shadow-(--shadow-contact)"
              >
                <div className="flex items-center gap-4">
                  <PlateTag plate={v.plateNumber} className="font-medium" />
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-ink">{v.makeModel}</span>
                    <span className="text-xs text-ink/60">
                      {v.colour} • {v.seatCapacity} seat{v.seatCapacity === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {editingId === v.vehicleId ? (
                    <VehicleEditForm
                      vehicle={v}
                      onSave={(data) => onUpdate(v.vehicleId, data)}
                      onCancel={() => setEditingId(null)}
                      isSaving={isLoading && editingId === v.vehicleId}
                    />
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(v.vehicleId)}
                        disabled={isLoading}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => { setDeleteId(v.vehicleId); setOpenDialog(true) }}
                        disabled={isLoading}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={openDialog}
        title="Delete vehicle?"
        children="This cannot be undone. Are you sure?"
        confirmLabel="Delete"
        onConfirm={() => onDelete(deleteId)}
        onCancel={() => setOpenDialog(false)}
        isLoading={deleteLoading}
      />
    </Panel>
  )
}

function VehicleEditForm({ vehicle, onSave, onCancel, isSaving }) {
  const [local, setLocal] = useState({
    makeModel: vehicle.makeModel,
    plateNumber: vehicle.plateNumber,
    colour: vehicle.colour,
    seatCapacity: String(vehicle.seatCapacity),
  })

  return (
    <div className="flex items-center gap-2">
      <input
        className="border border-ink/30 rounded-(--radius-control) px-2 py-1.5 text-sm text-ink w-32"
        value={local.makeModel}
        onChange={(e) => setLocal({ ...local, makeModel: e.target.value })}
      />
      <input
        className="border border-ink/30 rounded-(--radius-control) px-2 py-1.5 text-sm text-ink w-24 uppercase"
        value={local.plateNumber}
        onChange={(e) => setLocal({ ...local, plateNumber: e.target.value })}
      />
      <input
        className="border border-ink/30 rounded-(--radius-control) px-2 py-1.5 text-sm text-ink w-20"
        value={local.colour}
        onChange={(e) => setLocal({ ...local, colour: e.target.value })}
      />
      <SeatPicker
        label=""
        value={Number(local.seatCapacity) || 1}
        onChange={(v) => setLocal({ ...local, seatCapacity: String(v) })}
        error={false}
      />
      <Button
        variant="primary"
        size="sm"
        onClick={() => onSave(local)}
        isLoading={isSaving}
        disabled={isSaving}
      >
        Save
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
