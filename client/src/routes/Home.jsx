import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'

export default function Home() {
  const { profile, emailVerified } = useAuth()
  const [serverError, setServerError] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    api
      .getMe()
      .then(() => {})
      .catch((err) => {
        if (!(err instanceof Error && err.name === 'ApiError') || err.code !== 'PROFILE_REQUIRED') {
          setServerError(err?.message || 'Could not load your profile.')
        }
      })
      .finally(() => setIsLoading(false))
  }, [])

  return (
    <Panel className="w-full max-w-3xl mx-auto mt-10">
      <PageTitle className="mb-6">RideMate</PageTitle>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-ink/20 rounded-(--radius-panel) bg-surface p-5 shadow-(--shadow-contact)">
          <h3 className="font-medium text-ink mb-3">Your profile</h3>
          <p className="text-sm text-ink/85">{profile?.fullName || '—'}</p>
          <p className="text-sm text-ink/85">{profile?.universityEmail || '—'}</p>
          <p className="text-sm text-ink/85">{profile?.faculty || '—'}</p>
        </div>
        <div className="border border-ink/20 rounded-(--radius-panel) bg-surface p-5 shadow-(--shadow-contact)">
          <h3 className="font-medium text-ink mb-3">Status</h3>
          <p className="text-sm text-ink/85">{emailVerified ? 'Email verified' : 'Email not verified'}</p>
          <p className="text-sm text-ink/85">{profile ? 'Profile complete' : 'Profile incomplete'}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Link to="/profile" className="text-center">
            <Button variant="primary" fullWidth disabled={isLoading}>
              Manage profile
            </Button>
          </Link>
          <Link to="/vehicles" className="text-center">
            <Button variant="secondary" fullWidth disabled={isLoading}>
              My vehicles
            </Button>
          </Link>
        </div>
      </div>
    </Panel>
  )
}
