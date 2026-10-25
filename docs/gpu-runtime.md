# GPU runtime

Accepted by the lead, 24 October 2026. This file fixes runtime contracts for the latest GPU request and changes no runtime code. The accepted numeric catalog is in `docs/gpu-progression.md`. This runtime ruling supersedes that document's former engine serialization and predicted-finish selection. It preserves CPU/RAM/IO sharing semantics.

## Accepted scope

Keep the current scheduler, record pool, rack efficiency axis and event loop. Add eight physical accelerator columns per system and nine accelerator execution domains. Domains 0 through 7 refer to physical slots. Domain 8 is the linked GPU pool. Each domain has ordinary and tensor work clocks, with one shared contention count. This prevents ordinary and tensor stages from spending the same card's capacity twice.

Assign a running task to one domain for its whole lifetime. Reserve its VRAM when it starts and release it on every final exit. A queued task holds its scheduler slot, but holds no accelerator memory. Core count is a compatibility gate, not an exclusive allocation. Concurrent stages share the assigned hardware's throughput.

Without GPU link, one real GPU must satisfy both the task's core and VRAM gates. It executes at that GPU's own rate. With GPU link, GPUs pool cores and VRAM, and ordinary throughput is `sum(coreCount * clockHz)`. NPUs remain separate tensor-only devices. Their memory and throughput never contribute to an ordinary GPU task or to the GPU pool.

The lead approved one narrow exception to the current execution policy. Hardware rates, temperature and power settings remain fixed during a tick, but GPU sharing changes at stage events. The existing tick-frozen denominator can overspend a GPU when another stage enters it during the tick. The accepted decisions below record this exception. CPU execution and CPU research allocation remain unchanged.

## Constraints carried into implementation

- The player buys a preconfigured GPU model. Hot upgrades scale its specs and worsen efficiency. Replacing a model is a cold change under existing rules.
- Model names are four digits GSMT. Generations 1 through 9 have clock classes 1 kHz, 10 kHz, 100 kHz, 1 MHz, 10 MHz, 100 MHz, 1 GHz, 10 GHz and 100 GHz. Series 3 emphasizes cores, 5 VRAM, 7 clock, and 9 all three. Tiers are 30, 50, 60, 70, 80 and 90. Thus 3350 is generation 3, series 3, tier 50.
- Higher tiers raise all specs, with series emphasis. Comparable X9XX costs strictly more than X3XX + X5XX + X7XX combined and has the generation's best performance and efficiency. Large generation price jumps must preserve the X990 versus next-generation research and purchase choice. The accepted progression document supplies these numbers and local arithmetic checks; campaign evidence remains required.
- Accelerator task gates are only VRAM and GPU cores. Remove `FamilyDef.gpus`; add no clock, ops/s or device-count minimum. Work volume still sets execution duration. Other existing system, placement and memory gates stay in force.
- At most eight accelerators occupy a system. General boards keep one shared GPU/NPU slot, then at most two with `dualGpu`; accelerator boards have eight. Remove stale four-GPU limits and comments. GPUs and NPUs use the same physical slots.
- This ruling does not change the CPU. The user's correction remains binding: CPU cores have only clock; cache and queue belong to the CPU. Do not copy GPU model or core semantics into CPU work.
- Credits and Data remain exact `Amount` values through the existing ledger. Hardware work remains float64 under the v3 policy. Assignment never draws RNG.

## What the code currently does

| Path | Finding and required change |
| --- | --- |
| `build/compile.ts` | Independently takes maximum GPU rate, tensor rate and VRAM without link. VRAM includes NPUs. Replace these as authority with paired physical columns. |
| `market/fleet.ts` | `gateOn` checks `f.gpus` and system-wide VRAM. Capability classes key only aggregate columns. Use the same domain evaluator as execution and key the ordered physical inventory. |
| `exec/est.ts` | `gpuBase`, `gpuFactor` and `estOn` borrow system maxima. Estimate from a compatible domain. `startable` checks RAM and CPU threads but no VRAM. |
| `exec/alloc.ts`, `exec/stages.ts` | Start counts are limited by RAM, slots and threads. `usedVram` is incremented but never limits starts. Acquire the accelerator hold before entering the first stage. |
| `exec/run.ts`, `exec/clocks.ts`, `exec/lists.ts` | One GPU clock and list serve the entire system. Add bounded accelerator clocks and include their due events in the same event selection. |
| `exec/research.ts`, `phys/draw.ts` | Research uses an aggregate GPU rate. GPU load charges all installed accelerators whenever any GPU stage remains active, and misses research-only GPU load. Publish actual per-card duty. |
| `exec/kill.ts`, `exec/outcome.ts` | Running-task release and bulk round drop need accelerator cleanup. Killing by resource heads must also traverse accelerator heads. |
| `build/commit.ts`, `build/research/projects.ts` | Cold changes already retain the old compiled view while killing work. Research can replace compiled hardware capabilities at tick end. Reconcile accelerator domains explicitly at those boundaries. |
| `save/schema.ts`, `save/validate.ts` | Version 1 validates table shapes but not accelerator ownership or reservation sums. Bump the save version and validate the new invariants. |

