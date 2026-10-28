# Architecture

> **Ship note, 25 Oct 2026 (D17).** The game shipped as idlebit2 in a fresh repository. The v3 trees were hoisted one level (`src/game/v3/x` is now `src/game/x`, `scripts/v3/x` is now `scripts/x`, `/v3.html` is now `/`), and the v2 code, the mockups, the archived docs and the pre-ship briefs were removed. The v3 docs lost their prefix: `v3-program.md` is `decisions.md`, `v3-architecture.md` is `architecture.md`, `v3-tasks.md` is `tasks.md`, `v3-research.md` is `research.md`. Mentions below of removed files (`docs/mockups/`, `docs/archive/`, `docs/v2-*`, the v3 briefs, v2 code) are historical; those files remain in the BitRouge repository.

Architecture owner, 24 October 2026. Inputs: `docs/decisions.md` (binding, including decision log D1), `docs/research.md`, `docs/v3-handoff.md`, `docs/v2-architecture.md`, `docs/v2-perf-premise.md`, the v2 code and a measured prototype kernel (`docs/v3-arch-notes.md`). `docs/tasks.md` and the v3 `docs/game-spec.md` did not exist yet when this was written. Where this document needs something from them, §1.9 lists it as a requirement.

The accepted task lifecycle rule in `decisions.md` and `v3-onboarding-task-plan.md` supersedes the original arrival sampling, warm-up and arrival caps. D1/D2/D3 desktop and C1/C2/C3 CPU layouts remain review prototypes under `docs/mockups/v3/onboarding/`; no production layout is chosen. Existing GPU contracts, CPU/RAM specialized progression and performance budgets remain unchanged.

## 0. Summary

- **Sim.** A fixed 100 ms tick over struct-of-arrays typed buffers. A task record is a cohort with a count, and early-game records have count 1. Under D25 a routed task is cut into at most 256 shards, each a count-1 record with a parent row (§1.4). Each system keeps one cumulative work clock per resource, so a tick costs O(racks + task events), not O(running tasks). The RNG is used only by the market. `Amount` appears only in the per-tick ledger.
- **Fleet caps.** 12 servers per rack, 24 racks per room (3 rows of 8), 3 zones per site, 8 sites (one per map region). The largest fleet is 6,912 servers. Exactly one logical task arrives every 20 simulation ticks while running, with five real saved future tasks.
- **Contract.** `advanceGame`, `applyAction`, `deriveRenderSnapshot(state, scope)`, `quote(state, request)`. The snapshot covers only the visible level and its zoom partner. Quotes are a separate, lazy call.
- **Delivery.** v3 is built in parallel `v3` trees. Twelve Wave 1 agents own disjoint paths, and one of them owns the shared types and the barrel. Wave 2 deletes v2 and hoists the `v3` trees in one scripted step.

## 1. The sim model

### 1.1 Fixed tick and carry

```ts
export const TICK_MS = 100;            // program §13 starting value
export function advanceGame(state: GameState, elapsedMs: number): AdvanceResult;
```

- `elapsedMs` must be a non-negative safe integer. The platform keeps the fractional `performance.now()` remainder itself (it already does at its 50 ms cadence).
- `carry = state.clock.carryMs + elapsedMs`, `ticks = floor(carry / 100)`, `carryMs = carry % 100`. Everything is integer arithmetic.
- The sim then runs `ticks` identical tick functions. A tick reads only the state at its start. Nothing depends on where a call boundary falls, so `advance(200) ≡ advance(100)∘advance(100)` holds by construction, RNG included.
- A call that runs zero ticks returns `{ ...state, clock: { tick, carryMs } }` without touching the buffers.
- Player actions apply between ticks. An action dispatched mid-carry takes effect at the start of the next tick.
- `state.clock.tick` is the canonical time (`simTimeMs = tick × 100 + carryMs`). The store's publish revision is store metadata, not game state, as in v2.

The foreground runtime passes at most 100 ms of simulation time per main-thread advance, including save and departure boundaries. Excess time stays owed. A visible stall over 2 s uses worker catch-up; an action or pause with more than one tick owed also settles through that path. Dispatch rechecks catch-up before applying an action, and queued replay does not run the foreground boundary again. Save timestamps represent confirmed simulation state. Pausing during a pending worker result does not move that checkpoint into the future. Unhandled foreground simulation errors stop scheduling and saving, reject further live actions and ask the player to reload the last save. This bounds catch-up work per call; it does not preempt an individual tick.

**Quiescent skip.** If the round is not running, no research runs, no timer is pending, no task record exists and every thermal lump is settled, a tick changes nothing except `tick`. The loop then jumps straight to `min(target, nextWakeTick)`, where the next wake is, for example, auto-return. Settling is a spec rule: a lump within 0.05 °F of its equilibrium snaps to it. Every skipped tick would have been a no-op, so the skip keeps delta invariance. An absent player's paused hours cost O(1).

### 1.2 Tick phases

The order is fixed, and each phase has one owning domain. Rates hold for the whole tick: efficiency, clock state and supply state come from the tick's start.

| # | Phase | Owner | Does |
|---|---|---|---|
| 1 | `timers` | core | Boot timers (one shared boot time covers online/offline transitions, post-failure reboot, mid-round add and cold change, D1.8), drain, auto-return, C-state and S3 timers. All are counted in ticks. |
| 2 | `market` | market | Advances round-age difficulty, consumes each due saved slot every 20 ticks into pending work and refills the five-task schedule. Marked slots retire at arrival without an outcome. RNG is used only for plan generation, including initialization and round preparation. |
| 3 | `links` | net | Advances every link clock. A transfer that finishes a hop enters the next link on its reserved path, or arrives at its server. |
| 4 | `route` | net | D25: shard stealing; then each router queue dispatches FIFO, top-down (global → data plane → room LB → rack LB); then the top router takes heads. One `split` builds the tree for a take or a dispatch. It narrows candidates to children with room (or a free queue slot), applies filters and strategy shares, and cuts whole-unit shards of at least the effective grain. It reserves every slot and queue entry atomically and enqueues one transfer per shard. Minimum splits (`members`) use the same path. A head with no split and a full top queue stays in the market (D1.5). No routing budget (D12.5). |
| 5 | `admit` | exec | Arriving shard transfers take their reserved slot (running or the scheduler queue). Before Rack the lone system pulls the head itself. Gates are checked per shard here; a shard the server cannot run fails its whole task as `misroute` and aborts its siblings. |
| 6 | `run` | exec | Resource clocks advance; shard completions, stage transitions and in-tick carry happen; a task whose last shard completes is met and tallied once with its full payout (D25.5); research compute is tallied. |
| 7 | `deadlines` | market | At the end of `arrival + 99`, after pickup opportunities, fails unpicked work once: `cantRun` for still-unsupported pending work, `timeout` otherwise. Future slots have no active pickup clock. |
| 8 | `power` | phys | Draws, usage, overload timers, supply failure and reboot, PSU heat multipliers, joules per site. |
| 9 | `thermal` | phys | Rack and room lumps, cooling and setpoints, e(T) for the next tick, crash timers, crash and recovery. |
| 10 | `ledger` | core | Adds `count × price` payouts and the per-site energy bills to the wallet as `Amount`. Stops between-round research if Credits can't pay. |
| 11 | `round` | market | SLA check. Below 80% the round ends inside this tick: every record is freed, every unit is paused and the report is written. Retire unused forecast IDs and prepare the next round's five tasks once at relative offsets +2 through +10 seconds. |
| 12 | `research` | build | Applies tallied research ops to the active project. Completion applies effects and recompiles the affected units. |
| 13 | `events` | core | Appends the tick's cohort events to the ring and updates lifetime counters. |

Work lost in phases 8 and 9 is counted as failed with cause `overload` or `heat` at that tick. A unit that fails or crashes in tick *t* draws nothing from tick *t+1*.

### 1.3 State layout

`GameState` has three layers. Under D9, the platform uses `advanceGameOwned` to update hot buffers in place. `advanceGame` stays pure as the reference; tests prove both paths produce identical states.

```ts
export interface GameState {
  readonly schema: 'bitrouge-v3';
  readonly epoch: number;                 // bumps on reset
  readonly seed: number;
  readonly clock: { readonly tick: number; readonly carryMs: number };
  readonly wallet: Amount;
  readonly ledger: LedgerState;           // lifetime gross/energy/spent Amounts, 60 s net ring
  readonly round: RoundState;             // phase, index, start tick, met/failed, failedByCause, last report
  readonly market: MarketState;           // round-age intensity, round jitters, RNG words, saved five-task plan
  readonly build: BuildState;             // cold: topology and configuration, plain immutable objects
  readonly research: ResearchState;       // completed set, active, queue, priority mode, progress ops
  readonly configs: SavedConfigs;         // named system/rack/room/site configurations
  readonly compiled: CompiledBuffers;     // derived from build; replaced copy-on-write by actions only
  readonly hot: HotBuffers;               // runtime typed arrays; owned path mutates, pure reference clones
  readonly events: EventRing;             // 256 entries, seq numbers, cosmetic only
}
```

