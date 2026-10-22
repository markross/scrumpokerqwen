import { describe, expect, it } from 'vitest'
import {
  attachSocket,
  createRoom,
  deserializeRoom,
  detachSocket,
  generateCode,
  getView,
  hydrateStore,
  joinRoom,
  joinRoomByName,
  placeVote,
  removePlayer,
  resetRoom,
  revealRoom,
  serializeRoom,
  sweepStaleRooms,
  type RoomSnapshot,
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

  it('keeps named rooms regardless of age', () => {
    const store: Store = new Map()
    const room = ok(createRoom(store, 'Alice', 'p1', 'Team Alpha'))
    room.updatedAt = Date.now() - 30 * 24 * 60 * 60 * 1000
    sweepStaleRooms(store)
    expect(store.has(room.code)).toBe(true)
  })

  it('returns the codes it deleted (for durable cleanup)', () => {
    const store: Store = new Map()
    const named = ok(createRoom(store, 'Alice', 'p1', 'Team Alpha'))
    const stale = ok(createRoom(store, 'Bob', 'p2'))
    stale.updatedAt = Date.now() - 25 * 60 * 60 * 1000
    const deleted = sweepStaleRooms(store)
    expect(deleted).toEqual([stale.code])
    expect(store.has(named.code)).toBe(true)
  })
})

describe('room names', () => {
  it('stores a slugified name, and null when omitted or blank', () => {
    const store: Store = new Map()
    const named = ok(createRoom(store, 'Alice', 'p1', '  Team   Alpha  '))
    expect(named.name).toBe('team-alpha')
    const underscored = ok(createRoom(store, 'Dan', 'p4', 'My_Cool_Room'))
    expect(underscored.name).toBe('my-cool-room')
    const blank = ok(createRoom(store, 'Bob', 'p2', '   '))
    expect(blank.name).toBeNull()
    const plain = ok(createRoom(store, 'Carol', 'p3'))
    expect(plain.name).toBeNull()
  })

  it('accepts names up to 40 characters and rejects longer ones', () => {
    const store: Store = new Map()
    expect(createRoom(store, 'Alice', 'p1', 'x'.repeat(40)).ok).toBe(true)
    expect(createRoom(store, 'Alice', 'p2', 'x'.repeat(41)).ok).toBe(false)
  })

  it('rejects names with characters outside letters, numbers and hyphens', () => {
    const store: Store = new Map()
    expect(createRoom(store, 'Alice', 'p1', 'Sprint Planning 🚀').ok).toBe(false)
    expect(createRoom(store, 'Alice', 'p2', 'team@alpha').ok).toBe(false)
    expect(createRoom(store, 'Alice', 'p3', 'a.b.c').ok).toBe(false)
  })

  it("rejects room names shaped like room codes (3–5 code-alphabet chars)", () => {
    const store: Store = new Map()
    expect(createRoom(store, 'Alice', 'p1', 'beta').ok).toBe(false)
    expect(createRoom(store, 'Alice', 'p2', 'ABCDE').ok).toBe(false)
    // Slightly longer or hyphenated is fine — those shapes don't collide with codes.
    expect(createRoom(store, 'Alice', 'p3', 'abcdef').ok).toBe(true)
    expect(createRoom(store, 'Alice', 'p4', 'a-b').ok).toBe(true)
  })

  it('rejects room names that would shadow server routes', () => {
    const store: Store = new Map()
    expect(createRoom(store, 'Alice', 'p1', 'healthz').ok).toBe(false)
  })

  it('rejects a duplicate name case- and whitespace-insensitively', () => {
    const store: Store = new Map()
    ok(createRoom(store, 'Alice', 'p1', 'Team Alpha'))
    expect(createRoom(store, 'Bob', 'p2', '  team   ALPHA ').ok).toBe(false)
    expect(createRoom(store, 'Bob', 'p3', 'team-alpha').ok).toBe(false)
  })

  it('allows the same name again after the room is gone', () => {
    const store: Store = new Map()
    const first = ok(createRoom(store, 'Alice', 'p1', 'Team Alpha'))
    store.delete(first.code)
    expect(createRoom(store, 'Bob', 'p2', 'Team Alpha').ok).toBe(true)
  })

  it('exposes the name in the player view', () => {
    const store: Store = new Map()
    const room = ok(createRoom(store, 'Alice', 'p1', 'Team Alpha'))
    expect(getView(room, 'p1').name).toBe('team-alpha')
  })
})

