import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { io, type Socket } from 'socket.io-client'
import type {
  ClientToServerEvents,
  DeckValue,
  JoinResult,
  RoomState,
  ServerToClientEvents
} from '../shared/types.js'
import { httpServer, parseCorsOrigins } from './index.js'

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>

/** Untyped view used to fire malformed packets no typed client would produce. */
type RawSocket = Socket<
  Record<string, (...args: unknown[]) => unknown>,
  Record<string, (...args: unknown[]) => unknown>
>

function asRaw(socket: ClientSocket): RawSocket {
  return socket as unknown as RawSocket
}

let baseUrl = ''
const sockets: ClientSocket[] = []

function connect(): Promise<ClientSocket> {
  const socket = io(baseUrl, { transports: ['websocket'], forceNew: true })
  sockets.push(socket)
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket))
    socket.on('connect_error', (err) => reject(err))
  })
}

/** Drops the transport and waits for socket.io to bring it back up. */
function reconnect(socket: ClientSocket): Promise<void> {
  socket.disconnect()
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      socket.off('connect', onConnect)
      socket.off('connect_error', onError)
    }
    const onConnect = (): void => {
      cleanup()
      resolve()
    }
    const onError = (err: Error): void => {
      cleanup()
      reject(err)
    }
    socket.on('connect', onConnect)
    socket.on('connect_error', onError)
    socket.connect()
  })
}

interface Recorder {
  states: RoomState[]
  until(predicate: (state: RoomState) => boolean, from?: number): Promise<RoomState>
}

function record(socket: ClientSocket): Recorder {
  const states: RoomState[] = []
  socket.on('room:state', (state) => states.push(state))
  return {
    states,
    until(predicate, from = 0) {
      const found = states.slice(from).find(predicate)
      if (found) return Promise.resolve(found)
      return new Promise((resolve, reject) => {
        const onState = (state: RoomState): void => {
          if (!predicate(state)) return
          clearTimeout(timer)
          socket.off('room:state', onState)
          resolve(state)
        }
        const timer = setTimeout(() => {
          socket.off('room:state', onState)
          reject(new Error('Timed out waiting for room:state'))
        }, 3000)
        socket.on('room:state', onState)
      })
    }
  }
}

function unwrap(result: JoinResult): string {
  if (!result.ok) throw new Error(result.error)
  return result.code
}

function byId(state: RoomState, id: string) {
  return state.players.find((p) => p.id === id)
}

const twoPlayers = (s: RoomState): boolean => s.players.length === 2

beforeAll(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  const { port } = httpServer.address() as AddressInfo
  baseUrl = `http://localhost:${port}`
})

afterAll(async () => {
  for (const socket of sockets) socket.close()
  await new Promise<void>((resolve, reject) =>
    httpServer.close((err) => (err ? reject(err) : resolve()))
  )
})

