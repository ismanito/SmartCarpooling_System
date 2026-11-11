import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../components/ui/Button.jsx'
import { Panel, StatusPane, PageTitle } from '../components/ui/Panel.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useResendCooldown } from '../hooks/useResendCooldown.js'
import { usingAuthEmulator, emulatorVerifyEmail } from '../lib/firebase.js'

export default function VerifyEmail() {
  const navigate = useNavigate()
  const { firebaseUser, emailVerified, checkVerification, resendVerification, logOut } = useAuth()
  const { remaining, restart } = useResendCooldown(firebaseUser?.uid || '')
  const [isChecking, setIsChecking] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    if (emailVerified) navigate('/')
  }, [emailVerified, navigate])

  const handleCheck = async () => {
    setIsChecking(true)
    setMessage(null)
    try {
      const verified = await checkVerification()
      if (!verified) setMessage('Your email is not verified yet. Open the link in the email, then try again.')
    } catch (err) {
      setMessage(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setIsChecking(false)
    }
  }

  // Local development only: the emulator never sends real emails.
  const handleDevVerify = async () => {
    setIsChecking(true)
    setMessage(null)
    try {
      await emulatorVerifyEmail()
      await checkVerification()
    } catch (err) {
      setMessage(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <Panel className="w-full max-w-md">
      <PageTitle className="mb-6">Verify your email</PageTitle>
      <StatusPane className="my-6">
        <p className="text-sm text-ink">
          We sent a verification email to <strong>{firebaseUser?.email}</strong>. Open it and click the link, then come back here.
        </p>
      </StatusPane>
      <div className="flex flex-col gap-3">
        <Button
          variant="primary"
          onClick={handleCheck}
          isLoading={isChecking}
          disabled={isChecking}
          fullWidth
        >
          I verified my email
        </Button>
        {usingAuthEmulator && (
          <Button variant="secondary" onClick={handleDevVerify} disabled={isChecking} fullWidth>
            Verify instantly (local test mode)
          </Button>
        )}
        {message && (
          <p className="text-sm text-error" role="alert">
            {message}
          </p>
        )}
        {remaining > 0 ? (
          <Button variant="ghost" size="sm" disabled fullWidth>
            Resend verification email ({remaining}s)
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => { resendVerification(); restart() }} fullWidth>
            Resend verification email
          </Button>
        )}
      </div>
      <p className="text-sm text-center mt-6">
        Wrong account?{' '}
        <button type="button" onClick={logOut} className="text-ink underline underline-offset-4">
          Log out
        </button>
      </p>
    </Panel>
  )
}
