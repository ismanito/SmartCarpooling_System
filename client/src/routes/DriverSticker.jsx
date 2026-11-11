import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router'
import QRCode from 'qrcode'
import { Printer } from 'lucide-react'
import { Button } from '../components/ui/Button.jsx'
import { Alert, PageTitle } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { useLive } from '../hooks/useLive.js'
import { api } from '../lib/api.js'

/** A printable windscreen sticker. The QR code opens the public "Verified driver" page for this driver. */
export default function DriverSticker() {
  const { data: v, error } = useLive(api.verification, { pollMs: 60000 })
  const canvas = useRef(null)
  const [vehicle, setVehicle] = useState(null)
  const url = v?.qrToken ? `${window.location.origin}/verified/${v.qrToken}` : null

  useEffect(() => {
    if (url && canvas.current) QRCode.toCanvas(canvas.current, url, { width: 220, margin: 1, color: { dark: '#0b3336', light: '#ffffff' } })
  }, [url])
  useEffect(() => {
    if (v?.vehicleId) api.listVehicles().then((r) => setVehicle(r.vehicles.find((x) => x.vehicleId === v.vehicleId) || null)).catch(() => {})
  }, [v?.vehicleId])

  if (!v) return error ? <Alert tone="error">{error}</Alert> : <Spinner />
  if (v.status !== 'approved') return <Navigate to="/" replace />
  return (
    <div className="mx-auto w-full max-w-md space-y-5">
      <div className="print:hidden space-y-3">
        <PageTitle>Windscreen sticker</PageTitle>
        <p className="text-sm text-ink/85">Print this and stick it inside your windscreen. Riders can scan the code to check you are a verified driver.</p>
        <Button onClick={() => window.print()}><Printer size={18} aria-hidden /> Print</Button>
      </div>
      <div className="rounded-(--radius-panel) border-4 border-asphalt bg-white p-6 text-center text-asphalt print:border-2">
        <p className="font-display text-4xl leading-none font-semibold tracking-wide uppercase">Ride<span className="text-mint">Mate</span></p>
        <p className="mt-1 inline-block rounded bg-gold px-3 py-1 font-display text-2xl font-semibold tracking-wide uppercase">✓ Verified driver</p>
        <canvas ref={canvas} className="mx-auto mt-4" aria-label="QR code for the verified driver page" />
        {vehicle && <p className="mt-3 font-mono text-2xl font-bold tracking-widest">{vehicle.plateNumber}</p>}
        <p className="mt-1 text-sm">{v.typeLabel}. Scan to check this driver and car.</p>
      </div>
    </div>
  )
}
