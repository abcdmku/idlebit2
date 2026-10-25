# idlebit2

An idle compute game. You start with one CPU core and a global queue of tasks. Your hardware has 10 seconds to pick up the task at the head of the queue, and the tasks grow as the round goes on. A round ends when your SLA drops below 80%. Finished work earns Credits and Data. Spend them on parts and research, and grow the core into a system, a rack, a room and finally a set of data centers.

Play it at https://abcdmku.github.io/idlebit2/.

## Run

Needs Node 24.

```sh
npm ci
npm run dev       # http://127.0.0.1:6174
```

## Verify

```sh
npm run verify    # tests, typecheck, build
npm run bench     # perf budgets
npm run balance   # chained campaign bot
npm run qa        # headless Chrome capture and layout audit (needs npm run dev)
```

## Docs

[Game spec](docs/game-spec.md), [decisions](docs/decisions.md), [architecture](docs/architecture.md), [backlog](docs/backlog.md) and [AGENTS.md](AGENTS.md).

## Deploy

Every push to `main` builds with `GITHUB_PAGES=true` and publishes `dist/` to GitHub Pages at `/idlebit2/`.
