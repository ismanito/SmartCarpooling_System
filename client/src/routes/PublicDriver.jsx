import { useParams } from 'react-router'
import { BadgeCheck, ShieldX } from 'lucide-react'
import { Spinner } from '../components/ui/Spinner.jsx'
import { BigPlate } from '../components/ride/bits.jsx'
import { useLive } from '../hooks/useLive.js'
import { api } from '../lib/api.js'

/** The page behind the sticker's QR code. Anyone can open it: it shows only a first name, the car, the plate and the status. */
export default function PublicDriver() {
  const { token } = useParams()
  const { data, error } = useLive(() => api.publicDriver(token), { pollMs: 60000 })
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-5 py-10">
      <p className="font-display text-3xl font-semibold tracking-wide text-ink-deep uppercase">RideMate</p>
      {!data ? (
        error ? <p role="alert" className="text-error">Could not check this driver. Try again.</p> : <Spinner />
      ) : data.verified ? (
        <div className="space-y-4 rounded-(--radius-panel) border border-mint bg-surface p-5">
          <p className="flex items-center gap-2 font-medium text-ink"><BadgeCheck size={26} aria-hidden className="text-mint" /> ✓ Verified driver</p>
          {data.photoUrl && <img src={data.photoUrl} alt={`${data.firstName}`} className="aspect-square w-40 rounded-full object-cover" />}
          <p className="font-display text-4xl leading-none font-semibold text-ink-deep">{data.firstName}</p>
          <p className="text-sm text-ink">{data.typeLabel}</p>
          <p className="text-ink">{data.car}</p>
          <BigPlate plate={data.plateNumber} />
          <p className="text-xs text-ink/85">Check that the car and number plate match your ride in the app before you get in.</p>
        </div>
      ) : (
        <div className="space-y-2 rounded-(--radius-panel) border border-error bg-surface p-5">
          <p className="flex items-center gap-2 font-medium text-error"><ShieldX size={26} aria-hidden /> Not a verified driver</p>
          <p className="text-sm text-ink">This sticker is not valid. Do not get into the car, and tell the RideMate team.</p>
        </div>
      )}
    </main>
  )
}
