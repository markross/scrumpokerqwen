import { Redis } from '@upstash/redis'
import { DECK_VALUES, type Phase } from '../shared/types.js'
import type { PlayerSnapshot, RoomSnapshot } from './rooms.js'

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

const PHASES: readonly string[] = ['voting', 'revealed']

/**
 * Full shape check for a persisted row, before it reaches `deserializeRoom`.
 * `code` alone is not enough: a row that passes a shallow check but has no
 * valid `players` array makes deserialization throw, and without this filter
 * that one row cost us every room after it in the restore — including named
 * rooms. Returns null for anything unusable (the caller warns and skips).
 */
export function parseSnapshot(candidate: unknown): RoomSnapshot | null {
  if (!candidate || typeof candidate !== 'object') return null
  const row = candidate as Partial<RoomSnapshot>
  if (typeof row.code !== 'string' || row.code.length === 0) return null
  if (row.name !== null && typeof row.name !== 'string') return null
  if (typeof row.phase !== 'string' || !PHASES.includes(row.phase)) return null
  if (typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)) return null
  if (!Array.isArray(row.players)) return null
  const players: PlayerSnapshot[] = []
  for (const entry of row.players) {
    if (!entry || typeof entry !== 'object') return null
    const player = entry as Partial<PlayerSnapshot>
    if (typeof player.id !== 'string' || player.id.length === 0) return null
    if (typeof player.name !== 'string') return null
    const vote = player.vote
    if (vote !== null && vote !== undefined && !(DECK_VALUES as readonly string[]).includes(vote)) return null
    players.push({ id: player.id, name: player.name, vote: vote ?? null })
  }
  return {
    code: row.code,
    name: row.name ?? null,
    phase: row.phase as Phase,
    updatedAt: row.updatedAt,
    players
  }
}

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
  private flushing: Promise<void> | null = null

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
        const parsed = parseSnapshot(candidate)
        if (parsed) {
          snapshots.push(parsed)
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

  /**
   * Shutdown path: `index.ts` calls this right before `process.exit(0)`, so it
   * has to wait for the flush already on the wire (the in-flight promise used to
   * be untracked, which truncated up to ~1 s of writes) and then drain whatever
   * arrived since.
   */
  async close(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const inFlight = this.flushing
    if (inFlight) await inFlight
    await this.flush()
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.flushing) {
        this.schedule() // one flush at a time — re-arm and try again shortly
        return
      }
      void this.flush()
    }, this.coalesceMs)
    this.timer.unref()
  }

  /**
   * Drains the queue one command at a time. Single-flight by construction: two
   * overlapping flushes could finish out of order and let a queued `hdel` land
   * before a late `hset`, reviving a room the sweep had just deleted.
   */
  private async flush(): Promise<void> {
    if (this.flushing) return this.flushing
    const entries = [...this.pending]
    this.pending.clear()
    const running = (async () => {
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
    })()
    this.flushing = running
    try {
      await running
    } finally {
      if (this.flushing === running) this.flushing = null
    }
  }
}

/** Redis when both Upstash env vars are set, otherwise process-local memory. */
export function createRepository(
  env: NodeJS.ProcessEnv = process.env,
  log: Logger = console
): RoomRepository {
  // Tests boot `index.ts`, which builds this repository from the live env: never
  // let a dev shell's UPSTASH_* exports turn `npm test` into writes against the
  // production database.
  if (env.VITEST) return new MemoryRepository()
  const url = env.UPSTASH_REDIS_REST_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN
  if (url && token) {
    return new UpstashRepository(new Redis({ url, token }), 1000, log)
  }
  return new MemoryRepository()
}
