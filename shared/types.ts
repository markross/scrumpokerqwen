export const DECK_VALUES = ['0', '1', '2', '3', '5', '8', '13', '21', '?', '∞'] as const

export type DeckValue = (typeof DECK_VALUES)[number]

export const NUMERIC_VALUES = ['0', '1', '2', '3', '5', '8', '13', '21'] as const satisfies readonly DeckValue[]

export type Phase = 'voting' | 'revealed'

export interface PlayerView {
  id: string
  name: string
  connected: boolean
  hasVoted: boolean
  vote: DeckValue | null
}

export interface RoomState {
  code: string
  phase: Phase
  players: PlayerView[]
  votedCount: number
  total: number
}

export interface JoinPayload {
  name: string
  playerId: string
  code?: string
}

export type JoinResult = { ok: true; code: string } | { ok: false; error: string }

export interface ClientToServerEvents {
  'room:create': (payload: JoinPayload, ack: (result: JoinResult) => void) => void
  'room:join': (payload: JoinPayload, ack: (result: JoinResult) => void) => void
  'vote:place': (payload: { value: DeckValue }) => void
  'room:reveal': () => void
  'room:reset': () => void
  'player:leave': (ack: (result: { ok: boolean }) => void) => void
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void
}
