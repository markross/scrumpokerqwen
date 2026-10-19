# Scrum Poker

A real-time planning poker (Agile estimation) web app. Players join a room from
their own devices, estimate stories with Fibonacci values, and reveal votes
together.

## How it works

1. **Join** — one player enters a name (and optionally a room name like
   "Team Alpha") and creates a room. Share the 5-character code, a
   `?join=CODE` / `?room=NAME` invite link, or just tell people the room
   name — the join screen can search by code *or* name (late joining is fine).
2. **Vote** — each player picks `0 1 2 3 5 8 13 21 ? ∞`. Others only see
   *whether* you voted, never *what* you voted. Votes are changeable until reveal.
3. **Reveal** — anyone can press **Reveal votes**; cards flip and a summary shows
   the consensus (mode), the min–max range, and `?`/`∞` counts.
4. **Reset** — anyone can press **Reset** to clear votes for the next story.
   Players stay in the room.

## Stack

Node 24 · Express 5 · socket.io 4 · TypeScript (strict) · React 19 · Vite 7 ·
Tailwind CSS 4 + shadcn/ui · Vitest · Docker

## Quick start

```bash
npm install
npm run dev
```

- Client: http://localhost:5173 (proxies socket.io to the server)
- Server: http://localhost:3001

## Scripts

| Command              | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `npm run dev`        | Server (tsx watch) + Vite dev server     |
| `npm run build`      | Compile server (`tsc`) + build client    |
| `npm start`          | Run production server (serves client)    |
| `npm test`           | Vitest unit tests (room state machine)   |
| `npm run lint`       | ESLint                                   |

## Architecture

- `shared/types.ts` — domain types + socket event contracts used by both sides.
- `shared/naming.ts` — pure room-name normalization/validation (shared so the
  server-side tests cover the same rules the client uses).
- `server/rooms.ts` — pure, unit-tested room state machine. The server is the
  single source of truth; it emits each player their own **sanitized** view,
  so other players' votes never reach the network before reveal.
- `server/persistence.ts` — `RoomRepository` seam for durable room snapshots:
  `MemoryRepository` (default, process-local) or `UpstashRepository`
  (Redis via Upstash REST, coalesced writes, failures logged never fatal).
- `server/index.ts` — Express (static hosting + `/healthz`) and socket.io
  wiring; hydrates the store from the repository before listening and queues
  snapshots after every meaningful mutation.
- `client/` — React app: `useRoom` socket hook, JoinScreen, Room, PlayerCard
  (flip animation), VoteDeck, SummaryBar.

Players survive a page refresh: identity lives in `sessionStorage` and the
server keeps their seat (and vote) until they explicitly leave.

## Environment

| Variable                   | Default | Purpose                                             |
| -------------------------- | ------- | --------------------------------------------------- |
| `PORT`                     | `3001`  | HTTP + socket.io port                               |
| `CORS_ORIGIN`              | unset   | Comma-separated socket.io origin allowlist          |
| `UPSTASH_REDIS_REST_URL`   | unset   | With `TOKEN`: rooms persist across restarts         |
| `UPSTASH_REDIS_REST_TOKEN` | unset   | (Upstash REST credentials; both must be set)        |

Without the Upstash variables the server runs exactly like before: in-memory
rooms only. With them, every room (named or not) is snapshotted to Redis,
restored on boot, and **named rooms never expire** — a team can revisit
"Team Alpha" any time in the future. Unnamed rooms keep the 24 h stale sweep.

## Deployment (Render)

`render.yaml` deploys this repo as a single Docker web service. Push the repo,
create a **Blueprint** from it on Render, and share the resulting URL.
`/healthz` is the health check; WebSockets are supported out of the box.

Local Docker run:

```bash
docker build -t scrumpoker .
docker run --rm -p 3001:3001 scrumpoker
```

> Note: without `UPSTASH_REDIS_REST_URL`/`_TOKEN` state is in-memory and a
> server restart clears rooms. Set both (e.g. a free [Upstash](https://upstash.com)
> Redis database) to make rooms — especially named ones — durable across
> restarts and redeploys. `/healthz` reports the active `persistence` mode.
