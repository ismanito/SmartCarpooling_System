import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router'
import { Button } from '../components/ui/Button.jsx'
import { Panel, StatusPane, PageTitle } from '../components/ui/Panel.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useResendCooldown } from '../hooks/useResendCooldown.js'

export default function VerifyEmail() {
  const navigate = useNavigate()
  const { firebaseUser, emailVerified, checkVerification, resendVerification } = useAuth()
  const { remaining, restart } = useResendCooldown(firebaseUser?.uid || '')
  const [isChecking, setIsChecking] = useState(false)

  useEffect(() => {
    if (emailVerified) navigate('/')
  }, [emailVerified, navigate])

  const handleCheck = async () => {
    setIsChecking(true)
    await checkVerification()
    setIsChecking(false)
  }

  return (
    <Panel className="w-full max-w-md mx-auto mt-10">
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
        Already verified?{' '}
        <Link to="/login" className="text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </Panel>
  )
}
