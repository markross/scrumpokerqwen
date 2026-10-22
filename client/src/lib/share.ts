import { MAX_ROOM_NAME_LENGTH, looksLikeRoomCode, roomNameKey } from '@shared/naming'
import type { RoomState } from '@shared/types'

/** The room the current URL path points at: by code (`/K7XQM`) or by name (`/team-alpha`). */
export type RoomTarget = { kind: 'code'; value: string } | { kind: 'name'; value: string }

/**
 * Parse the first path segment into a room target. Code-shaped segments win
 * (creation rules prevent room names from colliding with that shape). Null for
 * `/` and for segments too long to be a room name.
 */
export function roomTargetFromPath(pathname: string): RoomTarget | null {
  const segment = pathname.split('/').filter(Boolean)[0]
  if (!segment) return null
  let value: string
  try {
    value = decodeURIComponent(segment).trim()
  } catch {
    return null
  }
  if (value.length === 0) return null
  if (looksLikeRoomCode(value)) return { kind: 'code', value: value.toUpperCase() }
  if (value.length > MAX_ROOM_NAME_LENGTH) return null
  return { kind: 'name', value }
}

/** The canonical URL path for a room: its name when it has one, else its code. */
export function canonicalRoomPath(room: Pick<RoomState, 'code' | 'name'>): string {
  return `/${encodeURIComponent(room.name ?? room.code)}`
}

/** Full shareable URL for a room (by name or code) on the given origin. */
export function roomUrl(nameOrCode: string, origin: string = window.location.origin): string {
  return `${origin}/${encodeURIComponent(nameOrCode)}`
}

/** Whether a room state already satisfies a URL target (slug-insensitive). */
export function targetMatchesRoom(
  target: RoomTarget,
  room: Pick<RoomState, 'code' | 'name'>
): boolean {
  if (target.kind === 'code') return room.code === target.value.toUpperCase()
  return room.name !== null && roomNameKey(room.name) === roomNameKey(target.value)
}
