import { randomInt } from 'node:crypto'
import {
  DECK_VALUES,
  type DeckValue,
  type Phase,
  type PlayerView,
  type RoomState
} from '../shared/types.js'
import { CODE_ALPHABET, roomNameKey, slugifyRoomName, validateNewRoomName } from '../shared/naming.js'

const CODE_LENGTH = 5
export const MAX_PLAYERS = 30
export const MAX_NAME_LENGTH = 24
const ROOM_TTL_MS = 24 * 60 * 60 * 1000

export interface Player {
  id: string
  name: string
  vote: DeckValue | null
  socketId: string | null
}

export interface Room {
  code: string
  name: string | null
  phase: Phase
  players: Map<string, Player>
  updatedAt: number
}

/** JSON-safe form of a Room used for durable snapshots (socketIds are per-process, dropped). */
export interface PlayerSnapshot {
  id: string
  name: string
  vote: DeckValue | null
}

export interface RoomSnapshot {
  code: string
  name: string | null
  phase: Phase
  updatedAt: number
  players: PlayerSnapshot[]
}

export type Store = Map<string, Room>

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

function touch(room: Room): void {
  room.updatedAt = Date.now()
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

function validName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed.length >= 1 && trimmed.length <= MAX_NAME_LENGTH
}

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase()
}

export function generateCode(store: Store): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = ''
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    }
    if (!store.has(code)) return code
  }
  throw new Error('Room code space exhausted')
}

export function createRoom(
  store: Store,
  name: string,
  playerId: string,
  roomName?: string
): Result<Room> {
  if (!validName(name)) return fail('Please enter a name (1–24 characters).')
  let room: string | null = null
  if (roomName !== undefined && roomName.trim().length > 0) {
    const nameError = validateNewRoomName(roomName)
    if (nameError) return fail(nameError)
    room = slugifyRoomName(roomName)
    const taken = [...store.values()].some((other) => other.name !== null && roomNameKey(other.name) === room!)
    if (taken) return fail(`A room named "${room}" already exists. Pick a different name.`)
  }
  const code = generateCode(store)
  const created: Room = {
    code,
    name: room,
    phase: 'voting',
    players: new Map(),
    updatedAt: Date.now()
  }
  created.players.set(playerId, { id: playerId, name: name.trim(), vote: null, socketId: null })
  store.set(code, created)
  return { ok: true, value: created }
}

function joinExisting(room: Room, name: string, playerId: string): Result<Room> {
  const existing = room.players.get(playerId)
  if (existing) {
    touch(room)
    return { ok: true, value: room }
  }
  if (!validName(name)) return fail('Please enter a name (1–24 characters).')
  if (room.players.size >= MAX_PLAYERS) return fail('This room is full.')
  room.players.set(playerId, { id: playerId, name: name.trim(), vote: null, socketId: null })
  touch(room)
  return { ok: true, value: room }
}

export function joinRoom(
  store: Store,
  rawCode: string,
  name: string,
  playerId: string
): Result<Room> {
  const code = normalizeCode(rawCode)
  const room = store.get(code)
  if (!room) return fail(`Room "${code}" was not found. Check the code or create a new room.`)
  return joinExisting(room, name, playerId)
}

export function joinRoomByName(
  store: Store,
  rawRoomName: string,
  name: string,
  playerId: string
): Result<Room> {
  const wanted = slugifyRoomName(rawRoomName)
  if (wanted.length === 0) return fail('Enter a room name to join.')
  const key = wanted
  const room = [...store.values()].find((other) => other.name !== null && roomNameKey(other.name) === key)
  if (!room) return fail(`A room named "${wanted}" was not found. Check the name or create a new room.`)
  return joinExisting(room, name, playerId)
}

function requireRoom(store: Store, rawCode: string): Room | { ok: false; error: string } {
  const room = store.get(normalizeCode(rawCode))
  if (!room) return fail('Room not found.')
  return room
}

export function attachSocket(
  store: Store,
  code: string,
  playerId: string,
  socketId: string
): Result<Room> {
  const room = requireRoom(store, code)
  if (!('players' in room)) return room
  const player = room.players.get(playerId)
  if (!player) return fail('Player not found in this room.')
  for (const other of room.players.values()) {
    if (other.socketId === socketId && other.id !== playerId) other.socketId = null
  }
  player.socketId = socketId
  touch(room)
  return { ok: true, value: room }
}

export function detachSocket(
  store: Store,
  code: string,
  playerId: string,
  socketId: string
): void {
  const room = store.get(normalizeCode(code))
  const player = room?.players.get(playerId)
  if (player && player.socketId === socketId) player.socketId = null
}

export function placeVote(
  store: Store,
  code: string,
  playerId: string,
  value: string
): Result<Room> {
  const room = requireRoom(store, code)
  if (!('players' in room)) return room
  if (room.phase !== 'voting') return fail('Voting is closed. Press Reset to start a new round.')
  if (!(DECK_VALUES as readonly string[]).includes(value)) return fail('Unknown vote value.')
  const player = room.players.get(playerId)
  if (!player) return fail('Player not found in this room.')
  player.vote = value as DeckValue
  touch(room)
  return { ok: true, value: room }
}

export function revealRoom(store: Store, code: string): Result<Room> {
  const room = requireRoom(store, code)
  if (!('players' in room)) return room
  room.phase = 'revealed'
  touch(room)
  return { ok: true, value: room }
}

export function resetRoom(store: Store, code: string): Result<Room> {
  const room = requireRoom(store, code)
  if (!('players' in room)) return room
  room.phase = 'voting'
  for (const player of room.players.values()) player.vote = null
  touch(room)
  return { ok: true, value: room }
}

export function removePlayer(store: Store, code: string, playerId: string): void {
  const room = store.get(normalizeCode(code))
  if (!room) return
  room.players.delete(playerId)
  touch(room)
}

export function getView(room: Room, forPlayerId: string): RoomState {
  const players: PlayerView[] = [...room.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    connected: player.socketId !== null,
    hasVoted: player.vote !== null,
    vote:
      room.phase === 'revealed' || player.id === forPlayerId ? player.vote : null
  }))
  return {
    code: room.code,
    name: room.name,
    phase: room.phase,
    players,
    votedCount: players.filter((player) => player.hasVoted).length,
    total: players.length
  }
}

/** Drops stale unnamed rooms; named rooms persist forever. Returns deleted codes. */
export function sweepStaleRooms(store: Store, now: number = Date.now()): string[] {
  const deleted: string[] = []
  for (const [code, room] of store) {
    if (room.name !== null) continue
    if (now - room.updatedAt > ROOM_TTL_MS) {
      store.delete(code)
      deleted.push(code)
    }
  }
  return deleted
}

export function serializeRoom(room: Room): RoomSnapshot {
  return {
    code: room.code,
    name: room.name,
    phase: room.phase,
    updatedAt: room.updatedAt,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      vote: player.vote
    }))
  }
}

export function deserializeRoom(snapshot: RoomSnapshot): Room {
  const players = new Map<string, Player>()
  for (const p of snapshot.players) {
    players.set(p.id, { id: p.id, name: p.name, vote: p.vote, socketId: null })
  }
  return {
    code: snapshot.code,
    name: snapshot.name,
    phase: snapshot.phase,
    players,
    updatedAt: snapshot.updatedAt
  }
}

/** Restores persisted snapshots into the live store; never clobbers a live room. */
export function hydrateStore(store: Store, snapshots: RoomSnapshot[]): void {
  for (const snapshot of snapshots) {
    if (store.has(snapshot.code)) continue
    store.set(snapshot.code, deserializeRoom(snapshot))
  }
}
