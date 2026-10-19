import path from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server, type Socket } from 'socket.io'
import type {
  ClientToServerEvents,
  DeckValue,
  ServerToClientEvents
} from '../shared/types.js'
import * as rooms from './rooms.js'

interface SocketData {
  code?: string
  playerId?: string
}

type RoomSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

const app = express()
const httpServer = createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
  httpServer,
  {
    cors: {
      origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true
    }
  }
)

const store: rooms.Store = new Map()

function broadcast(code: string): void {
  const room = store.get(code)
  if (!room) return
  for (const player of room.players.values()) {
    if (player.socketId) {
      io.to(player.socketId).emit('room:state', rooms.getView(room, player.id))
    }
  }
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
  res.json({ ok: true, rooms: store.size })
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
  socket.on('room:create', (payload, ack) => {
    if (socket.data.code) {
      ack({ ok: false, error: 'You are already in a room. Leave it first.' })
      return
    }
    const result = rooms.createRoom(store, payload.name, payload.playerId)
    if (!result.ok) {
      ack(result)
      return
    }
    attach(socket, result.value.code, payload.playerId)
    ack({ ok: true, code: result.value.code })
    broadcast(result.value.code)
  })

  socket.on('room:join', (payload, ack) => {
    if (socket.data.code) {
      ack({ ok: false, error: 'You are already in a room. Leave it first.' })
      return
    }
    if (!payload.code) {
      ack({ ok: false, error: 'Enter a room code to join.' })
      return
    }
    const result = rooms.joinRoom(store, payload.code, payload.name, payload.playerId)
    if (!result.ok) {
      ack(result)
      return
    }
    attach(socket, result.value.code, payload.playerId)
    ack({ ok: true, code: result.value.code })
    broadcast(result.value.code)
  })

  socket.on('vote:place', (payload) => {
    const { code, playerId } = socket.data
    if (!code || !playerId) return
    const result = rooms.placeVote(store, code, playerId, payload.value as DeckValue)
    if (result.ok) broadcast(code)
  })

  socket.on('room:reveal', () => {
    const { code } = socket.data
    if (!code) return
    const result = rooms.revealRoom(store, code)
    if (result.ok) broadcast(code)
  })

  socket.on('room:reset', () => {
    const { code } = socket.data
    if (!code) return
    const result = rooms.resetRoom(store, code)
    if (result.ok) broadcast(code)
  })

  socket.on('player:leave', (ack) => {
    const { code, playerId } = socket.data
    if (code && playerId) {
      rooms.removePlayer(store, code, playerId)
      detach(socket)
      broadcast(code)
    }
    ack({ ok: true })
  })

  socket.on('disconnect', () => {
    const { code } = socket.data
    detach(socket)
    if (code) broadcast(code)
  })
})

const sweeper = setInterval(() => rooms.sweepStaleRooms(store), 10 * 60 * 1000)
sweeper.unref()

const port = Number(process.env.PORT ?? 3001)
httpServer.listen(port, () => {
  console.log(`Scrum Poker server listening on http://localhost:${port}`)
})
