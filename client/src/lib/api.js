import { signOut } from 'firebase/auth'
import { getFirebaseAuth } from './firebase'

/** Firebase codes meaning the stored sign-in can never work again (account deleted, token revoked…). */
export const DEAD_SESSION_CODES = new Set([
  'auth/invalid-refresh-token',
  'auth/user-token-expired',
  'auth/user-not-found',
  'auth/user-disabled',
])

function sessionExpired() {
  signOut(getFirebaseAuth()).catch(() => {}) // ProtectedRoute then sends the user to /login
  return new ApiError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.')
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

/** Mirrors the server's `{ error: { code, message, details } }` format. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
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
    let token
    try {
      token = await user.getIdToken()
    } catch (err) {
      if (DEAD_SESSION_CODES.has(err?.code)) throw sessionExpired()
      throw err
    }
    headers.Authorization = `Bearer ${token}`
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
    if (auth && res.status === 401 && err?.code === 'AUTH_INVALID_TOKEN') throw sessionExpired()
    throw new ApiError(res.status, err?.code || 'UNKNOWN_ERROR', err?.message || 'Something went wrong.', err?.details)
  }
  return data
}

/** Downloads a file from an authenticated endpoint (a plain link cannot send the sign-in token). */
export async function download(path, fallbackName) {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new ApiError(401, 'AUTH_MISSING_TOKEN', 'Sign in to continue.')
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiError(res.status, data?.error?.code || 'UNKNOWN_ERROR', data?.error?.message || 'Could not download that file.')
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const qs = (params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  return q.size ? `?${q}` : ''
}

export const api = {
  allowedDomains: () => request('/auth/domains', { auth: false }),
  checkDomain: (email) => request('/auth/check-domain', { method: 'POST', body: { email }, auth: false }),
  startSession: () => request('/auth/session', { method: 'POST' }),
  demoVerify: () => request('/auth/demo-verify', { method: 'POST' }),
  driverApplication: () => request('/drivers/application'),
  reapplyDriver: (body) => request('/drivers/application', { method: 'POST', body }),
  adminDrivers: (status) => request(`/admin/drivers${qs({ status })}`),
  adminDriverDecision: (id, body) => request(`/admin/drivers/${id}/decision`, { method: 'POST', body }),
  getMe: () => request('/users/me'),
  createProfile: (profile) => request('/users', { method: 'POST', body: profile }),
  updateProfile: (changes) => request('/users/me', { method: 'PUT', body: changes }),
  listVehicles: () => request('/vehicles/mine'),
  createVehicle: (vehicle) => request('/vehicles', { method: 'POST', body: vehicle }),
  updateVehicle: (id, changes) => request(`/vehicles/${id}`, { method: 'PUT', body: changes }),
  deleteVehicle: (id) => request(`/vehicles/${id}`, { method: 'DELETE' }),

  // Rides
  places: () => request('/rides/places'),
  createOffer: (offer) => request('/rides/offers', { method: 'POST', body: offer }),
  myOffers: () => request('/rides/offers/mine'),
  offerMatches: (id) => request(`/rides/offers/${id}/matches`),
  cancelOffer: (id) => request(`/rides/offers/${id}/cancel`, { method: 'POST' }),
  createRequest: (req) => request('/rides/requests', { method: 'POST', body: req }),
  myRequests: () => request('/rides/requests/mine'),
  requestMatches: (id) => request(`/rides/requests/${id}/matches`),
  cancelRequest: (id) => request(`/rides/requests/${id}/cancel`, { method: 'POST' }),
  book: (offerId, requestId) => request('/rides/bookings', { method: 'POST', body: { offerId, requestId } }),
  bookingAction: (id, action) => request(`/rides/bookings/${id}/${action}`, { method: 'POST' }),
  completeOffer: (id) => request(`/rides/offers/${id}/complete`, { method: 'POST' }),
  rateBooking: (id, stars) => request(`/rides/bookings/${id}/rate`, { method: 'POST', body: { stars } }),

  // Notifications, ride details, reports
  notifications: () => request('/notifications'),
  markRead: (id) => request(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request('/notifications/read-all', { method: 'POST' }),
  tripDetails: (offerId) => request(`/rides/trips/${offerId}`),
  tripLocation: (offerId) => request(`/rides/trips/${offerId}/location`),
  sendLocation: (offerId, body) => request(`/rides/trips/${offerId}/location`, { method: 'POST', body }),
  stopLocation: (offerId) => request(`/rides/trips/${offerId}/location`, { method: 'DELETE' }),
  rate: (bookingId, body) => request(`/rides/bookings/${bookingId}/rate`, { method: 'POST', body }),
  reportIncident: (bookingId, body) => request(`/rides/bookings/${bookingId}/incidents`, { method: 'POST', body }),
  settleShare: (shareId) => request(`/payments/shares/${shareId}/settle`, { method: 'POST' }),
  cancelBooking: (bookingId) => request(`/rides/bookings/${bookingId}/cancel`, { method: 'POST' }),

  // Payments
  myPayments: () => request('/payments/mine'),
  myEarnings: () => request('/payments/earnings'),
  splitFare: (bookingId, emails) => request(`/payments/bookings/${bookingId}/split`, { method: 'POST', body: { emails } }),
  payShare: (shareId, body) => request(`/payments/shares/${shareId}/pay`, { method: 'POST', body }),

  // Admin
  adminPayments: () => request('/admin/payments'),
  adminDashboard: (range = {}) => request(`/admin/stats${qs(range)}`),
  adminDownloadCsv: (range = {}) => download(`/admin/stats.csv${qs(range)}`, 'ridemate-stats.csv'),
  adminIncidents: (status) => request(`/admin/incidents${qs({ status })}`),
  adminIncident: (id) => request(`/admin/incidents/${id}`),
  adminDecide: (id, body) => request(`/admin/incidents/${id}/decision`, { method: 'POST', body }),
  adminDownloadEvidence: (id) => download(`/admin/incidents/${id}/evidence`, `evidence-${id}.json`),
  adminSuspend: (id) => request(`/admin/users/${id}/suspend`, { method: 'POST' }),
  adminReinstate: (id) => request(`/admin/users/${id}/reinstate`, { method: 'POST' }),
  adminStats: () => request('/admin/stats'),
  adminVerifyAudit: () => request('/admin/audit/verify'),
  adminAudit: (before, filters = {}) => request(`/admin/audit${qs({ limit: 50, before, ...filters })}`),
  adminUsers: (search = '', filters = {}) => request(`/admin/users${qs({ search, ...filters })}`),
  adminSetUserStatus: (id, status) => request(`/admin/users/${id}/status`, { method: 'POST', body: { status } }),
  adminSettings: () => request('/admin/settings'),
  adminSaveSettings: (settings) => request('/admin/settings', { method: 'PUT', body: settings }),
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
