// Sounds made with the browser's own audio, so there are no files to load.
// Browsers only allow sound after the person has touched the page, so unlockAudio() runs on the first tap.
let ctx = null
let ringTimer = null
const KEY = 'ridemate.muted'

const read = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
let muted = read()

export const isMuted = () => muted
export function setMuted(value) {
  muted = Boolean(value)
  try {
    localStorage.setItem(KEY, muted ? '1' : '0')
  } catch {
    /* kept for this visit only */
  }
  if (muted) stopRinging()
}

/** Starts (or wakes) the audio engine. Call it from any tap. Returns true when sound can play. */
export function unlockAudio() {
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return false
      ctx = new Ctx()
    }
    if (ctx.state === 'suspended') ctx.resume()
    return ctx.state === 'running'
  } catch {
    return false
  }
}
export const audioReady = () => Boolean(ctx && ctx.state === 'running')

function note(freq, start, length, volume = 0.3, type = 'sine') {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  const t = ctx.currentTime + start
  // A short fade in and out stops the clicking you get from cutting a tone off.
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + length + 0.05)
}

/** A clear three-note chime for a new ride request. */
export function playRequest() {
  if (muted || !unlockAudio()) return
  ;[784, 988, 1319].forEach((f, i) => note(f, i * 0.16, 0.22, 0.4, 'triangle'))
}

/** A soft two-note ping for a new message. */
export function playMessage() {
  if (muted || !unlockAudio()) return
  note(660, 0, 0.14, 0.25)
  note(880, 0.12, 0.2, 0.25)
}

/** Rings (and vibrates) every couple of seconds until stopRinging(), so a request is hard to miss. */
export function startRinging() {
  stopRinging()
  const ring = () => {
    playRequest()
    navigator.vibrate?.([250, 120, 250])
  }
  ring()
  ringTimer = setInterval(ring, 2400)
}
export function stopRinging() {
  if (ringTimer) clearInterval(ringTimer)
  ringTimer = null
  navigator.vibrate?.(0)
}
