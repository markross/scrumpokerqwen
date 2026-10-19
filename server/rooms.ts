import { randomInt } from 'node:crypto'
import {
  DECK_VALUES,
  type DeckValue,
  type Phase,
  type PlayerView,
  type RoomState
} from '../shared/types.js'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
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
  phase: Phase
  players: Map<string, Player>
  updatedAt: number
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

export function createRoom(store: Store, name: string, playerId: string): Result<Room> {
  if (!validName(name)) return fail('Please enter a name (1–24 characters).')
  const code = generateCode(store)
  const room: Room = {
    code,
    phase: 'voting',
    players: new Map(),
    updatedAt: Date.now()
  }
  room.players.set(playerId, { id: playerId, name: name.trim(), vote: null, socketId: null })
  store.set(code, room)
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
    phase: room.phase,
    players,
    votedCount: players.filter((player) => player.hasVoted).length,
    total: players.length
  }
}

export function sweepStaleRooms(store: Store, now: number = Date.now()): void {
  for (const [code, room] of store) {
    if (now - room.updatedAt > ROOM_TTL_MS) store.delete(code)
  }
}
