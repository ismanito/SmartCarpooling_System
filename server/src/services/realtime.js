/**
 * Real-time push over Socket.IO. Each signed-in person joins a private room, and the server pushes small
 * "something changed" events that the apps answer by re-reading the REST endpoints. The apps also poll,
 * so everything still works if the socket drops.
 */
let io = null;
let sink = null; // tests replace this to capture what would have been pushed

/** Attaches Socket.IO to the HTTP server. The Firebase token is checked on connect. */
function init(httpServer, { verifyIdToken, findUserByFirebaseUid, corsOrigin }) {
  const { Server } = require('socket.io');
  io = new Server(httpServer, { cors: { origin: corsOrigin }, path: '/socket.io' });
  io.use(async (socket, next) => {
    try {
      const identity = await verifyIdToken(socket.handshake.auth?.token || '');
      if (!identity.emailVerified) return next(new Error('unverified'));
      const user = await findUserByFirebaseUid(identity.uid);
      if (!user || user.status !== 'active') return next(new Error('no_profile'));
      socket.data.userId = user.user_id;
      socket.data.role = user.role;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);
    if (socket.data.role === 'admin') socket.join('admins');
  });
  return io;
}

/** Pushes an event to one person. Never throws: a missing socket must not break a ride. */
function emitToUser(userId, event, payload = {}) {
  try {
    if (sink) sink({ userId, event, payload });
    io?.to(`user:${userId}`).emit(event, payload);
  } catch {
    /* best effort */
  }
}

function emitToAdmins(event, payload = {}) {
  try {
    if (sink) sink({ userId: 'admins', event, payload });
    io?.to('admins').emit(event, payload);
  } catch {
    /* best effort */
  }
}

function setSink(fn) {
  sink = fn;
}

module.exports = { init, emitToUser, emitToAdmins, setSink };
