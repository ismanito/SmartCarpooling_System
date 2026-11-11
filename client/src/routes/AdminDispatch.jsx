import { useEffect, useMemo, useState } from 'react'
import { Button } from '../components/ui/Button.jsx'
import { TextField } from '../components/ui/Field.jsx'
import { Alert, Panel } from '../components/ui/Panel.jsx'
import { Spinner } from '../components/ui/Spinner.jsx'
import { LiveMap } from '../components/ride/LiveMap.jsx'
import { SectionTitle, formatWhen } from '../components/rides/RideBits.jsx'
import { StatGrid, StatTile, kes } from '../components/payments/PaymentBits.jsx'
import { useLive } from '../hooks/useLive.js'
import { connectSocket } from '../lib/socket.js'
import { api } from '../lib/api.js'

// ---------------------------------------------------------------- live map

/** Online drivers and rides under way. Positions exist only while a driver is online. */
export function LiveOps() {
  const { data, error } = useLive(api.adminLive, { pollMs: 5000 })
  const [sos, setSos] = useState(null)
  useEffect(() => {
    const s = connectSocket()
    const on = (e) => setSos(e)
    s.on('sos', on)
    return () => s.off('sos', on)
  }, [])

  const markers = useMemo(
    () => (data?.drivers || []).map((d) => ({ id: d.driverId, lat: d.lat, lng: d.lng, color: d.rideId ? '#fb8f67' : '#01c49a', text: d.name[0] })),
    [data],
  )
  if (error && !data) return <Alert tone="error">{error}</Alert>
  if (!data) return <Spinner />
  return (
    <div className="space-y-4">
      {sos && <Alert tone="error">SOS from {sos.by} during a ride. Open it below and act now.</Alert>}
      <StatGrid>
        <StatTile label="Drivers online" value={data.drivers.length} />
        <StatTile label="Rides under way" value={data.rides.length} />
        <StatTile label="Requests waiting" value={data.waitingRequests} tone={data.waitingRequests > 0 ? 'alert' : 'plain'} />
        <StatTile label="Seats free" value={data.drivers.reduce((n, d) => n + d.seatsFree, 0)} />
      </StatGrid>
      <div className="relative h-80 overflow-hidden rounded-(--radius-panel) border border-ink/20 md:h-[28rem]">
        <LiveMap markers={markers} fitKey={`${markers.length}`} className="absolute inset-0" label="Online drivers" />
      </div>
      <p className="text-xs text-ink/85">Green drivers are free, orange are on a ride. A driver appears only while online and disappears when they go offline.</p>
      <SectionTitle>Rides under way</SectionTitle>
      {data.rides.length === 0 ? (
        <p className="text-sm text-ink/85">None right now.</p>
      ) : (
        <ul className="space-y-2">
          {data.rides.map((r) => (
            <li key={r.rideId} className="rounded-(--radius-control) border border-ink/20 bg-surface p-3 text-sm">
              <span className="font-medium">{r.driver}</span> · {r.riders} rider{r.riders === 1 ? '' : 's'} · {r.stopsLeft} stop{r.stopsLeft === 1 ? '' : 's'} left · {r.status.replace('_', ' ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- zones

const ringsOf = (z) => z.polygon.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng]))
const boxOf = (z) => {
  const pts = z.polygon.coordinates[0]
  const lngs = pts.map((p) => p[0])
  const lats = pts.map((p) => p[1])
  return { west: Math.min(...lngs), south: Math.min(...lats), east: Math.max(...lngs), north: Math.max(...lats) }
}
const rectangle = ({ west, south, east, north }) => ({ type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] })

/** Zones on a map. Pick one to rename it, change its neighbours, or redraw it by clicking two corners on the map. */
export function Zones() {
  const [version, setVersion] = useState(0)
  const [zones, setZones] = useState(null)
  const [error, setError] = useState(null)
  const [sel, setSel] = useState(null) // { zoneId|null, name, neighbours, box:{west,...}|null, geojson }
  const [corner, setCorner] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let live = true
    api.adminZones().then((r) => live && setZones(r.zones)).catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [version])

  const polygons = useMemo(
    () => (zones || []).map((z) => ({ id: z.zoneId, rings: ringsOf(z), color: sel?.zoneId === z.zoneId ? '#fb8f67' : '#156064', label: z.name, onClick: () => pick(z) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zones, sel?.zoneId],
  )
  function pick(z) {
    setSaved(false)
    setCorner(null)
    setSel({ zoneId: z.zoneId, name: z.name, neighbours: z.neighbours, box: boxOf(z), geojson: JSON.stringify(z.polygon) })
  }
  const clickMap = (lat, lng) => {
    if (!sel) return
    if (!corner) return setCorner({ lat, lng })
    const box = { west: Math.min(corner.lng, lng), south: Math.min(corner.lat, lat), east: Math.max(corner.lng, lng), north: Math.max(corner.lat, lat) }
    setCorner(null)
    setSel({ ...sel, box, geojson: JSON.stringify(rectangle(box)) })
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      let polygon
      try {
        polygon = JSON.parse(sel.geojson)
      } catch {
        throw new Error('The shape is not valid GeoJSON.')
      }
      await api.adminSaveZone(sel.zoneId, { name: sel.name, polygon, neighbours: sel.neighbours })
      setSaved(true)
      setVersion((v) => v + 1)
    } catch (err) {
      setError(err.details?.[0]?.message || err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!zones) return error ? <Alert tone="error">{error}</Alert> : <Spinner />
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink/85">Zones decide which riders can share a car: the same zone, or a neighbouring one. Where zones overlap, the smaller one wins. Click a zone on the map to edit it.</p>
      <div className="relative h-80 overflow-hidden rounded-(--radius-panel) border border-ink/20 md:h-[26rem]">
        <LiveMap polygons={polygons} markers={corner ? [{ id: 'corner', lat: corner.lat, lng: corner.lng, color: '#f8e16c', text: '1' }] : []} fitKey={`zones-${polygons.length}`} onMapClick={clickMap} className="absolute inset-0" label="Zones map" />
      </div>
      <div className="flex flex-wrap gap-2">
        {zones.map((z) => (
          <Button key={z.zoneId} size="sm" variant={sel?.zoneId === z.zoneId ? 'primary' : 'secondary'} onClick={() => pick(z)}>{z.name}</Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => { setSaved(false); setSel({ zoneId: null, name: '', neighbours: [], box: null, geojson: '' }) }}>+ Add zone</Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="info">Zone saved.</Alert>}
      {sel && (
        <Panel>
          <SectionTitle>{sel.zoneId ? 'Edit zone' : 'New zone'}</SectionTitle>
          <div className="mt-3 space-y-3">
            <TextField label="Name" value={sel.name} onChange={(e) => setSel({ ...sel, name: e.target.value })} />
            <p className="text-sm text-ink/85">{corner ? 'Click the opposite corner on the map.' : 'To redraw the shape, click two opposite corners on the map.'}</p>
            {sel.box && <p className="text-xs text-ink/85">Box: west {sel.box.west.toFixed(4)}, south {sel.box.south.toFixed(4)}, east {sel.box.east.toFixed(4)}, north {sel.box.north.toFixed(4)}</p>}
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-ink">Neighbouring zones</legend>
              <div className="flex flex-wrap gap-2">
                {zones.filter((z) => z.zoneId !== sel.zoneId).map((z) => {
                  const on = sel.neighbours.includes(z.zoneId)
                  return (
                    <button key={z.zoneId} type="button" aria-pressed={on} onClick={() => setSel({ ...sel, neighbours: on ? sel.neighbours.filter((n) => n !== z.zoneId) : [...sel.neighbours, z.zoneId] })} className={`focus-ring min-h-11 rounded-full border px-3 text-sm ${on ? 'border-ink bg-ink text-gold' : 'border-ink/30 bg-surface text-ink'}`}>
                      {z.name}
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <details>
              <summary className="cursor-pointer text-sm underline underline-offset-4">Shape as GeoJSON (advanced)</summary>
              <textarea value={sel.geojson} onChange={(e) => setSel({ ...sel, geojson: e.target.value })} rows={5} className="mt-2 block w-full rounded-(--radius-control) border border-ink/30 bg-surface p-2 font-mono text-xs" />
            </details>
            <div className="flex gap-2">
              <Button isLoading={busy} disabled={!sel.name || !sel.geojson} onClick={save}>Save zone</Button>
              <Button variant="ghost" onClick={() => setSel(null)}>Close</Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- settings, request log, analytics

const LABELS = {
  dispatch_radius_km: ['Search radius for drivers', 'km'],
  offer_timeout_s: ['Time a driver has to answer', 'seconds'],
  max_offers_per_request: ['Drivers asked per request', 'drivers'],
  max_riders_per_car: ['Riders per car', 'riders'],
  max_extra_minutes_per_rider: ['Most extra minutes for a rider already aboard', 'minutes'],
  scheduled_dispatch_lead_min: ['Find a driver this long before a booking', 'minutes'],
  no_show_wait_s: ['Wait before a no-show', 'seconds'],
  avg_speed_kmh: ['Average speed for ETAs', 'km/h'],
  fuel_rate_kes_per_km: ['Fuel cost', 'KES per km'],
  fare_rounding_kes: ['Round shares to the nearest', 'KES'],
}
const RESPONSE = { accepted: 'Accepted', declined: 'Declined', expired: 'Expired', waiting: 'Waiting' }

export function DispatchTools() {
  const [tab, setTab] = useState('analytics')
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Dispatch" className="flex gap-1 overflow-x-auto border-b border-ink/20">
        {[['analytics', 'Analytics'], ['log', 'Request log'], ['settings', 'Settings']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`focus-ring -mb-px min-h-11 border-b-2 px-4 text-sm font-medium whitespace-nowrap ${tab === id ? 'border-ink text-ink' : 'border-transparent text-ink/85'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'analytics' && <Analytics2 />}
      {tab === 'log' && <RequestLog />}
      {tab === 'settings' && <DispatchSettings />}
    </div>
  )
}

function Analytics2() {
  const { data, error } = useLive(api.adminDispatchAnalytics, { pollMs: 30000 })
  if (error && !data) return <Alert tone="error">{error}</Alert>
  if (!data) return <Spinner />
  const pct = (v) => (v === null ? 'n/a' : `${v}%`)
  return (
    <StatGrid>
      <StatTile label="Requests" value={data.requests} />
      <StatTile label="Fill rate" value={pct(data.fillRate)} tone="good" note="Searches that found a driver" />
      <StatTile label="Average wait" value={`${Math.round(data.avgWaitSeconds / 6) / 10} min`} note="Until a driver accepted" />
      <StatTile label="Pooled rides" value={pct(data.pooledPercent)} note={`${data.completedRides} completed rides`} />
      <StatTile label="No-driver rate" value={pct(data.noDriverRate)} tone={data.noDriverRate > 20 ? 'alert' : 'plain'} />
      <StatTile label="Estimated savings" value={kes(data.estimatedSavingsKes)} tone="good" note="Versus travelling alone" />
    </StatGrid>
  )
}

function RequestLog() {
  const [status, setStatus] = useState('')
  const { data, error } = useLive(() => api.adminDispatchLog(status || undefined), { pollMs: 10000 })
  return (
    <div className="space-y-3">
      <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
        Show
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="focus-ring h-11 rounded-(--radius-control) border border-ink/30 bg-surface px-2 font-normal">
          <option value="">All requests</option>
          {['searching', 'offered', 'assigned', 'picked_up', 'completed', 'no_driver', 'cancelled', 'scheduled'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </label>
      {error && <Alert tone="error">{error}</Alert>}
      {!data ? <Spinner /> : data.requests.length === 0 ? <p className="text-sm text-ink/85">No requests.</p> : (
        <ul className="space-y-2">
          {data.requests.map((r) => (
            <li key={r.requestId} className="rounded-(--radius-panel) border border-ink/20 bg-surface p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-ink">{r.rider}: {r.pickup} to {r.dropoff}</p>
                <span className="rounded-(--radius-chip) border border-ink/30 px-2 text-xs uppercase">{r.status.replace('_', ' ')}</span>
              </div>
              <p className="text-ink/85">{formatWhen(r.createdAt)} · {r.type}{r.driver ? ` · driver ${r.driver}` : ''}{r.cancelReason ? ` · ${r.cancelReason}` : ''}</p>
              {r.offers.length > 0 && (
                <ol className="mt-2 space-y-0.5 text-ink">
                  {r.offers.map((o, i) => (
                    <li key={o.offerId}>{i + 1}. Offered to <strong>{o.driver}</strong>{o.pooled ? ' (pooled)' : ''}, pick-up {o.pickupEtaMin} min: {RESPONSE[o.response] || o.response}</li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DispatchSettings() {
  const [values, setValues] = useState(null)
  const [limits, setLimits] = useState({})
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    api.adminDispatchSettings().then((r) => { if (live) { setValues(r.settings); setLimits(r.limits) } }).catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [])
  if (!values) return error ? <Alert tone="error">{error}</Alert> : <Spinner />
  return (
    <Panel className="max-w-xl">
      <p className="mb-4 text-sm text-ink/85">Changes apply to the next request. Every change is written to the audit log.</p>
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="info">Settings saved.</Alert>}
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          setSaved(false)
          try {
            setValues((await api.adminSaveDispatchSettings(values)).settings)
            setSaved(true)
          } catch (err) {
            setError(err.details?.[0] ? `${err.details[0].field}: ${err.details[0].message}` : err.message)
          } finally {
            setBusy(false)
          }
        }}
      >
        {Object.entries(LABELS).map(([key, [label, unit]]) => (
          <TextField key={key} label={`${label} (${unit})`} type="number" step="any" min={limits[key]?.min} max={limits[key]?.max} value={values[key] ?? ''} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
        ))}
        <Button type="submit" isLoading={busy}>Save settings</Button>
      </form>
    </Panel>
  )
}
