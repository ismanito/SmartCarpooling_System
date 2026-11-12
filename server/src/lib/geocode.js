// Address search for pick-up and drop-off points, using OpenStreetMap's free Nominatim service.
// Results are limited to the Nairobi area and cached, because Nominatim allows about one request a second.
const VIEWBOX = '36.60,-1.45,37.15,-1.10'; // left,bottom,right,top around Nairobi
const cache = new Map();
let lastCall = 0;

async function geocode(query, { fetchImpl = fetch } = {}) {
  const q = String(query || '').trim().slice(0, 120);
  if (q.length < 3) return [];
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.results;

  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q, format: 'jsonv2', limit: '6', countrycodes: 'ke', viewbox: VIEWBOX, bounded: '1', addressdetails: '0' }).toString();
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'RideMate/1.0 (student carpool project)', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`geocoder ${res.status}`);
  const rows = await res.json();
  const results = rows.map((r) => ({
    id: `geo:${Number(r.lat).toFixed(5)},${Number(r.lon).toFixed(5)}`,
    name: String(r.display_name).split(',').slice(0, 3).join(',').trim(),
    lat: Number(r.lat),
    lng: Number(r.lon),
    geo: true,
  }));
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), results });
  return results;
}

module.exports = { geocode };