- **`build`** is the player's configuration tree: sites, zones (rooms), racks, systems and installed parts, with generations, levels, port speeds, strategies, filters, setpoints and toggles. It changes only through actions and research effects. Configurations are snapshots of `build` subtrees.
- **`compiled`** is typed arrays derived from `build` by `compileUnit` (owned by build): per-thread rates, capacities, watts, gate masks, scheduler Q and K, supply capacities and loss, link speeds, router capacity and strategy ids. The tick reads them and never writes them. Actions replace only the arrays they change.
- **`market.plan`** is cold plain serializable data: target round, cursor and exactly five descriptors with reserved task IDs, frozen family/size/payout inputs, relative arrival offset and dismiss-on-arrival flag. Replace its array and entries on refill or action, never mutate data shared with the input state. Initialize before the first snapshot; save/load and snapshot reads never regenerate it or draw RNG. Bump the save version with a pre-live reset; the flow implementation owner sets the exact version.
- **`hot`** is typed arrays the tick mutates: clocks, timers, temperatures, usage, the record pool, the parent pool (was the gang pool), router-queue rings, link FIFOs, slot reservations, the deadline ring, tallies and RNG words.

**Indices are ids.** A unit's index into its arrays is its id: `SystemId`, `RackId`, `RoomId` and `SiteId` are branded integers. Indices are never reused, and a removed unit leaves a dead slot. Arrays grow by doubling, so a boot state is a few hundred bytes and boot clones stay small.

**Hidden containers.** Boot owns system 0 inside bench rack 0, room 0 and site 0. Their `opened` flags are false: no thermal model (70 °F, e = 1), no ports, no load balancer, and the system pulls from the feed itself. The Rack research opens rack 0 as the free starter rack with server 1 in it. Room and Data center open room 0 and site 0 the same way. One code path then serves every era.

**Per-system hot fields**, with the writing phase in brackets:

- `state` (u8: empty, offline, booting, idle, running, sleep, paused, dark, crashed, draining) and `timer` (u16 ticks) [timers, power, thermal]
- for each resource `r` in {cpu, ram, gpu, io}: `wAnchor`, `eAnchor`, `rate`, `due` (f64), `head` (i32 record), `active` (u16) [exec]
- `busyThreads`, `usedCache`, `usedRam`, `usedDisk` (D26), `usedVram`, `queueHead`, `queueTail`, `queueLen`, `reserved` (shards), `freeSlots` [exec]; one IO FIFO per drive (D1.2: a drive serves one IO stage at a time until `ncq`) [exec]
- `drawW`, `psuOverS`, `psuFailed` [power]; `idleSinceTick`, `cstate`, `turbo` [power]

**Free-slot summaries.** Exec keeps `freeSlots` per rack, room and site: the number of servers below that can admit now. A server cannot admit when it is busy with no scheduler, its queue is full, or it is booting, crashed, dark or offline (D1.5). Routers read these summaries, so a first-fit route costs O(sites + zones + racks + 12), not a fleet scan.

**Per-rack hot fields:** `tempF`, `eff`, `effClock` (cumulative Σ e·dt), `crashS`, `crashed`, `rebootTicks`, `coolerDuty`, `heatW`, `drawW`, `pduOverS`, `pduFailed`, `nextDue`, `dirty`. Rooms and sites have the same lump and supply fields: room `tempF`, `upsOverS`, cooler duty; site `gridOverS`, `outsideF`, joules this tick.

**Hops and links.** A hop is any routing point: the system feed pull before Rack, the rack LB, the room LB, the site data plane and the backbone scheduler. Under D25.7 every router hop has a **queue** of up to `L ≤ 32` taken-but-undispatched entries (a logical hold: no bits move until dispatch). Otherwise a task waits only in the global feed, then its shards travel reserved paths. Each hop has a strategy id, a filter mask, a queue level, its queue ring and a cursor for strategies that need one. Placement modes and the routing budget are gone (D25.6, D12.5). A link is any serial channel: a switch port, an uplink, a data-plane link or a backbone link. Each link has a speed, a cumulative bit clock, a latency in ticks and a transfer FIFO. QoS reorders that FIFO by payload.

### 1.4 Tasks and cohorts

A task record is a cohort: `count` identical tasks that share family, size jitter, arrival tick, location and progress. Records live in one SoA pool with a free list:

| Field | Type | Meaning |
|---|---|---|
| `family`, `variant` | u16, u8 | Catalog family; variant indexes the jittered size table |
| `scale` | f32 | Size jitter applied to every stage's work, ±20% |
| `count` | u32 | Tasks in the cohort |
| `stage` | u8 | Current stage index |
| `finish` | f64 | Finish value on the owning resource clock (§1.5) |
| `arrival` | u32 | Arrival tick. Pickup is legal through the end of `arrival + 99`, before that tick's deadline step. |
| `loc`, `owner` | u8, i32 | Location (feed, link, queue, running) and owner (link or system index). `target` holds the reserved server while in transit. |
| `prev`, `next` | i32 | Doubly linked list within the owner's FIFO or sorted run list |
| `parent` | i32 | Parent row of a split task (was `gang`), or -1 for an unsplit task |
| `units` | f64 | Shard size in whole units (D25.1); stage work = per-unit coefficient × units |
| `memC`, `memR`, `memD` | f64 | D26 placement: working-set bits this shard holds in cache, RAM and disk, fixed at start, released once at completion or loss |
| `picked` | u8 | Admitted (queued tasks have no deadline) or reserved on route |
| `taskId` | numeric ID | Reserved during schedule generation, preserved through arrival, split, shards and execution. Pool indices are not task identities. |
| `committed` | boolean flag | Monotonic after first admission or network reservation. Retained on split, shards, router-queue holds and requeue; guards dismissal even when `picked` resets. |

**New logical arrivals.** Each due slot materializes one record with `count = 1`, using its saved identity and frozen descriptor. Keep the existing cohort pool for execution, fixtures and distributed members; records may still split when they move. Five future descriptors stay outside the active pool and deadline ring. No per-family count draw, Poisson buffer, late-game cap or distributed carry creates extra arrivals.

**Split tasks (D25).**
- The gang pool becomes the **parent pool**. A row holds `taskId`, `family`, `units` (the task size), `work` (`W`), `minShards` (`members`), `placed`, `done`, `lostCause` and `replaceDeadline`.
- Each shard is an ordinary count-1 record with `parent` and `units` set. Its payload is `units × pay/unit` bits per hop.
- `split` reserves every shard in one route phase or none.
- A shard completion frees its record and increments `done`. When `done === placed`, the task is met: one tally of its full payout and Data, one completion event at that system and part, and the parent row is freed.
- Losing any shard fails the task with the root cause (D4.1). It frees every sibling (records, link transfers, router-queue shares) and the parent row, unless `checkpointing` re-places the shard inside 10 s.
- An unsplit task (`n = 1`) has no parent row and pays at its own completion, as before.

**Memory hierarchy (D26, D46).**
- **Placement.** At shard start, exec writes `memC/memR/memD` from the system's free tiers, fastest first: three subtractions on `usedCache/usedRam/usedDisk`. The rack storage node's free disk is a per-rack summary.
- **Loading.** Before the first authored stage, every shard loads its placement, cache then RAM then disk. `rec.part` 3–5 identifies these loads; stage parts remain 0–2. Cache bits run as CPU ops on assigned threads. RAM and disk bits, including unified-memory overflow, run on their own pools. No wall-clock countdown is added.
- **Stages.** A `mem` stage of `M` bits expands at start into up to three ordinary stages on existing clocks:
  - the cache part, `M × (1 − trafR − trafD)` CPU ops;
  - the RAM part, `M × memR/ws` on the RAM pool clock;
  - the disk part, `M × memD/ws` on the IO pool with holds.
  
  The expansion is computed once at start from the frozen fractions, so the work-clock model (§1.5) is unchanged and delta invariance holds by construction.
  Loading adds up to three work-completion events per shard. A memory stage adds at most two transitions between tiers. Empty tier parts are skipped. Placement remains available after its holds are released so completion can tally initial loads as well as stage traffic.
- **No migration.** Placement never changes after start. There is no per-tick rebalancing and no per-bit bookkeeping.
- **Unified memory.** With `unifiedMemory`, a GPU stage's off-VRAM fractions expand the same way after the GPU stage.
- **Report.** `round.spill` accumulates `W × memR/ws` and `W × memD/ws` per met task: two adds per completion.

**Completion windows (D26.5).**
- The parent row (or the record, for an unsplit task) carries `deadlineTick` (i32, −1 when the family has no window). It is set at take as `takeTick + deadline − 1`.
- A bucketed deadline ring, keyed by tick mod 4,096, holds the parent IDs whose window ends that tick. Windows are at most 288 s × 1.2 = 3,456 ticks, so 4,096 buckets never wrap onto a live entry.
- The deadlines phase pops only this tick's bucket, so the cost is O(expiring tasks). A met or failed task leaves a stale entry, and the pop skips it by checking the row's `taskId`.
- Router-queue entries keep their task's `deadlineTick`, because the window runs from take.

**Router queues (D25.7).** `hot.rq` is a fixed ring of 32 entries per router (`rqTask f64`, `rqParent i32`, `rqUnits f64`, `rqSince i32`), with `rqHead u8` and `rqLen u8` per router. Router order is global 0, then sites, zones and racks by id, so the top-down dispatch walk is index order. `compiled.<scope>.lbQueueSlots` (u8, 1–32) comes from the build's `queueLevel`. An entry holds a task ID and units, never a pool record. Its shards' records are created at dispatch. The ring is saved with `hot`.

