export const MAX_ROOM_NAME_LENGTH = 40

/** No-lookalike alphabet used for room codes (server generates, client recognizes). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * True when a URL path segment has the shape of a room code (3–5 chars from the
 * code alphabet, case-insensitive), so `/XYZ` resolves as a code, not a name.
 */
export function looksLikeRoomCode(segment: string): boolean {
  const raw = segment.trim().toUpperCase()
  if (raw.length < 3 || raw.length > 5) return false
  return [...raw].every((ch) => CODE_ALPHABET.includes(ch))
}

/** Names that would collide with server routes if used as a URL path. */
export const RESERVED_ROOM_NAMES: readonly string[] = ['healthz']

/**
 * URL-safe form of a room name: lowercased, runs of whitespace/underscores
 * collapse to single hyphens, leading/trailing hyphens stripped.
 */
export function slugifyRoomName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
}

/**
 * Case-insensitive identity of a room name — used for uniqueness, join-by-name
 * lookup, and URL paths. Legacy persisted names (e.g. "Team Alpha") slugify to
 * the same key as their URL form, so they stay joinable at `/<slug>`.
 */
export function roomNameKey(input: string): string {
  return slugifyRoomName(input)
}

/**
 * Creation-time rules for a room name: after slugifying it must be 1–40 chars
 * of letters/digits/hyphens, not shaped like a room code, and not reserved.
 * Returns an error message, or null when the name is usable — the stored name
 * is its slug.
 */
export function validateNewRoomName(input: string): string | null {
  const slug = slugifyRoomName(input)
  if (slug.length === 0) return 'Enter a room name (letters, numbers, spaces or hyphens).'
  if (slug.length > MAX_ROOM_NAME_LENGTH) {
    return `Please enter a room name (1–${MAX_ROOM_NAME_LENGTH} characters).`
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return 'Room names can only use letters, numbers, spaces and hyphens.'
  }
  if (looksLikeRoomCode(slug)) {
    return "Room names can't be 3–5 letters/digits — that shape is reserved for room codes."
  }
  if (RESERVED_ROOM_NAMES.includes(slug)) return 'That room name is reserved. Pick a different name.'
  return null
}

/** Convenience wrapper: a name is valid when it passes the creation rules. */
export function validRoomName(input: string): boolean {
  return validateNewRoomName(input) === null
}
