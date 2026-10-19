# Scrum Poker — Session Handoff

> Read this first in a new session to pick up exactly where we left off.
> Last updated: 2026-10-19. Repo: `/Volumes/Sensitive/scrumpokerqwen` (git `main`; remote `origin` = public `github.com/markross/scrumpokerqwen`, `main` PR-protected). Live: `https://scrumpoker-195h.onrender.com`.

## Where we are: v0.1 COMPLETE ✅ — deployed & live-verified

A fully working real-time planning poker app, built to an agreed spec, verified, and live at `https://scrumpoker-195h.onrender.com`. Phase 1 (ship it) is fully done, including the human two-device pass on the public URL.

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
| `5ba773c` | docs: mark browser QA passed, Phase 2 hardening complete |
| `9cee10c` | ci: bump checkout/setup-node actions; docs: record GitHub push + CI green |
| `673c7c0` | chore: PR-review workflow (branch protection via API, PR template, docs) — PR #1 |
| `02c414d` | docs: record Render deploy live + production socket smoke — PR #2 |
| `2d6b1a8` | docs: close out resolved open questions — PR #3 |
| `0c9f9f9` | docs: mark Phase 1 complete (live two-device QA); rate-limit deferred — PR #4 |
| `84b553e` | docs: record Phase 3 agreement (share links + theme toggle) and scale answer — PR #5 |
| `7d1fa41` | feat(client): share links via `?join=CODE` prefill + copy invite link — PR #6 |
| `7ff0140` | feat(client): light/dark theme toggle — PR #7 |

## Next steps

Phase 1 is complete; Phase 2 is complete except rate-limiting (deferred by user decision — see below). **Phase 3 (agreed slice) SHIPPED ✅ 2026-10-19**: share links (PR #6) + light/dark theme toggle (PR #7) merged to `main`, CI green, and **live-verified on Render** (no-FOUC theme script + `"join"`/`Copy invite link` strings present in the served bundle). Scale answered (open question 3): **a handful of small rooms** → in-memory single instance confirmed sufficient; persistence/Redis and rate-limiting stay deferred. **Next actionable work: confirm with the user** whether to pick another backlog item (story text ruled out; remaining unagreed options: spectator/facilitator roles, sound on reveal, CSV export, Playwright UI tests) — do not build unagreed features.

### Phase 1 — Ship it ✅ COMPLETE

1. ~~Manual browser QA~~ — **done 2026-10-19**, two-tab walkthrough passed (see "Verified").
2. ~~Push to GitHub~~ — **done 2026-10-19**: public repo `https://github.com/markross/scrumpokerqwen` (remote `origin`, `main` tracked). First CI run passed (`39229593283`, 21 s). Token needed `workflow` scope for the CI file (`gh auth refresh -s workflow`).
3. ~~Deploy to Render~~ — **done 2026-10-19**: Blueprint live at **`https://scrumpoker-195h.onrender.com`** (free plan, oregon, Docker runtime, healthz wired; created from the dashboard by the user).
4. ~~Post-deploy smoke~~ — **done 2026-10-19**: automated half passed (throwaway script, not committed: `/healthz` 200 + `{"ok":true}`; two real socket.io clients over the public URL exercised create → join → vote secrecy (peer view `vote:null`, `hasVoted:true`) → reveal (8/null exposed) → reset-by-non-creator), and the **human two-physical-devices pass on the public URL passed** (user, real devices). Cold start: free tier sleeps after idle; first request pays spin-up and in-memory rooms are lost on sleep — documented/accepted.

### Phase 2 — Hardening

- ✅ **Pin `lucide-react`** — pinned to `1.59.0` (`00597e2`).
- ✅ **CI** — `.github/workflows/ci.yml`: `npm ci && lint && test && build` on PR/main (`1ab93b2`). Actions bumped to `checkout@v5`/`setup-node@v6` (`9cee10c`).
- ✅ **PR review workflow** — `main` protected via GitHub API: PRs required, CI `checks` must pass (and be up to date), force-push/delete blocked, enforced on admins too. Every change (features, tooling, docs) ships as a PR opened with `gh pr create` for the user to review/merge — see AGENTS.md "Workflow" and `.github/PULL_REQUEST_TEMPLATE.md`.
- ✅ **Automated e2e** — `server/realtime.test.ts`: three two-client socket.io tests against the booted server (`ee4b035`). `server/index.ts` now exports `httpServer`/`io` and skips auto-listen when `process.env.VITEST` is set — prod boot unchanged (`npm start` smoke-tested). Playwright UI tests remain an optional extra.
- **Rate-limit `room:create` / join** — **deferred 2026-10-19** (user decision): low risk at current scale (Render free-tier limits + 30-player cap + 24 h TTL sweep make abuse unlikely); revisit before heavy public use. Likely shape: pure token bucket keyed by client IP, wired in `server/index.ts` (keep `rooms.ts` pure).

### Phase 3 — Feature backlog (NOT agreed unless marked — confirm before building)

- **Story text per round**: a "current story" field (someone types the story being estimated; shown above the grid) and a lightweight backlog/next-story flow — the natural evolution of "Reset = new round".
- **Persistence / multi-instance**: move room store behind an interface (in-memory → Redis) if they ever need restart survival or >1 server instance. **Deferred 2026-10-19**: scale = a handful of small rooms; in-memory stays.
- ✅ **Share links** (`?join=CODE` prefill so the creator can send one clickable link) — **agreed + shipped 2026-10-19**, merged PR #6 (client-only: `client/src/lib/share.ts`, JoinScreen prefill, Room "Copy invite link"; live-verified on Render).
- **Spectator/facilitator roles**: only agreed "anyone can control" for now; if a facilitator model is ever wanted, gate reveal/reset server-side.
- ✅ **Light/dark theme toggle** — **agreed + shipped 2026-10-19**, merged PR #7 (client-only: `ThemeToggle` + `lib/theme.ts`; localStorage `scrumpoker.theme`, system default, no-FOUC script in `index.html`; live-verified on Render).
- Sound on reveal; export results CSV. (not agreed)

### Open questions for the user

1. ~~GitHub repo name/org for the push~~ — resolved: `markross/scrumpokerqwen` (public). ~~Render account~~ — exists; live on free plan, oregon (`https://scrumpoker-195h.onrender.com`).
2. ~~Per-round story text?~~ — **answered 2026-10-19: no / not yet.** Stays in Phase 3 backlog, not to be built without a new yes.
3. ~~How many concurrent teams ≈ the deployment must support?~~ — **answered 2026-10-19: a handful of small rooms.** In-memory single-instance confirmed adequate; revisit persistence only if the scale answer changes.

### Known limitations (documented, accepted for v0.1)

- State is in-memory: server restart/redeploy wipes rooms (players rejoin after creator recreates; sessionStorage auto-rejoin then fails gracefully back to the name screen).
- Disconnected players hold their seat until they leave explicitly or the room TTLs out (no auth to distinguish refresh vs. close).
- Duplicate names allowed (unambiguous via "You" badge).
