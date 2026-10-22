import type { JoinPayload, RoomState } from '@shared/types'

import type { RoomTarget } from '@/lib/share'

/**
 * The room our socket *should* be bound to — the single source of truth for
 * "where do I rejoin after a reconnect". Set when a create/join ack succeeds,
 * cleared on Leave and when a rejoin comes back not-found. Mirrors the
 * sessionStorage session (same shape, kept in sync by `useRoom`).
 */
export interface JoinIntent {
  code: string
  /** Our own display name; the server keeps the seat by `playerId`. */
  name: string
  playerId: string
}

/** The `room:join` wire payload for a URL target (by code or by name). */
export function joinPayload(target: RoomTarget, name: string, playerId: string): JoinPayload {
  return target.kind === 'code'
    ? { code: target.value, name, playerId }
    : { roomName: target.value, name, playerId }
}

/**
 * Whether a `room:state` broadcast may be applied to the view. The server only
 * targets sockets it has attached, so an event for a room we have no intent to
 * be in is by definition racing a Leave (or a cross-room navigation) — dropping
 * it here stops both the stale view and the stale URL from resurrecting.
 */
export function shouldAcceptState(
  state: Pick<RoomState, 'code'>,
  intent: JoinIntent | null
): boolean {
  return intent !== null && state.code === intent.code
}

/**
 * The rejoin to issue when a (re)connect lands, or null to leave the socket
 * alone: no room intent, this physical connection is already bound, or a
 * create/join is still waiting for its ack (`awaitingAck` prevents a
 * double-join race against the initial join).
 */
export function rejoinAction(
  intent: JoinIntent | null,
  opts: { boundOnThisSocket: boolean; awaitingAck: boolean }
): JoinIntent | null {
  if (intent === null) return null
  if (opts.boundOnThisSocket || opts.awaitingAck) return null
  return intent
}