Paths in this file are relative to `src/game/` unless prefixed with `docs/`.

## Shared types and evaluator

The shared-contract owner defines the types. The catalog owner implements the pure evaluator. Its numeric formulas can change without changing execution.

```ts
type GpuGeneration = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type GpuSeries = 3 | 5 | 7 | 9;
type GpuTier = 30 | 50 | 60 | 70 | 80 | 90;
type GpuModelId = string & { readonly __gpuModelId: unique symbol };
interface GpuBuild {
  readonly kind: 'gpu';
  readonly model: GpuModelId;
  readonly upgrades: number;
}
interface NpuBuild extends PartLevel { readonly kind: 'npu' }
type AccelBuild = GpuBuild | NpuBuild;

interface AccelStats {
  readonly kind: 'gpu' | 'npu';
  readonly gpuCores: number;
  readonly clockHz: number;
  readonly vramBits: number;
  readonly plainOps: number;
  readonly tensorOps: number;
  readonly idleW: number;
  readonly loadW: number;
}
declare function evaluateAccel(a: AccelBuild, u: Unlocks): AccelStats;
```

`FamilyDef.gpuCoresMin: number` replaces `gpus`. It is the fixed nonnegative integer in the accepted progression table, copied unchanged to each member. It is not a `SizeTerm` and does not scale with task size. Zero means no core minimum. `vramAt` keeps its existing bits semantics. Authoring validation rejects negative, nonfinite or noninteger core gates and requires a GPU stage for accelerator requirements. All family literals and generated task sources must change together.

For a GPU, `plainOps = gpuCores * clockHz`; `tensorOps` is the same GPU's tensor-capable rate. The central evaluator validates the model ID and integer `upgrades=0..5` and applies model, upgrades and research effects exactly once. Parse the GSMT digits; never infer a model from ops/s. Generic adapters may expose `gen = displayedGeneration - 1` and `level = upgrades + 1`; those are derived values, never the saved GPU build. It returns finite nonnegative values, positive clock and rates for installed GPUs, safe integer core counts, and catalog-bounded integral VRAM. It returns watts at full hardware utilization. It does not apply rack efficiency, configuration efficiency, CPU DVFS or CPU turbo.

For the existing NPU design, `gpuCores = 0`, `plainOps = 0`, and `tensorOps` and local memory come from the NPU catalog. An NPU can independently host a tensor task with a zero GPU-core minimum and enough local memory. It cannot satisfy a positive GPU-core minimum. This is the accepted NPU boundary. Keep its four explicit catalog rows and AND gates from the progression document. Never invent GPU-equivalent NPU cores from ops/s.

Purchase and upgrade quotes remain separate and return whole-credit `Amount` values. Do not put prices through float64 runtime columns. Shared configurations save GPU model IDs and hot-upgrade counts, plus legacy NPU gen/level; evaluated rates and runtime assignments are not configuration fields.

## Exact buffer additions

Use strides on the existing system tables. This avoids a new table lifecycle and lets the existing allocation, growth, clone and typed-array save code handle the additions. Define `MAX_ACCELS = 8`, `ACCEL_DOMAINS = 9`, `ACCEL_CLOCKS = 18`, `POOL_DOMAIN = 8`. Physical index is `s * 8 + slot`; domain index is `s * 9 + d`; clock index is `s * 18 + 2 * d + tensor`, where tensor is 0 or 1.