describe('realtime flow (two socket.io clients)', () => {
  it('runs a full round: create, join, secret votes, reveal, reset', async () => {
    const alice = await connect()
    const aliceRec = record(alice)
    const code = unwrap(await alice.emitWithAck('room:create', { name: 'Alice', playerId: 'pA' }))
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/)
    await aliceRec.until((s) => s.players.length === 1 && s.phase === 'voting')

    const bob = await connect()
    const bobRec = record(bob)
    unwrap(await bob.emitWithAck('room:join', { name: 'Bob', playerId: 'pB', code }))
    await Promise.all([bobRec.until(twoPlayers), aliceRec.until(twoPlayers)])

    alice.emit('vote:place', { value: '8' }, () => {})
    bob.emit('vote:place', { value: '13' }, () => {})
    await aliceRec.until((s) => byId(s, 'pA')?.vote === '8')
    await bobRec.until((s) => byId(s, 'pA')?.hasVoted === true)
    await aliceRec.until((s) => byId(s, 'pB')?.hasVoted === true)

    // Wire-level secrecy: no pre-reveal state ever carries a peer's vote value.
    for (const state of bobRec.states.filter((s) => s.phase === 'voting' && twoPlayers(s))) {
      expect(byId(state, 'pA')?.vote).toBeNull()
    }
    for (const state of aliceRec.states.filter((s) => s.phase === 'voting' && twoPlayers(s))) {
      expect(byId(state, 'pB')?.vote).toBeNull()
    }

    alice.emit('room:reveal', () => {})
    const [aliceRevealed, bobRevealed] = await Promise.all([
      aliceRec.until((s) => s.phase === 'revealed'),
      bobRec.until((s) => s.phase === 'revealed')
    ])
    expect(byId(aliceRevealed, 'pA')?.vote).toBe('8')
    expect(byId(aliceRevealed, 'pB')?.vote).toBe('13')
    expect(byId(bobRevealed, 'pA')?.vote).toBe('8')
    expect(byId(bobRevealed, 'pB')?.vote).toBe('13')

    const idxA = aliceRec.states.length
    const idxB = bobRec.states.length
    bob.emit('room:reset', () => {})
    const freshRound = (s: RoomState): boolean =>
      s.phase === 'voting' &&
      s.players.length === 2 &&
      s.votedCount === 0 &&
      s.players.every((p) => p.vote === null && !p.hasVoted)
    await Promise.all([aliceRec.until(freshRound, idxA), bobRec.until(freshRound, idxB)])
  })

  it('keeps the seat and vote across a disconnect and same-playerId reconnect', async () => {
    const alice = await connect()
    const aliceRec = record(alice)
    const code = unwrap(await alice.emitWithAck('room:create', { name: 'Alice', playerId: 'pA2' }))
    await aliceRec.until((s) => s.players.length === 1)

    const bob = await connect()
    const bobRec = record(bob)
    unwrap(await bob.emitWithAck('room:join', { name: 'Bob', playerId: 'pB2', code }))
    await bobRec.until(twoPlayers)

    bob.emit('vote:place', { value: '5' }, () => {})
    await aliceRec.until((s) => byId(s, 'pB2')?.hasVoted === true)

    bob.close()
    await aliceRec.until((s) => byId(s, 'pB2')?.connected === false && s.total === 2)

    const bobBack = await connect()
    const bobBackRec = record(bobBack)
    unwrap(await bobBack.emitWithAck('room:join', { name: 'Impostor', playerId: 'pB2', code }))
    const mine = await bobBackRec.until((s) => byId(s, 'pB2')?.vote === '5')
    expect(byId(mine, 'pB2')?.hasVoted).toBe(true)
    expect(byId(mine, 'pB2')?.name).toBe('Bob')
    await aliceRec.until((s) => byId(s, 'pB2')?.connected === true)
  })

  it('rejects bad joins, blocks double join, and removes players on leave', async () => {
    const ghost = await connect()
    const unknown = await ghost.emitWithAck('room:join', {
      name: 'Ghost',
      playerId: 'pG',
      code: 'ZZZZZ'
    })
    expect(unknown.ok).toBe(false)
    const missing = await ghost.emitWithAck('room:join', { name: 'Ghost', playerId: 'pG' })
    expect(missing.ok).toBe(false)

    const carol = await connect()
    const carolRec = record(carol)
    const code1 = unwrap(await carol.emitWithAck('room:create', { name: 'Carol', playerId: 'pC' }))
    const second = await carol.emitWithAck('room:create', { name: 'Carol', playerId: 'pC' })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toMatch(/already in a room/i)

    const dave = await connect()
    unwrap(await dave.emitWithAck('room:join', { name: 'Dave', playerId: 'pD', code: code1 }))
    await carolRec.until(twoPlayers)

    expect(await dave.emitWithAck('player:leave')).toEqual({ ok: true })
    await carolRec.until((s) => s.players.length === 1)

    const code2 = unwrap(await dave.emitWithAck('room:create', { name: 'Dave', playerId: 'pD2' }))
    expect(code2).not.toBe(code1)
  })
})

describe('named rooms (two socket.io clients)', () => {
  it('creates a named room and joins the same room by name', async () => {
    const alice = await connect()
    const aliceRec = record(alice)
    const created = await alice.emitWithAck('room:create', {
      name: 'Alice',
      playerId: 'nA',
      roomName: '  Team   Retro  '
    })
    const code = unwrap(created)
    const firstState = await aliceRec.until((s) => s.name === 'team-retro')
    expect(firstState.code).toBe(code)

    const bob = await connect()
    const bobRec = record(bob)
    const joined = await bob.emitWithAck('room:join', {
      name: 'Bob',
      playerId: 'nB',
      roomName: 'team retro'
    })
    expect(unwrap(joined)).toBe(code)
    await Promise.all([aliceRec.until(twoPlayers), bobRec.until(twoPlayers)])

    // Secrecy still holds in a named room.
    bob.emit('vote:place', { value: '8' }, () => {})
    const sawVote = await aliceRec.until((s) => byId(s, 'nB')?.hasVoted === true)
    expect(byId(sawVote, 'nB')?.vote).toBeNull()
  })

  it('rejects a duplicate room name and unknown joins via ack errors', async () => {
    const host = await connect()
    unwrap(await host.emitWithAck('room:create', { name: 'Host', playerId: 'nH', roomName: 'Sprint 42' }))

    const copycat = await connect()
    const dup = await copycat.emitWithAck('room:create', {
      name: 'Copycat',
      playerId: 'nC',
      roomName: 'sprint  42'
    })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toMatch(/already exists/i)

    const stranger = await connect()
    const unknown = await stranger.emitWithAck('room:join', {
      name: 'Stranger',
      playerId: 'nS',
      roomName: 'No Such Room'
    })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error).toMatch(/not found/i)
  })
})

