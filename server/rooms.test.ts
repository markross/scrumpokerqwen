import { describe, expect, it } from 'vitest'
import {
  attachSocket,
  createRoom,
  detachSocket,
  generateCode,
  getView,
  joinRoom,
  placeVote,
  removePlayer,
  resetRoom,
  revealRoom,
  sweepStaleRooms,
  type Store
} from './rooms.js'

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function newStoreWithPlayers(players: Array<[string, string]>): { store: Store; code: string } {
  const store: Store = new Map()
  const [firstId, firstName] = players[0]!
  const room = ok(createRoom(store, firstName, firstId))
  for (const [id, name] of players.slice(1)) ok(joinRoom(store, room.code, name, id))
  return { store, code: room.code }
}

describe('createRoom', () => {
  it('creates a room with a 5-char code from the safe alphabet', () => {
    const store: Store = new Map()
    const room = ok(createRoom(store, 'Alice', 'p1'))
    expect(room.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/)
    expect(room.phase).toBe('voting')
    expect(store.get(room.code)).toBe(room)
  })

  it('rejects empty or whitespace-only names', () => {
    const store: Store = new Map()
    expect(createRoom(store, '   ', 'p1').ok).toBe(false)
  })

  it('rejects names longer than 24 characters', () => {
    const store: Store = new Map()
    expect(createRoom(store, 'x'.repeat(25), 'p1').ok).toBe(false)
  })

  it('generates unique codes', () => {
    const store: Store = new Map()
    for (let i = 0; i < 50; i++) ok(createRoom(store, `P${i}`, `id-${i}`))
    expect(store.size).toBe(50)
  })
})

describe('generateCode', () => {
  it('excludes lookalike characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode(new Map())).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/)
    }
  })
})

describe('joinRoom', () => {
  it('adds a new player to an existing room', () => {
    const { store, code } = newStoreWithPlayers([['p1', 'Alice']])
    const room = ok(joinRoom(store, code, 'Bob', 'p2'))
    expect(room.players.size).toBe(2)
  })

  it('is case-insensitive on the room code', () => {
    const { store, code } = newStoreWithPlayers([['p1', 'Alice']])
    expect(joinRoom(store, code.toLowerCase(), 'Bob', 'p2').ok).toBe(true)
  })

  it('errors for an unknown room code', () => {
    const store: Store = new Map()
    const result = joinRoom(store, 'ZZZZZ', 'Bob', 'p2')
    expect(result.ok).toBe(false)
  })

  it('re-joins the same player without duplicating them', () => {
    const { store, code } = newStoreWithPlayers([['p1', 'Alice']])
    ok(joinRoom(store, code, 'Alice', 'p1'))
    ok(joinRoom(store, code, 'Alice', 'p1'))
    expect(store.get(code)!.players.size).toBe(1)
  })

  it('keeps an existing player name on reconnect', () => {
    const { store, code } = newStoreWithPlayers([['p1', 'Alice']])
    ok(placeVote(store, code, 'p1', '8'))
    const room = ok(joinRoom(store, code, 'Someone Else', 'p1'))
    expect(room.players.get('p1')!.name).toBe('Alice')
    expect(room.players.get('p1')!.vote).toBe('8')
  })
})

describe('placeVote', () => {
  it('sets the vote and marks the player as voted', () => {
    const { store, code } = newStoreWithPlayers([
      ['p1', 'Alice'],
      ['p2', 'Bob']
    ])
    ok(placeVote(store, code, 'p1', '13'))
    const view = getView(store.get(code)!, 'p1')
    const me = view.players.find((p) => p.id === 'p1')!
    expect(me.vote).toBe('13')
    expect(me.hasVoted).toBe(true)
    expect(view.votedCount).toBe(1)
  })

  it('allows changing the vote before reveal', () => {
    const { store, code } = newStoreWithPlayers([['p1', 'Alice']])
    ok(placeVote(store, code, 'p1', '3'))
    ok(placeVote(store, code, 'p1', '21'))
    expect(store.get(code)!.players.get('p1')!.vote).toBe('21')
  })

  it('rejects values outside the deck', () => {
    const { store, code } = newStoreWithPlayers([['p1', 'Alice']])
    expect(placeVote(store, code, 'p1', '4').ok).toBe(false)
    expect(placeVote(store, code, 'p1', 'Fib').ok).toBe(false)
  })

  it('rejects votes once the round is revealed', () => {
    const { store, code } = newStoreWithPlayers([['p1', 'Alice']])
    ok(revealRoom(store, code))
    expect(placeVote(store, code, 'p1', '5').ok).toBe(false)
  })
})

