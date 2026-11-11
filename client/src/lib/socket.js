import { io } from 'socket.io-client'
import { getFirebaseAuth } from './firebase'

let socket = null

/**
 * One shared Socket.IO connection, signed in with the Firebase token (refreshed on every reconnect).
 * If the socket cannot connect, nothing breaks: every screen also polls.
 */
export function getSocket() {
  if (socket) return socket
  const url = import.meta.env.VITE_SOCKET_URL || undefined // same origin: the dev server and Vercel proxy /socket.io
  socket = io(url, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnectionDelayMax: 10_000,
    auth: (cb) => {
      const user = getFirebaseAuth().currentUser
      if (!user) return cb({ token: '' })
      user.getIdToken().then((token) => cb({ token }), () => cb({ token: '' }))
    },
  })
  return socket
}

export function connectSocket() {
  const s = getSocket()
  if (!s.connected && !s.active) s.connect()
  return s
}

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
}
