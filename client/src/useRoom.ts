import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type {
  ClientToServerEvents,
  DeckValue,
  RoomState,
  ServerToClientEvents
} from '@shared/types'
import { slugifyRoomName } from '@shared/naming'

import {
  canonicalRoomPath,
  roomTargetFromPath,
  targetMatchesRoom,
  type RoomTarget
} from '@/lib/share'

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
  /** Room the URL path points at while the lobby is showing (prefill). */
  lobbyTarget: RoomTarget | null
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
  const [lobbyTarget, setLobbyTarget] = useState<RoomTarget | null>(() =>
    roomTargetFromPath(window.location.pathname)
  )

  const roomRef = useRef<RoomState | null>(null)
  const setRoomBoth = useCallback((state: RoomState | null) => {
    roomRef.current = state
    setRoom(state)
  }, [])

  const pushRoomPath = useCallback((path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
      setLobbyTarget(null)
    }
  }, [])

  /** Join the room a URL target names; the stored display name is reused on back/forward. */
  const joinTarget = useCallback(
    (target: RoomTarget, displayName: string, pushUrl: boolean) => {
      setError(null)
      setBusy(true)
      const payload =
        target.kind === 'code'
          ? { code: target.value, name: displayName, playerId: meId }
          : { roomName: target.value, name: displayName, playerId: meId }
      socket.emit('room:join', payload, (result) => {
        if (!result.ok) {
          setBusy(false)
          setError(result.error)
          return
        }
        saveSession({ code: result.code, name: displayName, playerId: meId })
        if (pushUrl) {
          pushRoomPath(
            canonicalRoomPath({
              code: result.code,
              name: target.kind === 'name' ? slugifyRoomName(target.value) : null
            })
          )
        }
      })
    },
    [socket, meId, pushRoomPath]
  )

  const leaveRoom = useCallback(() => {
    socket.emit('player:leave', () => {
      clearSession()
      setRoomBoth(null)
      setError(null)
    })
  }, [socket, setRoomBoth])

  const boundRef = useRef(false)
  useEffect(() => {
    if (boundRef.current) return
    boundRef.current = true
    socket.on('room:state', (state) => {
      setRoomBoth(state)
      setBusy(false)
      // Keep the address bar on the room's canonical path (deep links, refresh-resume).
      const canonical = canonicalRoomPath(state)
      if (window.location.pathname !== canonical) {
        window.history.replaceState(null, '', canonical)
      }
    })
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    // The URL wins over the stored session: a room path joins that room;
    // only `/` resumes the last session. Without a stored name we can't join
    // silently — the lobby shows prefilled instead.
    const initial = roomTargetFromPath(window.location.pathname)
    const storedName = readStoredName()
    if (initial) {
      if (storedName.trim().length > 0) joinTarget(initial, storedName, false)
    } else {
      const saved = loadSession()
      if (saved) {
        socket.emit(
          'room:join',
          { code: saved.code, name: saved.name, playerId: saved.playerId },
          (result) => {
            if (!result.ok) clearSession()
          }
        )
      }
    }

    window.addEventListener('popstate', () => {
      const next = roomTargetFromPath(window.location.pathname)
      setLobbyTarget(next)
      const current = roomRef.current
      if (!next) {
        if (current) leaveRoom()
        return
      }
      if (current && targetMatchesRoom(next, current)) return
      if (current) {
        socket.emit('player:leave', () => {
          clearSession()
          setRoomBoth(null)
          joinTarget(next, readStoredName(), false)
        })
      } else {
        joinTarget(next, readStoredName(), false)
      }
    })
  }, [socket, joinTarget, leaveRoom, setRoomBoth])

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
        pushRoomPath(
          canonicalRoomPath({
            code: result.code,
            name: roomName !== undefined && roomName.trim().length > 0 ? slugifyRoomName(roomName) : null
          })
        )
      })
    },
    [socket, meId, pushRoomPath]
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
        pushRoomPath(canonicalRoomPath({ code: result.code, name: null }))
      })
    },
    [socket, meId, pushRoomPath]
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
        pushRoomPath(
          canonicalRoomPath({ code: result.code, name: slugifyRoomName(roomName) })
        )
      })
    },
    [socket, meId, pushRoomPath]
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
    leaveRoom()
    if (window.location.pathname !== '/') {
      window.history.pushState(null, '', '/')
      setLobbyTarget(null)
    }
  }, [leaveRoom])

  return {
    room,
    error,
    busy,
    connected,
    meId,
    lobbyTarget,
    createRoom,
    joinRoom,
    joinByName,
    vote,
    reveal,
    reset,
    leave
  }
}
