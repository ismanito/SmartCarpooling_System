import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { carIcon } from '../rides/RouteMap.jsx'

const NAIROBI = [-1.2195, 36.8789]

const pinIcon = (color, text = '', pulse = false) =>
  L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div style="width:30px;height:30px;border-radius:50%;background:${color};border:3px solid #0b3336;color:#0b3336;font:600 13px/24px Heebo,sans-serif;text-align:center;${pulse ? 'box-shadow:0 0 0 7px rgba(1,196,154,.35);' : ''}">${text}</div>`,
  })

/**
 * Map used by the Ride Now apps (OpenStreetMap, no key). It updates markers and the car in place, so the view does
 * not jump when data refreshes. The view refits only when `fitKey` changes.
 *
 * markers: [{ id, lat, lng, color, text, pulse, draggable, onDrag(lat, lng) }]
 * polygons: [{ id, rings: [[lat, lng], ...][], color, label }]   (admin zone view)
 */
export function LiveMap({ markers = [], car = null, route = null, polygons = [], fitKey = '', className = '', label = 'Map', onMapClick }) {
  const box = useRef(null)
  const map = useRef(null)
  const layers = useRef({ markers: new Map(), car: null, route: null, polygons: null })
  const lastFit = useRef('')
  const clickRef = useRef(onMapClick)
  useEffect(() => {
    clickRef.current = onMapClick
  }, [onMapClick])

  useEffect(() => {
    if (!box.current) return undefined
    const m = L.map(box.current, { scrollWheelZoom: false, zoomControl: false }).setView(NAIROBI, 13)
    L.control.zoom({ position: 'topright' }).addTo(m)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(m)
    m.on('click', (e) => clickRef.current?.(e.latlng.lat, e.latlng.lng))
    map.current = m
    lastFit.current = '' // a fresh map has not been fitted yet (React StrictMode rebuilds it in development)
    if (import.meta.env.DEV) window.__liveMap = m // lets browser tests inspect the view
    layers.current.polygons = L.layerGroup().addTo(m)
    const resize = new ResizeObserver(() => m.invalidateSize())
    resize.observe(box.current)
    const l = layers.current
    return () => {
      resize.disconnect()
      m.remove()
      map.current = null
      l.markers = new Map()
      l.car = null
      l.route = null
    }
  }, [])

  // Pins: move existing ones, add new ones, drop the ones that went away.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const l = layers.current
    const seen = new Set()
    for (const p of markers) {
      seen.add(p.id)
      let marker = l.markers.get(p.id)
      if (!marker) {
        marker = L.marker([p.lat, p.lng], { icon: pinIcon(p.color, p.text, p.pulse), draggable: Boolean(p.draggable), keyboard: false }).addTo(m)
        l.markers.set(p.id, marker)
      } else {
        if (!marker.dragging?.moving?.()) marker.setLatLng([p.lat, p.lng])
        marker.setIcon(pinIcon(p.color, p.text, p.pulse))
      }
      marker.off('dragend')
      if (p.draggable && p.onDrag) {
        marker.on('dragend', () => {
          const ll = marker.getLatLng()
          p.onDrag(ll.lat, ll.lng)
        })
      }
    }
    for (const [id, marker] of l.markers) {
      if (!seen.has(id)) {
        marker.remove()
        l.markers.delete(id)
      }
    }
  }, [markers])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const l = layers.current
    if (!car) {
      l.car?.remove()
      l.car = null
      return
    }
    const pos = [car.lat, car.lng]
    if (l.car) {
      l.car.setLatLng(pos)
      l.car.setIcon(carIcon(car.heading))
    } else {
      l.car = L.marker(pos, { icon: carIcon(car.heading), zIndexOffset: 1000, keyboard: false }).addTo(m)
    }
  }, [car])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const l = layers.current
    l.route?.remove()
    l.route = null
    if (route && route.length > 1) {
      l.route = L.layerGroup([L.polyline(route, { color: '#0b3336', weight: 7, opacity: 0.85 }), L.polyline(route, { color: '#f8e16c', weight: 2, dashArray: '8 8' })]).addTo(m)
    }
  }, [route])

  useEffect(() => {
    const g = layers.current.polygons
    if (!g) return
    g.clearLayers()
    for (const p of polygons) {
      const poly = L.polygon(p.rings, { color: p.color || '#156064', weight: 2, fillOpacity: 0.12 }).addTo(g)
      if (p.label) poly.bindTooltip(p.label, { sticky: true })
      if (p.onClick) poly.on('click', () => p.onClick(p.id))
    }
  }, [polygons])

  // Refit only when asked to (a new route, a new stop list), never on every refresh.
  useEffect(() => {
    const m = map.current
    if (!m || lastFit.current === fitKey) return
    lastFit.current = fitKey
    m.invalidateSize() // the box may have only just been laid out
    const pts = [...markers.map((p) => [p.lat, p.lng]), ...(car ? [[car.lat, car.lng]] : [])]
    if (polygons.length && pts.length === 0) {
      m.fitBounds(polygons.flatMap((p) => p.rings.flat()), { padding: [24, 24] })
    } else if (pts.length > 1) m.fitBounds(pts, { padding: [70, 70], maxZoom: 15 })
    else if (pts.length === 1) m.setView(pts[0], 15)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])

  return <div ref={box} role="img" aria-label={label} className={`isolate bg-paper-deep ${className}`} />
}