| Table | Columns | Meaning and writer |
| --- | --- | --- |
| `SYS_COMPILED` | `accelKind: u8[8]` | 0 empty, 1 GPU, 2 NPU. Build writes slots in `spec.accels` order. |
| `SYS_COMPILED` | `accelCores`, `accelClockHz`, `accelVram`, `accelOps`, `accelTensorOps`, `accelIdleW`, `accelLoadW`: `f64[8]` | Evaluated physical specs. Build writes; empty slots are zero. |
| `SYS_COMPILED` | `gpuLinked: u8` | Whether GPU pooling is enabled. Build writes. |
| `SYS_HOT` | `accelUsedVram: f64[9]` | Sum of running-task holds per domain. Exec writes. |
| `SYS_HOT` | `accelHolders: u16[9]` | Number of running tasks assigned to each domain, including those currently in non-GPU stages. Exec writes. |
| `SYS_HOT` | `accelWAnchor`, `accelEAnchor`, `accelRate`, `accelDue`: `f64[18]` | Work clocks on the rack efficiency axis. Due defaults to Infinity. Exec writes. |
| `SYS_HOT` | `accelHead: i32[18]`, `accelActive: u16[18]` | Sorted run-list heads default to -1; active values count tasks, including cohort counts. Exec writes. |
| `SYS_HOT` | `accelTaskS`, `accelResearchS`: `f64[8]` | Physical-card equivalent busy seconds during the last run phase. Exec writes, phys and views read. |
| `SYS_HOT` | `accelResearchOps: f64` | Accelerator research work this tick, including efficiency. Exec writes. |
| `RECORD` | `accelDomain: i32`, default -1 | A running task's lifetime accelerator hold. Exec writes. Family tensor tag selects its work clock. |

`sys.usedVram` becomes a diagnostic sum over all nine reservation domains, with linked physical GPU domains always zero. Do not use it for eligibility. `sys.active[GPU]` may remain the sum of accelerator-stage task counts for existing summaries. Keep `sys.head[GPU] = -1`, `rate[GPU] = 0` and `due[GPU] = Infinity`; no live record belongs to both old and new GPU lists.

Keep aggregate `gpuOps`, `tensorOps`, `vram`, `gpuDevices` and `npu` temporarily only where existing views need summaries. Define `gpuOps` and `vram` from GPUs alone. These summaries do not prove task compatibility. Remove runtime gate and estimate reads of them. Counts may be displayed but cannot gate tasks.

A domain descriptor is a pure bounded read over compiled columns. Without link, each occupied slot is a domain. With link, physical GPU domains are disabled, domain 8 sums only GPUs, and physical NPU domains remain enabled. Pool cores and VRAM sum; pool ordinary and tensor rates sum their respective per-card rates. Disabled domains have no holds, heads or rate. No GPU belongs to two enabled domains.

## Assignment and reservation API

Execution owns the helpers below in a focused accelerator module. The fleet gate uses the pure compiled helper, not a second implementation.

```ts
interface AccelNeed {
  readonly required: boolean;
  readonly tensor: boolean;
  readonly gpuCores: number;
  readonly vramBits: number;
}
interface AccelChoice {
  readonly domain: number;
  readonly take: number;
  readonly opsPerS: number;
}
declare function accelNeed(f: FamilyDef, size: number): AccelNeed;
declare function accelGate(c: CompiledBuffers, s: number, n: AccelNeed): number;
declare function chooseAccel(
  c: CompiledBuffers, h: HotBuffers | null, s: number,
  n: AccelNeed, maxTake: number,
): AccelChoice | null;
declare function holdAccel(w: World, s: number, r: number, choice: AccelChoice): void;
declare function releaseAccel(w: World, s: number, r: number): void;
```

For a task without GPU work, `required` is false, `chooseAccel` returns domain -1 and `take = maxTake`, and no hold is created. For GPU work, a compatible domain must have enough cores and total VRAM and a positive rate for that task's mode. Ordinary tasks consider GPUs only. Tensor tasks consider GPUs and the NPU rule above. In unlinked mode the same domain must pass every test.

`accelGate` checks static hardware capacity, ignoring temporary reservations. Return the existing GPU detail when no permitted device exists, a new `gpuCores` detail when no permitted domain meets the core minimum, or VRAM when no core-compatible domain also has enough memory. Delete the old `gpus` detail from active task logic. A capable but busy system passes static routing checks and queues the task. Lack of free VRAM is not a misroute or an arrival failure.

