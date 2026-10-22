import path from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server, type Socket } from 'socket.io'
import type {
  ClientToServerEvents,
  DeckValue,
  JoinPayload,
  ServerToClientEvents
} from '../shared/types.js'
import * as rooms from './rooms.js'
import { createRepository } from './persistence.js'

interface SocketData {
  code?: string
  playerId?: string
}

type RoomSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

/**
 * socket.io dispatches event listeners via `emitUntyped` inside
 * `process.nextTick` with no try/catch, so a synchronous throw in a handler
 * (e.g. from a malformed packet) becomes an uncaughtException that kills the
 * whole process. Register every socket handler through this wrapper: a bad
 * packet is logged and dropped, never fatal (same principle as the
 * persistence-error invariant).
 */
function onEvent<S extends keyof ClientToServerEvents>(
  socket: RoomSocket,
  event: S,
  handler: (...args: Parameters<ClientToServerEvents[S]>) => void
): void {
  const listener = (...args: unknown[]): void => {
    try {
      handler(...(args as Parameters<ClientToServerEvents[S]>))
    } catch (err) {
      console.warn(`Dropped malformed "${String(event)}" packet from socket ${socket.id}.`, err)
    }
  }
  // socket.io's overloaded `on` cannot infer its listener type through a
  // generic event key; the wrapper's signature is exactly what the matching
  // overload expects, so cast the method at this single boundary.
  ;(socket.on as unknown as (ev: S, listener: (...args: unknown[]) => void) => unknown)(event, listener)
}

/** Never assume the client supplied the ack callback; a missing one is a no-op. */
function safeAck<A extends unknown[]>(ack: ((...args: A) => void) | undefined): (...args: A) => void {
  return typeof ack === 'function' ? ack : () => {}
}

const isString = (value: unknown): value is string => typeof value === 'string'

/** Shape check for wire data before it reaches the pure `rooms.*` functions. */
function isJoinPayload(candidate: unknown): candidate is JoinPayload {
  if (typeof candidate !== 'object' || candidate === null) return false
  const payload = candidate as Partial<JoinPayload>
  return (
    isString(payload.name) &&
    isString(payload.playerId) &&
    (payload.code === undefined || isString(payload.code)) &&
    (payload.roomName === undefined || isString(payload.roomName))
  )
}

const app = express()
export const httpServer = createServer(app)
export const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
  httpServer,
  {
    cors: {
      origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true
    }
  }
)

const store: rooms.Store = new Map()
export const repository = createRepository()

function broadcast(code: string): void {
  const room = store.get(code)
  if (!room) return
  for (const player of room.players.values()) {
    if (player.socketId) {
      io.to(player.socketId).emit('room:state', rooms.getView(room, player.id))
    }
  }
}

/** Queue the room's latest snapshot for durable storage (no-op on socket-only changes). */
function persist(code: string): void {
  const room = store.get(code)
  if (room) repository.save(rooms.serializeRoom(room))
}

function attach(socket: RoomSocket, code: string, playerId: string): void {
  if (socket.data.code && socket.data.playerId) {
    rooms.detachSocket(store, socket.data.code, socket.data.playerId, socket.id)
  }
  rooms.attachSocket(store, code, playerId, socket.id)
  socket.data.code = rooms.normalizeCode(code)
  socket.data.playerId = playerId
}

function detach(socket: RoomSocket): void {
  if (socket.data.code && socket.data.playerId) {
    rooms.detachSocket(store, socket.data.code, socket.data.playerId, socket.id)
  }
  socket.data.code = undefined
  socket.data.playerId = undefined
}

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: store.size, persistence: repository.mode })
})

const dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDist = path.resolve(dirname, '../../../client/dist')
app.use(express.static(clientDist))
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/socket.io')) {
    res.sendFile(path.join(clientDist, 'index.html'))
  } else {
    next()
  }
})

io.on('connection', (socket) => {
  onEvent(socket, 'room:create', (payload, ack) => {
    const reply = safeAck(ack)
    if (socket.data.code) {
      reply({ ok: false, error: 'You are already in a room. Leave it first.' })
      return
    }
    if (!isJoinPayload(payload)) {
      reply({ ok: false, error: 'Malformed request.' })
      return
    }
    const result = rooms.createRoom(store, payload.name, payload.playerId, payload.roomName)
    if (!result.ok) {
      reply(result)
      return
    }
    attach(socket, result.value.code, payload.playerId)
    persist(result.value.code)
    reply({ ok: true, code: result.value.code })
    broadcast(result.value.code)
  })

  onEvent(socket, 'room:join', (payload, ack) => {
    const reply = safeAck(ack)
    if (socket.data.code) {
      reply({ ok: false, error: 'You are already in a room. Leave it first.' })
      return
    }
    if (!isJoinPayload(payload)) {
      reply({ ok: false, error: 'Malformed request.' })
      return
    }
    if (!payload.code && !payload.roomName) {
      reply({ ok: false, error: 'Enter a room code or room name to join.' })
      return
    }
    const result = payload.code
      ? rooms.joinRoom(store, payload.code, payload.name, payload.playerId)
      : rooms.joinRoomByName(store, payload.roomName!, payload.name, payload.playerId)
    if (!result.ok) {
      reply(result)
      return
    }
    attach(socket, result.value.code, payload.playerId)
    persist(result.value.code)
    reply({ ok: true, code: result.value.code })
    broadcast(result.value.code)
  })

  onEvent(socket, 'vote:place', (payload) => {
    const { code, playerId } = socket.data
    if (!code || !playerId) return
    if (!payload || !isString(payload.value)) return
    const result = rooms.placeVote(store, code, playerId, payload.value as DeckValue)
    if (result.ok) {
      persist(code)
      broadcast(code)
    }
  })

  onEvent(socket, 'room:reveal', () => {
    const { code } = socket.data
    if (!code) return
    const result = rooms.revealRoom(store, code)
    if (result.ok) {
      persist(code)
      broadcast(code)
    }
  })

  onEvent(socket, 'room:reset', () => {
    const { code } = socket.data
    if (!code) return
    const result = rooms.resetRoom(store, code)
    if (result.ok) {
      persist(code)
      broadcast(code)
    }
  })

  onEvent(socket, 'player:leave', (ack) => {
    const reply = safeAck(ack)
    const { code, playerId } = socket.data
    if (code && playerId) {
      rooms.removePlayer(store, code, playerId)
      detach(socket)
      persist(code)
      broadcast(code)
    }
    reply({ ok: true })
  })

  // Reads no wire data (only server-set socket.data), so it needs no wrapper.
  socket.on('disconnect', () => {
    const { code } = socket.data
    detach(socket)
    if (code) broadcast(code)
  })
})

const sweeper = setInterval(() => {
  for (const code of rooms.sweepStaleRooms(store)) repository.remove(code)
}, 10 * 60 * 1000)
sweeper.unref()

const port = Number(process.env.PORT ?? 3001)
if (!process.env.VITEST) {
  void (async () => {
    try {
      const snapshots = await repository.loadAll()
      rooms.hydrateStore(store, snapshots)
      if (snapshots.length) console.log(`Restored ${snapshots.length} room(s) from ${repository.mode}`)
    } catch (err) {
      console.warn('Could not restore rooms on startup; starting empty.', err)
    }
    httpServer.listen(port, () => {
      console.log(`Scrum Poker server listening on http://localhost:${port} (persistence: ${repository.mode})`)
    })
  })()

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    httpServer.close()
    await repository.close()
    process.exit(0)
  }
  process.once('SIGTERM', () => void shutdown())
  process.once('SIGINT', () => void shutdown())
}
