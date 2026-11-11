import { useEffect, useState } from 'react'
import { Download, Share, X } from 'lucide-react'

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent)

/**
 * "Install app" for phones. Android and desktop Chrome give us a real install prompt;
 * iPhone has none, so we show the Add to Home Screen steps instead. Hidden once installed.
 */
export function InstallButton({ className = '' }) {
  const [promptEvent, setPromptEvent] = useState(null)
  const [installed, setInstalled] = useState(() => isStandalone())
  const [showIosHelp, setShowIosHelp] = useState(false)

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault()
      setPromptEvent(e)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPromptEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed) return null
  const ios = isIos()
  if (!promptEvent && !ios) return null

  const install = async () => {
    if (!promptEvent) return setShowIosHelp(true)
    promptEvent.prompt()
    await promptEvent.userChoice.catch(() => {})
    setPromptEvent(null)
  }

  return (
    <>
      <button
        type="button"
        onClick={install}
        className={`focus-ring inline-flex min-h-11 items-center gap-2 rounded-(--radius-control) border border-gold/60 px-3 text-sm font-medium text-gold hover:bg-white/10 ${className}`}
      >
        <Download size={16} aria-hidden /> Install app
      </button>
      {showIosHelp && (
        <div role="dialog" aria-label="Install RideMate on your iPhone" className="fixed inset-x-3 bottom-3 z-50 rounded-(--radius-panel) bg-surface p-4 text-ink shadow-xl md:left-auto md:max-w-sm">
          <button type="button" aria-label="Close" onClick={() => setShowIosHelp(false)} className="focus-ring absolute top-2 right-2 rounded p-2">
            <X size={18} aria-hidden />
          </button>
          <p className="font-medium">Install RideMate on your iPhone</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            <li>
              Tap the Share button <Share size={14} aria-hidden className="inline align-text-bottom" /> in Safari.
            </li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong>. RideMate now opens like an app.</li>
          </ol>
        </div>
      )}
    </>
  )
}