With hot buffers, `chooseAccel` restricts `take` to `floor(freeVram / perTaskVram)`. A zero VRAM requirement adds no limit. Among domains that can start at least one task, choose the largest uncontended rate for the family's ordinary or tensor work; ties use the lower domain index. Return as many identical tasks as fit that domain, bounded by `maxTake`. This is a deliberate simple placement rule, not a new strategy. With null hot buffers, use total VRAM instead and ignore contention.

`startable` calls this read-only choice for one task, in addition to its existing CPU and RAM checks. `startQueued` computes the existing thread, slot and RAM bound, then takes the chosen domain's bound. Split the queue record before acquiring its hold. Start that piece, then let the normal loop pick another queue record or another piece for another card. A cohort never spans domains. All members of one record share domain, progress and rate.

`holdAccel` validates the choice against the exact record count, records the domain, adds `count * vramPerTask` and increments `accelHolders` by count. It runs once before `enterStage`, even when the first stage is CPU or RAM. `releaseAccel` subtracts that same amount, decrements the holder count and sets the record domain to -1, so a repeated release is a no-op. When the domain's holder count reaches zero, set its used VRAM to exactly zero. Keep memory through CPU, RAM and IO stages. No live task migrates opportunistically between cards.

Core minima are per task. Two tasks can each require all the cores of a card, pass the gate and share its rate. Do not multiply the core gate by cohort count or reserve cores as VRAM. This retains useful concurrency without creating a second core allocator.

## Work clocks and event ownership

For enabled domain d, let `n = ordinaryActive + tensorActive`. If n is positive, both task clocks advance on rack efficiency axis E at:

```text
ordinaryRate = domain.plainOps  * etaCfg * taskShare / n
tensorRate   = domain.tensorOps * etaCfg * taskShare / n
W(E) = wAnchor + rate * (E - eAnchor)
finish = W_at_entry + stageWork
```

For n = 0, set both rates to zero. A tensor-only NPU's ordinary rate is always zero. The shared n includes each record's count, not just the number of records. Equal time shares therefore consume at most one domain's hardware budget across mixed ordinary and tensor work. Tensor acceleration belongs to that domain only. Separate ordinary and tensor clocks avoid per-record divisor rewrites when research changes tensor factors.

Exec owns all task clocks, heads, holds and due values. Phys continues to own `rack.eff`, `rack.effClock` and power-state factors. Both accelerator clocks use the existing `Span` GPU efficiency-axis bounds; no wall-clock task timer is introduced. GPU rate does not inherit CPU DVFS or turbo. Preserve the existing CPU-only power-cap policy: GPU watts are uncappable load and still contribute to overloads. A future GPU cap needs its own rate and power contract.

Use the existing sorted list operations with an explicit head array and index, or small accelerator-specific wrappers. Records still use `prev` and `next` and belong to exactly one run list at a time. GPU stage entry and exit update the appropriate accelerator list and count. Non-GPU stages keep their current lists and clock rules.

Extend `runEvents` to compare CPU, RAM, the 18 accelerator clock heads, then IO. Compare their due positions as fractions of the same tick. On exact ties use that fixed order, then existing stable list insertion order. This preserves the former CPU, RAM, GPU, IO priority. Within accelerator events, lower domain wins, then ordinary before tensor. Use one completion predicate, `axisEnd >= due`, and no epsilon completion tolerance.

At a GPU stage entry or exit, first settle both clocks of that domain at the event's exact E using the old rates. Flush its usage integration through that event. Change the active counts, re-anchor both rates at that E and refresh both due values. `finish` stays in its owning work clock. Carry `finish_prev` directly only when the next stage uses the same accelerator clock. Crossing domains, tensor modes or other resources uses the destination clock at the same tau. New starts cannot consume work from before their entry event.

At tick start, allocate as today, then anchor accelerator rates with start-of-tick hardware and mode values. Process GPU events under the rule above, including GPU entry caused by a CPU or RAM completion. CPU, RAM and IO sharing remain as they are. Time slicing retains its existing no-new-task chaining policy; stage transitions still update GPU sharing.

`nextDueTick` includes all enabled accelerator due values using the existing conservative `EFF_MAX` bound. Any allocation, release, stage change, relevant research mode change or recompile dirties the rack. Do not enable rack skipping as part of this work; `ALWAYS_VISIT` is currently true. Existing and new equivalence tests must pass before a separate skip optimization.

## Research and power integration

Research uses each physical accelerator exactly once. GPU research base is that card's ordinary rate; NPU research base is its tensor rate. GPU link changes task eligibility and pooling, not the sum of research hardware. Never sum an NPU into a GPU pool and then count it again independently.