describe('vote secrecy', () => {
  it('hides other players\' votes but exposes voted status during voting', () => {
    const { store, code } = newStoreWithPlayers([
      ['p1', 'Alice'],
      ['p2', 'Bob']
    ])
    ok(placeVote(store, code, 'p2', '8'))
    const view = getView(store.get(code)!, 'p1')
    const bob = view.players.find((p) => p.id === 'p2')!
    expect(bob.vote).toBeNull()
    expect(bob.hasVoted).toBe(true)
  })

  it('lets a player see their own vote during voting', () => {
    const { store, code } = newStoreWithPlayers([['p1', 'Alice']])
    ok(placeVote(store, code, 'p1', '5'))
    const view = getView(store.get(code)!, 'p1')
    expect(view.players.find((p) => p.id === 'p1')!.vote).toBe('5')
  })

  it('exposes every vote after reveal', () => {
    const { store, code } = newStoreWithPlayers([
      ['p1', 'Alice'],
      ['p2', 'Bob']
    ])
    ok(placeVote(store, code, 'p1', '5'))
    ok(placeVote(store, code, 'p2', '?'))
    ok(revealRoom(store, code))
    const view = getView(store.get(code)!, 'p1')
    expect(view.players.find((p) => p.id === 'p2')!.vote).toBe('?')
    expect(view.phase).toBe('revealed')
  })
})

describe('reveal and reset', () => {
  it('reveal can happen with zero votes', () => {
    const { store, code } = newStoreWithPlayers([['p1', 'Alice']])
    const room = ok(revealRoom(store, code))
    expect(room.phase).toBe('revealed')
  })

  it('reset clears votes but keeps players and starts a new round', () => {
    const { store, code } = newStoreWithPlayers([
      ['p1', 'Alice'],
      ['p2', 'Bob']
    ])
    ok(placeVote(store, code, 'p1', '8'))
    ok(placeVote(store, code, 'p2', '13'))
    ok(revealRoom(store, code))
    const room = ok(resetRoom(store, code))
    expect(room.phase).toBe('voting')
    expect([...room.players.values()].every((p) => p.vote === null)).toBe(true)
    expect(room.players.size).toBe(2)
  })
})

describe('late joiners', () => {
  it('are included in the voted tally', () => {
    const { store, code } = newStoreWithPlayers([['p1', 'Alice']])
    ok(placeVote(store, code, 'p1', '5'))
    ok(joinRoom(store, code, 'Carol', 'p3'))
    const view = getView(store.get(code)!, 'p1')
    expect(view.total).toBe(2)
    expect(view.votedCount).toBe(1)
  })
})

describe('socket attach/detach', () => {
  it('marks players connected via socket state', () => {
    const { store, code } = newStoreWithPlayers([['p1', 'Alice']])
    ok(attachSocket(store, code, 'p1', 's1'))
    expect(getView(store.get(code)!, 'p1').players[0]!.connected).toBe(true)
    detachSocket(store, code, 'p1', 's1')
    expect(getView(store.get(code)!, 'p1').players[0]!.connected).toBe(false)
  })

  it('keeps the vote across a disconnect and reattach', () => {
    const { store, code } = newStoreWithPlayers([['p1', 'Alice']])
    ok(attachSocket(store, code, 'p1', 's1'))
    ok(placeVote(store, code, 'p1', '21'))
    detachSocket(store, code, 'p1', 's1')
    ok(attachSocket(store, code, 'p1', 's2'))
    expect(getView(store.get(code)!, 'p1').players[0]!.vote).toBe('21')
  })
})

describe('removePlayer', () => {
  it('removes the player from the room', () => {
    const { store, code } = newStoreWithPlayers([
      ['p1', 'Alice'],
      ['p2', 'Bob']
    ])
    removePlayer(store, code, 'p2')
    expect(store.get(code)!.players.size).toBe(1)
  })
})

describe('sweepStaleRooms', () => {
  it('drops rooms untouched past the TTL', () => {
    const { store, code } = newStoreWithPlayers([['p1', 'Alice']])
    const room = store.get(code)!
    room.updatedAt = Date.now() - 25 * 60 * 60 * 1000
    sweepStaleRooms(store)
    expect(store.has(code)).toBe(false)
  })
})