describe('rejoin after reconnect (two socket.io clients)', () => {
  // socket.io restores the transport on its own but not the room membership, so
  // the client re-issues its join on 'connect' (useRoom's rejoin). Without that,
  // a Render spin-down/redeploy left every player showing Offline with dead
  // controls until a manual reload.
  it('restores the seat, the vote and the controls when the transport comes back', async () => {
    const alice = await connect()
    const aliceRec = record(alice)
    const code = unwrap(await alice.emitWithAck('room:create', { name: 'Alice', playerId: 'rA' }))
    await aliceRec.until((s) => s.players.length === 1)

    const bob = await connect()
    unwrap(await bob.emitWithAck('room:join', { name: 'Bob', playerId: 'rB', code }))
    await aliceRec.until(twoPlayers)
    bob.emit('vote:place', { value: '8' }, () => {})
    await aliceRec.until((s) => byId(s, 'rB')?.hasVoted === true)

    bob.on('connect', () => {
      // What useRoom's connect handler does for the room it intends to be in.
      bob.emit('room:join', { code, name: 'Bob', playerId: 'rB' }, () => {})
    })
    const bobRec = record(bob)
    const seenByAlice = aliceRec.states.length
    await reconnect(bob)

    // Same seat, kept name, kept vote — no reload needed.
    const restored = await bobRec.until((s) => byId(s, 'rB')?.vote === '8')
    expect(restored.code).toBe(code)
    expect(byId(restored, 'rA')?.name).toBe('Alice')
    await aliceRec.until((s) => byId(s, 'rB')?.connected === true, seenByAlice)

    // Re-attached means in control again (socket.data rebound).
    bob.emit('room:reveal', () => {})
    const revealed = await aliceRec.until((s) => s.phase === 'revealed', seenByAlice)
    expect(byId(revealed, 'rB')?.vote).toBe('8')
  })

  it('treats a repeated join for the same room as a no-op success', async () => {
    const host = await connect()
    const code = unwrap(await host.emitWithAck('room:create', { name: 'Host', playerId: 'jA' }))
    const elsewhere = await connect()
    const otherCode = unwrap(
      await elsewhere.emitWithAck('room:create', { name: 'Elsewhere', playerId: 'jX' })
    )

    const bob = await connect()
    const bobRec = record(bob)
    unwrap(await bob.emitWithAck('room:join', { name: 'Bob', playerId: 'jB', code }))

    // A join replayed by the send buffer can land on a socket the server still
    // considers attached; it must not come back as a rejected double join.
    expect(unwrap(await bob.emitWithAck('room:join', { name: 'Bob', playerId: 'jB', code }))).toBe(code)

    // Switching rooms without leaving is still refused, for another room and for
    // another player in this one.
    const switchRooms = await bob.emitWithAck('room:join', { name: 'Bob', playerId: 'jB', code: otherCode })
    expect(switchRooms.ok).toBe(false)
    if (!switchRooms.ok) expect(switchRooms.error).toMatch(/already in a room/i)
    const hopSeat = await bob.emitWithAck('room:join', { name: 'Bob', playerId: 'jB2', code })
    expect(hopSeat.ok).toBe(false)
    if (!hopSeat.ok) expect(hopSeat.error).toMatch(/already in a room/i)

    // Still bound to the first room, and still in control.
    bob.emit('room:reveal', () => {})
    const revealed = await bobRec.until((s) => s.phase === 'revealed')
    expect(revealed.code).toBe(code)
  })
})

