## What

<!-- one-paragraph summary of the feature/change -->

## Why

<!-- link to spec/HANDOFF item; Phase 3 features must be agreed with the user first -->

## Checklist

- [ ] `npm run lint && npm test && npm run build` green locally (CI runs them too)
- [ ] Any broadcast-path change preserves vote secrecy (`getView` sanitization; peers see `hasVoted` only pre-reveal)
- [ ] New/changed socket events are in the `shared/types.ts` contracts, with correct server generic order
- [ ] `server/rooms.ts` stays socket.io-free; wiring stays in `server/index.ts`
- [ ] New behaviour covered by Vitest (unit in `rooms.test.ts`, two-client e2e in `realtime.test.ts`)
- [ ] HANDOFF.md updated (status / commit table / backlog)