**Optional cohort for siblings.** Sibling shards with equal units waiting on the same link FIFO may share one record with `count = k` and a contiguous target range. They split into count-1 records where their paths diverge (the existing `splitRecord`). Use this only if the bench needs it; it changes no rule.

**Pool bounds.** Five future descriptors are separate cold data. The ordinary uncommitted pending window contains at most five logical tasks at a published boundary.
- Shards per task ≤ `min(systems with room, 256, floor(s / g), floor(W / (r × 1 s)))`: the D25.11 split floor keeps every shard at 1 s or more of its target's nominal rate, so shard events per tick are at most about 0.1 per system.
- Shard records in flight ≤ Σ system slots (running ≤ 6,912 × K, queued ≤ 6,912 × Q, plus reserved in transfer). That is the same bound as before D25, because every shard holds a slot.
- Parent rows ≤ the number of split tasks with a shard in flight, so ≤ shard records.
- Router-queue entries ≤ 32 × 609 routers (576 racks, 24 rooms, 8 sites, 1 global) = 19,488 at the largest fleet, in fixed rings.

The pool grows on demand. Round end frees active records, parent rows and router queues, and prepares the next-round plan once.

### 1.5 Execution: per-resource work clocks

This is the part that makes the sim fast by construction.

- Each system resource has a cumulative per-task-thread work clock `W`. On the CPU, `W` advances by `perThreadRate × eff × 0.1 s` per tick. `perThreadRate` already includes clock × lanes, the research share (§1.6), turbo, DVFS, throttle, power capping, and the time-slice share `min(1, cores / Σthreads)`. RAM, GPU and IO clocks advance by bandwidth divided by the number of tasks in that stage.
- A record that starts a stage stores `finish = W_now + stageWork / threads`, where `threads = min(free, max(1, floor(units / grain)))` at start (D25.3). RAM, GPU and IO stages divide by their share instead of threads. `finish` never changes after that.
- `W` is stored lazily per system as `wAnchor + rate × (rack.effClock − eAnchor)`. A rate change re-anchors one system resource in O(1). The records on it are untouched, so sharing, throttle, turbo and e(T) all stay cheap.
- `due` is the rack `effClock` value at which the resource's head record finishes. Each rack keeps `nextDue = min(due)` over its systems. In the run phase a rack whose `effClock < nextDue` and that is not `dirty` is skipped entirely. Otherwise the phase visits its 12 systems.
- Completion is decided by one predicate only, `rack.effClock ≥ due`, so float rounding can't make two code paths disagree.
- **In-tick carry.** When a record completes and the system's own queue holds the next runnable task, that task starts at `finish_prev` rather than at `W_now`. It can complete within the same tick. Tasks that come from a link or the feed start at the tick boundary. Completing a task therefore starts the next one immediately with no lost work (program §5), and tiny late-game tasks don't each cost a tick.
- Per-system draw changes only at events: admission, completion, stage change, C-state, turbo, failure. Draw is recomputed for visited systems, and the rack draw sum is recomputed in fixed slot order whenever a member changed, so no float drift builds up.

The test oracle (`testkit/oracle.ts`) was removed with the D40 test cleanup; the remaining invariant tests are delta invariance, D9 owned ≡ pure, the save round trip, `Amount` and purity.

### 1.6 Strategies

Strategies are table-driven. Hot loops dispatch on a small integer id stored in `compiled` and use no closures.

```ts
// exec/schedulers/types.ts (exec-private; ids are public in types/catalog.ts)
export interface QueueStrategy {
  readonly id: QueueStrategyId;              // fifo | sjf | rr | priority | mlfq
  /** Index of the next record to start from this system's queue, or -1. Pure read. */
  pickNext(w: World, system: number): number;
  /** Admission limit: K, or 2K for round robin time slicing. */
  admitLimit(w: World, system: number): number;
  readonly shares: 'exclusive' | 'timeslice';
}
// net/routers/types.ts
export interface RouteStrategy {
  readonly id: RouteStrategyId;              // firstFit (free default, D1.5) | roundRobin | leastConn | weighted | leastWork | binPacking | latency | price
  /** Pick one of n candidate child slots for record `rec` at `hop`. May advance only the hop's own cursor. */
  choose(w: World, hop: number, rec: number, candidates: Int32Array, n: number): number;
}
export type RouteFilter = (w: World, hop: number, rec: number, candidates: Int32Array, n: number) => number; // returns kept count
/** D25: one split for takes, router-queue dispatch and minimum splits. Writes leaves (system or child-router queue) and units; returns the leaf count, 0 when it can't split now. */
export interface Splitter { split(w: World, hop: number, task: number, units: number, outLeaf: Int32Array, outUnits: Float64Array): number }
/** D25: a strategy's share weights over the candidates (equal for firstFit and roundRobin). */
export type ShareWeights = (w: World, hop: number, task: number, candidates: Int32Array, n: number, outWeight: Float64Array) => void;
```

- The model is the research tree's split (research §1.5): one strategy per load balancer (walk order plus share weights under D25), any number of filters, and global split rules (`gather`, `shardSteal`, `stealRoom`, `checkpointing`). Placement modes are gone. A scope passes in only children that can admit now. First-fit returns the first candidate in slot order. It checks no gates, load or speed, so misroutes happen until `lbCapability`.
- Each strategy, filter and split rule lives in its own file with a two-system fixture test that proves a distinct observable effect: a different SLA count, a different route sequence or a different energy bill (program §5).
- Filters run before the strategy. A filter that would remove every candidate is skipped for that decision (research §1.5).
- Strategies never draw RNG. Ties go to the lowest slot index, and round-robin cursors are hot state.
- A strategy change is an action that writes one `compiled` byte. It is hot and loses no work (D1.6).
- **Research share.** Background research gets each system's idle threads. Shared mode multiplies the task `perThreadRate` by 0.75 and gives research the other 0.25. Focus gives research everything. Offline units and between-round units give research everything. Exec tallies research ops; build applies them. A mode change re-anchors every online system once.

### 1.7 RNG

- `core/rng.ts` implements xoshiro128** in place on the `Uint32Array(4)` in `hot.rng`, with the same algorithm and test vectors as v2's `rng.ts`.
- Prepare each round's seed and family jitters once at initialization or the previous round's end. Generate the five saved future descriptors in schedule order using the existing seeded family weights and size variation.
- Refill only after consuming a due descriptor. Arrival itself uses the frozen task, with no burst or count draw. Hardware, dismissal and UI reads do not change the sequence of future descriptors.
- Return and auto-return anchor the prepared next-round plan to the new start tick, retaining its five IDs, descriptors and dismissal flags. No second reseed or preparation occurs on Return or the first market tick.
- No other domain draws. Delta invariance follows from the fixed tick and saved RNG/plan state. Save/load continues the same plan without regeneration.

### 1.8 Amount only at the wallet

- Physical quantities are float64: work, rates, watts, joules, °F, timers in seconds.
- Counts are integers: met, failed, tasks and members.
- Credits are `Amount` (`src/game/amount.ts`, kept as is).
- In the ledger phase: `wallet += Σ_family count_f × price_f − Σ_site roundHalfUp(joules_site × price_site, CREDIT_SCALE)`.
  - Prices per site come from D1.7.
  - `CREDIT_SCALE` is a spec constant; I propose 9 decimal places.
  - Converting a float to `Amount` uses its shortest round-trip decimal, which is deterministic.
- Inside one `advanceGame` call the ledger holds `Decimal` objects and writes the `Amount` string back once at commit.
- Measured cost is 3–4 µs per tick with 10 paying families: 0.25 s of a 2 h round.
- Net/min comes from a ring of 60 one-second samples of lifetime gross and energy, as two `Amount` subtractions at publish.
- Purchases debit the wallet in `applyAction` with the quoted `Amount`.

### 1.9 Fleet caps and what they require from other documents

| Cap | Value | Research hook |
|---|---|---|
| Servers per rack | 12 | User rule |
| Rack switch ports | 4 → 8 → 12 | `portExpansion`, `densePorts` |
| Uplinks per switch | 1 → 2 → 4 | `lag`, `lag4` |
| Racks per room | 16 (2 rows of 8) → 24 (3 rows) | `hallExpansion` sets the cap to 3 rows |
| Room switch ports | 4 → 8 → 16 → 24 | `spineLeaf` sets the cap to 24, one per rack |
| Zones per site | 2 → 3 | `zoneExpansion` sets the cap to 3 |
| Sites | 1 → 4 → 8, one per map region | `regions` (home + 3), `intercontinental` (all 8) |
| Scheduler K per system | ≤ 32 | Scheduler levels |
| Scheduler Q per system | ≤ 64 | Scheduler levels |
| Members per distributed task | ≤ 256 | Task catalog |
| Shards per task | ≤ 256 (D25.1: effective grain `max(g, ceil(s/256))`) | Spec §5.1 |
| Router queue entries | ≤ 32 per router (D25.7) | Queue level, Credits |
| Memory tiers per system | 3: cache, RAM, disk (D26) | Parts |
| Completion window | ≤ 288 s (240 s × 1.2 jitter), deadline ring of 4,096 ticks (D26.5) | Task catalog |

The largest fleet is 8 × 3 × 24 × 12 = **6,912 servers, 576 racks, 24 rooms, 8 sites**. The room's network rack sits in the top-left corner outside the 24-slot grid, as in the approved mockup. All caps live in `src/game/core/constants.ts`.

