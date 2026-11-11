/**
 * Asks the Python matching engine for ranked matches.
 * Returns null when it is not configured or not reachable, so the API falls back to its built-in rules.
 * @param {{ url: string, internalKey: string }} matcher
 * @param {'requests'|'offers'} kind
 */
async function fetchMatches(matcher, kind, id, { fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  if (!matcher?.url || !matcher?.internalKey) return null;
  try {
    const res = await fetchImpl(`${matcher.url}/v1/${kind}/${id}/matches`, {
      headers: { 'X-Internal-Key': matcher.internalKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body?.matches) ? body.matches : null;
  } catch {
    return null;
  }
}

module.exports = { fetchMatches };