describe('joinRoomByName', () => {
  it('joins the named room, case- and whitespace-insensitively', () => {
    const store: Store = new Map()
    const room = ok(createRoom(store, 'Alice', 'p1', 'Team Alpha'))
    const joined = ok(joinRoomByName(store, '  team   alpha ', 'Bob', 'p2'))
    expect(joined.code).toBe(room.code)
    expect(joined.players.size).toBe(2)
  })

  it('keeps seat and vote when the same playerId rejoins by name', () => {
    const store: Store = new Map()
    const room = ok(createRoom(store, 'Alice', 'p1', 'Team Alpha'))
    ok(placeVote(store, room.code, 'p1', '8'))
    const joined = ok(joinRoomByName(store, 'Team Alpha', 'Someone Else', 'p1'))
    expect(joined.players.size).toBe(1)
    expect(joined.players.get('p1')!.name).toBe('Alice')
    expect(joined.players.get('p1')!.vote).toBe('8')
  })

  it('finds legacy persisted names (pre-slug rules) by their slug', () => {
    const store: Store = new Map()
    store.set('ABCDE', {
      code: 'ABCDE',
      name: 'Team Alpha',
      phase: 'voting',
      players: new Map(),
      updatedAt: Date.now()
    })
    const joined = ok(joinRoomByName(store, 'team-alpha', 'Bob', 'p2'))
    expect(joined.code).toBe('ABCDE')
    expect(joined.players.get('p2')!.name).toBe('Bob')
  })

  it('errors on unknown or blank names and on a full room', () => {
    const store: Store = new Map()
    expect(joinRoomByName(store, 'Nope', 'Bob', 'p2').ok).toBe(false)
    expect(joinRoomByName(store, '   ', 'Bob', 'p2').ok).toBe(false)
    const room = ok(createRoom(store, 'Alice', 'p1', 'Team Alpha'))
    for (let i = 0; i < 29; i++) room.players.set(`x${i}`, { id: `x${i}`, name: 'X', vote: null, socketId: null })
    expect(joinRoomByName(store, 'Team Alpha', 'Bob', 'p99').ok).toBe(false)
  })
})

describe('snapshots', () => {
  it('round-trips a room through serialize/deserialize with socketIds dropped', () => {
    const store: Store = new Map()
    const room = ok(createRoom(store, 'Alice', 'p1', 'Team Alpha'))
    ok(attachSocket(store, room.code, 'p1', 's1'))
    ok(placeVote(store, room.code, 'p1', '13'))
    ok(revealRoom(store, room.code))

    const snapshot = serializeRoom(store.get(room.code)!)
    const revived = deserializeRoom(JSON.parse(JSON.stringify(snapshot)) as RoomSnapshot)
    expect(revived.code).toBe(room.code)
    expect(revived.name).toBe('team-alpha')
    expect(revived.phase).toBe('revealed')
    expect(revived.players.get('p1')!.vote).toBe('13')
    expect(revived.players.get('p1')!.socketId).toBeNull()
  })

  it('hydrateStore restores rooms but never clobbers live ones', () => {
    const store: Store = new Map()
    const live = ok(createRoom(store, 'Alice', 'p1', 'Team Alpha'))
    const snapshot = serializeRoom(live)
    const other = ok(createRoom(store, 'Bob', 'p2'))
    const ghost = serializeRoom({ ...other, name: 'Ghost', phase: 'revealed' })

    hydrateStore(store, [ghost, serializeRoom({ ...snapshot, name: 'Changed' })])
    expect(store.get(other.code)!.name).toBeNull()
    expect(store.get(live.code)!.name).toBe('team-alpha')
    expect(store.size).toBe(2)
  })

  it('hydrateStore skips a malformed snapshot instead of dropping the batch', () => {
    // loadAll validates on the way in; this is the second line of defence so a
    // future shape regression costs one room rather than the whole restore.
    const corrupt = {
      code: 'BADDD',
      name: null,
      phase: 'voting',
      updatedAt: 1
    } as unknown as RoomSnapshot // players missing → deserializeRoom throws
    const second: RoomSnapshot = {
      code: 'CCCCC',
      name: null,
      phase: 'revealed',
      updatedAt: 2,
      players: [{ id: 'p2', name: 'Bob', vote: '13' }]
    }
    const first: RoomSnapshot = {
      code: 'AAAAA',
      name: null,
      phase: 'voting',
      updatedAt: 1,
      players: [{ id: 'p1', name: 'Alice', vote: null }]
    }
    const store: Store = new Map()

    expect(() => hydrateStore(store, [first, corrupt, second])).not.toThrow()

    expect([...store.keys()]).toEqual(['AAAAA', 'CCCCC'])
    expect(store.get('AAAAA')!.players.get('p1')!.name).toBe('Alice')
    expect(store.get('CCCCC')!.phase).toBe('revealed')
  })
})