The per-tick cost depends more on task events than on fleet size, so `docs/tasks.md` must respect these market constraints. The task designer owns the numbers inside them:

1. **Fixed cadence.** One logical task every 20 ticks while running, with the first at +2 seconds. Late growth comes from existing work, requirements and members. No hardware warm-up, Poisson gaps, bursts, arrival throttle or adjustable cap applies.
2. **Family count.** At most 12 families active in the mix at once.
3. **Distributed work.** At most 256 members per logical task. Members do not add arrival slots; no distributed-family carry is needed.
4. **Saved forecast.** Five actual future descriptors, initially at +2 through +10 seconds, with frozen identities and facts. No pickup clock before arrival. Generate during initialization, round preparation and refill only.

All arrivals get a full 10-second pickup opportunity, even if unsupported. Hold whole-fleet-impossible work pending, recheck after purchases, and fail once at its deadline as `cantRun` or `timeout` as appropriate. Free future dismissal marks a slot in place; free pending dismissal removes only uncommitted feed work. Neither changes SLA, Credits, Data or cadence. `committed` survives requeues and splits. Existing capability-aware routing research and otherwise possible misroutes remain.

The focused lifecycle checks are described in `v3-onboarding-task-plan.md`. This documentation pass runs text consistency checks only.

### 1.10 Cost per tick at the largest fleet

The estimates below used the earlier high-arrival prototype and are historical cost estimates, not a current benchmark. The fixed cadence above supersedes their arrival-load assumptions; existing performance budgets stay unchanged. No new balance or performance proof is claimed.

The constants come from the prototype in `docs/v3-arch-notes.md` (Node 24.14, this machine): the infrastructure pass costs about 5 ns per server, and a task arrival with routing, split and completion costs 0.15–0.25 µs. Production adds port hops, stages and schedulers. I budget 13 event operations per task at 0.1 µs each.

| Term | Estimate |
|---|---:|
| Rack pass: thermal, PDU, effClock, `nextDue` check (576 × ~50 ns) | 29 µs |
| Room and site pass (32 × ~100 ns) | 3 µs |
| Systems in visited racks (~80 racks × 12 × 15 ns) | 14 µs |
| Task events (40 tasks × 13 ops × 0.1 µs): arrival, up to 4 hops enqueue and deliver, admit, stages, complete | 52 µs |
| Ledger: ≤ 8 site bills and ≤ 12 family payouts in decimal.js | 10 µs |
| Deadline ring, tallies, event ring | 5 µs |
| **Total** | **~113 µs** |

- **2 h round:** 72,000 × 113 µs ≈ 8.1 s, plus worker transport and per-chunk clones (~0.1 s). About 17% under the 10 s budget.
- **Frame:** a hot clone of about 3 MB (0.3–0.6 ms), plus 0–1 tick (0.11 ms), plus the room snapshot (~0.1 ms), ≈ 0.9 ms against 4 ms.
- **Boot frame:** a clone under 1 KB, one tick of about 2 µs and a chip snapshot of about 20 µs, ≈ 0.05 ms against 0.5 ms.
- **24 h campaign:** most hours run on small fleets at under 10 µs per tick. 864,000 ticks plus bot decisions every 2 s of sim time (43,200 × ~1 ms of quotes) is about 60 s against 300 s.

**D25 shard cost.** A split multiplies task events by the shard count, but a shard is never under 1/256 of its task, and per-shard work is the old per-task event chain: about 13 events at 0.1 µs. The design model (`scripts/market-model.ts --fleet`, `docs/tasks.md` §9) measures settled rounds on a homogeneous fleet:

| Systems | 12 | 24 | 48 | 96 | 288 | 576 | 864 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Shard starts per tick | 0.6 | 1.3 | 2.7 | 5.4 | 13.9 | 14.1 | 13.8 |
| Whole tasks per tick (pre-D25) | 0.1 | 0.2 | 0.2 | 0.4 | 0.3 | 0.4 | 0.5 |

Above one room the rate stops growing: the 256-shard cap keeps each shard large, so takes get rarer as the fleet grows. At the largest fleet, assume 15–30 shard starts per tick with headroom for round-start bursts. That is 15–30 × 13 × 0.1 µs ≈ 20–40 µs per tick, on top of the ~113 µs above, plus up to 609 router-queue dispatch checks. Each check is O(1) while a queue is empty and skipped through a non-empty-queue bitset. The estimate becomes ~150 µs per tick: about 11 s for a 2 h round, against the 10 s budget and D24's 60 s fallback. G3 must re-measure `fleetMax` with splits. If it fails, the fallback order is:

1. the optional sibling cohort (§1.4);
2. then the steps below.

The 256 cap is not a fallback lever: lowering it weakens the economy.

**D26 cost.**
- Spill adds at most two stage events per spilled `mem` stage, and the D25.11 floor's `nNoDisk` term keeps well-built splits off disk.
- The deadline phase is O(tasks expiring this tick), because met tasks are skipped lazily.
- Placement is O(1) per shard start.

Estimate at the largest fleet: under 5 µs per tick on top of the D25 figure above. No new per-tick loop over systems or shards.

**If the Gate 3 bench fails,** change constants, not the design, and apply them in this order:

1. Profile task events and report the measured bottleneck. The accepted 20-tick arrival cadence is fixed and cannot be lowered as a performance fallback.
2. Drop rows per room to 2, which removes 25% of the racks.
3. Drop zones per site to 2.

## 2. Module map

v3 is built under parallel trees and hoisted at integration (§5). No file over 300 lines. Paths are relative to `src/game/`.

```
index.ts                     S1  public barrel, the only import path for render/ui/platform
types/                       S1  shared contract (only S1 edits)
  ids.ts                     branded SystemId/RackId/RoomId/SiteId, UnitRef, PartRef, SwitchRef, NodeRef, FamilyId, ResearchId
  state.ts                   GameState and its sub-states (§1.3)
  actions.ts                 GameAction, ConfigSource, ActionOutcome, Rejection
  snapshot.ts                RenderSnapshot, SnapshotScope, level snapshots
  views.ts                   SupplyView, SwitchView, PortView, PartView, TaskView, slot views
  quotes.ts                  QuoteRequest, Quote, EffectPreview, LockReason
  events.ts                  GameEvent, FailCause
  report.ts                  AdvanceResult, AdvanceReport, RoundReport
  catalog.ts                 PartDef, FamilyDef, ResearchDef, StrategyDef, ids and effect union
core/                        S1
  constants.ts               TICK_MS, PICKUP_TICKS, caps, CREDIT_SCALE
  world.ts                   World: mutable transient over cloned hot buffers; open/commit
  buffers.ts                 typed-array layouts, growth, clone
  pool.ts                    record and parent pools, router-queue rings, free lists, list ops
  rng.ts                     in-place xoshiro128**, splitmix reseed
  advance.ts                 carry, tick loop, quiescent skip
  tick.ts                    phase order (§1.2)
  ledger.ts                  Amount wallet per tick, net ring
  timers.ts                  one boot time (D1.8) for online/offline, reboot, mid-round add, cold change; drain; auto-return
  actions.ts                 applyAction dispatcher, debit, revision of compiled
  events.ts                  ring writer
save/                        S1  schema.ts, serialize.ts (typed arrays as base64), validate.ts
testkit/                     S1  builders.ts (buildState from a fleet spec), fleets.ts (named fixtures)
market/                      S2
  families.ts                family catalog data from docs/tasks.md
  curve.ts                   round-age intensity, mix windows, seeded weights and size variation
  arrivals.ts                consume fixed-cadence saved slots, refill plan, count-1 pending arrivals
  feed.ts                    global feed, deadline ring, expiry, feed ordering for the view
  sla.ts                     met/failed counters, causes, SLA percent
  rounds.ts                  start, end, report, auto-return, all-or-nothing return
  actions.ts                 returnToMarket, setAutoReturn, guarded dismissTask
probes/                      S2  bot.ts, policies.ts, campaign.ts (balance)
exec/                        S3
  clocks.ts                  per-resource work clocks, anchors, due, rack nextDue
  admit.ts                   per-shard gates: summed working sets (D1.1), VRAM, storage, ECC; queue, slot reservations, per-drive IO FIFO
  run.ts                     completions, stage transitions, in-tick carry, parent (split task) accounting and met-on-last-shard
  kill.ts                    drop work in a subtree with a cause
  research.ts                background/shared/focus share and research op tally
  schedulers/                fifo.ts sjf.ts rr.ts priority.ts mlfq.ts index.ts (+ workStealing, numa rules)
net/                         S3
  links.ts                   serial links, bit clocks, FIFOs, QoS, cut-through, latency
  hops.ts                    route phase: top-down path choice over free-slot summaries, reservations, routing budget
  routers/                   firstFit.ts roundRobin.ts leastConn.ts weighted.ts leastWork.ts binPacking.ts latency.ts price.ts index.ts
  filters.ts                 capability, health, power, thermal, region
  split.ts                   D25 split: candidates, share weights, grain, minimum split, atomic reserve; stealing; checkpointing
phys/                        S4
  draw.ts                    idle/load watts, C-states, package C, DVFS, turbo, S3, power capping
  supplies.ts                PSU, PDU, UPS, grid usage; overload timers; failure, reboot; loss; ×1/×1.5/×3; dual feed; ride-through
  thermal.ts                 rack and room lumps, per-tick decay constants, leak, setpoints, economizer, outside air
  efficiency.ts              e(T), thermal throttle, crash timers and recovery
  energy.ts                  joules per site per tick for the ledger
build/                       S5
  catalog/                   chip.ts board.ts infra.ts network.ts site.ts tiers.ts (generations, levels, prices, watts)
  compile.ts                 build → compiled arrays per unit
  parts.ts                   upgrade (hot), replace/add/remove (cold) handlers
  units.ts                   add system/rack/zone/site from a ConfigSource; add row
  configs.ts                 barebones, copy, saved; save/apply/delete configuration
  ports.ts                   1-2-5 ladder, per-port and same-speed pricing, port count
  research/                  tree.ts (from research.md appendix), effects.ts, projects.ts, actions.ts
  quotes.ts                  lazy quotes for every QuoteRequest
view/                        S6
  snapshot.ts                deriveRenderSnapshot(state, scope, previous)
  hud.ts feed.ts round.ts research.ts
  chip.ts system.ts rack.ts room.ts global.ts
  selectors.ts               research tree, saved names, paged queue inspection, unit labels
  fixtures.ts                snapshots derived from testkit fleets, for renderer previews and UI tests
```

