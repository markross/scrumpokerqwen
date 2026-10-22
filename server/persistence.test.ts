import { describe, expect, it, vi } from 'vitest'
import {
  createRepository,
  MemoryRepository,
  parseSnapshot,
  UpstashRepository,
  type UpstashLike
} from './persistence.js'
import type { RoomSnapshot } from './rooms.js'

function snapshot(code: string, name: string | null = null): RoomSnapshot {
  return { code, name, phase: 'voting', updatedAt: 1, players: [] }
}

function fakeClient(): UpstashLike & {
  hgetall: ReturnType<typeof vi.fn>
  hset: ReturnType<typeof vi.fn>
  hdel: ReturnType<typeof vi.fn>
} {
  return {
    hgetall: vi.fn().mockResolvedValue({}),
    hset: vi.fn().mockResolvedValue(1),
    hdel: vi.fn().mockResolvedValue(1)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('MemoryRepository', () => {
  it('round-trips snapshots and honours remove', async () => {
    const repo = new MemoryRepository()
    repo.save(snapshot('AAAAA', 'Team Alpha'))
    repo.save(snapshot('BBBBB'))
    expect(await repo.loadAll()).toHaveLength(2)
    repo.remove('AAAAA')
    const all = await repo.loadAll()
    expect(all.map((s) => s.code)).toEqual(['BBBBB'])
  })
})

describe('UpstashRepository', () => {
  it('coalesces repeated saves per room into a single hset with the latest state', async () => {
    const client = fakeClient()
    const repo = new UpstashRepository(client, 15, { warn: () => {} })
    repo.save(snapshot('AAAAA', 'First'))
    repo.save(snapshot('AAAAA', 'Second'))
    await sleep(60)
    expect(client.hset).toHaveBeenCalledTimes(1)
    const [key, kv] = client.hset.mock.calls[0] as [string, Record<string, string>]
    expect(key).toBe('scrumpoker:rooms')
    expect(Object.keys(kv)).toEqual(['AAAAA'])
    expect(JSON.parse(kv['AAAAA']!).name).toBe('Second')
  })

  it('a queued delete wins over an earlier save for the same room', async () => {
    const client = fakeClient()
    const repo = new UpstashRepository(client, 15, { warn: () => {} })
    repo.save(snapshot('AAAAA'))
    repo.remove('AAAAA')
    await sleep(60)
    expect(client.hset).not.toHaveBeenCalled()
    expect(client.hdel).toHaveBeenCalledTimes(1)
  })

  it('close() flushes pending writes immediately', async () => {
    const client = fakeClient()
    const repo = new UpstashRepository(client, 60_000, { warn: () => {} })
    repo.save(snapshot('AAAAA'))
    await repo.close()
    expect(client.hset).toHaveBeenCalledTimes(1)
  })

  it('close() waits for a flush already on the wire before resolving', async () => {
    // index.ts exits right after close(): an untracked in-flight hset used to be
    // truncated by process.exit(0), losing up to a second of writes per redeploy.
    const client = fakeClient()
    let release!: () => void
    client.hset.mockImplementation(
      () => new Promise<number>((resolve) => (release = () => resolve(1)))
    )
    const repo = new UpstashRepository(client, 5, { warn: () => {} })
    repo.save(snapshot('AAAAA'))
    await sleep(25) // the coalesce timer has fired; the hset is in flight now
    expect(client.hset).toHaveBeenCalledTimes(1)

    let closed = false
    const closing = repo.close().then(() => {
      closed = true
    })
    await sleep(25)
    expect(closed).toBe(false)

    release()
    await closing
    expect(closed).toBe(true)
    expect(client.hset).toHaveBeenCalledTimes(1) // not re-issued for the same snapshot
  })

  it('never runs two flushes at once, so queued commands keep their order', async () => {
    // Overlapping flushes could finish out of order and land an hdel before a
    // late hset, reviving a room the sweep had just deleted.
    const client = fakeClient()
    let inFlight = 0
    let overlapped = false
    client.hset.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          inFlight++
          if (inFlight > 1) overlapped = true
          setTimeout(() => {
            inFlight--
            resolve(1)
          }, 20)
        })
    )
    const repo = new UpstashRepository(client, 5, { warn: () => {} })
    repo.save(snapshot('AAAAA'))
    await sleep(8) // first flush is on the wire
    repo.save(snapshot('BBBBB')) // its flush has to wait for the running one
    await repo.close()

    expect(overlapped).toBe(false)
    expect(
      client.hset.mock.calls.map(([, kv]) => Object.keys(kv as Record<string, string>))
    ).toEqual([['AAAAA'], ['BBBBB']])
  })

  it('swallows client errors and keeps the server running', async () => {
    const client = fakeClient()
    client.hset.mockRejectedValue(new Error('redis down'))
    const warn = vi.fn()
    const repo = new UpstashRepository(client, 5, { warn })
    expect(() => repo.save(snapshot('AAAAA'))).not.toThrow()
    await sleep(40)
    expect(warn).toHaveBeenCalled()
  })

  it('loadAll parses stored snapshots, skips unreadable rows, and survives failures', async () => {
    const client = fakeClient()
    client.hgetall.mockResolvedValue({
      AAAAA: JSON.stringify(snapshot('AAAAA', 'Team Alpha')),
      BAD: '{not json'
    })
    const repo = new UpstashRepository(client, 5, { warn: () => {} })
    const all = await repo.loadAll()
    expect(all.map((s) => s.code)).toEqual(['AAAAA'])

    client.hgetall.mockRejectedValue(new Error('redis down'))
    expect(await repo.loadAll()).toEqual([])
  })

  it('loadAll accepts pre-parsed hash values (what the real @upstash/redis client returns)', async () => {
    const client = fakeClient()
    // The real client's hgetall JSON-parses each hash value before handing it over.
    client.hgetall.mockResolvedValue({
      AAAAA: snapshot('AAAAA', 'Team Alpha'),
      Nonsense: { unexpected: true },
      '42': 42
    })
    const repo = new UpstashRepository(client, 5, { warn: () => {} })
    const all = await repo.loadAll()
    expect(all.map((s) => s.code)).toEqual(['AAAAA'])
  })

  it('loadAll treats an empty hash (null result) as no rooms', async () => {
    const client = fakeClient()
    client.hgetall.mockResolvedValue(null)
    const repo = new UpstashRepository(client, 5, { warn: () => {} })
    expect(await repo.loadAll()).toEqual([])
  })

  it('loadAll skips corrupt rows instead of aborting the whole restore', async () => {
    // The bug this pins down: a row that passed the shallow `code` check but had
    // no valid players array threw inside deserializeRoom during hydration, and
    // the catch-all in index.ts dropped every room after it — named rooms
    // included.
    const good = {
      code: 'AAAAA',
      name: 'Team Alpha',
      phase: 'revealed',
      updatedAt: 7,
      players: [{ id: 'p1', name: 'Alice', vote: '8' }]
    }
    const corrupt: Record<string, unknown> = {
      BB: { code: 'BB', name: null, phase: 'voting', updatedAt: 1 }, // players missing
      CC: { code: 'CC', name: null, phase: 'voting', updatedAt: 1, players: 'nope' },
      DD: { code: 'DD', name: null, phase: 'done', updatedAt: 1, players: [] }, // bad phase
      EE: { code: 'EE', name: null, phase: 'voting', updatedAt: 'yesterday', players: [] },
      FF: {
        code: 'FF',
        name: null,
        phase: 'voting',
        updatedAt: 1,
        players: [{ id: 'p1', name: 'Alice', vote: '77' }] // off the deck
      },
      GG: { code: 'GG', name: null, phase: 'voting', updatedAt: 1, players: [null] }
    }
    const client = fakeClient()
    client.hgetall.mockResolvedValue({ ...corrupt, AAAAA: good })
    const warn = vi.fn()
    const repo = new UpstashRepository(client, 5, { warn })

    expect(await repo.loadAll()).toEqual([good])
    expect(warn).toHaveBeenCalledTimes(6)
  })
})

