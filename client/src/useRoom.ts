import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type {
  ClientToServerEvents,
  DeckValue,
  RoomState,
  ServerToClientEvents
} from '@shared/types'

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

interface StoredSession {
  code: string
  name: string
  playerId: string
}

const SESSION_KEY = 'scrumpoker.session'
const PLAYER_KEY = 'scrumpoker.playerId'
const NAME_KEY = 'scrumpoker.name'

function getPlayerId(): string {
  let id = sessionStorage.getItem(PLAYER_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(PLAYER_KEY, id)
  }
  return id
}

function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    if (typeof parsed.code === 'string' && typeof parsed.playerId === 'string') return parsed
    return null
  } catch {
    return null
  }
}

function saveSession(session: StoredSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  sessionStorage.setItem(NAME_KEY, session.name)
}

function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
}

export function readStoredName(): string {
  return sessionStorage.getItem(NAME_KEY) ?? ''
}

export interface RoomApi {
  room: RoomState | null
  error: string | null
  busy: boolean
  connected: boolean
  meId: string
  createRoom: (name: string, roomName?: string) => void
  joinRoom: (code: string, name: string) => void
  joinByName: (roomName: string, name: string) => void
  vote: (value: DeckValue) => void
  reveal: () => void
  reset: () => void
  leave: () => void
}

export function useRoom(): RoomApi {
  const socketRef = useRef<AppSocket | null>(null)
  if (!socketRef.current) {
    socketRef.current = io({ autoConnect: true })
  }
  const socket = socketRef.current

  const meId = useRef(getPlayerId()).current
  const [room, setRoom] = useState<RoomState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(socket.connected)

  const boundRef = useRef(false)
  useEffect(() => {
    if (boundRef.current) return
    boundRef.current = true
    socket.on('room:state', (state) => {
      setRoom(state)
      setBusy(false)
    })
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    const saved = loadSession()
    if (saved) {
      socket.emit('room:join', { code: saved.code, name: saved.name, playerId: saved.playerId }, (result) => {
        if (!result.ok) clearSession()
      })
    }
  }, [socket])

  const createRoom = useCallback(
    (name: string, roomName?: string) => {
      setError(null)
      setBusy(true)
      socket.emit('room:create', { name, playerId: meId, roomName }, (result) => {
        if (!result.ok) {
          setBusy(false)
          setError(result.error)
          return
        }
        saveSession({ code: result.code, name, playerId: meId })
      })
    },
    [socket, meId]
  )

  const joinRoom = useCallback(
    (code: string, name: string) => {
      setError(null)
      setBusy(true)
      socket.emit('room:join', { code, name, playerId: meId }, (result) => {
        if (!result.ok) {
          setBusy(false)
          setError(result.error)
          return
        }
        saveSession({ code: result.code, name, playerId: meId })
      })
    },
    [socket, meId]
  )

  const joinByName = useCallback(
    (roomName: string, name: string) => {
      setError(null)
      setBusy(true)
      socket.emit('room:join', { roomName, name, playerId: meId }, (result) => {
        if (!result.ok) {
          setBusy(false)
          setError(result.error)
          return
        }
        saveSession({ code: result.code, name, playerId: meId })
      })
    },
    [socket, meId]
  )

  const vote = useCallback(
    (value: DeckValue) => {
      socket.emit('vote:place', { value })
    },
    [socket]
  )

  const reveal = useCallback(() => {
    socket.emit('room:reveal')
  }, [socket])

  const reset = useCallback(() => {
    socket.emit('room:reset')
  }, [socket])

  const leave = useCallback(() => {
    socket.emit('player:leave', () => {
      clearSession()
      setRoom(null)
      setError(null)
    })
  }, [socket])

  return { room, error, busy, connected, meId, createRoom, joinRoom, joinByName, vote, reveal, reset, leave }
}
