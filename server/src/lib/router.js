const { routeKm: mockRouteKm } = require('./places');

/**
 * Road distance between two places. Uses Google's Distance Matrix API when a server key is
 * configured, and the mock router (straight line x 1.3) otherwise or if Google cannot be reached.
 */
async function roadKm(from, to, { apiKey = '', fetchImpl = fetch } = {}) {
  if (!apiKey) return mockRouteKm(from, to);
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    url.searchParams.set('origins', `${from.lat},${from.lng}`);
    url.searchParams.set('destinations', `${to.lat},${to.lng}`);
    url.searchParams.set('units', 'metric');
    url.searchParams.set('key', apiKey);
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(3000) });
    const metres = (await res.json())?.rows?.[0]?.elements?.[0]?.distance?.value;
    return metres > 0 ? Math.round(metres / 10) / 100 : mockRouteKm(from, to);
  } catch {
    return mockRouteKm(from, to);
  }
}

module.exports = { roadKm };