For each interval between events, enabled task execution gives a busy domain utilization `uTask = taskShare` when n is positive, otherwise zero. Research is zero when inactive, insolvent or disallowed by the system mode. Accelerator research also requires `DRAW_FULL` from the existing `drawKind`; boot is idle-only, and dark, crash, cold and sleep modes do no accelerator research. When research is allowed, `uResearch = 1 - uTask`. Offline systems and systems between rounds have `uTask = 0`, `uResearch = 1`. Background tasks take 100%, Shared tasks 75%, Focus tasks 0%. Leave CPU research behavior outside this GPU change.

Integrate each physical card's `uTask * intervalSeconds` and `uResearch * intervalSeconds` in increasing tau order. A linked GPU pool gives all participating GPUs the same utilization fractions. VRAM can stripe proportionally across linked GPUs; `usedPoolVram * cardVram / poolVram` is the derived per-card reservation for display. NPU memory is separate. Research is a streaming kernel with no task-sized persistent VRAM allocation; a task's VRAM hold alone does not make its idle compute unavailable to research.

Accumulate accelerator research work for the interval as `sum(cardResearchBase * uResearch) * etaCfg * deltaE`. Add it to `accelResearchOps`, then to the existing research total once. Refactor only the GPU term out of `researchRateOf`; leave its CPU formula and busy-core reporting unchanged. Do not also add the old `gpuBase` research term or multiply the accelerator work by efficiency a second time. Flush the final interval through tau = 1 even when no task event occurs.

Reset card usage meters at the start of each run phase, not each advance call. Scratch event cursors can stay local because a save never interrupts a tick. Persist the resulting meters so phys and snapshots read the same completed tick. During phases after run, failure cleanup must not erase usage already consumed and awaiting that tick's power bill.

`systemDraw` retains the current idle, sleep and power-mode logic. Replace only the aggregate GPU load term with `sum(accelLoadW[i] * (accelTaskS[i] + accelResearchS[i]) / DT_S)`. Every powered installed card still contributes its own idle watts. Unused cards incur no load, research-only cards incur real load, and a card completing halfway through a tick incurs half a tick of task load unless research fills the rest. Assert each card's total equivalent busy seconds is in [0, DT_S], allowing only arithmetic roundoff in assertions.

Keep GPU idle watts in `idleW[GPU]` if existing summaries need them, but never count those watts twice. Supply loss, heat, billing and whole-credit energy-meter rules stay in their existing phases. This contract supplies average watts for the existing per-tick physical model; it does not add sub-tick overload timers or change crash timing.

GPU upgrade and replacement previews in `build/effect.ts` must compare the selected card's evaluated specs and measured card duty. They must not use CPU utilization as GPU utilization or present an incompatible system maximum as that card's throughput. Preserve the existing exact quote and ledger path; upgrading hardware changes completed work and energy, never the payout per unit of work.

## Exits, cohorts and configuration changes

- `releaseRunning` calls `releaseAccel` exactly once. `leaveStage` releases a stage's compute share only, not its lifetime memory. Completion, `abortRecord`, failure, gang failure, swap and offline kills all converge on these functions.
- `killSubtree` traverses accelerator heads as well as CPU, RAM and IO heads. It kills every running record once, including tasks currently outside their GPU stage but holding VRAM. Existing gang root-cause and single-failure accounting remains authoritative.
- Queued, feed, link and gang-anchor records have domain -1. Canceling a transfer releases only the existing route-slot reservation. `dropAllWork` frees work without failures, clears all accelerator holds, heads, counts and clocks, and leaves no card reserved for the next round.
- Queue splits have no holds to copy. A split of an already-running record retains the same domain in both pieces and leaves the aggregate hold unchanged. Each piece later releases only its own count. Update the pool contract and IO-stage split path explicitly. Forbid merging across different domains or progress; the current pool does not merge records.
- Physical slot identities are stable while work runs. Hot GPU upgrades preserve domain and remaining work and change future rates at the next tick boundary. VRAM upgrades expand free space without rewriting existing holds. Replacement, removal and configuration load kill against the old compiled inventory before interpreting new slot indices, including between rounds if a runtime hold exists unexpectedly.
- Research that changes VRAM or rates updates compatibility and future rates at the next boundary. A new GPU-link unlock must rebind existing GPU holders to domain 8 without failing tasks. At the boundary, settle old GPU clocks, read remaining work as `max(0, finish - oldW)`, rebuild domain holds and lists in old-domain/list order, and enter the pool clock with that remaining work. Set the new start to `newFinish - fullStageWork` so progress displays retain the completed fraction. Preserve task id, count, CPU threads, stage, queue position and payout. CPU-stage holders only change their accelerator domain. NPUs stay on their physical domains. Rebuild holder counts and diagnostic reservation totals in fixed record order.

