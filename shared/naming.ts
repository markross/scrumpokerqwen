export const MAX_ROOM_NAME_LENGTH = 40

const CONTROL_CHARS = /\p{Cc}/u

/** Trims and collapses internal whitespace runs to single spaces. */
export function normalizeRoomName(input: string): string {
  return input.trim().replace(/\s+/g, ' ')
}

/** Case-insensitive identity of a room name (used for uniqueness + lookup). */
export function roomNameKey(input: string): string {
  return normalizeRoomName(input).toLowerCase()
}

export function validRoomName(input: string): boolean {
  const normalized = normalizeRoomName(input)
  if (normalized.length < 1 || normalized.length > MAX_ROOM_NAME_LENGTH) return false
  return !CONTROL_CHARS.test(normalized)
}
