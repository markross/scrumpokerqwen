# FIX_PLAN.md — Review remediation plan

Created 2026-10-22 from two independent whole-codebase reviews (findings cross-validated against the code; server-crash and hydrate-crash paths reproduced empirically against `server/dist`).

## Status (written 2026-10-22, updated 2026-10-23)

| Group | PR | State |
| --- | --- | --- |
| PR 1 — socket hardening (server crash) | #11 | **MERGED** (was already opened when this plan was written; live on `main`) |
| PR 2 — client resilience (redeploy stranded players) | #12 | Open, CI green, ready for your review |
| PR 3 — persistence correctness (+ Vitest/Redis isolation) | #13 | Open, CI green, ready for your review |
| PR 4 — dead-code chore | #14 | Open, CI green, ready for your review |
| PR 5 — creation growth | #16 (sweep) | **Reworked 2026-10-23:** a named room is a *standing room* — the sweep now **empties** it (evicts offline players, resets the round) instead of deleting it. Per-IP create bucket + global `MAX_ROOMS` **still not built**, and now the only thing bounding how many rooms exist — needs your go/no-go |
| Extras — vote/reveal/reset error feedback + `CORS_ORIGIN` trim | #15 | Open, CI green (stacked on #12); Vitest Redis isolation shipped with #13 |
| Excluded — seat-takeover / vote-peeking | — | Not built, by your decision (participants assumed trusted) |