The GPU-link conversion is a rare recompile pass over live records, not a per-tick scan. A hot rate recompile does not need that pass: existing work clocks re-anchor continuously at the boundary and retain their finish values. Use a single exec-owned reconciliation helper at both `commitBuild` and research completion; build must not edit exec columns itself. Reconcile against the final compiled state if several research projects complete in one phase.

## Save and validation contract

Bump `SAVE_VERSION` to the next unused version at integration, currently 2. Retain the `bitrouge-v3` envelope. Pre-live saves from the earlier layout reset with a clear version-mismatch reason. No migration invents a model from old throughput maxima.

Save `{kind: 'gpu', model: GpuModelId, upgrades: number}` in builds and saved configurations. Reset old v3 GPU builds, configurations, accelerator research and pool state together; do not guess a migration from old gen/level. Save every new hot column, including work anchors, holds and record assignments. Extend the existing schema layouts and model validators. Existing generic typed-array encoding handles the extra columns; do not replace it with JSON float arrays. Compiled encodings remain memoized by immutable array identity.

On load, validate model digits and unlock constraints, at most eight slots, finite nonnegative physical stats, domain ranges and enabled domain kinds. For running accelerator tasks, validate paired core and VRAM compatibility, record assignment, list ownership, and holder counts and reservation totals rebuilt in deterministic record order. Queued and transit records must have no accelerator hold. Validate active task counts against both clock lists. Disabled domains must be empty. Allow Infinity only in existing clock sentinel positions; anchors, rates, holds and usage must be finite. A save must not load a GPU stage under the obsolete system GPU head.

Reservation sums may differ in the last bits from subtraction history. Use a bounded arithmetic comparison for validation, not a gameplay eligibility epsilon. Preserve valid saved values for an exact continuation. Release code should set a domain's hold to exactly zero when its last holder exits; do not use a blanket clamp to hide over-reservation or double release. Do not rebuild valid clock anchors or reservation values on every load.

## Required implementation tests

| Area | Required evidence |
| --- | --- |
| Paired gates | A fast low-VRAM card plus a slow high-VRAM card cannot form an imaginary fast high-VRAM card. When only the slow card fits, measured completion uses its own rate. Two unlinked cards cannot combine their cores or VRAM. |
| Removed gates | A sufficiently large but slow GPU passes; a fast GPU with too few cores fails. Many small unlinked GPUs do not satisfy a core gate. No family, routing filter or estimate retains a GPU-count or minimum-clock gate. |
| Link arithmetic | For cards with 2 cores at 10 Hz and 3 cores at 100 Hz, pooled rate is 320 ops/s, never 500. Pool capacity includes only GPUs. Link research during CPU and GPU stages preserves work and holds. |
| NPU isolation | An NPU cannot run ordinary GPU work, supply its VRAM or speed it up. A zero-GPU-core tensor task can use a fitting NPU; a positive GPU-core task cannot borrow invented NPU cores. |
| Concurrency | Two 60-bit tasks on a 100-bit card cannot start together. Independent cards each make full independent progress. Linked reservations cannot exceed pooled VRAM. A blocked queue record is skipped and another fitting record starts. |
| Mixed stages | A CPU-to-GPU entrant midway through a tick reduces the incumbent's GPU share immediately. Total ordinary/tensor time shares remain bounded. Short same-card tasks chain within a tick. GPU-stage exits keep VRAM until task completion. |
| Cohorts | A cohort splits across cards only into separate records, respects each card's memory, and completes at each card's own rate. Running IO splits preserve aggregate GPU holds; each piece releases its share. |
| All exits | Completion, explicit abort, gang loss, power failure, heat crash, cold replacement, offline transition and round end leave no leaked hold. Failure payouts remain zero, gang losses count once, and card slot reuse starts cleanly. |
| Power and research | Only used cards draw task load; idle installed cards draw idle watts. Research uses every available card once, including an NPU alongside GPUs. Background, Shared, Focus, offline and between-round research have matching per-card duty, work, energy and heat. Mid-tick completion retains already-used energy. |
| Recompile and save | Hot upgrades preserve completed work, alter only future speed and expand memory. Cold changes clean old slots. Save/load during mixed-domain work and mid-carry continues identically, including all new buffers and exact wallet strings. Invalid holds, domains, models and old versions are rejected. |
| Determinism | Compare full state, events, RNG words and draw counts, Credits, Data and energy meters across one advance and uneven partitions, including 1 ms + 99 ms, multi-tick calls, research completion and failures. Repeat with a save/load between pieces. |

