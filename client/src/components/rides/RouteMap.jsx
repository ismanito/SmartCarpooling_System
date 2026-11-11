import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const USIU = [-1.2195, 36.8789]

/** Map of the chosen pick-up and drop-off. Uses OpenStreetMap tiles, which need no API key. */
function carIcon(heading) {
  const rotate = Number.isFinite(heading) ? heading : 0
  return L.divIcon({
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="width:34px;height:34px;border-radius:50%;background:#f8e16c;border:3px solid #0b3336;box-shadow:0 0 0 6px rgba(1,196,154,.35);display:flex;align-items:center;justify-content:center;transform:rotate(${rotate}deg)"><div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:12px solid #0b3336"></div></div>`,
  })
}

/** `live` ({ lat, lng, heading }) puts a moving car on the map; it follows updates without resetting the view. */
export function RouteMap({ from, to, live = null, className = '' }) {
  const box = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)
  const car = useRef(null)

  useEffect(() => {
    if (!box.current) return undefined
    const m = L.map(box.current, { scrollWheelZoom: false }).setView(USIU, 12)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m)
    map.current = m
    layer.current = L.layerGroup().addTo(m)
    // The panel beside the map can change height; keep the map filling it.
    const resize = new ResizeObserver(() => m.invalidateSize())
    resize.observe(box.current)
    return () => {
      resize.disconnect()
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    layer.current.clearLayers()
    const stops = [from && { ...from, color: '#01c49a' }, to && { ...to, color: '#fb8f67' }].filter(Boolean)
    for (const s of stops) {
      L.circleMarker([s.lat, s.lng], { radius: 9, color: '#0b3336', weight: 3, fillColor: s.color, fillOpacity: 1 })
        .bindTooltip(s.name, { permanent: true, direction: 'top', offset: [0, -8] })
        .addTo(layer.current)
    }
    if (from && to) {
      const line = [[from.lat, from.lng], [to.lat, to.lng]]
      L.polyline(line, { color: '#0b3336', weight: 7, opacity: 0.85 }).addTo(layer.current)
      L.polyline(line, { color: '#f8e16c', weight: 2, dashArray: '8 8' }).addTo(layer.current)
      m.fitBounds(line, { padding: [48, 48], maxZoom: 14 })
    } else if (stops[0]) {
      m.setView([stops[0].lat, stops[0].lng], 13)
    }
  }, [from, to])

  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!live) {
      car.current?.remove()
      car.current = null
      return
    }
    const pos = [live.lat, live.lng]
    if (car.current) {
      car.current.setLatLng(pos)
      car.current.setIcon(carIcon(live.heading))
    } else {
      car.current = L.marker(pos, { icon: carIcon(live.heading), zIndexOffset: 1000, keyboard: false }).bindTooltip('Driver', { direction: 'top', offset: [0, -16] }).addTo(m)
    }
    if (!m.getBounds().contains(pos)) m.panTo(pos)
  }, [live])

  return (
    <div
      ref={box}
      role="img"
      aria-label={from && to ? `Map from ${from.name} to ${to.name}${live ? ', with the driver’s live position' : ''}` : 'Map of Nairobi around USIU-Africa'}
      className={`isolate min-h-64 overflow-hidden rounded-(--radius-panel) border border-ink/20 bg-paper-deep ${className}`}
    />
  )
}