Docs for the code PRs are deliberately consolidated: each PR carries only the doc lines it invalidates (#16 corrects the "live forever" invariant in place), and one closing `docs:` PR will update HANDOFF's test counts, commit table and next-steps once these merge.

Scope decisions already made by the user:

- **Seat-takeover / vote-peeking finding is EXCLUDED** — participants are assumed trusted. Do not add per-seat auth tokens.
- **Room-creation growth:** on 2026-10-22 the user first chose retention over rate limiting, then **clarified on 2026-10-23** that a named room is a *standing room* — the sweep must **empty** it (evict players whose socket is gone, start a fresh round once the roster is clear) rather than delete it, so today's team doesn't inherit yesterday's absentees while `/<team-alpha>` keeps working (shipped as #16). Consequence: named rooms are never deleted again, so nothing bounds how many exist — the token bucket / `MAX_ROOMS` cap is the remaining guard and is still open.


Workflow per AGENTS.md: one branch + PR per fix group (`fix:`/`chore:` prefix), `gh pr create`, CI green, merge left to the user. Full check before pushing each: `npm run lint && npm test && npm run build`.

## Priority order

1. PR 1 — server crash (one raw packet kills the process for everyone) → **merged** #11
2. PR 2 — client resilience (every Render redeploy/spin-down currently strands all players) → #12 (open)
3. PR 3 — persistence correctness (durability promise is silently partial today) → #13 (open)
4. PR 4 — dead-code chore (independent, trivial) → #14 (open)
5. PR 5 — creation growth → sweep behaviour **settled 2026-10-23** (#16: named rooms emptied of absent players, never deleted); cap/token bucket still awaiting go/no-go

Extras from the companion review: vote/reveal/reset error feedback + `CORS_ORIGIN`
trim → #15 (open, stacked on #12); Vitest Redis isolation → #13.

---

## PR 1 — `fix/socket-hardening` (their #2) — CRITICAL

**Files:** `server/index.ts`, `server/realtime.test.ts`

**Problem (reproduced 4/4):** socket.io 4.8.4 invokes event listeners via `emitUntyped` inside `process.nextTick` with no try/catch (`node_modules/socket.io/dist/socket.js` `dispatch()`), so any synchronous throw in a handler is an uncaughtException that kills the whole process — all rooms gone. Reachable unauthenticated from a browser console:

- `emit('player:leave')` with no ack callback → `TypeError: ack is not a function` (`index.ts:160`)
- `emit('room:create')` with no payload → `payload.name` throws → `name.trim()` in `rooms.ts:59`
- `emit('room:create', {…})` with no callback → success path calls `ack(…)` → throws
- `emit('vote:place')` with no payload → `payload.value` throws
- `room:join` with non-string `code`/`roomName` (e.g. number) → `.trim()` throws in `normalizeCode`/`slugifyRoomName`

The e2e suite misses it because it always uses `emitWithAck` with well-formed payloads.

**Implementation:**

1. In `index.ts`, add a small per-handler wrapper (typed helper) that try/catches the handler body and `console.warn`s — one bad packet must never take down the server (same principle as the persistence invariant).
2. Validate payloads at handler entry before touching `rooms.*`:
   - `room:create` / `room:join`: `name` is string; for join, `code` and/or `roomName` string-or-undefined.
   - `vote:place`: `payload?.value` is string (deck membership already checked in `placeVote`).
   - Ack errors when possible (`typeof ack === 'function'` guard before every `ack(...)`; never assume the callback exists).
3. Keep `rooms.ts` untouched — it already returns `Result`s; this is wiring-layer hardening only.

**Acceptance:** new e2e test in `realtime.test.ts` fires each malformed packet above on a raw socket (`emit` with no callback), then asserts the server still responds on a fresh `emitWithAck` roundtrip (and a second socket survives). All 67 existing tests keep passing.

**Effort:** S–M.

---

## PR 2 — `fix/client-resilience` (their #1, #7, #8 + #9 refactor) — HIGH

**Files:** `client/src/useRoom.ts`, `client/src/lib/share.ts` (new pure helpers there or in a new `client/src/lib/session.ts`), plus node-env unit tests.

Do the #9 dedupe first, then layer the fixes on the shared join path.

### 2a. Dedupe join paths (their #9 — cleanup)

`joinRoom` / `joinByName` duplicate `joinTarget`'s emit → `saveSession` → `pushRoomPath` shape. Make all three delegate to one internal `doJoin(target, displayName, opts)`. Safe because the `room:state` handler's `replaceState` re-canonicalizes the URL (name path) anyway.

### 2b. Rejoin after reconnect (their #1 — the headline fix)

**Problem:** `socket.on('connect')` (`useRoom.ts:160`) only sets `connected = true`. After a server restart or network blip, socket.io auto-reconnects, but the new server-side socket has no room: Vote/Reveal/Reset become silent no-ops (server early-returns on empty `socket.data`) and the player shows Offline to peers. Only a manual page reload recovers. Render free-tier spin-downs and redeploys trigger this regularly.

**Implementation:**

1. Introduce an `intent` ref: `{ code, name, playerId }` set on create/join ack success; cleared on leave and on rejoin-ack failure. This is the single source of truth for "which room should my socket be bound to".
2. On socket `'connect'` events after the first (`reconnect` semantics — compare against a `joinedOnThisSocket` marker reset by `disconnect`), if `intent` is set, re-emit `room:join` with `{ code, name, playerId: meId }`.
   - Success → normal `room:state` flow restores the view (server keeps seat + vote across disconnects, `rooms.ts:106–111`, so this lands on the existing seat).
   - Failure (memory-only prod restart wiped the room, or 24 h TTL) → clear `intent` + `clearSession()`, show lobby with the existing prefilled name; surface the server error ("Room not found…") instead of failing silently.
3. Guard against double-join races: ignore connect-triggered rejoins while `busy` (initial join in flight).

### 2c. Leave works offline (their #8)

**Problem:** `leaveRoom` clears local state only in the ack callback (`useRoom.ts:139–145`). Offline, socket.io buffers the emit, the ack never arrives, the button does nothing — and because `clearSession()` is also ack-gated, a page reload re-joins the room you just left.

**Implementation:** make `leaveRoom` clear locally and synchronously (`intent = null` first — see 2d, then `setRoomBoth(null)`, `clearSession()`, `setError(null)`), emit `player:leave` best-effort (ack ignored). For the popstate cross-room case, `emit('room:join')` immediately after `emit('player:leave')` — socket.io guarantees per-socket ordering and `index.ts` processes events sequentially, so no ack-wait is needed for correctness (this also removes the current nested-ack callback).

### 2d. Late `room:state` can't resurrect the lobby (their #7)

**Problem:** a pre-leave broadcast arriving after `leave()` pushed `/` runs the `room:state` handler's `replaceState` (`useRoom.ts:155–158`) and pins the address bar to the room path (view itself recovers when the ack lands, but the URL desync sticks). With 2c's synchronous clear it would be worse — a stale broadcast would re-render the room view.

**Implementation:** drop `room:state` events whenever `intent` is null (an event that arrives while we don't intend to be in any room is by definition racing a leave — the server never targets a detached socket otherwise). This one gate fixes both the URL desync and the resurrection vector, and composes with 2b (rejoin sets `intent` before broadcasts arrive: `index.ts` queues `ack` before `broadcast`).

**Tests (must stay DOM-free per AGENTS.md):** extract the decision logic as pure helpers — e.g. `shouldAcceptState(intent)` and `rejoinAction(intent, isFirstConnect, busy)` — and unit-test them in `client/src/lib/*.test.ts`. Wire-up in `useRoom` stays thin. Realistic e2e coverage of reconnect needs Playwright; out of scope, note it.

**Effort:** M.

---

## PR 3 — `fix/persistence-robustness` (their #4, #5) — MEDIUM

**Files:** `server/persistence.ts`, `server/rooms.ts`, `server/persistence.test.ts`, `server/rooms.test.ts`

### 3a. `close()` must await in-flight flushes (their #4)

**Problem:** `close()` (`persistence.ts:108–114`) clears the timer and awaits *a new* `flush()`, but never the one already running (the in-flight promise isn't tracked). `index.ts:196` `process.exit(0)` can therefore truncate `hset`s still on the wire — undermining the "state survives redeploys" promise by up to ~1 s of writes. Overlapping flushes can also complete out of order (queued `hdel` landing before a late `hset` revives a swept room — self-healing at next sweep, but sloppy).

**Implementation:** track `private flushing: Promise<void> | null`; in `close()`: `clearTimeout`, `await this.flushing`, then `await this.flush()` once more. Single-flight serialization (skip a scheduled flush while one runs, re-arm instead) fixes ordering as a side effect. Keep the never-throw contract.

### 3b. One corrupt row must not abort the whole restore (their #5)

**Problem (reproduced):** `loadAll` only checks `typeof code === 'string'` (`persistence.ts:85`). A row that passes but lacks a valid `players` array makes `deserializeRoom` throw (`for…of` on `undefined`, `rooms.ts:269`); the throw escapes `hydrateStore` into the catch-all at `index.ts:177–184`, and every room after the bad row is silently not restored — including named rooms that are supposed to live forever.

**Implementation:**

1. Validate each snapshot fully in `loadAll` before yielding it: `players` is an array of `{ id: string, name: string, vote: deck value | null }`, `phase` in `{voting, revealed}`, `updatedAt` number. Warn + skip invalid rows (existing pattern).
2. Defense in depth: per-snapshot `try/catch` inside `hydrateStore` (`rooms.ts:282`) so future shape regressions skip one room instead of dropping the batch. Keep `rooms.ts` pure — skip silently, no logging inside.

**Tests:** `close()` waits for a slow in-flight flush before resolving (deferred-promise fake client); `loadAll` skips rows with missing/non-array `players` and bad `phase` while returning the good ones; `hydrateStore` survives a malformed snapshot mid-array.

**Effort:** S–M.

---

## PR 4 — `chore/remove-dead-code` (their #10) — TRIVIAL

- Delete `validRoomName` (`shared/naming.ts:64–67`) and `NUMERIC_VALUES` (`shared/types.ts:5`) — zero call sites (grep-verified; not used by tests).
- Inline the pointless `const key = wanted` (`server/rooms.ts:139`).
- **Keep** `roomNameKey` even though it's currently `slugifyRoomName` — it's a documented domain concept (identity vs URL form, `naming.ts:33–40`), not an accident.

Verify: `npm run lint && npm test && npm run build` (removing `NUMERIC_VALUES` touches `shared/types.ts`, which both workspaces compile).

---

## PR 5 — `feat/room-creation-limits` (their #6) — SPLIT: sweep decided 2026-10-23, caps still open

**Problem:** `room:create` is unauthenticated and uncapped. Unnamed rooms sweep after 24 h, but named rooms never expire, so anyone can create named rooms until memory (and the Redis hash) grows forever; each create also O(n)-scans the store for name uniqueness.

**Decided 2026-10-23 (sweep semantics):** the user clarified what the sweep should do to a named room — **keep the room, remove the players**, because "on one day the players using a named room might be different to the next day, so I don't want non present players to be left in the room on subsequent days" → shipped as #16 (`fix/room-sweep-policy`). `sweepStaleRooms` now returns `{ deleted, cleared }`: unnamed rooms are deleted as before; a stale named room has its **offline** players evicted (votes included) and, once the roster is empty, is reset to a fresh `voting` round. Connected players are never evicted from a named room. `index.ts` persists the change (`remove` for deletes, `save` + `broadcast` for empties) and logs both kinds.

**Still open (caps):** this resolves the *room* half of the finding but **not** the growth half — since a named room is now never deleted, the count of rooms is unbounded again (the sweep only bounds what each room holds). The per-IP create bucket and a global `MAX_ROOMS` store cap were **not** built; HANDOFF deferred rate-limiting on 2026-10-19 ("revisit before heavy public use"), but with named rooms permanent again this is the only remaining guard. Likely shape unchanged: pure token bucket keyed by client IP wired in `index.ts` (5 creates/min, reused for joins), `MAX_ROOMS` (~300) returning a friendly "too many rooms right now" ack, `rooms.ts` staying pure. A name→code `Map` index is worth adding in the same PR only if creation volume ever makes the O(n) uniqueness scan matter — unnecessary at legitimate scale.

## Optional extras (from the companion review)

- **Vote/reveal/reset errors are swallowed** (`index.ts` discarded `result.error`; no ack in the contract) → **built, #15 (open)**: `vote:place`/`room:reveal`/`room:reset` carry an `ActionResult` ack, and the room view shows the refusal.
- **`CORS_ORIGIN` not trimmed** → **built, #15 (open)** as `parseCorsOrigins` (trimmed, empties dropped, empty-list ≡ unset) with unit tests.
- **Test isolation:** `realtime.test.ts` imported `index.ts`, which built `createRepository()` from the real env — a dev shell with `UPSTASH_*` exported made `npm test` write test rooms to prod Redis → **built, #13 (open)**: memory repository forced whenever `VITEST` is set.

---

## Follow-ups found while implementing (not in scope for the groups above)

1. **Named rooms accumulate.** They are never deleted (by design, 2026-10-23) and the sweep only empties them, so the store and the `scrumpoker:rooms` hash grow with every name ever created, and each create O(n)-scans for uniqueness. This is the case the still-unbuilt per-IP create bucket + `MAX_ROOMS` cap exists to bound (PR 5 above) — needs your go/no-go. Related question worth settling: should an *empty* named room keep its name reserved forever (today: yes)?
2. **Unnamed-room sweep is `updatedAt`-only, so an idle-but-attended throwaway room goes out from under its players.** A room whose players leave a tab open without voting for 24 h is deleted while they watch it; their next action then fails ("Room not found." — and with #15, they see why). Pre-existing, and #16 deliberately left it that way: named rooms protect connected players (only offline players are evicted), unnamed ones stay throwaway. Two-line fix if you ever want it for unnamed rooms too: skip rooms with a connected player.
3. **No browser-level test coverage for the client fixes.** The reconnect rejoin, offline Leave and the new error banner are covered at the socket level and as pure functions, but not in a real browser — Playwright is still the standing gap in the backlog. Manual pass worth doing on `npm run dev`: two tabs in a room, then `Ctrl-C` + restart the server.
4. **Upstash in Render is still not enabled**, so prod remains memory-only: a redeploy still wipes every room — named ones included, since only Redis makes them standing. Players now recover to the lobby with a clear message instead of a dead room. Steps are in HANDOFF "To enable durability in prod".
