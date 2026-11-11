import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button.jsx'

/**
 * Takes a selfie from the live camera (never from the photo gallery). The driver takes `prompts.length` photos in a row,
 * each with its own instruction (for example "look straight at the camera", then "turn your head slightly").
 * `onDone` gets the photos as files. This is a simple check, not a liveness detector: an admin compares the faces.
 */
export function LiveSelfie({ prompts = ['Look straight at the camera'], onDone, onCancel, busy = false }) {
  const video = useRef(null)
  const stream = useRef(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  const [shots, setShots] = useState([])

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }, [])

  useEffect(() => {
    let live = true
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot open the camera. Use a phone or a computer with a camera, over https.')
      return undefined
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (!live) return s.getTracks().forEach((t) => t.stop())
        stream.current = s
        video.current.srcObject = s
        return video.current.play().then(() => live && setReady(true))
      })
      .catch((e) => live && setError(e.name === 'NotAllowedError' ? 'Camera access is blocked. Allow the camera for this site in your browser settings, then try again.' : 'Could not start the camera.'))
    return () => {
      live = false
      stop()
    }
  }, [stop])

  const snap = () => {
    const v = video.current
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth || 640
    canvas.height = v.videoHeight || 480
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        const file = new File([blob], `selfie-${shots.length + 1}.jpg`, { type: 'image/jpeg' })
        const next = [...shots, file]
        setShots(next)
        if (next.length === prompts.length) {
          stop()
          onDone(next)
        }
      },
      'image/jpeg',
      0.9,
    )
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-error">{error}</p>
        {onCancel && <Button variant="secondary" onClick={onCancel}>Close</Button>}
      </div>
    )
  }

  const step = Math.min(shots.length, prompts.length - 1)
  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-(--radius-panel) bg-asphalt">
        <video ref={video} playsInline muted aria-label="Camera preview" className="aspect-[4/3] w-full -scale-x-100 object-cover" />
        {!ready && <p className="absolute inset-0 flex items-center justify-center text-sm text-paper">Starting the camera…</p>}
      </div>
      <p role="status" className="text-center font-medium text-ink">
        {prompts.length > 1 ? `Photo ${step + 1} of ${prompts.length}: ` : ''}
        {prompts[step]}
      </p>
      <div className="flex gap-2">
        <Button fullWidth disabled={!ready || busy} isLoading={busy} onClick={snap}>
          <Camera size={18} aria-hidden /> Take photo
        </Button>
        {shots.length > 0 && (
          <Button variant="secondary" onClick={() => setShots([])} aria-label="Start again">
            <RefreshCw size={18} aria-hidden />
          </Button>
        )}
      </div>
      {onCancel && (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  )
}