describe('parseSnapshot', () => {
  const valid = {
    code: 'AAAAA',
    name: 'Team Alpha',
    phase: 'voting',
    updatedAt: 1,
    players: [{ id: 'p1', name: 'Alice', vote: null }]
  }

  it('accepts a well-formed snapshot and normalizes a missing vote to null', () => {
    expect(parseSnapshot(valid)).toEqual(valid)
    const noVote = { ...valid, players: [{ id: 'p1', name: 'Alice' }] }
    expect(parseSnapshot(noVote)?.players).toEqual([{ id: 'p1', name: 'Alice', vote: null }])
    expect(parseSnapshot({ ...valid, players: [{ id: 'p1', name: 'Alice', vote: '∞' }] })?.players[0]?.vote).toBe('∞')
  })

  it('rejects rows that would make deserialization throw', () => {
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot('AAAAA')).toBeNull()
    expect(parseSnapshot({ ...valid, code: '' })).toBeNull()
    expect(parseSnapshot({ ...valid, name: 7 })).toBeNull()
    expect(parseSnapshot({ ...valid, phase: 'done' })).toBeNull()
    expect(parseSnapshot({ ...valid, updatedAt: '1' })).toBeNull()
    expect(parseSnapshot({ ...valid, updatedAt: NaN })).toBeNull()
    expect(parseSnapshot({ ...valid, players: undefined })).toBeNull()
    expect(parseSnapshot({ ...valid, players: 'p1' })).toBeNull()
    expect(parseSnapshot({ ...valid, players: [null] })).toBeNull()
    expect(parseSnapshot({ ...valid, players: [{ name: 'Alice', vote: null }] })).toBeNull()
    expect(parseSnapshot({ ...valid, players: [{ id: '', name: 'Alice', vote: null }] })).toBeNull()
    expect(parseSnapshot({ ...valid, players: [{ id: 'p1', vote: null }] })).toBeNull()
    expect(parseSnapshot({ ...valid, players: [{ id: 'p1', name: 'Alice', vote: '77' }] })).toBeNull()
  })
})

describe('createRepository', () => {
  it('falls back to memory when Upstash env vars are absent', () => {
    expect(createRepository({}).mode).toBe('memory')
    expect(createRepository({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' }).mode).toBe('memory')
  })

  it('uses redis when both Upstash env vars are set', () => {
    const repo = createRepository({
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token'
    })
    expect(repo.mode).toBe('redis')
  })
})
