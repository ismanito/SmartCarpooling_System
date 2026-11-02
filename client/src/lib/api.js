import { getFirebaseAuth } from './firebase'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

/** Mirrors the server's `{ error: { code, message, details } }` format. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const user = getFirebaseAuth().currentUser
    if (!user) throw new ApiError(401, 'AUTH_MISSING_TOKEN', 'Sign in to continue.')
    headers.Authorization = `Bearer ${await user.getIdToken()}`
  }

  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach RideMate. Check your connection and try again.')
  }

  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = data?.error
    throw new ApiError(res.status, err?.code || 'UNKNOWN_ERROR', err?.message || 'Something went wrong.', err?.details)
  }
  return data
}

export const api = {
  allowedDomains: () => request('/auth/domains', { auth: false }),
  checkDomain: (email) => request('/auth/check-domain', { method: 'POST', body: { email }, auth: false }),
  startSession: () => request('/auth/session', { method: 'POST' }),
  getMe: () => request('/users/me'),
  createProfile: (profile) => request('/users', { method: 'POST', body: profile }),
  updateProfile: (changes) => request('/users/me', { method: 'PUT', body: changes }),
  listVehicles: () => request('/vehicles/mine'),
  createVehicle: (vehicle) => request('/vehicles', { method: 'POST', body: vehicle }),
  updateVehicle: (id, changes) => request(`/vehicles/${id}`, { method: 'PUT', body: changes }),
  deleteVehicle: (id) => request(`/vehicles/${id}`, { method: 'DELETE' }),
}

/** Copies server field errors onto react-hook-form fields. Returns true if any were applied. */
export function applyFieldErrors(error, setError) {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return false
  let applied = false
  for (const d of error.details) {
    if (d.field) {
      setError(d.field, { type: 'server', message: d.message })
      applied = true
    }
  }
  return applied
}
