# AGENTS.md

Scrum Poker — real-time planning poker. npm workspaces: `server` (Express 5 + socket.io 4) and `client` (React 19 + Vite 7 + Tailwind v4 + shadcn/ui). `shared/types.ts` holds domain types + socket event contracts for both sides.

## Start here

- `HANDOFF.md` is the authoritative session state: agreed spec (do not regress), architecture invariants, backlog. Phase 3 features are NOT agreed — confirm with the user before building them.
- Git: branch `main`, remote `origin` = `https://github.com/markross/scrumpokerqwen` (public). `main` is protected: PRs required, `checks` must pass, no direct pushes (enforced on admins too).

## Workflow: every change ships as a PR

All new features (and tooling/docs changes) go through a PR for the user to review — never push to `main` directly:

1. Branch from up-to-date `main`: `git checkout -b feat/<name>` (use `feat|fix|chore|docs|test|ci:` prefixes).
2. Commit, `git push -u origin <branch>`, open the PR with `gh pr create` (fill the PR template; note which spec/HANDOFF item it implements).
3. Wait for CI green, then **leave review/merge to the user** — do not merge unless explicitly asked.

Phase 3 features are NOT agreed — confirm with the user before building them. Do not create additional repos or deploy without user confirmation (see HANDOFF "Open questions").

## Commands (Node >= 24 required)

- `npm run dev` — tsx watch server (:3001) + Vite (:5173). Vite proxies `/socket.io` with `ws: true`, so the client is same-origin in dev.
- `npm run lint && npm test && npm run build` — full check. There is no root typecheck script; types are checked inside `npm run build` (client = `tsc --noEmit` + vite build; server = `tsc`).
- Single test file: `npx vitest run server/rooms.test.ts`. Vitest only includes `server/**/*.test.ts` (node env) — client tests would silently not run. E2E = `server/realtime.test.ts` (real socket.io clients vs booted server); no Playwright yet.
- `npm start` runs `node server/dist/server/index.js` — note the doubled `server/` segment below.

## Build / ESM gotchas

- `server/tsconfig.json` uses `rootDir: ".."` and includes `../shared/**/*.ts`, so output is `server/dist/server/index.js` + `server/dist/shared/` — NOT `dist/index.js`. `npm start`, the Dockerfile, and `main` in `server/package.json` all depend on this layout.
- Server imports relative modules with `.js` extensions (e.g. `../shared/types.js`) — NodeNext ESM requirement; do not "fix" them to `.ts` or extensionless.
- socket.io generics order must be `Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>` — reversed generics caused a build error before.
- Client path aliases: `@/` → `client/src`, `@shared/` → `shared/` (defined in both `client/vite.config.ts` and `client/tsconfig.json`).

## Invariants (unit-tested; do not break)

- `server/rooms.ts` is a pure state machine over a `Store` (Map). No socket.io in it — server wiring stays in `server/index.ts`.
- Vote secrecy: the server only ever broadcasts per-player sanitized views via `getView`; peers must not receive others' `vote` values before reveal (they see `hasVoted` only). Check this in devtools when touching any broadcast path.
- Player identity: `playerId` lives in client `sessionStorage`; the server keeps seat + vote across refreshes, explicit Leave removes. Rooms are in-memory; the sweep deletes **unnamed** stale rooms after 24 h — **named rooms are exempt and live forever** (agreed 2026-10-19).
- Persistence: `server/persistence.ts` defines `RoomRepository` (memory default | Upstash Redis REST when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set). `index.ts` hydrates the store before listening and queues coalesced snapshots after meaningful mutations; `rooms.ts` stays pure — serialize/hydrate helpers live there, repository wiring stays in `index.ts`. Never let a persistence error take down the server.
- Product spec: anyone can Reveal/Reset, Reveal works with zero votes, deck is `0 1 2 3 5 8 13 21 ? ∞`, late join anytime.

## Misc

- Env: `PORT` (default 3001), `CORS_ORIGIN` (comma-separated allowlist; leave unset for dev and the single-service production deploy), `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` (both set = durable rooms; unset = memory-only, e.g. dev/tests).
- Deploy: `render.yaml` Blueprint + multi-stage `Dockerfile` (runs `npm start` as non-root). In-memory state: restarts wipe rooms — documented and accepted for v0.1.
- `server/index.ts` exports `httpServer`/`io` and only auto-listens when `process.env.VITEST` is unset — `server/realtime.test.ts` boots it on port 0. Don't remove the guard or the exports.