Survivors outside the tree that v3 imports and keeps: `src/game/amount.ts`, `src/game/format.ts` and the purity test.

### 2.1 Public contract

```ts
// index.ts (S1)
export type * from './types';
export { createInitialState } from './core/state';
export { advanceGame } from './core/advance';
export { applyAction } from './core/actions';
export { deriveRenderSnapshot } from './view/snapshot';
export { quote } from './build/quotes';
export { selectResearchTree, selectSavedConfigs, selectQueuePage } from './view/selectors';
export { serializeSave, deserializeSave, SAVE_SCHEMA } from './save/serialize';
export { offlineCapMs } from './build/research/effects';

export function createInitialState(seed?: number): GameState;
export function advanceGame(state: GameState, elapsedMs: number): AdvanceResult;
export function applyAction(state: GameState, action: GameAction): ActionOutcome;
export function deriveRenderSnapshot(state: GameState, scope: SnapshotScope, previous?: RenderSnapshot): RenderSnapshot;
export function quote(state: GameState, request: QuoteRequest): QuoteResult;

export interface AdvanceResult { readonly state: GameState; readonly report: AdvanceReport }
export interface AdvanceReport {
  readonly ticks: number; readonly activeTicks: number;          // activeTicks: round running
  readonly met: number; readonly failedByCause: Readonly<Record<FailCause, number>>;
  readonly gross: Amount; readonly energy: Amount; readonly net: Amount;
  readonly roundsEnded: readonly RoundReport[]; readonly researchCompleted: readonly ResearchId[];
}
export type ActionOutcome =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly state: GameState; readonly rejection: Rejection };
export interface Rejection { readonly code: 'locked' | 'funds' | 'cap' | 'occupied' | 'invalid' | 'roundState'; readonly reason: string }
```

### 2.2 Domain interfaces (not public)

Every domain exports phase functions with the same shape, and `core/tick.ts` calls them in order:

```ts
export type Phase = (w: World) => void;
// market: marketPhase, deadlinePhase, roundPhase   exec: admitPhase, runPhase
// net: linkPhase, routePhase                       phys: powerPhase, thermalPhase
// build: researchPhase                              core: timerPhase, ledgerPhase, eventPhase
export type ActionHandler<A extends GameAction> = (state: GameState, action: A) => ActionOutcome;
export function compileUnit(state: GameState, unit: UnitRef): CompiledBuffers; // build, used by handlers and research effects
export function killSubtree(w: World, unit: UnitRef, cause: FailCause): void; // exec, used by phys and core
```

**Write ownership of hot fields.** A domain writes only its own field groups and reads any field. Phase order makes the reads well defined. S1 encodes this table as comments in `core/buffers.ts`.

| Field group | Writer |
|---|---|
| system/rack/room/site `state`, `timer`, auto-return | core (timers); power and thermal set `dark`/`crashed` through `core/timers.setUnitState` |
| clocks, `due`, `nextDue`, `busyThreads`, used capacities, queues, reservations, `freeSlots` summaries, record `finish`/`stage` | exec |
| link clocks and FIFOs, cursors, router queues, split reservations | net |
| feed, deadline ring, intensity, rng, round counters | market |
| `drawW`, supply timers and flags, `tempF`, `eff`, `effClock`, crash timers, joules | phys |
| wallet `Decimal`, ledger ring | core |
| research progress, completion | build |

## 3. Snapshot contract v3

The snapshot covers only what is on screen. The UI's view store gives the platform store a `SnapshotScope`. The store rebuilds the snapshot after any advance that ran a tick (10 Hz), after any action and after any scope change.

```ts
export type LevelId = 'chip' | 'system' | 'rack' | 'room' | 'global';
export interface NodeRef { readonly level: LevelId; readonly id: number } // chip and system: SystemId; rack: RackId; room: RoomId; global: 0
export interface SnapshotScope { readonly focus: NodeRef; readonly partner: NodeRef | null } // partner: the other end of a zoom transition

export interface RenderSnapshot {
  readonly epoch: number; readonly tick: number; readonly simTimeMs: number;
  readonly hud: HudSnapshot;
  readonly feed: FeedSnapshot;
  readonly round: RoundSnapshot;
  readonly research: ResearchBadge;                 // active project, progress, priority mode; the full tree is a selector
  readonly unlocked: Readonly<Record<LevelId, boolean>>;
  readonly home: Readonly<Partial<Record<LevelId, NodeRef>>>;
  readonly focus: LevelSnapshot;
  readonly partner: LevelSnapshot | null;
  readonly events: readonly GameEvent[]; readonly firstSeq: number; readonly lastSeq: number;
}
export type LevelSnapshot = ChipSnapshot | SystemSnapshot | RackSnapshot | RoomSnapshot | GlobalSnapshot;
```

### 3.1 What each consumer reads

| Consumer | Reads | Notes |
|---|---|---|
| HUD | `hud.credits: Amount`, `hud.netPerMinute: Amount`, `hud.sla { met, failed, percent }` (percent to one decimal), `hud.roundState: 'running' \| 'ended' \| 'between'`, `hud.roundElapsedMs`, `hud.autoReturnInMs` | Fixed geometry. Credits snap to the published value. |
| Feed (pixel object at every level) | Exactly five `feed.upcoming` saved tasks with epoch/round/task ID, name, numerical work and requirements, arrival offset, nullable absolute arrival tick and dismissal mark. Separate `feed.entries` (≤ 8 pending) keep real deadline, blocked requirement and committed/dismissible status. Keep pending/transit/queued/running counts, intensity, authored `1 task / 2 s` cadence and existing failures/telemetry. | Future tasks have no pickup countdown. Pending countdowns use the real deadline. Paused forecasts show times after Return. Unsupported rows need no telemetry. |
| Round report plate | `round.lastReport: RoundReport { index, durationMs, met, failedByCause, peakIntensity, creditsEarned, energyCost, net }` and `round.canReturn` | Return to market reads `canReturn`. |
| Chip | `ChipSnapshot { systemId, online: UnitState, tier, clock { hz, generation, level }, lanes, coreSites, cores: CoreView[] { busy, family, progress, threads, research, cstate }, cache: { levels: { kind, bits, generation, level }[], usedBits }, scheduler: { generation, level, strategy, q, queued, k, running } \| null, researchShare, slots: BuildSlotView[] }` | Strict grid. Clock LED blink comes from `hz` and sim time, capped visually. |
| System | `SystemSnapshot { systemId, online, bootMs, cpu: PartView, ram: PartView[], gpu: PartView[], storage: PartView[], psu: SupplyView, running: TaskView[] (≤ K), queue { cap, count, sample: TaskView[] (≤ 8) }, reserved, rates { ops, ramBits, gpuOps, ioBits }, capacities { cache, ram, vram, storage }, drawW, saveable }` | `PartView { slot, kind, generation, level, active, resourceBusy }`. No prices in the world. |
| Rack | `RackSnapshot { rackId, online, tempF, eff, crashS, crashed, cooler { tech, generation, level, duty, setpointF, watts }, pdu: SupplyView, lb: LbView, switch: SwitchView, servers: ServerSlotView[12] }` | `ServerSlotView { systemId \| null, state, load, running, port \| null }`. Port LEDs come from `PortView.active`. |
| Room | `RoomSnapshot { roomId, siteId, zone, zones, online, tempF, outsideF, crashS, cooler, ups: SupplyView, network: { switch: SwitchView, lb: LbView }, rows, racks: RackSlotView[rows × 8] }` | `RackSlotView { rackId \| null, state, load, tempF, pduUsage, servers: Uint8Array(12) of UnitState codes }`. |
| Global | `GlobalSnapshot { sites: SiteView[8], backbone: { generation, links: LinkView[] }, regionsOpen }` | `SiteView { siteId \| null, region, open, online, zones: ZoneView[], grid: SupplyView, dataPlane { generation, bitsPerSec, latencyMs, active }, energyPrice: Amount, outsideF }`. |
| Plates | The focus snapshot for live values, plus `quote()` results | Plates never compute prices. |
| Research wafer | `selectResearchTree(state)`, called only while the wafer is open | A lazy selector, not part of the snapshot. |

Shared views:

```ts
export interface SupplyView { kind: 'psu' | 'pdu' | 'ups' | 'grid'; generation: number; level: number; capacityW: number;
  deliveredW: number; usage: number; overloadS: number; failed: boolean; rebootMs: number | null; loss: number; capped: boolean }
export interface SwitchView { generation: number; topHz: number; sameSpeed: boolean; portCeiling: number;
  ports: readonly PortView[]; uplinks: readonly PortView[] }
export interface PortView { speedHz: number; rung: number; peer: number | null; active: boolean; family: FamilyId | null;
  progress: number; queued: number }
export interface LbView { generation: number; level: number; strategy: RouteStrategyId; filters: readonly FilterId[];
  routedPerSec: number; capacityPerSec: number }
export interface TaskView { key: number; family: FamilyId; count: number; stage: number; resource: 'cpu' | 'ram' | 'gpu' | 'io';
  progress: number; deadlineTick: number | null }
```

### 3.2 Build rules

- **Cost.** Proportional to visible entities: at most 24 racks × 12 server bytes, or 8 sites × 3 zones. Never O(fleet). Global and room aggregates (load, temperature, state) are hot fields that phys and exec already maintain.
- **Incremental.** `previous` lets the builder reuse static sub-objects (slot layouts, labels, port counts) while `compiled` and `build` are referentially unchanged. Dynamic values come from fresh small objects on each publish. Published objects are frozen in development builds.
- **No quotes.** Quotes never run inside `deriveRenderSnapshot`. A 2 ms snapshot was one of v2's frame-time failures.
- **Between ticks.** Progress and LED phases come from published rates and `simTimeMs`. The renderer may extrapolate presentation by the wall time since the last publish, up to 100 ms. It never extrapolates state.
- **Events.** Events are per cohort per tick, never per task. The renderer keeps `epoch` and `lastSeq`, as in v2 §3.

### 3.3 Lazy quotes

```ts
export type QuoteRequest =
  | { kind: 'tray'; at: NodeRef }                                   // the 4 tray items for the visible level
  | { kind: 'part'; part: PartRef }                                 // upgrade, replace options, add/remove
  | { kind: 'add'; parent: UnitRef | { kind: 'global' }; slot: number } // configuration plate: barebones tiers, copies, saved names
  | { kind: 'switch'; sw: SwitchRef }                               // per-port and all-port speed, port count
  | { kind: 'infra'; rack: RackId | RoomId; slot: 'cooling' | 'power' | 'lb' | 'switch' }
  | { kind: 'research'; project: ResearchId };
export interface Quote { readonly action: GameAction; readonly cost: Amount; readonly affordable: boolean;
  readonly locked: LockReason | null; readonly cold: boolean; readonly downtimeMs: number; readonly effect: EffectPreview | null }
export interface QuoteResult { readonly configRevision: number; readonly quotes: readonly Quote[] }
```

The static part of a quote (cost, lock, effect) depends only on `build`, `compiled` and `research`. Build caches it by `configRevision`. `affordable` is one `Amount` compare against the current wallet. The UI asks for quotes only for the open plate and the visible tray, and re-asks on wallet changes at 2 Hz. That re-ask costs one compare per quote.

## 4. Actions and commands

```ts
export type GameAction =
  | { type: 'returnToMarket' }
  | { type: 'dismissTask'; task: { epoch: number; roundIndex: number; taskId: number } } // future mark or uncommitted pending removal, free and no SLA/reward change
  | { type: 'setOnline'; unit: UnitRef; online: boolean }                 // boot time mid-round, instant between rounds
  | { type: 'upgradePart'; part: PartRef }                                // hot: level + 1
  | { type: 'replacePart'; part: PartRef; generation: number }            // cold: one boot time (10 s base, Fast boot lowers it), scrap
  | { type: 'addPart'; system: SystemId; kind: BoardPartKind; generation: number } // cold
  | { type: 'removePart'; part: PartRef }                                 // cold, scrap
  | { type: 'addUnit'; parent: UnitRef | { kind: 'global' }; slot: number; source: ConfigSource } // system, rack, zone, site
  | { type: 'addRow'; room: RoomId }
  | { type: 'applyConfig'; unit: UnitRef; name: string }                  // cold onto an existing unit
  | { type: 'saveConfig'; unit: UnitRef; name: string }
  | { type: 'deleteConfig'; kind: UnitKind; name: string }
  | { type: 'upgradePort'; sw: SwitchRef; port: number | 'all' }          // 'all' only while sameSpeed is on
  | { type: 'setSameSpeed'; sw: SwitchRef; on: boolean }
  | { type: 'addPorts'; sw: SwitchRef }
  | { type: 'setStrategy'; unit: UnitRef | { kind: 'global' }; strategy: QueueStrategyId | RouteStrategyId }
  | { type: 'setFilter'; unit: UnitRef | { kind: 'global' }; filter: FilterId; on: boolean }
  | { type: 'setPlacement'; unit: UnitRef | { kind: 'global' }; mode: PlacementId }
  | { type: 'setSetpoint'; unit: RackId | RoomId; setpointF: number }
  | { type: 'startResearch'; project: ResearchId }
  | { type: 'queueResearch'; project: ResearchId }
  | { type: 'cancelResearch' }
  | { type: 'setResearchPriority'; mode: 'background' | 'shared' | 'focus' }
  | { type: 'setAutoReturn'; on: boolean }
  | { type: 'reset' };
export type ConfigSource =
  | { kind: 'barebones'; tier: TierId }         // a system: that generation's CPU at L1 with base cache; a rack: basic infra; a zone or site: basic infra
  | { kind: 'copy'; from: UnitRef }             // a unit in the same parent
  | { kind: 'saved'; name: string };
export type UnitRef = { kind: 'system'; id: SystemId } | { kind: 'rack'; id: RackId }
  | { kind: 'room'; id: RoomId } | { kind: 'site'; id: SiteId };
export type PartRef = { unit: UnitRef; slot: PartSlot };   // board parts, rack infra slots, room cooler/UPS, site grid/data plane, backbone
export type SwitchRef = { kind: 'rack'; id: RackId } | { kind: 'room'; id: RoomId };
```

- `applyAction` validates against current state, debits the quoted `Amount`, edits `build`, recompiles only the changed units and returns `ActionOutcome`. It never accepts a client price.
- **Cold changes** call `killSubtree(unit, 'downtime')` and set the unit's boot timer. With `gracefulDrain` they set `draining` instead and start the timer after the drain.
- **Online and offline.** Mid-round toggles start the boot timer (10 s base, lowered by Fast boot, D1.8). Between rounds they apply at once. `returnToMarket` brings every online unit in together and reseeds the round.
- **Add during a round.** A unit added mid-round runs the same boot timer before it accepts tasks.
- **Configurations.** `saveConfig` stores generations, levels, port speeds, strategies, filters, setpoints and toggles, never runtime state. A configuration that needs unresearched parts quotes as locked with the missing node named.
- **Navigation.** Zoom, select, open plate and cancel remain `ViewCommand`s in the UI view store (v2 §4). They never reach the sim. Research preserves its selected hardware or task while open; the underlying dialog is unmounted and Back closes the sheet before clearing that origin. Search and prerequisite history live inside the Research view. A system summary can open a CPU cache component's plate from its embedded chip snapshot without changing the world focus. The research wafer and save-name prompt are view state.
- **Network rack.** Tapping the room's network rack opens a plate that issues `setStrategy`, `setFilter`, `upgradePort` and `addPorts` with `SwitchRef { kind: 'room' }`.

## 5. Keep, adapt, delete

### 5.1 Path rule

- Wave 1 builds in parallel trees: `src/game/`, `src/render/`, `src/ui/`, `src/platform/`, `src/dev/`, `scripts/`.
- v3 trees never import v2 modules. The exceptions are `src/game/amount.ts` and `src/game/format.ts`, which survive.
- Art-only v2 files are copied into the v3 tree on day one by their owner, not imported, so v2 can be deleted without touching v3.
- v2 stays runnable at `/` throughout Wave 1. v3 runs at `/v3.html`.

### 5.2 How `npm run verify` stays green

