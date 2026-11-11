import { useCallback, useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { ShieldCheck } from 'lucide-react'
import { Analytics, Dashboard, Incidents } from './AdminSections.jsx'
import { Verification } from './AdminVerification.jsx'
import { DispatchTools, LiveOps, Zones } from './AdminDispatch.jsx'
import { Button } from '../components/ui/Button.jsx'
import { TextField } from '../components/ui/Field.jsx'
import { Panel, Alert, PageTitle } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Rating, SectionTitle, formatWhen } from '../components/rides/RideBits.jsx'
import { PayChip, kes } from '../components/payments/PaymentBits.jsx'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'users', label: 'Users' },
  { id: 'verification', label: 'Driver verification' },
  { id: 'live', label: 'Live map' },
  { id: 'incidents', label: 'Incident reports' },
  { id: 'zones', label: 'Zones' },
  { id: 'dispatch', label: 'Dispatch' },
  { id: 'payments', label: 'Payments' },
  { id: 'audit', label: 'Audit log' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'settings', label: 'Matching settings' },
]

export default function Admin() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  if (profile?.role !== 'admin') return <Navigate to="/" replace />
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'dashboard'
  const go = (id) => setParams({ tab: id })

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium tracking-wider text-ink/85 uppercase">Admin console</p>
        <PageTitle>{TABS.find((t) => t.id === tab).label}</PageTitle>
        <p className="mt-1 text-sm break-all text-ink/85">Signed in as {profile.universityEmail}</p>
      </div>
      <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Admin sections" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => go(t.id)}
              className={`focus-ring min-h-11 shrink-0 rounded-(--radius-control) px-3 text-left text-sm font-medium whitespace-nowrap ${tab === t.id ? 'bg-ink text-gold' : 'text-ink hover:bg-ink/8'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {tab === 'dashboard' && <Dashboard />}
          {tab === 'users' && <People myId={profile.userId} />}
          {tab === 'verification' && <Verification />}
          {tab === 'live' && <LiveOps />}
          {tab === 'zones' && <Zones />}
          {tab === 'dispatch' && <DispatchTools />}
          {tab === 'incidents' && <Incidents initialId={params.get('id')} />}
          {tab === 'payments' && <Payments />}
          {tab === 'audit' && <Audit />}
          {tab === 'analytics' && <Analytics />}
          {tab === 'settings' && <Settings />}
        </div>
      </div>
    </div>
  )
}

function Payments() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    api
      .adminPayments()
      .then((r) => live && setData(r))
      .catch((err) => live && setError(err.message))
    return () => {
      live = false
    }
  }, [])

  if (error) return <Alert tone="error">{error}</Alert>
  if (!data) return <Spinner />
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink/85">
        Fares are shared between riders and paid straight to the driver. RideMate records them here but does not hold the money.
      </p>
      {data.recent.length === 0 ? (
        <p className="text-sm text-ink/85">No fares yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-(--radius-panel) border border-ink/20 bg-surface">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-paper-deep text-xs tracking-wider uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Trip</th>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Rider</th>
                <th className="px-3 py-2 font-medium">Paid</th>
                <th className="px-3 py-2 font-medium">Fare</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((p) => (
                <tr key={p.paymentId} className="border-t border-ink/10 align-top">
                  <td className="px-3 py-2">
                    {p.trip.origin} to {p.trip.destination}
                    <span className="block text-ink/85">{formatWhen(p.trip.departAt)}</span>
                  </td>
                  <td className="px-3 py-2">{p.driver}</td>
                  <td className="px-3 py-2">{p.rider}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{kes(p.paidKes)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{kes(p.totalKes)}</td>
                  <td className="px-3 py-2">
                    <PayChip status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function People({ myId }) {
  const [users, setUsers] = useState(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)

  const [filters, setFilters] = useState({ status: '', role: '' })
  const load = useCallback(async (term = '', f = filters) => {
    try {
      setUsers((await api.adminUsers(term, f)).users)
    } catch (err) {
      setError(err.message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const setStatus = async (u, status) => {
    setBusy(u.userId)
    setError(null)
    try {
      await (status === 'suspended' ? api.adminSuspend(u.userId) : api.adminReinstate(u.userId))
      await load(search)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <form
        role="search"
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          load(search)
        }}
      >
        <TextField aria-label="Search by name or email" placeholder="Name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <div className="flex flex-wrap gap-3">
        {[
          ['status', 'Status', [['active', 'Active'], ['suspended', 'Suspended']]],
          ['role', 'Role', [['student', 'Students'], ['driver', 'Drivers'], ['admin', 'Admins']]],
        ].map(([key, label, opts]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            {label}
            <select
              value={filters[key]}
              onChange={(e) => {
                const next = { ...filters, [key]: e.target.value }
                setFilters(next)
                load(search, next)
              }}
              className="focus-ring h-11 rounded-(--radius-control) border border-ink/30 bg-surface px-2"
            >
              <option value="">All</option>
              {opts.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {users === null ? (
        <Spinner />
      ) : users.length === 0 ? (
        <p className="text-sm text-ink/85">No students match that search.</p>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-control) border border-ink/20 bg-surface p-3">
              <div>
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  {u.fullName} <Rating value={u.avgRating} />
                  {u.role === 'admin' && <span className="rounded-(--radius-chip) bg-ink px-1.5 text-xs text-gold">Admin</span>}
                  {u.role === 'driver' && <span className="rounded-(--radius-chip) border border-ink px-1.5 text-xs">Driver</span>}
                  {u.role === 'student' && u.personType === 'staff' && <span className="rounded-(--radius-chip) border border-ink px-1.5 text-xs">Staff</span>}
                  {u.status === 'suspended' && <span className="rounded-(--radius-chip) bg-error px-1.5 text-xs text-surface">Suspended</span>}
                </p>
                <p className="text-sm text-ink/85">
                  {u.universityEmail} · {u.faculty}
                </p>
              </div>
              {u.userId !== myId &&
                (u.status === 'active' ? (
                  <Button variant="secondary" size="sm" isLoading={busy === u.userId} onClick={() => setStatus(u, 'suspended')}>
                    Suspend
                  </Button>
                ) : (
                  <Button size="sm" isLoading={busy === u.userId} onClick={() => setStatus(u, 'active')}>
                    Reactivate
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Audit() {
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState(null)
  const [more, setMore] = useState(true)
  const [filters, setFilters] = useState({ action: '', from: '', to: '', userId: '' })
  const [applied, setApplied] = useState({})
  const [chain, setChain] = useState(null)
  const [verifying, setVerifying] = useState(false)

  const load = useCallback(
    async (before) => {
      try {
        const { entries: page } = await api.adminAudit(before, applied)
        setEntries((prev) => (before ? [...(prev || []), ...page] : page))
        setMore(page.length === 50)
        setError(null)
      } catch (err) {
        setError(err.message)
      }
    },
    [applied],
  )

  useEffect(() => {
    load()
  }, [load])

  const verify = async () => {
    setVerifying(true)
    try {
      setChain(await api.adminVerifyAudit())
    } catch (err) {
      setError(err.message)
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault()
          setEntries(null)
          setApplied({ ...filters })
        }}
      >
        <TextField label="Action starts with" placeholder="booking." value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
        <TextField label="User id" placeholder="paste a user id" value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value.trim() })} />
        <TextField label="From" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <TextField label="To" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="secondary">Filter</Button>
          <Button type="button" onClick={verify} isLoading={verifying}>
            <ShieldCheck size={16} aria-hidden /> Verify integrity
          </Button>
        </div>
      </form>
      {chain && (
        <Alert tone={chain.valid ? 'info' : 'error'}>
          {chain.valid
            ? `Audit log is intact: all ${chain.checked} entries match their hash chain (checked in ${chain.durationMs} ms).`
            : `Audit log has been altered. Entry ${chain.firstBroken?.auditId} no longer matches its hash (${chain.firstBroken?.reason}).`}
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {!entries ? (
        !error && <Spinner />
      ) : (
        <>
          <div className="overflow-x-auto rounded-(--radius-panel) border border-ink/20 bg-surface">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-paper-deep text-xs tracking-wider uppercase">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                  <th className="px-3 py-2 font-medium">Hash</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.auditId} className="border-t border-ink/10 align-top">
                    <td className="px-3 py-2">{e.auditId}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatWhen(e.createdAt)}</td>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{e.action}</td>
                    <td className="px-3 py-2 break-all text-ink/85">{JSON.stringify(e.details)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink/85">{e.entryHash.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {entries.length === 0 && <p className="text-sm text-ink/85">No entries match.</p>}
          {more && entries.length > 0 && (
            <Button variant="secondary" onClick={() => load(entries[entries.length - 1].auditId)}>
              Show older entries
            </Button>
          )}
        </>
      )}
    </div>
  )
}

const SETTING_LABELS = {
  search_radius_km: ['Pick-up and drop-off radius', 'km'],
  time_window_min: ['Departure time window', 'minutes'],
  max_detour_km: ['Longest detour', 'km'],
  w_overlap: ['Weight: route overlap', '0 to 1'],
  w_time: ['Weight: timing', '0 to 1'],
  w_detour: ['Weight: detour', '0 to 1'],
  fuel_rate_kes_per_km: ['Fuel cost', 'KES per km'],
  fare_rounding_kes: ['Round fares to the nearest', 'KES'],
}

const WEIGHTS = ['w_overlap', 'w_time', 'w_detour']

function Settings() {
  const [values, setValues] = useState(null)
  const [limits, setLimits] = useState({})
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    api
      .adminSettings()
      .then((r) => {
        if (!live) return
        setValues(r.settings)
        setLimits(r.limits)
      })
      .catch((err) => live && setError(err.message))
    return () => {
      live = false
    }
  }, [])

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      setValues((await api.adminSaveSettings(values)).settings)
      setSaved(true)
    } catch (err) {
      setError(err.details?.find((d) => d.message)?.message ? `${err.details[0].field}: ${err.details[0].message}` : err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!values) return error ? <Alert tone="error">{error}</Alert> : <Spinner />
  const weightTotal = WEIGHTS.reduce((n, k) => n + Number(values[k] || 0), 0)
  return (
    <Panel className="max-w-xl">
      <SectionTitle>Matching settings</SectionTitle>
      <p className="mt-1 mb-4 text-sm text-ink/85">New values apply to the next match search. Every change is written to the audit log.</p>
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="info">Settings saved.</Alert>}
      <form onSubmit={save} className="space-y-3">
        {Object.entries(SETTING_LABELS).map(([key, [label, unit]]) =>
          WEIGHTS.includes(key) ? (
            <div key={key} className="flex flex-col gap-1.5">
              <label htmlFor={key} className="flex justify-between text-sm font-medium text-ink">
                <span>{label}</span>
                <span>{Number(values[key] ?? 0).toFixed(2)}</span>
              </label>
              <input
                id={key}
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={values[key] ?? 0}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                className="h-11 w-full accent-(--color-ink)"
              />
            </div>
          ) : (
            <TextField
              key={key}
              label={`${label} (${unit})`}
              type="number"
              step="any"
              min={limits[key]?.min}
              max={limits[key]?.max}
              value={values[key] ?? ''}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          ),
        )}
        <p className={`text-sm ${Math.abs(weightTotal - 1) > 0.011 ? 'text-error' : 'text-ink/85'}`} role="status">
          The three weights add up to {weightTotal.toFixed(2)}. They must add up to 1.
        </p>
        <Button type="submit" isLoading={busy}>
          Save settings
        </Button>
      </form>
    </Panel>
  )
}
