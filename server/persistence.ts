import { Redis } from '@upstash/redis'
import type { RoomSnapshot } from './rooms.js'

/**
 * Durable home for room snapshots. Implementations must never throw out of
 * save/remove — the in-memory store stays authoritative and persistence
 * failures are logged only.
 */
export interface RoomRepository {
  readonly mode: 'memory' | 'redis'
  loadAll(): Promise<RoomSnapshot[]>
  save(snapshot: RoomSnapshot): void
  remove(code: string): void
  /** Flush any queued writes (call on shutdown / in tests). */
  close(): Promise<void>
}

const ROOMS_KEY = 'scrumpoker:rooms'

/** Process-local repository. Useful for tests and as the no-config fallback. */
export class MemoryRepository implements RoomRepository {
  readonly mode = 'memory' as const
  private readonly map = new Map<string, RoomSnapshot>()

  async loadAll(): Promise<RoomSnapshot[]> {
    return [...this.map.values()]
  }

  save(snapshot: RoomSnapshot): void {
    this.map.set(snapshot.code, snapshot)
  }

  remove(code: string): void {
    this.map.delete(code)
  }

  async close(): Promise<void> {
    this.map.clear()
  }
}

/** Minimal shape of the Upstash REST client (kept injectable for tests). */
export interface UpstashLike {
  hgetall(key: string): Promise<unknown>
  hset(key: string, kv: Record<string, string>): Promise<unknown>
  hdel(key: string, field: string): Promise<unknown>
}

interface Logger {
  warn(message?: unknown, ...args: unknown[]): void
}

/**
 * Redis (Upstash REST) repository. Writes are coalesced per room code
 * (latest snapshot wins) and flushed on a short timer to keep command
 * volume low; deletes flush through the same queue.
 */
export class UpstashRepository implements RoomRepository {
  readonly mode = 'redis' as const
  private readonly pending = new Map<string, RoomSnapshot | null>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly client: UpstashLike,
    private readonly coalesceMs = 1000,
    private readonly log: Logger = console
  ) {}

  async loadAll(): Promise<RoomSnapshot[]> {
    try {
      const rows = ((await this.client.hgetall(ROOMS_KEY)) ?? {}) as Record<string, unknown>
      const snapshots: RoomSnapshot[] = []
      for (const raw of Object.values(rows)) {
        // The real @upstash/redis client JSON-parses hash values (pre-parsed
        // objects); other backends may hand back the raw JSON string.
        let candidate: unknown = raw
        if (typeof raw === 'string') {
          try {
            candidate = JSON.parse(raw)
          } catch {
            this.log.warn('Skipping unreadable room snapshot.')
            continue
          }
        }
        if (candidate && typeof candidate === 'object' && typeof (candidate as RoomSnapshot).code === 'string') {
          snapshots.push(candidate as RoomSnapshot)
        } else {
          this.log.warn('Skipping room snapshot with unexpected shape.')
        }
      }
      return snapshots
    } catch (err) {
      this.log.warn('Room load failed; starting with an empty store.', err)
      return []
    }
  }

  save(snapshot: RoomSnapshot): void {
    this.pending.set(snapshot.code, snapshot)
    this.schedule()
  }

  remove(code: string): void {
    this.pending.set(code, null)
    this.schedule()
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.flush()
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.coalesceMs)
    this.timer.unref()
  }

  private async flush(): Promise<void> {
    const entries = [...this.pending]
    this.pending.clear()
    for (const [code, snapshot] of entries) {
      try {
        if (snapshot) {
          await this.client.hset(ROOMS_KEY, { [code]: JSON.stringify(snapshot) })
        } else {
          await this.client.hdel(ROOMS_KEY, code)
        }
      } catch (err) {
        this.log.warn(`Failed to persist room "${code}".`, err)
      }
    }
  }
}

/** Redis when both Upstash env vars are set, otherwise process-local memory. */
export function createRepository(
  env: NodeJS.ProcessEnv = process.env,
  log: Logger = console
): RoomRepository {
  const url = env.UPSTASH_REDIS_REST_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN
  if (url && token) {
    return new UpstashRepository(new Redis({ url, token }), 1000, log)
  }
  return new MemoryRepository()
}