- **Wave 1 start (lead).** Add `v3.html` as a second Vite input and a `bench:v3` script. Vitest's `src/**/*.test.ts` glob and the `src/game` purity test already cover the new trees.
- **Every gate.** v2 and v3 tests both run. Typecheck covers both, and the build bundles both entries.
- **v3 tests.** They must not import v2.
- **Wave 2, one integration step by one agent** (the lead's integrator, not a Wave 1 owner):
  1. Back up the v2 tree to a tarball. It is uncommitted, and HEAD predates it.
  2. Delete the v2 lists in §5.4.
  3. Run `scripts/hoist.mjs`. It moves `src/game/*` to `src/game/`, `src/render/*` to `src/render/`, `src/ui/*` to `src/ui/`, `src/platform/*` to `src/platform/` and `src/dev/*` to `src/dev/`, then rewrites import specifiers.
  4. Point `index.html` at the v3 entry, remove `v3.html`, and point `bench` at the v3 bench.
  5. `npm run verify`.
  
  No compatibility layer exists at any point.

### 5.3 What survives

| Area | Copied into the v3 tree unchanged or near-unchanged | Rewritten against the v3 contract |
|---|---|---|
| Sim | `amount.ts`, `format.ts`, `purity.test.ts` stay in place. v2 `rng.ts` test vectors are reused by `core/rng.test.ts`. | Everything else |
| Render core | `camera.ts`, `glyphs.ts`, `hit.ts`, `palette.ts`, `paths.ts`, `sprites.ts`, `harness.ts`, `registry.ts` (LevelId `room`), `transition.ts` and `view.ts` (types only) | `types.ts` (LevelRenderer reads `LevelSnapshot`), `px.ts` (drop v2 imports), `activity.ts`, `fx.ts`, `decoration.ts`, new `feed.ts` (the pixel feed object) |
| Chip | `sprites.ts`, `art.ts` (part art), `bitrouge-machine.ttf`, `readouts.css` | `layout.ts`, `geometry.ts`, everything else. This is the strict-grid rebuild (program §12). |
| System | `art.ts`, `board.ts`, `sprites.ts`, `partKinds.ts` | `layout.ts`, `geometry.ts`, `parts.ts`, `power.ts`, `activity.ts`, `mini.ts`, `index.ts` (CPU/RAM/GPU/Storage tray, PSU on board, no cooling) |
| Rack | `layout.ts`, cabinet and panel drawing routines out of `cabinet.ts` and `panels.ts` | `model.ts`, `world.ts`, `index.ts`, `mini.ts`, `power.ts`; new switch ports, LB slot and 4-slot infra |
| Room (was datacenter) | `layout.ts`, `static.ts`, sprite routines out of `sprites.ts` | `model.ts`, `world.ts`, `index.ts`, `mini.ts`; one AZ per view, network rack, zone switcher |
| Global | `geo.ts`, `layout.ts`, `map.ts`, sprite routines | `model.ts`, `index.ts`, `parts.ts`, `power.ts`; sites, zones, data plane, backbone |
| UI | `hooks/*`, `CanvasWorld.tsx`, `WorldLabels.tsx`, `input/gestures.ts`, `input/viewport.ts`, `plates/PlateFrame.tsx`, `styles/*.css`, `styles/fonts/*` | `GameShell`, `Hud`, `BuildTray`, `ZoomRail`, `viewState`, `storeHooks`, `input/commands`, all plates, research wafer (reorganized), new feed HUD hooks, round plate, configuration plate, save-name prompt |
| Platform | `persistence.ts` (+ test), `cooperativeAdvance.ts` (+ test) | `store.ts` (adds `setScope`), `runtime.ts` (about 200 lines: rAF, integer-ms cadence, visibility, catch-up), `saveGame.ts`, `offline.ts` + `offline.worker.ts` (chunks of ticks, no checkpoint accounting) |
| Scripts | `qa-v2/cdp.mjs`, `capture.mjs`, `clock.mjs`, `files.mjs` | `scripts/bench/**`, `scripts/qa/**`, `scripts/hoist.mjs` |

Each copy is made in Wave 1, at G0, by the owner of the destination path.

### 5.4 Deleted in Wave 2, in the integration step

- **`src/game/`.** Everything except `amount.ts`, `amount.test.ts`, `format.ts`, `format.test.ts` and `purity.test.ts`. That is 351 files including 112 test files.
  - Directories: `catalog/`, `contracts/` (fixtures included), `demand/`, `events/`, `heat/`, `jobs/`, `kernel/` (`reference/` included), `parts/`, `perf/`, `power/`, `probes/`, `quotes/`, `research/`, `tree/`.
  - Top-level files: `accounting`, `actions`, `advance`, `demand`, `economy`, `hardwareWork`, `index`, `initialState`, `renderSnapshot`, `research`, `rng`, `save`, `selectors`, `taskDefinitions`, `taskWork`, `testHelpers`, `timeGrid`, `types`, `unlocks`, `workScheduler`.
  - Top-level tests: `accounting`, `actions`, `actions.boundaries`, `advance.deltaInvariance`, `advance.order`, `demand`, `economy`, `format` (kept), `hardwareWork`, `infrastructure`, `market`, `rng`, `save`, `taskDefinitions`, `taskWork`, `workScheduler`.
  - `index.ts` and `types.ts` are replaced by the hoisted v3 files of the same name.
- **`src/platform/`.** Everything except `persistence.*` and `cooperativeAdvance.*`, which v3 copied. That is `checkpoint*`, `gameOfflineAdvance*`, `gameStore*`, `index.ts`, `long/`, `contracts/`, `offlineAdvance*`, `reports.ts`, `runtime*`, `saveGame*` and `sessionCheckpoints*`.
- **`src/render/`.** `core/`, `levels/` and `index.ts`. v3 copied what it needs.
- **`src/ui/`.** `v2/`, `App.tsx`, `App.test.tsx`, `App.live.test.tsx` and `hooks/`.
- **`src/dev/v2/`.**
- **Scripts.** `scripts/qa-v2/` (after copying the four CDP helpers), `scripts/design-model.ts` and `scripts/probe-balance.ts`.
- **Root.** `dev.html`'s v2 QA entry. The lead decides the replacement.
- **Docs.** The lead moves the v2 docs to `docs/archive/`.

## 6. Wave 1 ownership

Twelve agents. S1 alone owns `src/game/types/**`, `src/game/index.ts`, `src/game/core/constants.ts` and the contract-change log `docs/v3-contract-requests.md`. Other agents request contract changes in that log and S1 lands them, normally the same day.

| Agent | Owns (exclusive) | Inputs | Outputs | Starts | Hands off at |
|---|---|---|---|---|---|
| **S1 Sim core and contract** | `src/game/{index.ts,types/**,core/**,save/**,testkit/**}`, `docs/v3-contract-requests.md` | This doc, program, spec | Contract, tick loop, World, pools, RNG, ledger, timers, action dispatcher, save v3, fleet builders, oracle | Day 0 | G0: full contract and a running empty tick; G1–G3: core features each gate needs |
| **S2 Market, rounds and balance** | `src/game/{market/**,probes/**}`, `scripts/balance/**` | `docs/tasks.md` | Families, curve, arrivals, feed, deadline ring, SLA, rounds, report, auto-return; the balance bot and 24 h campaign | After G0 | G1: bands to `ram`; G3: all bands; G4: campaign and pacing |
| **S3 Execution and network** | `src/game/{exec/**,net/**}` | Spec, research tree | Work clocks, admission gates, schedulers, research share, kill; links, hops, routers, filters, gangs, data plane, backbone | After G0 | G1: exec, system strategies; G2: rack network, gang rack; G3: room, site, global |
| **S4 Power and heat** | `src/game/phys/**` | Spec power and heat sections | Draw model, supplies, overload, failures, lumps, cooling, e(T), crash, joules | After G0 | G1: PSU, C-states, DVFS; G2: rack; G3: room, site, regions |
| **S5 Catalog, research, configurations and quotes** | `src/game/build/**` | Spec catalog, `docs/research.md` appendix | Catalog, compile, part/unit/config/port actions, research tree and effects, quotes | After G0 | G1: chip and board; G2: rack, configuration plate; G3: room, global |
| **S6 Snapshot and selectors** | `src/game/view/**` | Contract, domain hot fields | `deriveRenderSnapshot`, HUD, feed, round, level builders, selectors, snapshot fixtures | After G0 | G1: chip, system, HUD, feed; G2: rack; G3: room, global |
| **R1 Renderer core** | `src/render/core/**`, `src/render/index.ts`, `src/render/levels/index.ts` | Contract, mockups v3 | LevelRenderer v3, registry, camera, transitions, hit, pixel feed object, harness | Day 0 (copy art), contract after G0 | G1 |
| **R2 Levels: chip and system** | `src/render/levels/{chip,system}/**` | R1, S6 fixtures, `docs/mockups/v3` | Strict-grid chip, system board | Day 0 (art port) | G1 |
| **R3 Levels: rack, room and global** | `src/render/levels/{rack,room,global}/**` | R1, S6 fixtures, `docs/mockups/v3` | Rack with 4 infra slots and ports, room with network rack and zones, global with sites, zones and backbone | Day 0 (art port) | G2 rack; G3 room, global |
| **U1 UI shell, HUD and feed** | `src/ui/{main.tsx,App.tsx,GameShell.tsx,CanvasWorld.tsx,Hud*.tsx,ZoomRail.tsx,RoundPlate.tsx,viewState.ts,storeHooks.ts,input/**,hooks/**,styles/{tokens,shell,hud}.css}` | Contract, R1, P1 store | Shell, HUD with SLA and round state, Return to market, round report plate, view state with `SnapshotScope` | After G0 | G1 |
| **U2 Plates, configurations and research** | `src/ui/{plates/**,research/**,tray/**,styles/{plates,research,tray}.css}` | Quotes, contract | Part, supply, cooler, switch, LB, network rack, configuration and save-name plates; research wafer; tray | After G0 | G1: part plate, tray, wafer; G2: switch, LB, config; G3: network rack, zone and site add |
| **P1 Platform, perf bench and QA bridge** | `src/platform/**`, `src/dev/**`, `scripts/{bench,qa}/**` | Contract, S1 fleets | Store with scope, runtime, saves, offline worker, DEV bridge `window.__br`, bench (§7), CDP capture copies | Day 0 (copies) | G1: boot budget; G3: frame and offline budgets |

Agents may start reading and copying on day 0. Writing against the contract starts at G0.

### 6.1 Gates

The lead reviews each gate. `npm run verify` is green at every gate.

| Gate | Contents | Pass criteria |
|---|---|---|
| **G0 Contract** (S1 alone, about 1 day) | All of `types/**`; a barrel whose functions really run (initial state with hidden containers, a tick loop with empty phases, a dispatcher that rejects unimplemented actions as `invalid`, a skeleton snapshot with HUD and chip); `testkit` builders able to construct any fleet up to the caps; save round-trip of the boot state | Typecheck; `buildState(fleetMax)` builds; the snapshot fixture compiles for every level |
| **G1 Boot slice** (all but R3) | Chip and System playable at `/v3.html`: market bands to `ram`, rounds, SLA, research, chip and board parts, PSU, configurations for systems | Boot frame ≤ 0.5 ms (P1); delta-invariance property tests; mid-round save round-trip; oracle equivalence; the bot's first purchase under 30 s and first round ending in 4–8 min (S2) |
| **G2 Rack slice** | Rack infra, ports and speeds, first-fit and researched LB strategies and filters, misroutes, gang rack, rack thermal and PDU, configuration plate with copy and saved | Strategy distinct-effect tests; `rackFull` frame ≤ 1 ms; misroute and pickup causes appear in the report |
| **G3 Room and global slice** | Rooms, zones, sites, network rack, data plane, backbone, regions, max fleet | `fleetMax` frame ≤ 4 ms; 2 h round offline in the worker ≤ 10 s; market-constraint test (§1.9) |
| **G4 Balance** | 24 h campaign | ≤ 300 s wall; pacing report against program §14 |

After G4 comes Wave 2: integration (§5.2), then QA screenshots against the v3 mockups.

## 7. Bench and perf proof

### 7.1 Harness

- `npm run bench:v3` runs `scripts/bench/run.ts`. It becomes `npm run bench` at integration.
- Single Node 24 process, plus one `worker_threads` worker for the offline case.
- It writes `artifacts/qa/perf/<stamp>/report.json` and a Markdown table, records node, V8, CPU and source hash, and exits non-zero if any budget fails.
- Instrumentation is a const-guarded counter set: ticks, active ticks, records peak, events by kind, placements, `Amount` ops, clone bytes and per-phase µs. It is off by default and costs nothing when off.

### 7.2 Fixtures

Fixtures are deterministic builders in `src/game/testkit/fleets.ts`. There are no stored binaries to rot. Seed 42.

| Fixture | Contents |
|---|---|
| `boot` | `createInitialState(42)` |
| `rackFull` | One rack, 12 max-tier servers, all rack research, round running at the curve point that loads it |
| `roomFull` | One room, 24 racks |
| `fleetMax` | 8 sites × 3 zones × 24 racks × 12 servers. Maximum compute parts with synthetic power/cooling capacity headroom, all research complete, `leastWork` + capability + health filters, router queues at level 32, `gather` and `shardSteal` on (D25), auto-return at its minimum delay. Prime intensity 34 at the accepted one-task-per-20-ticks cadence, then warm 600 ticks so pools are populated. |
| `fleetMaxHot` | `fleetMax` with undersized PDUs and coolers, so supplies cycle and racks crash. This exercises the failure and kill paths. |

### 7.3 Budgets

| Budget (§13) | Method | Pass |
|---|---|---|
| Boot frame ≤ 0.5 ms | 2,000 chained iterations of `advanceGame(s, 50)` followed by `deriveRenderSnapshot(s, chipScope, prev)`, after 200 warm-up iterations | p95 ≤ 0.5 ms; p50 and max reported |
| Frame at the largest fleet ≤ 4 ms | For each scope (chip, system, rack, room, global, and the room→rack transition with partner), 1,200 chained iterations (60 s of sim) of `advanceGame(s, 50)` + snapshot + `quote({kind:'tray'})` affordability, on `fleetMax` and `fleetMaxHot` | p95 of the worst scope ≤ 4 ms |
| 2 h round offline in the worker ≤ 10 s | Post `fleetMax` to a `worker_threads` worker running P1's real offline handler, request 7,200,000 ms in 60 s chunks as the runtime does, and time from post to final result, including structured clone | ≤ 10 s, and `activeTicks ≥ 70,000` (auto-return keeps the market live; otherwise the run is invalid, not a pass) |
| 24 h campaign ≤ 5 min | S2's bot from `boot`, 864,000 ticks, its normal decision cadence, wall-clocked | ≤ 300 s; also emits the pacing milestones |

**Advisory browser check** (Wave 2, P1's CDP scripts): `fleetMax` room view at 390×780 with 4× CPU throttling. Main-thread frame p95 including draw ≤ 16.7 ms, and renderer allocations flat over 600 settled frames.

### 7.4 Correctness gates in `npm run verify`

- **Delta invariance.** Random partitions (1 ms to 10 s pieces) of 10 min of sim on `boot`, `rackFull`, a 2-rack split fixture with router queues (D25), and a small-RAM spill fixture with completion windows (D26) produce `toEqual` states, including RNG words, draw counts and the event ring. The owned-vs-pure equivalence test (D9) runs on the same split fixture.
- **Save round-trip.** Save at random ticks mid-round, load, continue: the result equals an uninterrupted run.
- **Clock oracle.** Removed with the D40 test cleanup; delta invariance and the D9 owned ≡ pure test remain.
- **Strategy effects.** Every strategy, filter and split rule has a test that fails if it is replaced by the base `firstFit` spread.
- **Market constraints** (§1.9) over the whole curve.
- **Purity test**, unchanged.

## 8. Risks, ranked

1. **Task events, not fleet size, set the cost.** The accepted cadence is fixed at one logical task per 20 ticks. The earlier warning about 50 arrivals per tick describes the historical stress model, not current demand. Existing member and shard limits (256) and performance budgets remain; D25 shard cost is in §1.10.
   - The §1.9 constraints are in this doc and a test enforces them.
   - Arrivals are counted per cohort.
   - G3 measures `fleetMax` before balance work starts.
   - The fallback is constants (§1.10), not new machinery.
2. **Mechanic sprawl.** 144 research nodes, many of which add a per-tick rule: C-states, turbo, DVFS, S3, NUMA, work stealing, live migration, checkpointing, dual feed, ride-through, economizer.
   - Each mechanic should be a compiled parameter evaluated where the pass already is: in the system visit or the rack pass, never a new per-tick loop.
   - A research node whose mechanic is not implemented carries `implemented: false` in the catalog and is hidden. The tree stays honest and verify stays green while S3, S4 and S5 land mechanics slice by slice.
3. **Contract bottleneck at S1.**
   - G0 lands the whole type surface first.
   - Change requests go through one log.
   - Domain-private types stay in domain folders so the shared surface stays small.
   - Snapshot types are shaped by what each level draws (§3.1), which limits churn from the renderer side.
4. **Offline catch-up at the largest fleet with the research-raised offline cap** (D1.10, up to 24 h).
   - With auto-return, 24 h of back-to-back rounds is 864,000 active ticks: about 100 s in the worker.
   - Quiescent skip makes paused time free, but active rounds are not.
   - Mitigation: P1 shows real catch-up progress and keeps the current machine playable. The lead decides whether that is acceptable (§9).
5. **Determinism traps in the hot loop.** Float reassociation, iteration-order changes or reading wall time break invariance.
   - Fixed tick, index-ordered loops, one completion predicate, the oracle and partition tests, and the purity test catch these.
   - `structuredClone` in the worker preserves float bits.
6. **Renderer and UI rework is larger than a port.** All but 31 of the 129 render files read v2 snapshot types. Only art survives.
   - Art is copied on day 0.
   - The level snapshots mirror what each level draws, so `model.ts` adapters stay thin.
   - S6 publishes testkit-derived fixtures at each gate, so R2, R3 and U2 never wait on a live sim.
7. **The integration step in a shared checkout.**
   - One agent runs it, from a script, after a v2 tarball backup, with everyone else idle.
   - Hoist collisions are impossible because v3 trees contain no file named like a survivor.

## 9. Lead decisions and objections

**Decisions the lead must make:**

1. **Offline catch-up budget at the largest fleet.** D1.10 raises the offline cap to 24 h. §13 budgets only a 2 h round, which implies about 100 s of worker time for 24 h. Either accept that with a progress display (my recommendation), or cap offline rounds at the largest fleets.
2. **v2 backup before Wave 2.** v2 exists only in the uncommitted working tree. The integration step deletes it. Approve a tarball (`C:\Users\Borg\backups\bitrouge-v2-<date>.tgz`) or a commit before the step.

**Objections to the program:**

1. **Cohorts.** The original cohort rationale is superseded for arrivals by the accepted fixed-cadence schedule, which creates count-1 logical tasks. Keep the existing pool and split behavior for execution, fixtures and distributed members.
2. **Purity costs a copy, settled by D9.** The platform uses `advanceGameOwned`, which takes ownership and updates hot buffers in place. `advanceGame` stays pure as the reference. Equivalence tests prove identical states, including RNG, across time partitions.
3. **Region-locked demand needs the 8-site cap.** With fewer sites than map regions, region-locked tasks for unowned regions always fail. The caps allow one site per region. The task designer must draw region locks only from regions the player can open.
4. **The research tree's "architecture cap" placeholders are now numbers:** rows 3, zones 3, room ports 24, sites 8. `docs/research.md` §4.2 should cite them.
5. **Concurrent working-set sharing (D1.1)** makes admission depend on the sum of running working sets. The cost is one add and one compare per admission, so there is no performance objection. I record it because it rules out admitting by core count alone.
