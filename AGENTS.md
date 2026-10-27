# idlebit2 Agent Guide

## Project Shape

- `src/game`: pure simulation, catalog, market, research, save schema, view selectors, and tests. The public barrel is `index.ts`; shared types live in `types/`. No imports from `react` or browser globals (`window`, `document`, `localStorage`). `purity.test.ts` enforces this.
- `src/render`: canvas display only. Levels read `RenderSnapshot` level snapshots and return hit targets. Game rules and hardware state belong to the simulation; camera and cosmetic effects belong to the renderer. See `src/render/README.md`.
- `src/ui`: React shell, HUD, plates, research, input, and CSS. Owns the keyboard. Entry: `src/ui/main.tsx`, mounted by `index.html`.
- `src/platform`: store, runtime loop, persistence, saves, and the offline-advance worker.
- `src/dev`: the DEV-only QA bridge (`window.__br`). Production builds never install it.
- `scripts/`: `bench/` (perf budgets), `balance/` (campaign bot; `run.ts --hours=N --out=<file>` also writes a save that `npm run qa` manifests load as `stage`) and `qa/` (headless Chrome capture and the layout audit).
- `public/assets/fonts/chakra-petch/`: the only typeface (D11), bundled locally. Reference assets through the Vite base (`import.meta.env.BASE_URL` or CSS `url()`s that Vite rewrites), never a hard-coded host path.
- `docs/`: `game-spec.md` (the rules), `decisions.md` (binding decision log), `architecture.md`, `tasks.md`, `research.md`, `hardware-progression.md`, `gpu-progression.md`, `gpu-runtime.md`, and `backlog.md` (known issues).

Game rules belong in `src/game`. React and canvas consume game functions and snapshots; they do not own progression, unlocks, rewards, timers, or balancing rules.

All simulation timing is hardware-derived: work volumes advance through component rates (`clockHz`, throughput). Do not add wall-clock timers where hardware can own the duration. Fixed clocks are only deadlines or physical latencies, and must be named as such.

`advanceGame(state, elapsedMs)` must be delta-invariant: `advance(200) ≡ advance(100)∘advance(100)`, including RNG draws.

## Pre-Live Design Policy

idlebit2 is pre-live. Breaking save schema, UI, and mechanic changes are allowed when they move the game toward `docs/game-spec.md`. Keep the spec and `docs/decisions.md` aligned with those changes and prefer reset notes over preserving obsolete behavior.

## Coding Standards

- Strict TypeScript. `npm run typecheck` must pass.
- Pure functions for simulation and selectors; immutable updates for game state. One exception (decisions D9): the platform may call `advanceGameOwned`, which takes ownership of its input state and updates hot buffers in place. The pure `advanceGame` stays the reference, and `core/owned.test.ts` proves both paths produce identical states.
- Currencies are `Amount` (exact decimal strings, `src/game/amount.ts`), never floats.
- All randomness goes through `src/game/core/rng.ts` and threads state explicitly.
- Keep files focused and under a few hundred lines; split by domain.
- Model state with explicit types instead of loose objects.
- Save serializable game state, not UI or canvas objects. Pre-live, a save shape change bumps `SAVE_VERSION` and older saves reset; write no migrations.
- Tests are a small core-invariant suite and nothing more: `purity.test.ts` (no React or browser globals in `src/game`), `amount.test.ts`, `core/advance.test.ts` (delta invariance, RNG included), `core/owned.test.ts` (D9) and `save/serialize.test.ts` (save round trip). Do not add tests unless the user asks for one; prove a change with typecheck, a scripted sim run or QA screenshots instead, and delete throwaway probes when done.

## UI Standards

- The first screen is playable.
- Concise copy: labels, values, unlock reasons, warnings.
- Do not show saving-up, payback or progression time forecasts. Show prices, balances, measured progress and actual gameplay timers.
- Keep the game uncluttered. Round progress belongs in the round report, not extra HUD tracks or feed lines. Remove subtext that repeats a visible label or value.
- One body text size; only the Credits and Data figures and headers are larger (D2.1). Currencies show whole numbers.
- Readable on desktop and mobile; respect safe-area insets; `image-rendering: pixelated`.
- Do not move controls in response to runtime status changes. Reserve stable geometry and update in place.
- Every light and animation shows real state at its real rate. No decorative effects.

## Verification

- `npm run verify`: the core-invariant tests, typecheck, build. It must stay green at every handoff.
- Prove behavior on the real artifact: a `tsx` script against the public `src/game` barrel for sim changes, `npm run qa` screenshots at 1280×800, 844×390, 390×780 and 320×568 for UI changes.
- `npm run bench`: perf budgets. `npm run balance`: the chained campaign bot.
- `npm run qa` with `npm run dev` running: captures and audits the game in headless Chrome into `artifacts/qa/` (git-ignored).
- `node scripts/qa/boot.mjs --url=<page>`: boot check of a built or deployed page (console errors plus desktop and phone shots).

## Subagent Ownership

- Lead/integrator owns root docs, configs, dependency choices, and final consistency.
- Simulation agent owns `src/game/**`. Only one agent at a time edits `src/game/types/**` and `src/game/index.ts`.
- Renderer agent owns `src/render/**`.
- UI agent owns `src/ui/**`.
- Platform agent owns `src/platform/**` and `src/dev/**`.

Agents are not alone in this repository. Do not revert edits made by others. Keep changes scoped to your owned area and adapt to nearby work.