describe('action feedback (ack results)', () => {
  // Vote/reveal/reset used to discard `result.error` on the floor: no ack in the
  // contract at all, so a refused action (a vote landing during a concurrent
  // Reveal, say) looked exactly like an accepted one.
  it('reports refusals instead of swallowing them', async () => {
    const alice = await connect()
    unwrap(await alice.emitWithAck('room:create', { name: 'Alice', playerId: 'fA' }))

    const outsider = await connect()
    const strayVote = await outsider.emitWithAck('vote:place', { value: '5' })
    expect(strayVote.ok).toBe(false)
    if (!strayVote.ok) expect(strayVote.error).toMatch(/not in a room/i)
    const strayReveal = await outsider.emitWithAck('room:reveal')
    expect(strayReveal.ok).toBe(false)
    if (!strayReveal.ok) expect(strayReveal.error).toMatch(/not in a room/i)
    const strayReset = await outsider.emitWithAck('room:reset')
    expect(strayReset.ok).toBe(false)

    const offDeck = await alice.emitWithAck('vote:place', { value: '77' as DeckValue })
    expect(offDeck.ok).toBe(false)
    if (!offDeck.ok) expect(offDeck.error).toMatch(/unknown vote/i)

    const lateVote = await alice.emitWithAck('room:reveal').then(() =>
      alice.emitWithAck('vote:place', { value: '8' })
    )
    expect(lateVote.ok).toBe(false)
    if (!lateVote.ok) expect(lateVote.error).toMatch(/voting is closed/i)

    // Accepted actions answer too, so the client can clear its banner.
    expect(await alice.emitWithAck('room:reset')).toEqual({ ok: true })
    expect(await alice.emitWithAck('vote:place', { value: '8' })).toEqual({ ok: true })
    expect(await alice.emitWithAck('room:reveal')).toEqual({ ok: true })
  })

  it('still drops malformed action packets without a reply', async () => {
    const alice = await connect()
    unwrap(await alice.emitWithAck('room:create', { name: 'Alice', playerId: 'gA' }))
    const raw = asRaw(alice)
    raw.emit('vote:place', { value: 8 }) // non-string value: logged + dropped
    // Same socket keeps working.
    expect(await alice.emitWithAck('vote:place', { value: '3' })).toEqual({ ok: true })
  })
})

describe('CORS_ORIGIN parsing', () => {
  it('allows any origin when the variable is unset or carries no entries', () => {
    expect(parseCorsOrigins(undefined)).toBe(true)
    expect(parseCorsOrigins('')).toBe(true)
    expect(parseCorsOrigins('  ,  ')).toBe(true)
  })

  it('trims entries so "https://a, https://b" actually matches', () => {
    // Before trimming, " https://b" compared unequal to every real Origin and
    // silently blocked that client.
    expect(parseCorsOrigins('https://a, https://b')).toEqual(['https://a', 'https://b'])
    expect(parseCorsOrigins(' https://a ,')).toEqual(['https://a'])
    expect(parseCorsOrigins('https://a')).toEqual(['https://a'])
  })
})

describe('malformed packets (raw socket.io clients)', () => {
  // socket.io dispatches listeners via emitUntyped inside process.nextTick
  // with no try/catch, so before handler hardening each of these threw an
  // uncaughtException that killed the whole process for every room.
  it('never lets a malformed packet take down the server', async () => {
    const attacker = await connect()
    const raw = asRaw(attacker)

    raw.emit('room:create') // no payload, no ack
    raw.emit('room:create', { name: 'M', playerId: 'm0' }) // valid payload, no ack callback
    raw.emit('room:create', { name: 'M', playerId: 'm1', roomName: 42 }) // non-string roomName
    raw.emit('room:join', { name: 'M', playerId: 'm2', code: 12345 }) // non-string code
    raw.emit('room:join', { name: 'M', playerId: 'm3', roomName: {} }) // non-string roomName
    raw.emit('vote:place') // no payload
    raw.emit('vote:place', { value: 8 }) // non-string value
    raw.emit('player:leave') // no ack callback

    // The offending socket stays usable: leave the room the no-ack create joined.
    expect(await attacker.emitWithAck('player:leave')).toEqual({ ok: true })

    // And the server still answers fresh emitWithAck roundtrips on new sockets.
    const witness = await connect()
    const witnessRec = record(witness)
    const code = unwrap(
      await witness.emitWithAck('room:create', { name: 'Witness', playerId: 'w1' })
    )
    const joiner = await connect()
    unwrap(await joiner.emitWithAck('room:join', { name: 'Joiner', playerId: 'w2', code }))
    await witnessRec.until(twoPlayers)
  })

  it('replies with an error ack instead of going dark on malformed join/create', async () => {
    const visitor = await connect()
    const raw = asRaw(visitor)

    const badJoin = (await raw.emitWithAck('room:join', {
      name: 'M',
      playerId: 'm4',
      code: 12345
    })) as JoinResult
    expect(badJoin.ok).toBe(false)

    const badCreate = (await raw.emitWithAck('room:create', {
      name: 7,
      playerId: 'm5'
    })) as JoinResult
    expect(badCreate.ok).toBe(false)

    // Same socket still works once it behaves.
    const goodCreate = await visitor.emitWithAck('room:create', {
      name: 'Fine',
      playerId: 'm6'
    })
    expect(goodCreate.ok).toBe(true)
  })
})
