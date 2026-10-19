# AGENTS.md

Scrum Poker — real-time planning poker. npm workspaces: `server` (Express 5 + socket.io 4) and `client` (React 19 + Vite 7 + Tailwind v4 + shadcn/ui). `shared/types.ts` holds domain types + socket event contracts for both sides.

## Start here

- `HANDOFF.md` is the authoritative session state: agreed spec (do not regress), architecture invariants, backlog. Phase 3 features are NOT agreed — confirm with the user before building them.
- Git: branch `main`, no remote. Do not create/push a GitHub repo or deploy without user confirmation (see HANDOFF "Open questions").

## Commands (Node >= 24 required)

- `npm run dev` — tsx watch server (:3001) + Vite (:5173). Vite proxies `/socket.io` with `ws: true`, so the client is same-origin in dev.
- `npm run lint && npm test && npm run build` — full check. There is no root typecheck script; types are checked inside `npm run build` (client = `tsc --noEmit` + vite build; server = `tsc`).
- Single test file: `npx vitest run server/rooms.test.ts`. Vitest only includes `server/**/*.test.ts` (node env) — client tests would silently not run; no e2e yet.
- `npm start` runs `node server/dist/server/index.js` — note the doubled `server/` segment below.

## Build / ESM gotchas

- `server/tsconfig.json` uses `rootDir: ".."` and includes `../shared/**/*.ts`, so output is `server/dist/server/index.js` + `server/dist/shared/` — NOT `dist/index.js`. `npm start`, the Dockerfile, and `main` in `server/package.json` all depend on this layout.
- Server imports relative modules with `.js` extensions (e.g. `../shared/types.js`) — NodeNext ESM requirement; do not "fix" them to `.ts` or extensionless.
- socket.io generics order must be `Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>` — reversed generics caused a build error before.
- Client path aliases: `@/` → `client/src`, `@shared/` → `shared/` (defined in both `client/vite.config.ts` and `client/tsconfig.json`).

## Invariants (unit-tested; do not break)

- `server/rooms.ts` is a pure state machine over a `Store` (Map). No socket.io in it — server wiring stays in `server/index.ts`.
- Vote secrecy: the server only ever broadcasts per-player sanitized views via `getView`; peers must not receive others' `vote` values before reveal (they see `hasVoted` only). Check this in devtools when touching any broadcast path.
- Player identity: `playerId` lives in client `sessionStorage`; the server keeps seat + vote across refreshes, explicit Leave removes. Rooms are in-memory with a 24 h stale-room sweep.
- Product spec: anyone can Reveal/Reset, Reveal works with zero votes, deck is `0 1 2 3 5 8 13 21 ? ∞`, late join anytime.

## Misc

- Env: `PORT` (default 3001), `CORS_ORIGIN` (comma-separated allowlist; leave unset for dev and the single-service production deploy).
- Deploy: `render.yaml` Blueprint + multi-stage `Dockerfile` (runs `npm start` as non-root). In-memory state: restarts wipe rooms — documented and accepted for v0.1.
- Known issue: `lucide-react` is `"latest"` (unpinned) in `client/package.json`.
