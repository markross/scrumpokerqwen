import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type {
  ActionResult,
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
import { joinPayload, rejoinAction, shouldAcceptState, type JoinIntent } from '@/lib/session'

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

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

function loadSession(): JoinIntent | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as JoinIntent
    if (typeof parsed.code === 'string' && typeof parsed.playerId === 'string') return parsed
    return null
  } catch {
    return null
  }
}

function saveSession(intent: JoinIntent): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(intent))
  sessionStorage.setItem(NAME_KEY, intent.name)
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

  /** The room our socket should be bound to (drives rejoin + `room:state` gating). */
  const intentRef = useRef<JoinIntent | null>(null)
  /** True once the current physical connection has been bound by a create/join ack. */
  const boundRef = useRef(false)
  /** True while a create/join emit is waiting for its ack. */
  const awaitingAckRef = useRef(false)
  /** Invalidates acks of superseded/abandoned emits (Leave, disconnect, newer op). */
  const opRef = useRef(0)

  const beginOp = useCallback((): number => {
    awaitingAckRef.current = true
    return ++opRef.current
  }, [])

  const endOp = useCallback((op: number): void => {
    if (op === opRef.current) awaitingAckRef.current = false
  }, [])

  const bindIntent = useCallback((intent: JoinIntent): void => {
    intentRef.current = intent
    boundRef.current = true
    saveSession(intent)
  }, [])

  const clearIntent = useCallback((): void => {
    intentRef.current = null
    boundRef.current = false
    clearSession()
  }, [])

  const pushRoomPath = useCallback((path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
      setLobbyTarget(null)
    }
  }, [])

  /**
   * The single join path: emit `room:join`, then share the success bookkeeping
   * (session + intent + canonical URL). Used by the code join, the name join,
   * the deep-link/back-forward join, and the stored-session resume.
   */
  const doJoin = useCallback(
    (target: RoomTarget, displayName: string, opts: { pushUrl: boolean }) => {
      setError(null)
      setBusy(true)
      const op = beginOp()
      socket.emit('room:join', joinPayload(target, displayName, meId), (result) => {
        endOp(op)
        if (!result.ok) {
          setBusy(false)
          setError(result.error)
          return
        }
        bindIntent({ code: result.code, name: displayName, playerId: meId })
        if (opts.pushUrl) {
          pushRoomPath(
            canonicalRoomPath({
              code: result.code,
              name: target.kind === 'name' ? slugifyRoomName(target.value) : null
            })
          )
        }
      })
    },
    [socket, meId, pushRoomPath, beginOp, endOp, bindIntent]
  )

  /**
   * Leave for good. Clears synchronously — offline, socket.io buffers the emit
   * and the ack may never arrive, so gating the clear on it would leave the
   * button dead and (worse) a reload would rejoin the room we just left.
   */
  const leaveRoom = useCallback(() => {
    opRef.current++
    awaitingAckRef.current = false
    clearIntent()
    setRoomBoth(null)
    setError(null)
    setBusy(false)
    // Best effort; the ack is ignored. Per-socket ordering means a join emitted
    // right after this still lands after the leave server-side.
    socket.emit('player:leave', () => {})
  }, [socket, clearIntent, setRoomBoth])

  const boundOnceRef = useRef(false)
  useEffect(() => {
    if (boundOnceRef.current) return
    boundOnceRef.current = true
    socket.on('room:state', (state) => {
      // A broadcast for a room we have no intent to be in is racing a leave.
      if (!shouldAcceptState(state, intentRef.current)) return
      setRoomBoth(state)
      setBusy(false)
      // Keep the address bar on the room's canonical path (deep links, refresh-resume).
      const canonical = canonicalRoomPath(state)
      if (window.location.pathname !== canonical) {
        window.history.replaceState(null, '', canonical)
      }
    })
    socket.on('connect', () => {
      setConnected(true)
      // socket.io reconnects the transport but not our room membership: re-issue
      // the join for the room we intend to be in, so a server restart / network
      // blip does not leave Vote/Reveal/Reset as silent no-ops.
      const rejoin = rejoinAction(intentRef.current, {
        boundOnThisSocket: boundRef.current,
        awaitingAck: awaitingAckRef.current
      })
      if (!rejoin) return
      boundRef.current = true
      const op = beginOp()
      socket.emit(
        'room:join',
        { code: rejoin.code, name: rejoin.name, playerId: rejoin.playerId },
        (result) => {
          endOp(op)
          setBusy(false)
          if (result.ok) return
          // The room is gone (memory-only restart, or the sweep got to it):
          // fall back to the lobby with our name kept and the reason shown.
          clearIntent()
          setRoomBoth(null)
          setError(result.error)
          setLobbyTarget(roomTargetFromPath(window.location.pathname))
        }
      )
    })
    socket.on('disconnect', () => {
      setConnected(false)
      // This connection is dead: nothing is in flight any more, and the next
      // connect has to rejoin even if we were mid-op.
      boundRef.current = false
      awaitingAckRef.current = false
      opRef.current++
    })

    // The URL wins over the stored session: a room path joins that room;
    // only `/` resumes the last session. Without a stored name we can't join
    // silently — the lobby shows prefilled instead.
    const initial = roomTargetFromPath(window.location.pathname)
    const storedName = readStoredName()
    if (initial) {
      if (storedName.trim().length > 0) doJoin(initial, storedName, { pushUrl: false })
    } else {
      const saved = loadSession()
      if (saved) doJoin({ kind: 'code', value: saved.code }, saved.name, { pushUrl: false })
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
      // Leave then join back to back: ordering is guaranteed per socket, and the
      // server handles the events sequentially, so no ack-wait is needed.
      if (current) leaveRoom()
      doJoin(next, readStoredName(), { pushUrl: false })
    })
  }, [socket, doJoin, leaveRoom, setRoomBoth, beginOp, endOp, bindIntent, clearIntent])

  const createRoom = useCallback(
    (name: string, roomName?: string) => {
      setError(null)
      setBusy(true)
      const op = beginOp()
      socket.emit('room:create', { name, playerId: meId, roomName }, (result) => {
        endOp(op)
        if (!result.ok) {
          setBusy(false)
          setError(result.error)
          return
        }
        bindIntent({ code: result.code, name, playerId: meId })
        pushRoomPath(
          canonicalRoomPath({
            code: result.code,
            name: roomName !== undefined && roomName.trim().length > 0 ? slugifyRoomName(roomName) : null
          })
        )
      })
    },
    [socket, meId, pushRoomPath, beginOp, endOp, bindIntent]
  )

  const joinRoom = useCallback(
    (code: string, name: string) => {
      doJoin({ kind: 'code', value: code }, name, { pushUrl: true })
    },
    [doJoin]
  )

  const joinByName = useCallback(
    (roomName: string, name: string) => {
      doJoin({ kind: 'name', value: roomName }, name, { pushUrl: true })
    },
    [doJoin]
  )

  /**
   * Room actions report refusals through the ack: a vote that lands during a
   * concurrent Reveal (or a Reveal after the room expired) used to be discarded
   * by the server with no reply at all, so the click looked like it worked.
   */
  const act = useCallback(
    (emit: (ack: (result: ActionResult) => void) => void): void => {
      setError(null)
      emit((result) => {
        if (!result.ok) setError(result.error)
      })
    },
    []
  )

  const vote = useCallback(
    (value: DeckValue) => {
      act((ack) => socket.emit('vote:place', { value }, ack))
    },
    [socket, act]
  )

  const reveal = useCallback(() => {
    act((ack) => socket.emit('room:reveal', ack))
  }, [socket, act])

  const reset = useCallback(() => {
    act((ack) => socket.emit('room:reset', ack))
  }, [socket, act])

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