Extend the naive oracle in `exec/oracle.test.ts` with physical cards, paired gates, lifetime holds and event-time GPU sharing. The oracle tracks remaining work per task independently of cumulative clocks. Compare per-tick task progress and outcomes, not just eventual payout. Preserve the current CPU, RAM and IO oracle semantics. Use exact equality for call-partition and save-continuation tests; any numeric tolerance belongs only to the independent arithmetic oracle and must be documented.

Run focused tests, `npm run typecheck`, `npm run verify`, then the existing maximum-fleet frame and offline benchmarks. Eighteen clock heads are a bounded event scan, but added hot columns cost roughly 6 MB at 6,912 systems before table over-allocation. Measure clone time and maximum concurrent GPU event cost. Do not claim the 4 ms frame or 10 s offline budget from loop bounds alone. If needed, pack only enabled clocks as a follow-up with measured evidence; do not start by adding dynamic per-task clocks, heaps or a new scheduler.

## Ownership handoff

| Owner | Work |
| --- | --- |
| Lead and shared-contract owner | Apply the accepted event-sharing exception and NPU rule. Own `types/**`, `core/buffers.ts`, constants, pool contract, save schema/validation and final documentation consistency. Keep CPU changes outside this GPU handoff. |
| GPU progression and catalog owner | Implement model IDs, evaluator, exact quotes, buy/upgrade/config validation and paired compiled columns. Prove series-9 price and efficiency inequalities, hot-upgrade loss and generation tradeoffs. |
| Execution owner | Own assignment, holds, clocks, lists, event integration, estimates, release paths, reconciliation and per-card usage/research publication. Adapt tests and oracle with the shared owner. |
| Market and routing owner | Replace task GPU-count gates with core gates, regenerate family sources, update failure details, capability-class signatures and estimates. Include all eight ordered physical entries and link state in class keys; aggregate equality is insufficient. |
| Physics owner | Consume the per-card duty meters in GPU load, keep existing power/heat timing, and test research-only draw and overload behavior. Avoid CPU power-policy changes. |
| View and QA owners | Read real card assignment, VRAM and duty. Bind GPU activity to actual card clock and usage, saturating honestly above visible rates. Run focused regression and performance checks. |

The design handoff also reconciles GPU sections in the progression, program, research, task and main spec documents. Runtime implementation and generated research files remain with their assigned owners.

## Accepted decisions and evidence still required

1. The lead accepted GPU fair sharing across active ordinary and tensor stages, recomputed at stage events inside a tick. CPU, RAM and IO sharing stay unchanged. This supersedes whole-tick GPU sharing and the earlier proposal's one-engine serialization.
2. Placement chooses the largest compatible uncontended ordinary or tensor rate, then physical slot order. Linked GPUs use domain 8. Lifetime VRAM reservations constrain starts, while static eligibility ignores temporary reservations.
3. NPU service is tensor-only and requires a zero GPU-core minimum. NPU memory and throughput never enter the GPU linked domain. Keep the four legacy rows, independent of the nine GPU generations.
4. GPU builds save a validated `GpuModelId` and `upgrades=0..5`. Task `gpuCoresMin` is a fixed integer from the progression table. The accepted catalog and exact generation research Credit fees remain in force.
5. The bounded design increases hot-clone size and event scans. Performance and campaign balance remain unproved until implementation produces the required per-card, legal-campaign and maximum-fleet evidence. No shortcut may restore aggregate-max gates, borrow NPU memory, drop task events or change exact currency accounting.

CPU/RAM specialized curve and power integration remains required by `hardware-progression.md`. Its latest idle split is `0.1 * min(nativeFullW * push^0.25, fullW)` and load is `fullW - idleW`. No CPU/RAM runtime implementation belongs to this GPU wave.
