# Scrum Poker — Session Handoff

> Read this first in a new session to pick up exactly where we left off.
> Last updated: 2026-10-19. Repo: `/Volumes/Sensitive/scrumpokerqwen` (git `main`, clean tree, 11 commits).

## Where we are: v0.1 COMPLETE ✅

A fully working real-time planning poker app, built to an agreed spec, verified, and ready to deploy.

### Agreed spec (from clarification Q&A — do not regress)

- Real-time multiplayer; each player on their own device; rooms via 5-char codes (no-lookalike alphabet)
- Screen 1: name entry + Create room / Join by code → Screen 2: voting room
- All player names visible; votes hidden until reveal (peers only ever see "voted / not voted")
- Deck: `0 1 2 3 5 8 13 21 ? ∞`; votes changeable until reveal
- **Reveal** always available (even with zero votes); **anyone** can press Reveal / Reset
- Reset = new round in the same room: votes cleared, names kept
- Late joining allowed anytime
- After reveal: per-player flipped cards + summary (consensus/mode, min–max range, `?`/`∞` counted separately)
- Create-or-join by code flow (first player creates, shares code)

### Stack (user-selected, do not silently change)

Node 24 LTS · Express 5 · socket.io 4 · TypeScript 5 strict (shared event contracts in `shared/types.ts`) · React 19 · Vite 7 · Tailwind CSS v4 · shadcn/ui (dark-first zinc/indigo theme) · Vitest 3 · ESLint (typescript-eslint) · npm workspaces (server + client)

### Architecture invariants (preserve these)

1. **Server is the single source of truth.** Pure state machine in `server/rooms.ts` (unit-tested); every mutation broadcasts a *sanitized* per-player view (`getView`): other players' `vote` fields never leave the server before reveal; you always see your own.
2. **Typed sockets:** `ClientToServerEvents` / `ServerToClientEvents` in `shared/types.ts`; server `Socket`/`Server` generics = `<ClientToServerEvents, ServerToClientEvents>` (note the order — reversed generics caused a build error before).
3. **Stable player identity:** `playerId` in `sessionStorage`; server keeps seat + vote across refreshes; explicit Leave removes; disconnected players stay listed as Offline. Empty/stale rooms swept after 24 h TTL.
4. Rooms are **in-memory** (fine for one instance; see backlog for persistence).
5. Server hosts the built client + SPA fallback + `/healthz` (`server/index.ts`); dev = `tsx watch` (3001) + Vite (5173, proxies `/socket.io`, ws:true).

### Verified (all green at last run)

- `npm test` — 27/27 Vitest tests (`server/rooms.test.ts` 24 unit: secrecy, reveal, reset, late join, reconnect, validation, TTL sweep; `server/realtime.test.ts` 3 two-client socket.io e2e: wire-level secrecy, reveal/reset, disconnect/reconnect, leave, bad joins)
- `npm run lint` — clean; `npm run build` — clean
- The throwaway two-client realtime script is now permanent: `server/realtime.test.ts` (runs in `npm test`)
- Prod server serves built client + SPA routes + healthz
- `docker build` succeeds; container smoke-tested on port 3006 (healthz + index)
- `npm run dev` boots both processes, proxy works

- Human browser walkthrough (two tabs, dev = :5173): name entry → create/join → vote secrecy verified in devtools WS frames (peer `vote:null`, `hasVoted` visible) → reveal flip → summary → reset → mid-round refresh keeps seat+vote → late join → leave/confirm — **passed 2026-10-19**

### Commands

```bash
npm install && npm run dev   # dev (client :5173, server :3001)
npm test && npm run lint     # checks
npm run build && npm start   # production (single service, :3001, PORT env)
```

### Commit history

| Commit | What |
| --- | --- |
| `7dcf5b3` | chore: monorepo scaffold (workspaces, tsconfigs, vitest, eslint) |
| `914e059` | feat: shared types + room state machine + 24 tests |
| `55c0a25` | feat: Express 5 + socket.io realtime server |
| `387c554` | feat: client scaffold (Vite/React/Tailwind/shadcn primitives) |
| `7d8a5e5` | feat: join screen + voting room |
| `e883b8a` | chore(deploy): Dockerfile, render.yaml, README |
| `d6b3910` | docs: session handoff with status and next-steps plan |
| `ade7e7e` | docs: agent-facing repo notes (AGENTS.md) |
| `00597e2` | chore(deps): pin lucide-react 1.59.0, socket.io-client server devDep, ignore .idea/ |
| `ee4b035` | test(server): realtime two-client e2e suite |
| `1ab93b2` | ci: GitHub Actions lint/test/build on PR + main |

## Next steps

### Phase 1 — Ship it (the only agreed-but-unstarted work)

1. ~~Manual browser QA~~ — **done 2026-10-19**, two-tab walkthrough passed (see "Verified").
2. **Push to GitHub** (no remote yet; `git remote add origin …` + push — ask user for the org/repo name and confirm before creating it). The CI workflow (`.github/workflows/ci.yml`) activates on push.
3. **Deploy to Render** via Blueprint from `render.yaml` (config already in repo, untested against a real Render account). Check: public URL loads, WebSocket upgrade succeeds (`/healthz`, then a two-player sanity session), free-tier cold start behaviour (in-memory state lost on sleep — acceptable, documented).
4. Post-deploy smoke: same flow from two physical devices on the public URL.

### Phase 2 — Hardening

- ✅ **Pin `lucide-react`** — pinned to `1.59.0` (`00597e2`).
- ✅ **CI** — `.github/workflows/ci.yml`: `npm ci && lint && test && build` on PR/main (`1ab93b2`).
- ✅ **Automated e2e** — `server/realtime.test.ts`: three two-client socket.io tests against the booted server (`ee4b035`). `server/index.ts` now exports `httpServer`/`io` and skips auto-listen when `process.env.VITEST` is set — prod boot unchanged (`npm start` smoke-tested). Playwright UI tests remain an optional extra.
- Consider rate-limiting `room:create` / join (public-internet exposure) — still open, do before heavy public use.

### Phase 3 — Feature backlog (from earlier conversations; NOT agreed — confirm before building)

- **Story text per round**: a "current story" field (someone types the story being estimated; shown above the grid) and a lightweight backlog/next-story flow — the natural evolution of "Reset = new round".
- **Persistence / multi-instance**: move room store behind an interface (in-memory → Redis) if they ever need restart survival or >1 server instance.
- **Share links**: `?join=CODE` prefill so the creator can send one clickable link.
- **Spectator/facilitator roles**: only agreed "anyone can control" for now; if a facilitator model is ever wanted, gate reveal/reset server-side.
- Light/dark theme toggle; sound on reveal; export results CSV.

### Open questions for the user

1. GitHub repo name/org for the push, and does their Render account exist / which region?
2. Is per-round story text needed for the team's workflow? (Phase 3's top candidate.)
3. How many concurrent teams ≈ the deployment must support? (In-memory single-instance is fine for a handful of small rooms.)

### Known limitations (documented, accepted for v0.1)

- State is in-memory: server restart/redeploy wipes rooms (players rejoin after creator recreates; sessionStorage auto-rejoin then fails gracefully back to the name screen).
- Disconnected players hold their seat until they leave explicitly or the room TTLs out (no auth to distinguish refresh vs. close).
- Duplicate names allowed (unambiguous via "You" badge).
