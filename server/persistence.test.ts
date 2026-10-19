import { describe, expect, it, vi } from 'vitest'
import {
  createRepository,
  MemoryRepository,
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
