# Game specification

Spec owner, 24 October 2026. This file replaces the v2 specification (in the BitRouge repository history). The binding decisions are in `docs/decisions.md`, including its decision log (§15a). Where this file and the program disagree, the program wins and this file has a bug.

Companion documents:

| Document | Owns |
|---|---|
| `docs/tasks.md` | Task families, the round-age intensity curve `I`, endless-queue generation and its RNG draws, payouts. |
| `docs/research.md` | The research tree: node IDs, work volumes, prerequisites, and the effects each node grants (Appendix C here defines what every effect does). |
| `docs/architecture.md` | Module map, fleet caps, cohorts, data layout, performance budgets. |
| `docs/hardware-progression.md` | CPU/RAM level curves, hardware energy ratios, price steps, source calculations and integration checks. |

This file owns every rule that turns tasks, hardware and research into state changes. Numbers marked **(s)** are starting values the balance owner may tune with probe evidence. Every other number is fixed.

## Changes since D9

Program D10 (tasks are pulled, never throttled). It supersedes the fixed 2 s cadence, the five scheduled arrivals, the pending feed and count-weighted SLA. Implementation owners: S1 contract, S2 market, S3 execution and network, S6 snapshots.

| # | Change | Where |
|---|---|---|
| 17 | **Endless queue.** The market is an ordered queue per round, generated on demand. The player sees the first five, head first. No arrival cadence, schedule or pending feed. | §5.2, §16.2 |
| 18 | **Head-only clock.** Only the head has a 10 s clock, from the tick it becomes the head. It times out (`timeout`) or, if no online hardware can run it, fails as `cantRun`. The next task then becomes the head with a fresh 10 s. A head no hardware can run blocks the line. | §4.2, §5.2 |
| 19 | **Pull admission.** Hardware takes the head as soon as it has room and its first link is free. Order is strict: nothing behind the head is taken first. Taking is pickup. | §6.4, §7.6 |
| 20 | **Inbound pipe.** Every system has an inbound link from boot: the **pipe**, 1 kHz on the 1-2-5 ladder. Its upgrades open with `netSpeed`. From Rack on, the pipe becomes the system's switch port. | §7.2, §7.3, A.1 |
| 21 | **Payload is work.** A task's transfer size is its work, `Σ stage work`, per member. `payloadBits` is derived, not authored. Transfer time = work / link speed at every hop. | §5.1, §7.4 |
| 22 | **Prefetch.** With a scheduler, the pipe fills free queue slots while cores compute. Without one, the core waits for each transfer. | §6.4, §6.7 |
| 23 | **One take per slot per tick.** Each slot takes at most one new task per tick. This bounds per-tick work for tiny tasks. | §6.4 |
| 24 | **Count SLA (D28).** SLA = met / (met + failed) over the round's last 50 resolved tasks; dismissals and research are outside it; the 80% check waits for 10 resolved tasks. | §4.2 |
| 25 | **Research is a task that cuts the line (D27).** Starting a project puts it at the queue front; systems with room take it and hold a slot and threads until it completes. No research shares, no idle-time research; between rounds it runs on every paused server. | §11.2 |
| 26 | **Tick order.** The Arrivals step becomes Market: advance `I` and top up the visible window. Pre-Rack pulls and pipe transfers run inside Execution. The Deadlines step checks the head only. | §14.1 |
| 27 | **Strategies.** System strategies order the system queue only; the market order is fixed. `mlfq` becomes aging inside the queue. `reserveOnRoute` becomes **queued take**. | §8.1, §7.6 |
| 28 | **Link catalog scale.** Payload = work makes the A.3 port, uplink, data plane and backbone speeds far too slow from Rack on. A.3 needs a re-base; see its note. | A.3 |
| 29 | **Removed:** `arrivalCadenceTicks`, scheduled arrival offsets, `dismissOnArrival`, the pending feed and `feedVisible`, transit deadlines, `cantRun · link`. | App. B |
| 30 | **D13: the pipe is the upstream port.** A unit's inbound speed is the speed of the port it plugs into upstream: system → rack-switch port (default 1 kHz), rack uplink → room network-rack port, room (AZ) → backbone. There is no separate `pipe` part. Before the upstream device exists, the unit sits on that device's default port; at boot the lone system is on a 1 kHz rack-switch port, and pipe upgrades are port upgrades. | §7.2, A.1, A.3 |
| 31 | **D13: defaults per generation.** Every link generation has a default (base) speed. Room network-rack defaults carry about 12 rack ports' traffic; data plane and backbone defaults carry a full room. A higher tier is never slower by default. | A.3 |
| 32 | **Withdrawn:** "the rack uplink starts at port 1's speed" (row 20, D10.4). A rack uplink starts at the room network rack's default port speed. | §7.2 |
| 33 | **D14: price parity.** A port-speed step to X costs the native clock work from the old speed to X in the CPU generation whose native range holds X. A closed formula replaces the per-generation `portStep` table. Uplinks, room ports, the data plane and the backbone use the same curve, scaled by the streams they carry (12 or 288). Reaching a 10 kHz pipe costs about 415,000 Credits, not 510. | §12.5, A.3 |
| 34 | **D14: `netSpeed` moves** to Hz W2, 100 Data, requiring only `fifoSched`. | research doc §5.6, §6 |
| 35 | **A.3 table replaced.** The pre-re-base ladder table (10 kHz – 10 GHz switches, `portStep` by generation) is gone. A.3 now lists the re-based catalog with the D13 defaults. | A.3 |
| 36 | **D15: links upgrade where they plug in, once that structure exists.** A system's port (its pipe) stays at the 1 kHz switch default until the player has a Rack, then steps on the rack switch. A rack uplink stays at the room network-rack default until Room, then steps on the network rack. A room's uplink steps at the data plane once Global is open, and its backbone link once `regions` adds it. Before then the link shows its fixed speed and where it becomes upgradeable. | §7.2, §12.5, §16.3 |
| 37 | **D15: `netSpeed` and the `linkSpeed` ceiling are removed.** No research gates a link speed step; the structure node does (`rack`, `room`, `dataCenter`, `regions`). This supersedes D13.2's pre-Rack pipe upgrades and D14.2's `netSpeed`. | §7.2, §12.2, App. B, research doc §5.6 |
| 38 | **D15: pre-Rack income is capped** by the fixed 1 kHz pipe at 1,000 ops/s. Tasks above 10,000 ops can't be taken in time and fail. That wall, at `I` ≈ 13–14, is the push to the Rack. Hz-era and Rack prices must fit that income (`docs/tasks.md` §12). | §6.4, `tasks.md` |
| 39 | **D16: pre-Rack re-price.** SDRAM 3e5 (from 2e6), DDR 4.5e5, a full kHz CPU 2e6, a barebones kHz server 5e5, the rack frame and starter-rack parts 2.4e6. Research Data: W4 4,000, W5 6,000, W6 10,000; `rack` moves to W6 at 30,000. | A.1–A.4, research doc §3.3 |
| 40 | **D16: post-Rack install prices** follow the model's re-fitted rungs: ×1/85 Rack, ×1/7 MHz fab, ×1/21 Room, ×1/27 GHz fab, ×1/9 Data center, ×1/11 Regions. Upgrade prices are unchanged. | App. A |
| 41 | **D18.3: `lbL4` and `lbAsic` are deleted.** Their only effect was routing capacity. Load balancers have one generation per scope; the tree has 162 nodes. | A.2, research doc §5.6 |
| 42 | **D18.4: dead fields removed.** `FamilyDef.payloadBits` is gone (payload is `members × Σ stage work`, computed). The router budget is gone from §7.6–7.7. | §5.1, §7.6, §7.7 |
| 43 | **D18.5: link power.** A link at speed S draws `load = wPerUnit × 1 kHz × (S / 1 kHz)^0.3` at full use and idles at 10% of that; `wPerUnit` = 0.01 W per bit/s at 1 kHz. A link stays a small share of the servers it feeds; a data-plane port idles near 1e5 W, not 5e17 W, and the full 6,912-server fleet's links idle at about 6e6 W, not 4.7e19 W. | §9.1, A.3 |
| 44 | **D20: steep early ramp.** `T(I) = min(250, 7 × 2^(I/5))` s per unit. With no purchases round 1 ends near 60 s on `Can't run · cache` and timeouts; an active player reaches 4–8 min. | §4.1, `tasks.md` §3.1 |
| 45 | **D19: months-long pacing.** System 30–60 min, Rack 5–8 h, Room 2–4 days, zones 1–2 weeks, Regions 2–4 weeks, every data center 2–4 months. Research Data and work re-tiered (W4–W15, research doc §3), the offline cap grows 8 → 12 → 24 → 48 h (`offline48` added), and rack and room cooler `wpw` drop so an idle cooler no longer outdraws the servers it cools. | App. A, research doc §3, §5.10 |
| 46 | **D25: divisible tasks.** A task has a size in whole units and a family **grain**. Routers split it into **shards**: equal whole-unit shares, one for every child with room (FIFO first-fit spread), at most 256, never below the effective grain `max(g, ceil(s/256))` and (D25.11) never under 1 s of work at its target's nominal rate. A shard keeps its task's ID and descriptor. Size-scaling gates (working set, VRAM, storage) apply per shard. `threads` is gone: a starting shard takes `min(free threads, max(1, floor(units / g)))`. | §5.1, §6.3–6.5, §7.6–7.7 |
| 47 | **D25.5: pay for the full task only.** A task pays its full `W` Credits and Data once, when its last shard completes, and is met then. Finished shards free their slots at once but earn nothing. Any shard failure fails the whole task with its full `W`, pays nothing and aborts its siblings. | §4.2, §6.8, §9.8 |
| 48 | **D25.6: `members` is a minimum split.** A distributed task needs at least `members` shards on distinct systems, `minZones` zones and its region, placed atomically by any router. The `gang`, `topology` and `zone` placements, and the `cantRun · gang` detail, are removed. | §4.2, §7.8, §8.5 |
| 49 | **D25.7: router queues.** Every router holds up to `L` taken-but-undispatched tasks or shares (base 1, upgradable to 32, priced by `lbQueueStep`). Taking into a router queue is pickup. Queued take (`reserveOnRoute`) and the 10 s first-link bound are deleted. | §7.1, §7.6, §12.7, App. B |
| 50 | **D25.9: split research.** New strategy `linkAware`; new filter `local`; new rules `gather`, `shardSteal`, `stealRoom`; `checkpointing` covers any shard; strategies now set share sizes. | §8 |
| 51 | **D26: memory hierarchy.** A system's memory is cache, then RAM, then disk. A shard's working set is placed fastest tier first in free capacity at start; what doesn't fit spills. The only memory gate is the whole hierarchy (`Can't run · cache`, `· RAM` or `· disk`, naming the deepest tier the system has). RAM stream and storage IO stages fold into one `mem` resource (bits touched): cache-resident bits cost no time, RAM-resident bits run at RAM bandwidth, disk-resident bits at drive IO. Drive IO is re-based to 1/16 (HDD, SSD), 1/4 (NVMe) and 1/2 (SCM) of its era's RAM bandwidth. `storagePerUnit`, the `storage` resource and the storage gate are gone; `virtualMemory` is base. | §5.1, §6.2–6.6, §6.10, A.1 |
| 52 | **D26.4: GPU memory is separate.** VRAM stays a gate with no spill until `unifiedMemory`, which pools VRAM with RAM and disk. | §6.3, §6.6 |
| 53 | **D26.5: completion windows.** Families from `rackDist` on carry a window from take (120 / 180 / 240 / 120 s by band, × size jitter). A task not met inside it fails `late` with its full `W`; router-queue time counts. Seven failure causes. | §4.2, §5.1, §14.1 |
| 54 | **D25.11: split floor.** Every shard carries at least 1 s of work at its target's nominal rate. | §7.7 |
| 55 | **D31: power at scale.** Asleep systems are never split targets; demand wakes them. Start controllers stage systems, racks and sites at round start and wake them by trigger: the rack's **Power control** unit (battery and smart start in one, a fifth rack slot under the cooler), `roomStart` on the UPS, `globalStart` on the global scheduler. The Power control battery makes each rack's opening unbilled (refill at 25% of marginal price at Return). Off-grid generation at sites cuts imports. Booting bills normally. | §4.1, §4.3, §4.4, §9.3, §9.8–9.10 |


## Changes since D4

Historical task-alignment changes from program D5. Program D10 (above) supersedes rows 1–4.

| # | Change | Where |
|---|---|---|
| 1 | Market inputs for warm-up: `utilization` and `offeredLoad` EMAs, `recentFailure`, per-family can-run check. The old `onlineUtilization` is replaced. | §5.2 |
| 2 | Market state gains a per-family `carry` count and a private round generator seeded by the round seed. | §5.2, §14.3 |
| 3 | Failure records carry an optional one-word `detail`. | §4.2 |
| 4 | Arrival check adds `cantRun · link`: a payload too slow for the pickup window on the fastest path. | §4.2 |
| 5 | **Watts follow work.** Rate parts draw `wPerUnit × rate × push^0.3`; `PartRow` loses `idle[]`/`load[]` for them and gains `wPerUnit`. Coolers keep `wpw`. Non-rate parts draw a small idle only. | §9.1, A.1–A.3 |
| 6 | **Prices are per-generation arrays** (`price[g]`, `upgrade[g]`), with level growth `x^1.2` (×2.3 per flow level). `priceGrowth` is gone. Clock upgrades are priced per lane driven. | §12.3, §12.5, A |
| 7 | Capacities rebased to the model's fleet ladder; drive IO base is 16 bit/s; RAM, GPU, storage, supply and cooler bases changed. | A.1–A.3 |

## Changes since D6

User rulings D7 (program §15a). For S1 (contract), S3 (execution) and S5 (build and catalog):

| # | Change | Where |
|---|---|---|
| 8 | The Chip level is renamed **CPU** (display name; the zoom-level id stays `chip` unless S1 renames it everywhere). The CPU view shows exactly four parts: clock, cache, scheduler, cores. | §3.2, §16.4 |
| 9 | Caps: cores per CPU ≤ 32; scheduler `Q` ≤ 32; running slots `Keff` ≤ 32 (also bounded by hardware threads). Cache keeps its full range. CPU clocks use the later CPU/RAM progression ruling below. | §6.2, §12.2, A.1 |
| 10 | **1–4 identical CPUs per system** (was 1–2). An added CPU copies CPU 1; every CPU action applies to all CPUs at price × CPU count. All CPUs' cores pool under one scheduler. | §6.1, §12.3 |
| 11 | **RAM slots** on a general system: 1–4. | §6.1, §12.2 |
| 12 | **Configuration efficiency** `η_cfg = socketFactor × dimmFactor`. It multiplies compute and GPU rates and divides heat, like `e(T)`; the two combine as `η_cfg × e(T)`. | §6.2, §10.3 |
| 13 | **System board type**: `general` or `accelerator` (2 CPUs, 8 RAM slots, 8 GPU slots, no DIMM penalty). New system field `board`; new barebones option. | §6.1, §13.2, A.4 |
| 14 | New network strategy **`affinity`** (Workload affinity). | §8.3 |
| 15 | A `general` board holds at most **2 GPUs/NPUs** (`dualGpu`); 8 GPUs only on the `accelerator` board. Node names aligned: `accelSystem`, `lbAffinity`, `quadSocket`; `octaChannel` (8 RAM) needs `accelSystem`; `quadGpu` and `gpuBaseboard` no longer exist. | §6.1, §8.3, §12.2, §13.2, App. D |
| 16 | Task instances and families use fixed `gpuCoresMin` and scaling VRAM gates, plus `affinity` for workload routing. No GPU-device-count or clock gate. The accepted GPU progression and runtime rulings supersede the old count gate. | §4.2, §5.1, §6.3, §8.3 |

## CPU/RAM progression revision

The user's calculation examples and follow-up supersede the generic clock/RAM doubling curve and their old 1%-of-gross native energy calibration. Every CPU clock and RAM generation has L1–36. Throughput grows 1.5× per level, freely crossing later tiers' native rates. Native CPU energy ratios are 10, 6, 3 and 2, with efficiency declining inside each era. Isolated operating costs exceed potential output at about L29/L26/L23/L20, but those upgrades remain purchasable through L36. RAM capacity and bandwidth use separate curves. Clock/RAM prices grow 1.7× per step. The binding ruling is program §15a **CPU/RAM progression**; [the focused specification](hardware-progression.md) records formulas and source evidence. These rules await shared runtime integration and a legal campaign balance pass.

## 1. The game

The player runs computing hardware that serves a global market of tasks. A **round** starts when the player returns their infrastructure to the market. Tasks wait in an endless global queue. Hardware pulls the head as soon as it has room, over an inbound pipe that starts at 1 kHz. The head must be taken within 10 s of becoming the head. A taken task runs through hardware stages and, when it completes, pays 1 Credit per unit of work plus some Data, which funds research. The market's intensity rises with every task drawn, from zero each round (D30). Tasks grow from 1-bit CPU operations, through RAM, GPU and storage work, to distributed tasks that span racks, zones and regions. Every failed task lowers the round's work-weighted SLA. When SLA falls below 80%, the round ends at once and every system pauses at no cost. Between rounds the player builds, upgrades, replaces, researches and saves configurations, then returns to the market. Energy is billed continuously, so every watt competes with income. The core decision is upgrade versus replace: levels are cheap but lose performance per watt, while native newer generations cost more and run efficiently. The camera zooms from a single CPU through System, Rack and Room to the Global map.

## 2. Units, time and numbers

| Quantity | Unit | Representation |
|---|---|---|
| Credits: wallet, prices, payouts, energy debits, round totals | Credits | Whole numbers, stored as integer `Amount` (exact; may exceed 2^53) |
| Data: balance, earnings, research costs | Data | Whole numbers, integer `Amount` |
| Energy meter, Data meter | fractions of one unit | float64 in `[0, 1)` |
| Energy prices | Credits/J | float64 |
| Time | ticks of 100 ms **(s)**; `dt = 0.1 s` | Integer tick counter. Rule durations are in seconds; implementations convert them to whole ticks. |
| Work, rates, payload, capacities | ops, bits, ops/s, bit/s, tasks/s | float64 |
| Power, heat, energy | W, J | float64 |
| Temperature | °F | float64 |
| Timers (overload, crash, transitions, wake) | s | float64, advanced by `dt` per tick |
| SLA sums `deliveredWork`, `failedWork`, grace `G` | ops and bits of task work | float64 |
| Round counts `met`, `failed`, `dismissed` | tasks | Integer |
| Intensity `I` | — | float64, owned by `docs/tasks.md` |

Rules for numbers:
- Every rate is constant within a tick unless a rule here says otherwise.
- `Amount` math happens a few times per tick, never per bit or per stage. Payouts are summed as `count × payout` per distinct payout value. Credits and Data change only in whole units (program D2, D3, §9.8).
- No Credit or Data amount is ever shown with a fraction. Large values may use compact notation such as 1.24M. Rates show whole units per minute.
- float64 values are compared with plain `<`, `<=` and `>=`. There are no epsilons. A stage completes when its remaining work is `<= 0` after a subtraction.
- `advanceGame(state, elapsedMs)` takes a non-negative **integer** number of milliseconds. Callers keep their own fractional carry. The state stores `pendingMs`, an integer with `0 <= pendingMs < 100`. The function adds `elapsedMs`, runs `floor(pendingMs / 100)` ticks, and keeps the remainder. Every tick is identical whatever the caller's chunking, so `advance(200) ≡ advance(100)∘advance(100)` by construction, RNG included.

## 3. World structure

### 3.1 The tree

The saved tree is `World → Site → Zone → Rack → System → Socket`.

- A **system** is one server: a board (`general` or `accelerator`) with 1–4 CPU sockets, RAM modules, GPUs, drives and a fixed board PSU.
- A **socket** holds one CPU: a package, cores, a clock, L1, and optionally L2 and L3. Every CPU in a system is identical. A system's single scheduler serves all of them.
- A **rack** has 5 infrastructure slots, top to bottom: cooler, **power control** (D31: battery and smart start, under the cooler), PDU, load balancer, switch. It also has 12 server slots. A server slot holds a system or a storage node (§6.10).
- A **zone** is one room, one data hall and one availability zone. It has a network rack in the top-left slot (room switch and room load balancer), rows of rack slots, room cooling, one UPS (two with `dualFeed`).
- A **site** is one data center in one region. It has zones, a data plane that links them, and a grid feed.
- The **world** has sites, backbone links and, from Regions on, one global scheduler. Site 0 is the **gateway**: the market enters the world there (§7.2).

Every node has a stable ID and an index among its siblings. All iteration and all tie-breaks use index order: site, zone, rack slot, server slot, socket, core.

Fleet caps are set in `docs/architecture.md` §1.9: 12 servers per rack, 2 then 3 rows of 8 rack slots per zone, 2 then 3 zones per site, one site per region (8). The network rack sits in the top-left corner, outside the rack grid.

### 3.2 Levels and unlocks

| Zoom level | Opened by (research effect) | What the player gets for free |
|---|---|---|
| CPU (formerly Chip) | start | One system: socket 1 with package gen 0, one core gen 0 L1 (1 lane), clock gen 0 L1 (1 Hz), L1 cache gen 0 L1 (1 bit). Board PSU gen 0 L1 (dormant until System, §9.2). No scheduler, RAM, GPU or storage. |
| System | `view: system` | The same system, now shown as a board. |
| Rack | `view: rack` | A barebones rack (§13.2) holding the existing system in server slot 1. |
| Room | `view: room` | A barebones zone holding the existing rack in its first rack slot. |
| Global | `view: global` | A barebones site (the gateway) holding the existing zone as zone 1. |
| more sites | `gen: site 0` (the `regions` node) | Building sites in open regions; the global scheduler, gen 0 L1, free. |

A container granted this way is free and keeps every descendant, its state and its IDs. Before a level opens, its container does not exist in the rules. Each section says what applies "before X".

### 3.3 Regions

Every site sits in a region. A region sets the site's energy price and outside air temperature. The map owner may rename regions and the tasks designer references these IDs.

| Region ID | Continent | Opens with | `Tout` (°F) **(s)** | Energy price (Credits/J) **(s)** |
|---|---|---|---:|---:|
| `us-east` (home) | Americas | start | 70 | 0.010 |
| `us-west` | Americas | `regions` | 75 | 0.012 |
| `eu-west` | Europe | `regions` | 60 | 0.014 |
| `eu-north` | Europe | `intercontinental` | 45 | 0.009 |
| `sa-east` | Americas | `intercontinental` | 85 | 0.008 |
| `af-south` | Africa | `intercontinental` | 90 | 0.007 |
| `ap-southeast` | Asia-Pacific | `regions` | 88 | 0.011 |
| `ap-northeast` | Asia-Pacific | `intercontinental` | 65 | 0.016 |

The `regions` ceiling (Appendix C) counts open regions, home included: 1, then 4 with `regions`, then 8 with `intercontinental`. Each region holds at most one site. Before Global, the player's hardware is in `us-east`.

## 4. Rounds

### 4.1 Round states

| State | Meaning | Ends when |
|---|---|---|
| `running` | Hardware pulls tasks from the queue and runs them. SLA is live. | SLA < 0.80 at the SLA step (§14), or the player ends it (End round). |
| `ended` | The round just ended and the report is shown. Mechanically identical to `between`. | The player dismisses the report, takes any action, or returns to market. |
| `between` | Nothing is pulled. Hardware is paused unless research runs (§11.3). | Return to market, by the player or by auto-return. |

A new game starts in `running`, round 1, with the queue's first five tasks already saved before the first snapshot, so the first screen is playable. The first task is the head from tick 0.

**Return to market** is legal in `ended` and `between`. It:
1. sets `round += 1` and starts the already prepared next-round queue at this tick, preserving its seed, its five visible tasks (IDs, descriptors) and any dismissals made between rounds (§14.3);
2. sets `deliveredWork = failedWork = 0`, `met = failed = dismissed = 0` and fixes `G` from the five visible tasks (§4.2), so SLA = 100%;
3. restarts running difficulty at the curve's start (`docs/tasks.md` §3) without regenerating or reseeding;
4. makes every system whose own switch and every ancestor switch are online `onMarket` at once, unless it is in a downtime (§4.3). With start controllers (D31, §4.4), each powered scope instead applies its "Start with": global, then zones, then racks; the rest start `standby` or `asleep`. Rack batteries refill (§9.9). Units switched offline stay out. There is no partial return;
5. resumes research stopped for insolvency (§11.4).

**Round end.** At the SLA step, if the round is `running` and `SLA < 0.80`:
1. every task in transfer, queued or running is dropped, and the rest of the round's queue is discarded. Dropped tasks count as neither met nor failed and pay nothing;
2. every online/offline transition, boot and drain completes at once; cold changes complete at once;
3. the round state becomes `ended` and the report is frozen (§4.7);
4. prepares round `index + 1` once: its seed and its first five tasks, drawn from `I = 0` (D30). Retire the ended round's unused IDs and never reuse them;
5. from the next tick, hardware is paused unless research runs. The next round's five tasks stay frozen while stopped and show as "after Return".

**End round** (action `endRound`, legal only in `running`; user, 25 Oct): the player ends the round on purpose. It runs the same round end between ticks, after the last tick run, with no extra cost, and the report records `endedBy: 'player'` ("Ended by you"; an SLA end records `'sla'`).

Power-failure reboots and crash recoveries keep running between rounds. With no load they finish on their own.

### 4.2 SLA

SLA is a **plain count ratio** (D28), over the **last 50 resolved tasks of the round**:

```text
SLA = met / (met + failed)        over the round's last 50 resolved tasks (all of them before 50)
```

- A task counts once when it resolves: met when its last shard completes, failed with exactly one cause. A split task counts once, never per shard (D25.5). A late task counts once; its aborted siblings don't count.
- Dismissed tasks, tasks dropped at round end, and the research task (D27) are outside it.
- Within one tick, the tick's met tasks enter the window before its failed tasks, so the window is the same however an advance is cut.
- **Warm-up.** The 80% check starts once 10 tasks have resolved this round (met + failed ≥ 10). Before that the HUD shows the ratio as "warming up", and the round can't end on SLA.
- **Why a window.** Over the whole round, hundreds of early small tasks would keep the ratio above 80% long after the hardware hit its wall (each failing head takes its full 10 s). The window ends the round within about a minute of the wall, at any fleet size.
- SLA is global and resets at Return to market. It is evaluated once per tick, after all completions and failures of that tick.
- The HUD shows `floor(SLA × 1000) / 10` percent and the window's counts ("SLA 92.0% · 46 / 50"), so a value just below 80% never reads 80.0%. The round report keeps the whole round's met, failed and dismissed totals, and the met and failed work.

A task is **met** when its last shard completes (§6.8). It **fails** with exactly one of seven causes (program D4.1, D26.5):

| Cause ID | Label | When |
|---|---|---|
| `timeout` | Timed out | It was the head and was not taken by the end of tick `headTick + 99` (§5.2), while some online hardware could run it. A minimum-split task: its minimum split could not be placed, or taken into a router queue, in that window. |
| `cantRun` | Can't run | It was the head and was not taken by the end of tick `headTick + 99`, and no online hardware could run it at that moment (§6.3, §7.8). Record the current missing requirement once. |
| `misroute` | Misrouted | One of its shards was delivered to a system that cannot run that shard (§7.5). |
| `power` | Power | One of its shards was queued or running on a system that lost power (§9.4). |
| `heat` | Heat | One of its shards was queued or running on a system whose rack or zone crashed (§10.7). |
| `swap` | Swap | One of its shards was queued or running on a system that took a cold change, was removed (§4.5), or was switched offline (§4.4). |
| `late` | Late | It has a completion window (§5.1) and was not met by the end of tick `takeTick + deadline − 1`, counting from the tick it was taken, router-queue time included (D26.5). |

A split task fails when any shard is lost and `checkpointing` does not save it (D25.5, §7.8). It records the root cause of that shard's loss and counts once, with its full `W`. Nothing is paid, including the work of shards that already finished. Its other shards are aborted at once: queued, running and in-transfer shards and router-queue shares are freed (slots, memory, VRAM, threads) and their work is discarded. There is no separate shard or member cause.

**Detail** (program D5.3). Each failure may carry one word, shown after the label in the feed and the round report ("Can't run · RAM"). The words and their order are `docs/tasks.md` §6:

| Cause | Detail |
|---|---|
| `timeout` | none, or `link` when some capable system had a free slot but its first link was busy for the whole window |
| `cantRun` | the first failing check in this order: memory, `GPU`, `gpuCores`, `VRAM`, `ECC`, `members`, `zones`, `region` (D25.6 removed `gang`; D26 removed `storage`). The memory detail names the deepest tier the system has: `cache` (cache only), `RAM` (no drive) or `disk`. It means no legal split fits the whole hierarchy (§6.3). |
| `misroute` | the first gate the shard's target lacked, same words |
| `power` | the failed supply: `PSU`, `PDU`, `UPS`, `grid` |
| `heat` | `rack` or `room` |
| `swap` | `cold` or `offline` |
| `late` | `disk` if any of its shards had disk-resident traffic, `RAM` if any had RAM-resident traffic and none disk, otherwise none |

`cantRun · cache` means the system has only cache and it is too small; `RAM` means cache plus RAM is too small and there is no drive; `disk` means even the whole hierarchy is too small (D26.1). A slow link is never a `cantRun` gate: a long transfer only delays the next take (§6.4).

The feed shows each failure with its cause as it happens. The round report counts them.

### 4.3 System modes

Every system, rack, zone and site has an online switch, `intent ∈ {online, offline}`. A system's **mode** is the first that applies:

| Mode | Condition | Can admit (routers see) | Runs tasks | Draws power |
|---|---|---|---|---|
| `dark` | Its own or an ancestor supply has failed and not yet rebooted (§9.4). | no (full) | no | 0 W |
| `crashed` | Its rack or zone crashed and has not recovered (§10.7). | no (full) | no | 0 W |
| `cold` | It is in a cold change (§4.5). | no (full) | no | 0 W |
| `paused` | The round is not `running` and research does not use it (§11.3). | — | no | 0 W |
| `offline` | Round `running`; its own or an ancestor switch is offline and the transition has finished. | no (full) | no | only for research (§11.2) |
| `goingOffline` | Round `running`; switched offline less than `bootSeconds` ago. | no (full) | only while draining (§4.4) | yes |
| `boot` | Round `running`; added, or switched online, less than `bootSeconds` ago. | no (full) | no | idle W |
| `standby` | `onMarket` conditions hold, but a start controller has not powered its rack, zone or site (D31, §4.4). | no; a controller powers it on | no | 0 W |
| `asleep` | `onMarket` conditions hold, but the system is in S3 sleep (§9.3). | no (D31): demand or a controller wakes it | no | 0.03 × idle W |
| `onMarket` | Otherwise. | yes, if it has room | yes | yes |

**Room.** A system **has room** when `admitted + reserved < slots`, where `admitted` and `reserved` count shards (an unsplit task is one shard) and `reserved` counts those routed to it and still in transfer: every route reserves its slot (§7.6). A router has room when a system below it has room or its own queue has a free slot (§7.1). A system without room is **full**: with no scheduler, that means busy; with a scheduler, its queue is full. Every router, the base first-fit included, sends a task only to a system that can admit it now (§7.7). Systems that are not `onMarket` or `asleep` count as full (program D1.5).

**`bootSeconds`** is one boot time, 10 s at base, lowered by `fastBoot` research (program D1.8). It sets the online and offline transitions, the boot of a unit added mid-round, the cold-change downtime, the reboot after a supply failure, and the minimum crash recovery.

The static fleet capability check counts systems in `onMarket`, `asleep`, `boot` and `cold`: they will accept work within `bootSeconds`. It does not count `offline`, `goingOffline`, `paused`, `dark` or `crashed`.

### 4.4 Online and offline

While a round runs, every online/offline change takes `bootSeconds` (10 s at base). Between rounds it is instant.

**Switching a unit offline** affects it and every system below it.
- **Base:** at once, every task queued or running there fails with `swap`, and transfers heading there return to the queue front. The systems are `goingOffline` for `bootSeconds`, admit nothing, draw idle watts, then become `offline`.
- **With `gracefulDrain`:** the systems stop admitting and keep running what they hold. Queued tasks and transfers heading there return to the queue front (§5.2). When the last running task completes, the `bootSeconds` transition starts. Switching the unit back online during the drain cancels it at once.

**Switching a unit online** starts a `boot` of `bootSeconds`. Booting systems draw and bill idle watts (the free warm-up is scrapped) and admit nothing; a rack battery covers them (§9.9). Afterwards they are `onMarket`.

**Toggling during a transition** starts the opposite transition, `bootSeconds` from that moment.

**Adding a unit** mid-round (a system, rack, zone or site) starts its systems in `boot` for `bootSeconds` with `intent = online`. Between rounds new units are added with `intent = online` and no boot.

**Start controllers** (D31). Online is the player's intent; powered is the controller's. Three parts stage the fleet at round start and wake it with demand:

| Scope | Part | Lives in | Stages | Research |
|---|---|---|---|---|
| Rack | **Power control** (`powerCtl`): battery and smart start in one unit | its own rack slot, under the cooler | systems: awake or `asleep` | `powerCtl` (kHz W8); gen 1 `powerCtlLiIon`, gen 2 `powerCtlLfp` |
| Zone | `roomStart` | the room's UPS | racks: powered or `standby` | `roomStart` (MHz W11); gen 1 `startPredict` |
| Global | `globalStart` | the global scheduler | sites and their zones: online or `standby` | `globalStart` (GHz W14); gen 1 `startPredict` |

- **Settings** (hot, saved, copied with configurations): **Start with** `n` units powered or awake at Return to market (1 to the unit count, default 1). **Wake when** the head has waited `≥ X s` (1–9, default 2), or, with generation 1 (Power control gen 1 at a rack, `startPredict` above), the awake units' busy fraction over the last 10 s is `≥ Y %` (50–95, default 75). **Order**: rack `slot` or `fastest`, room `slot` or `coolest`, global `slot`, `cheapest` (site marginal price, §9.10) or `nearest` (backbone latency).
- **Step.** Each second in which its trigger holds, a controller wakes or powers the next units in its order: 1 at generation 0, `ceil(0.25 × awake)` at generation 1. Demand waking (§9.3 `s3Sleep`) adds any shortage at once. A controller acts only while its own unit is powered; a scope with no controller powers everything at Return.
- **Latency** by the controller's level L1–5: system wake 2, 1.5, 1, 0.5, 0.25 s; rack power-on `rackOnS` 2 s × the same ratio; site or zone online `siteOnS` 5 s × the same ratio. These are physical latencies. Waking units draw idle watts.
- **Back to rest.** Systems sleep by `s3Sleep`. A room controller returns a rack to `standby` after all its systems have slept 30 s; a global controller returns a site after all its racks have been in standby 60 s. A unit holding research (D27) never rests.
- **Pace.** Generation 0 doubles a rack's awake systems in at most 12 s and a room's racks in at most 24 s; generation 1 doubles any scope in about 3 s. D30 demand doubles every 1.18 `I`, about 30–70 s at the fleet's limit. So a head waits at most `X + latency` extra (4 s at defaults) and waking keeps pace without SLA cost.

### 4.5 Hot and cold changes

| Change | Kind | Scope |
|---|---|---|
| Level upgrade of any part; port speed step; port count step; uplink step | hot | none |
| Strategy, filter, router queue level (§12.7), setpoint, toggle, C-state limit, DVFS or turbo switch | hot | none (program D1.6) |
| Replace a part with another generation | cold | the unit that owns it |
| Add a part into an empty slot (socket, core, RAM module, GPU, NPU, drive, scheduler, L2, L3) | hot | none |
| Add a second UPS; remove a part | cold | the owning unit |
| Scrap a system, storage node or rack | cold | that unit; removal is permanent |
| Load a configuration onto an existing unit (§13.4) | cold if a part is installed or removed, otherwise hot | that unit |

Owning unit: socket and board parts → the system; rack cooler, PDU, load balancer and switch → the rack and all its systems; network rack parts, room cooling, UPS and rows → the zone; data plane and grid feed → the site; a backbone link → that link (it carries nothing during the downtime); the global scheduler → global routing stops during the downtime.

Exceptions that make a cold change hot:
- **`hotPlug`:** adding, removing or replacing a drive.
- **`hotSwap`:** any cold change whose scope is one system in a rack, including loading a configuration onto it. Running tasks continue at the new rates. If the change removes capacity the running tasks need (memory, a GPU a task is bound to), the tasks that no longer fit fail with `swap`.

A cold change while a round runs:
1. **Base:** every task queued or running on the systems in scope fails with `swap`. Transfers heading there return to the queue front. **With `gracefulDrain`:** the systems first drain as in §4.4, then the downtime starts.
2. **With `liveMigration`:** before step 1, each running task migrates (§6.11).
3. The systems are `cold` for `bootSeconds`. Afterwards they return to the mode §4.3 gives them, with no extra boot.

Between rounds a cold change is instant.

**`rollingUpgrade`** applies one configuration to every server of a rack as a single purchase. The servers change one at a time in slot order: each drains, takes its cold downtime, and the next starts when it returns.

Purchases are never refunded. A replaced or removed part is scrapped.

### 4.6 Auto-return

With the `autoReturn` rule, each round end starts a countdown of `delayS` (120 s, then 15 s with `cronTuning`). When it reaches zero in `ended` or `between`, the game performs Return to market. The player can switch auto-return off; the switch is saved. A manual Return to market cancels the countdown. The countdown is a named deadline, not a hardware duration.

### 4.7 Round report

Frozen at round end:

| Field | Type |
|---|---|
| Round number | integer |
| Duration | ticks |
| Met | integer |
| Failed, by cause (§4.2) | integer per cause |
| Delivered and failed work, final SLA | float64 ops; SLA to one decimal |
| Spill (D26) | share of delivered work whose memory traffic ran from RAM, and from disk | float64 fractions |
| Dismissed | integer |
| Peak intensity `I` | float64 |
| Gross payouts | integer Credits |
| Data earned | integer Data |
| Energy cost during the round | integer Credits |
| Net | integer Credits |
| Research work done during the round | float64 ops |

The last 20 reports are kept **(s)**.

## 5. Tasks and the market

### 5.1 Task instance

`docs/tasks.md` defines families and how instances are sampled. Every instance has this shape:

```ts
type Resource = 'compute' | 'mem' | 'gpu';               // D26.3: 'ram' and 'storage' folded into 'mem'
type Tier = 'cache' | 'ram' | 'disk';                   // D26.1: where a shard's bits sit
interface Stage { resource: Resource; work: number }   // ops for compute and gpu; bits touched for mem
interface StageCoef { resource: Resource; perUnit: number } // whole ops or bits per unit of size
interface TaskInstance {
  id: number;             // reserved when the task enters the visible window, unique within the save, increasing
  family: FamilyId;
  headTick: number | null;// tick it became the head; null behind the head
  size: number;           // s: whole units, >= members × grain (D25.1)
  stages: StageCoef[];    // run in order; a shard of u units has stage work perUnit × u
  grain: number;          // g: whole units that must run together (D25.1); replaces threads
  wsFixed: number;        // bits per shard
  wsPerUnit: number;      // bits per unit; a shard's working set is wsFixed + wsPerUnit × units
  vramPerUnit: number;    // bits per unit; 0 = no VRAM gate (D26.4: no spill until unifiedMemory)
  gpuCoresMin: number;    // fixed integer per shard from the accepted family table; never scales with size
  affinity: 'general' | 'accelerator'; // the family's class, used by the affinity strategy (§8.3)
  ecc: boolean;           // every shard's system needs ECC RAM
  tensor: boolean;        // GPU stages may use tensor rates and NPUs
  members: number;        // minimum split (D25.6): at least this many shards on distinct systems; 1 for ordinary tasks
  minZones: number;       // the shards span at least this many zones; default 1
  region: RegionId | null;// every shard must be in a site of this region
  dataRatio: number;      // Credits per Data, 10 to 100; authored per family, jittered per round seed
  deadline: number | null;// D26.5: completion window in ticks from take, frozen at the draw; null before rackDist
  takeTick: number | null;// the tick it was taken (split or into a router queue); null until taken
}
interface Shard {          // D25.1: a piece of one task; routed, transferred, admitted, queued and run like a task
  task: number;           // the parent task's id; family and descriptor come from it
  index: number;          // 0 … n−1 in split order
  units: number;          // whole units, >= the effective grain unless the task is a single shard
}
```

**Size and grain** (D25.1). `docs/tasks.md` §2 draws `s` and authors `g`. The **effective grain** is `ĝ = max(g, ceil(s / 256))`, so a task has at most `maxShards = 256` shards. A shard holds whole units and never fewer than `ĝ`, except that a task with `s < ĝ` is one shard. Per shard of `u` units: stage work `perUnit × u`, working set `wsFixed + wsPerUnit × u` (placed in the memory hierarchy, §6.5), VRAM `vramPerUnit × u`. `gpuCoresMin`, `ecc`, `tensor`, `region` and `wsFixed` apply to every shard unchanged.

**Payout** is derived, not authored (program D2): `payout = W = s × Σ perUnit`, which is 1 Credit per op or bit of the task's stage work. It is paid **once, for the full task, when its last shard completes** (D25.5). A shard pays nothing on its own. Stage work is a whole number. `mem` stage work is the bits the task touches and pays like any work; where those bits sit changes only time (D26.2). Payload transfer and storage-node traffic (§6.10) are not task work and do not pay. There are no premiums or multipliers.

**Payload** is derived too (program D10.4): a shard's transfer size equals its work, `u × Σ perUnit` bits, at every hop of its path. A task's payload over all its shards equals its payout. It is computed, never stored (D18.4). A 1,000-op task takes 1 s to land over a 1 kHz link.

**Completion window** (D26.5). `deadline = ceil(windowS_f × j / dt)` ticks, where `windowS_f` is the family's window (`docs/tasks.md` §5: 120 s for `rackDist`, 180 s `roomDist`, 240 s `multiAz`, 120 s `region`, 60 s Exchange Feed; none before `rackDist`) and `j` the task's frozen size jitter. The window is constant seconds because the market's size scale is the era's reference: a fleet that holds the 10 s head clock at intensity `I` finishes a mean task there in about one take interval. The clock starts at take (`takeTick`), router-queue time included. The task must be met by the end of tick `takeTick + deadline − 1` or it fails `late` (§4.2).

**Data** earned is `payout / dataRatio` (program D3), with the payout: near 10 for data-rich families (analytics, logs, storage, indexing, ML), near 100 for plain compute. A failed task earns neither Credits nor Data, even for shards that finished (D25.5).

Hardware, routing, service and research never change `payout` or `dataRatio`.

### 5.2 Market

Program D10. The market is an **endless, ordered queue** per round. Nothing arrives on a schedule and nothing throttles it. The only limits are the hardware's room, its link speed and the head's 10 s clock.

**The queue.**
- The queue is generated on demand from the round's seeded curve (`docs/tasks.md` §3). Its state is the **window**: the next five tasks, head first, saved with frozen IDs and descriptors (family, size). Nothing behind the window exists yet.
- When a task leaves the window (taken, failed or dismissed), the rest shift up and one new task is drawn at the back, at the current intensity `I`. The draw happens in the same step, so the window always shows five.
- **Intensity advances per task drawn (D30).** After each draw `I ← I + 1/k(I)`, `k(I) = 9 + 0.3 I + 0.03 I²` tasks per unit **(s)**. `I` never advances with time, and every round starts at `I = 0`: fast hardware moves through the small early tasks quickly, slow hardware crawls, and the curve is the same for both.
- Hardware, idle time, utilization, SLA and window occupancy never change `I` or the draws. `I` follows round age only.
- New tasks have `count = 1`. A split task is one logical task and pays once (D25.5).

**The head and its clock.**
- Position 1 is the **head**. Only the head has a clock. A task becomes the head when the task in front of it leaves.
- `headTick` is the first tick in which the head can be taken. If the previous head left during the pull or routing step of tick `t`, it is `t`. If it left later in tick `t` (at the deadline step, or by a player action between ticks), it is `t + 1`.
- The head must be taken by the end of tick `headTick + 99` (100 ticks, 10 s). Otherwise it fails at that tick's deadline step: `cantRun` if no hardware in the static capability set (§4.3) can run it, `timeout` otherwise. The next task becomes the head with a fresh 10 s.
- Order is strict. Nothing behind the head is taken before it, at any scope. A head that no online hardware can run blocks the line until it is dismissed or fails.
- Taken tasks have no deadline. They can still fail with their system (§6.9).

**Taking** (pickup). A task is taken when it is split and every shard's slot is reserved, with transfers queued on the first link of their paths (§6.4, §7.6), or when the top router takes it into its queue (§7.1, D25.7). Taking is immediate and repeats in the same tick while the new head can also be taken.

**Returned work.** Taken work that comes back to the market goes to the **queue front**, ahead of the head, in its original queue order. This covers a cancelled transfer or a gracefully drained queue (§4.4, §6.9). Its `committed` flag stays true. The first returned task becomes the head with a fresh 10 s. The window then shows the first five entries, so returned tasks may push untaken ones out of view until they leave.

**Dismissal.**
- `dismissTask` names epoch, round and task ID. Any uncommitted task in the window can be dismissed for free. The rest shift up, one new task is drawn at the back, and a dismissed head promotes the next task at once with a fresh 10 s.
- Committed work (transferring, queued, running, held in a router queue, or returned to the front) cannot be dismissed. Stale IDs and wrong epochs or rounds reject.
- Dismissal changes no SLA sum, met or failed count, Credits, Data or research. The round report counts dismissals separately.

**Between rounds.**
- Round end prepares the next round once: its seed, round jitters and its first five tasks, drawn from `I = 0` (D30), each draw advancing `I`. They show as "after Return". The player may dismiss them; each dismissal draws a replacement at the next intensity.
- Return and auto-return start that queue as is, without reseeding or regenerating. Paused time never ages it.

**Saves.** Save the round index, seed and jitters, the window (IDs, descriptors, `committed`), the queue-front entries, `headTick`, the market RNG words and `I`. Saving, loading, snapshots and opening panels never draw. Validate on load: unique window IDs, known families, finite sizes, `headTick` ordering. Bump the save version and reset older pre-live saves; the implementation owner picks the number.

## 6. Execution in a system

### 6.1 Parts of a system

| Part | Count | Notes |
|---|---|---|
| board | 1 | `general`: up to 4 sockets (`cpuSockets` ceiling), up to 4 RAM modules (`ramSlots` ceiling, at most 4), up to 2 GPUs/NPUs (`gpuSlots` ceiling, at most 2). `accelerator` (needs `accelSystem`): 1–2 sockets, up to 8 RAM modules, up to 8 GPUs/NPUs, no DIMM penalty. Changing board type is a cold change. |
| CPU package (`cpu`) | 1 per socket | **All CPUs are identical** (program D7.3): an added CPU copies CPU 1's parts, generations and levels, and every CPU action (upgrade, replace, add a core, add L2 or L3) applies to all CPUs at once. |
| core | 1 to `coreSites` per CPU, at most 32 | Each core has its own generation and level (mirrored across CPUs). |
| clock | 1 per socket | Shared by that socket's cores. |
| `l1` | 1 per socket | |
| `l2`, `l3` | 0 or 1 per socket | Need their research. |
| scheduler | 0 or 1 per system | One queue and one set of running slots for every core of every CPU. |
| RAM module | 0 to the board's RAM slots | Each has its own generation, level and ECC flag. Channels (dual, quad) stay bandwidth technology (§6.2). |
| GPU or NPU | 0 to the board's GPU slots | GPU saves `{kind: 'gpu', model: GpuModelId, upgrades}`. Legacy NPU saves `{kind: 'npu', gen, level}`. |
| drive | 0 to `driveSlots` | Each has its own generation and level. Drives are the disk tier (§6.2); no task requires one (D26.3). |
| board PSU | exactly 1 | |

### 6.2 Capabilities

| Capability | Formula |
|---|---|
| hardware threads | `Σ cores × threadsPerCore` (1, or 2 with `smt`) |
| core rate | `lanes × clockHz × clockFactor × η_cfg × e(T)` ops/s. `e(T)` is §10.4 (1 before Rack). `clockFactor` is §9.3's product of DVFS, turbo, thermal throttle and power-cap factors (1 by default). |
| `η_cfg` | `socketFactor(sockets) × dimmFactor(RAM modules)` (program D7.5). `socketFactor` 1, 2, 3, 4 CPUs → 1.00, 0.92, 0.85, 0.78 **(s)**. `dimmFactor` 0–2 modules → 1.00, 3 → 0.95, 4 → 0.90 **(s)**; an `accelerator` board has `dimmFactor = 1` up to 8. The system plate shows `η_cfg`. |
| `K` (concurrency) | scheduler `K`; 1 with no scheduler |
| `Q` (queue) | scheduler `Q`; 0 with no scheduler |
| `Keff` | `timeSlice`: `min(32, 2 × K)`. With `dma`: `K`. Otherwise `min(K, hardware threads)`. Never above 32 (program D7.2). |
| `slots` | `Keff + Q` |
| cache | `Σ` over sockets of L1 + L2 + L3 capacity: the cache tier. Cache-resident traffic costs no time (it runs inside compute). |
| RAM | `Σ` module capacity: the RAM tier |
| disk | `Σ` drive capacity, plus the rack storage node's free capacity with `sharedStorage` (§6.10): the disk tier |
| `memCap` | the hierarchy, cache + RAM + disk (D26.1). The only memory gate. |
| RAM bandwidth | `channels × module bandwidth` if every module has the same generation and level (`multiChannel`); otherwise the lowest module bandwidth |
| GPU domains | One actual card without link. With `gpuLink`, sum GPU cores, VRAM and per-card ordinary/tensor rates in one linked domain; never multiply summed cores by the fastest clock. Apply `η_cfg × e(T)` once. NPU domains stay separate and contribute zero GPU cores. |
| disk IO | `Σ` drive IO rates (striping); IO concurrency 1, or 4 with `ncq`: the disk tier's rate |

### 6.3 Can run

A system **can run** a shard of `u` units (D25.1) when all hold:
1. **Memory** (D26.1). `wsFixed + wsPerUnit × u <= memCap`, the whole hierarchy: cache + RAM + disk. No single tier is a gate.
2. **Resources.** Every stage's resource exists: `mem` always does (some tier holds its bits); `gpu` needs a compatible GPU domain, or a separate NPU for a `tensor` task with `gpuCoresMin=0`.
3. **Gates.** `gpuCoresMin` and `vramPerUnit × u` must both fit the same actual GPU domain; VRAM never spills (D26.4) unless `unifiedMemory`, where `vramPerUnit × u <=` that domain's VRAM + the system's RAM + disk. A fitting NPU may serve only a tensor task with zero GPU-core minimum. Static eligibility ignores current reservations; `ecc` needs every RAM module to be ECC.
4. **Region.** If `region` is set, the system's site is in that region.

Gates 1 and 3 scale with the shard: a split over more systems needs less memory and VRAM per system, and spills less (D26.6). That is how a larger fleet runs larger tasks (D25). The grain is never a gate. GPU clock, model, generation, ops/s and device count are never task gates. Work volume and effective rate determine duration.

A task **can run on the fleet** (the static capability check of §4.3, §5.2) when, with `C` the systems in the static capability set that meet the size-free gates (resources, `gpuCoresMin`, `ecc`, `region`, `wsFixed` within the hierarchy), some `k` with `members <= k <= min(|C|, 256, max(1, floor(s / g)))` gives shards of `ceil(s / k)` units that fit the `k`-th largest system of `C` (by hierarchy, then VRAM), and those `k` systems span `minZones` zones. The first failing check names the `cantRun` detail (§4.2).

### 6.4 Admission and pickup

Untaken tasks wait in one place only: the market queue (§5.2). There are no per-system inboxes.

A system **has room to take** when all hold:
- `admitted + reserved < slots`, where `reserved` counts shards taken for it and still in transfer;
- its **first link** is free: before Rack, its own pipe (§7.2); from Rack on, the top link of its path (§7.6);
- it has taken fewer than `slots` shards this tick. Each slot takes at most one new shard per tick. This bounds per-tick work when tasks are tiny.
- while a task waits in its queue with a running slot free (memory or threads hold it back, D26), `queued + reserved < Q`: the queue never holds more than `Q`.

**Taking is pickup.** The head is taken when its split is reserved: every shard's slot is reserved and its transfer is queued on the first link (or the top router takes it into its queue, §7.1). The head's clock stops there. Each shard is **admitted** when its transfer lands: it then takes its reserved slot as queued or running. A shard in a system queue is a queued task for every rule of this section.

**Before Rack**, the single system pulls the head itself, inside execution (§6.7). There is no router, so the task is one shard of its whole size (its cores still split it, §6.5):
- It pulls at allocation (`τ = 0`), when a task completes (`τc`), and when a transfer lands, while it has room to take and the head is one it can run (§6.3).
- The pull sends the head's work over the pipe: it lands at `τ + Σ stage work / pipe speed`, carried into later ticks if needed (§7.4).
- A head it can't run blocks the line until it is dismissed, a purchase makes it runnable, or it fails as `cantRun` (§5.2).

**Without a scheduler** (`slots = 1`), the core waits for each transfer. A task takes `transfer + compute`, and the next pull starts when it completes.

**With a scheduler**, transfers prefetch into free queue slots while the cores compute. A task costs the system `max(transfer, compute / Keff)` per take in steady state.

**From Rack on**, the top router takes the head and splits it (§7.6, §7.7). Each shard is admitted when its transfer is delivered (§7.5).

Queued tasks and shards have no deadline. They leave the queue by starting, or by failing with their system.

### 6.5 Starting tasks and hardware threads

A queued task may start when:
- fewer than `Keff` tasks are running;
- except under `timeSlice`, a hardware thread is free (with `dma`, only if its current stage is `compute`; a task whose current stage is not `compute` may start without one);
- **memory** fits (D26.1): the free hierarchy (cache + RAM + disk not held by running shards, program D1.1) holds its working set.

**Placement** (D26.1). At start, a shard of working set `ws` is placed fastest tier first in the system's free capacity: `c = min(ws, free cache)`, then `r = min(ws − c, free RAM)`, then `d = ws − c − r` on disk (local drives, then the rack storage node with `sharedStorage`). The placement is fixed for the shard's life: it holds those bits until it completes or is lost, and never migrates between tiers. A shard that doesn't fit the free hierarchy waits; it is skipped, not blocking. Queued shards hold no memory.

For a task with GPU work, start also requires enough free VRAM on one compatible domain. Choose the largest compatible uncontended ordinary or tensor rate for its family, then physical slot order. Reserve its VRAM there before the first stage, retain it through all stages, and release it only on completion or loss. With `unifiedMemory` (D26.4), a VRAM need above the domain's free VRAM is placed in free RAM, then on disk, like the working set. Queued tasks reserve no VRAM. Core minima are compatibility checks, not reserved cores. A cohort splits into records when tasks select different domains.

The strategy picks which eligible queued task starts. A task that does not fit is skipped, not blocking.

**Threads per shard** (D25.3). A starting shard of `u` units wants `want = max(1, floor(u / g))` threads, where `g` is the family grain. This replaces the family's fixed `threads`: a coarse Compute shard runs on one core until it is thousands of units long, while a fine Parallel shard fills every free core.

**Thread assignment** (all strategies except `timeSlice`). A starting shard takes `min(free hardware threads, want)` threads:
1. one thread on each idle core first, largest lanes first, ties socket then core index;
2. then second threads on busy cores (`smt` only).

With `numaAware`, if its threads fit on one socket's free threads, it takes them all from the socket with the most free threads (ties: socket 1).

A thread's rate is its core's rate, times `smtShare = 0.6` while two tasks share that core. The share is fixed at allocation for the rest of the tick, and set when a task starts mid-tick.

A shard keeps its threads until it completes. Base: it never gains threads mid-shard. With `workStealing`, at each allocation free threads join running shards that hold fewer than `want`, oldest start first. With `dma`, a shard releases its threads while it is in a RAM- or disk-tier part of a `mem` stage, keeps its slot, and takes free threads again when it reaches a `compute` stage (waiting until an allocation if none are free).

### 6.6 Stages and shared resources

Stages run in order. At constant rates a stage takes `work / rate`, so a task takes `sum(work / rate)`, as in v2.

| Resource | Rate for one task | How it is shared |
|---|---|---|
| `compute` | `Σ` rates of its threads. `timeSlice`: `min(want × meanCoreRate, totalCoreRate / running)`. A D27 research holder's threads are busy (§11.2). | Threads are assigned; not pooled. |
| `mem` (D26.2) | Split at start into up to three parts by the shard's placement fractions `f_c = c/ws`, `f_r = r/ws`, `f_d = d/ws`, run in that order: the cache part costs no time; the RAM part runs at RAM bandwidth (a shard whose threads span more than one CPU gets at most `0.5 ×`, `socketSpanPenalty`); the disk part runs at disk IO. | Cache: none. RAM: pool. Disk: pool among holders. |
| `gpu` | Its lifetime domain's ordinary or tensor rate × `1 / n`, where `n` counts all active ordinary and tensor tasks on that domain. | Fair sharing per domain, updated at stage events |
| disk part of `mem` | Disk IO (`Σ` drives). At most `ioConcurrency` shards hold the drives at once (program D1.2); a shard takes a hold when it enters its disk part and one is free, oldest first, and keeps it until that part ends. A storage-node part also crosses both server links (§6.10). | Pool among holders |

**Spill formula** (D26.2). A `mem` stage of `M` bits touched takes `M × f_r / ramRate + M × f_d / diskRate` at constant rates; with `ws = 0` it costs nothing. So per stage: `time = compute / rate + Σ_tier (bits touched in the tier / tier rate)`, with the cache rate taken as infinite: cache serves at core speed, inside the compute time. The fractions are frozen at start, so the parts are ordinary stages on the existing RAM and IO clocks: deterministic and delta-invariant. With `hotPages`, the disk part touches `M × f_d²` bits and the RAM part `M × (f_r + f_d − f_d²)` (to cache when there is no RAM).

**Unified memory** (D26.4). With `unifiedMemory`, a GPU stage of `G` ops whose VRAM need sits partly outside VRAM (fractions `v_r` in RAM, `v_d` on disk) is followed by a RAM part of `G × v_r` bits and a disk part of `G × v_d` bits at those tiers' rates. Without it, VRAM is a gate.

**GPU event sharing.** Use eight physical accelerator slots plus linked domain 8, with ordinary and tensor work clocks per domain, eighteen clocks total. Both clocks share one active-task denominator. At each GPU stage entry or exit, settle both clocks and per-card usage to that event, update counts, then re-anchor rates. A CPU/RAM stage completion that enters GPU work updates its GPU domain immediately. An entrant cannot spend work from before its entry. Unlinked cards progress independently; linked GPUs share one domain. Detailed buffer, recompile and tie-order contracts are in `gpu-runtime.md`.

**Other pools share equally.** RAM and disk keep their existing tick-frozen denominators. For each pool, let `n` be the number of shards in a part on it at the start of system processing, at least 1; disk counts holders. Shards progress at `rate / n`, including mid-tick entrants. Their existing bounded tick excess remains accepted. A disk part without a hold waits until a hold frees. CPU/RAM/IO sharing semantics are unchanged by the GPU ruling.

**Prefetch** (D26). With `prefetch`, the shard at the front of the system queue is placed as soon as it is the front and the free hierarchy holds it (it then holds that memory). When no running shard is in a RAM part at the start of the tick, its first `mem` stage's RAM part advances with the idle RAM bandwidth.

### 6.7 The per-tick execution algorithm

For each system that is `onMarket`, `goingOffline` while draining, or holding research (§11), in index order:

1. **Allocation.** With `workStealing`, widen running tasks. Before Rack, pull the head while §6.4 allows, and advance pipe transfers in flight. Transfers that land are admitted at their landing `τ`. Start queued tasks while §6.5 allows, in strategy order. Started tasks have `τ = 0` (or `τ = wake` for a core waking from a C-state, §9.3).
2. **Processing.** Visit running tasks in start order (earlier start first; ties by task ID). For each, run its stages from `τ` until `τ = dt` or it completes. A compute stage with `τ + work/rate <= dt` completes at that `τ`, and the next stage starts there.
3. **Chaining** (every strategy except `timeSlice`). When a task completes at `τc`, it frees its slot, threads and memory. The system at once starts the next queued task by strategy, at `τc`, appended to the visit list. Before Rack it also pulls the head at `τc` if §6.4 allows; that task starts when its transfer lands. The new task takes the freed threads first. Under `timeSlice`, the next task starts at the next tick's allocation.
4. **Idle time.** Each core's time not used by tasks is idle, including time spent waiting for a transfer or behind a blocked head. Idle time and the reserved research share go to research (§11.2).

Utilization for power (§9.1) comes from this step: busy time per core, pool consumption per pool.

### 6.8 Completion and payout

A shard **completes** when its last stage's remaining work reaches zero in step 2 or 3. It frees its slot, threads, memory and accelerator VRAM hold at once, and its task's done count rises by one. Its work earns nothing on its own (D25.5).

A task is **met** in the tick its **last** shard completes: its full payout `W` and its Data join the tick's sums once, `W` joins `deliveredWork`, and the completion is reported at the component that ran that last shard (its system, and the core or GPU card of its final stage; §16.4). An unsplit task is its own last shard.

Credits and Data are credited at the ledger step (§9.8).

### 6.9 What is lost

| Event | Queued and running tasks on the affected systems | Transfers heading there |
|---|---|---|
| Power failure | fail `power` | return to the queue front |
| Thermal crash | fail `heat` | return to the queue front |
| Cold change, removal | fail `swap` (migrate first with `liveMigration`) | return to the queue front |
| Offline switch | fail `swap` (drain first with `gracefulDrain`) | return to the queue front |
| Round end | dropped | dropped |

The table is per shard. A lost queued or running shard fails its whole task (§4.2, D25.5) and aborts its siblings. A cancelled transfer returns its whole task to the queue front: every shard's transfer and reservation is cancelled and its admitted shards are aborted with their work discarded. If any shard of that task has already completed, the task fails with the event's cause instead. Router-queue entries follow their router's unit: when it goes dark, crashes, takes a cold change or goes offline, they return to the queue front. At round end they are dropped. A task with finished shards that is dropped at round end pays nothing.

A task returned to the queue front keeps its ID, descriptor and queue order and stays committed (§5.2). The first returned task becomes the head with a fresh 10 s. Research progress already made is never lost. Every completion, failure, split-task loss, swap, offline transition and dropped round releases accelerator holds exactly once. Preserve already-consumed per-card duty until the tick's power bill.

### 6.10 Storage nodes

With `sharedStorage`, a server slot can hold a **storage node**: drives and a board PSU, no CPU. It takes a switch port like a server and is never a routing target.

Under D26 the storage node is the rack's **shared disk tier**. A shard whose working set doesn't fit its own cache, RAM and drives spills the rest onto the node's free capacity (§6.5 placement, after local drives). The disk part of its `mem` stages for those bits runs as a transfer over the node's server link and then the shard's server link (§7.4), at the node's IO rate if that is lower than a link. The shard holds its slot (and its threads, unless `dma`) until the transfer completes. The node's holds follow the drive rules of §6.6. The node also counts toward every rack server's hierarchy for the memory gate (§6.3).

### 6.11 Live migration

With `liveMigration`, when a system goes offline, takes a cold change, or crashes (not a power failure), each of its running shards looks for another `onMarket` system in the same rack that can run it and has a free slot (least connections, ties index). If found, the task moves: its remaining state is a transfer of `workingSet` bits over the old and new server links. It is admitted on arrival with its remaining work and keeps its pickup. If not found, the task fails as §6.9 says.

## 7. Routing and networking

### 7.1 Scopes and routers

| Scope | Router | Children | Exists from |
|---|---|---|---|
| global | global scheduler (the research doc's "backbone scheduler") | sites | `regions` |
| site | data plane | zones | Global |
| zone | room load balancer, in the network rack | racks | Room |
| rack | rack load balancer | systems | Rack |

The **top router** is the highest that exists. Before Rack there is no routing: the single system takes the head over its own pipe (§6.4).

Each router has a **strategy** (§8.3), a set of **filters** it has switched on (§8.4), and a **queue** (D25.7). Base: `firstFit`, no filters, a 1-slot queue (program D1.5). There are no placements (D25.6).

**Router queue** (D25.7).
- It holds up to `L` entries, where `L` is the router's queue level, 1 at base and at most 32 (§12.7).
- An entry is a whole task taken from the market, or a share sent down by a parent router. It is taken but not yet dispatched.
- An entry is a logical hold: it moves no bits. Its shards' transfers start when it is dispatched, along their full paths from the market (§7.4).
- An entry is committed and has no deadline. Its router's unit is the rack (rack LB), the zone (room LB), the site (data plane) or global (scheduler). §6.9 says what happens to entries when that unit fails or goes offline.
- A router **has room** for a share when a system below it has room to take (§6.4), or its queue has a free slot. A share for a minimum-split task (`members > 1`) counts only systems, never queue slots (§7.8).

### 7.2 Links

All network transfer happens on **links**. A link has one or more channels. Each channel carries one transfer at a time at its speed in bit/s. A link may add latency.

| Link | Between | Channels and speed | Latency |
|---|---|---|---|
| server link (lone system) | market ↔ the system, before Rack: its default rack-switch port (D13) | 1 channel at that port's speed | 0 |
| server link | rack switch port ↔ system or storage node | 1 channel at that port's speed | 0 |
| rack link | rack uplinks ↔ the room switch port for that rack. Before Room: rack uplinks ↔ market. | one channel per rack uplink, each `min(uplink speed, room port speed)`; before Room, the uplink speed | 0 |
| zone link | room uplinks ↔ the data plane port for that zone. Before Global: room uplinks ↔ market. | one channel per room uplink, each `min(uplink speed, data plane speed)`; before Global, the uplink speed | data plane latency (0 before Global) |
| backbone link | gateway site ↔ another site | 1 channel at the link speed | backbone latency (× 0.5 for a Subsea link between continents) |

- Ports are assigned in slot order. A system or storage node without a rack switch port, or a rack without a room switch port, has no link: it gets no tasks.
- The market enters at the gateway site's data plane, free. A site other than the gateway is reachable only through its backbone link to the gateway.
- **The pipe is the upstream port** (program D10.4, D13). A unit's inbound pipe is the port it plugs into upstream, at that port's speed:
  - a system plugs into a rack-switch port. The switch default is 1 kHz (`k = 0`);
  - a rack's uplink plugs into a room network-rack port, at that switch generation's default speed (A.3);
  - a room (AZ) plugs into the site's data plane and, from Regions on, the backbone, at their default speed (A.3).
- **Before the upstream device exists**, the unit is already on that device's default port, at a fixed speed (D15). At boot the lone system's pipe is a 1 kHz rack-switch port of switch generation 0. It can't be upgraded until the player has a Rack; then it steps on the rack switch, priced per port as §12.5. Its plate shows the fixed speed and "Upgrade at the Rack switch".
- **Where each link steps (D15).** A link's speed steps only once the structure it plugs into exists:
  - server ports, on the rack switch, from Rack;
  - rack uplinks, on the room network rack, from Room;
  - room uplinks, at the data plane, from Global; backbone links once `regions` adds them.
  Until then each shows its default speed and "Upgrade at the Room network rack" or "Upgrade at Global".
- Before Room, a rack's uplink is on a default room network-rack port of room-switch generation 0 (10 GHz) and can't step. Before Global, a room's uplink is on a default data-plane port of generation 0 and can't step.
- **Composition.** When Rack opens, the system keeps its port as port 1 of the starter rack switch, at whatever speed it reached. Systems added later get ports at the switch generation's default. A rack uplink starts at the room network rack's default port speed (D13.4); a new room's uplinks start at the data plane's or backbone's default. Throughput below a link is at most `channels × speed` of that link. Ports bound one server; uplinks bound the rack; room uplinks bound the zone.
- **First link.** A task is taken when its shards' transfers are queued on the first link of their paths: the pipe before Rack, otherwise the top link (§7.4). Later links queue them by store and forward. Their delay never touches the head clock, but it holds the reserved slots.
- **Bandwidth hierarchy** (D25.4). A shared upper link carries every shard below it in turn, while the ports below carry their shards in parallel. A rack uplink therefore carries the rack's whole share of every task, and it must be about as fast as the ports below it combined, or it becomes the rack's throttle.

### 7.3 Port speed ladder

```text
speed(k) = [1, 2, 5][k mod 3] × 10^(3 + floor(k / 3))   bit/s
k = 0 → 1 kHz; 3 → 10 kHz; 9 → 1 MHz; 15 → 100 MHz; 18 → 1 GHz; 21 → 10 GHz
```

The pipe and every switch port, uplink, data plane and backbone link use this one ladder. Each switch, data plane and backbone generation has a base index `baseK` and a top index `topK` (Appendix A.3). Every port of that part stays within them. A port's default is its generation's `baseK` (D13). Before Rack, the lone system's port is fixed at 1 kHz (D15).

### 7.4 Transfers

A transfer moves one shard (an unsplit task is one shard) or one storage-node disk part (§6.10) along a **path**: the ordered list of links from the market to its target.

| Target | Path |
|---|---|
| A system in the gateway site | zone link, rack link, server link (only the links that exist at the player's stage) |
| A system in another site | backbone link, then zone link, rack link, server link in that site |

Rules:
- Each shard crosses every link of its path with its work, `u × Σ perUnit` bits (§5.1). A split task crosses a shared link as one transfer per shard below it, one after another (D25.4).
- **First-link room.** A router may take or dispatch onto a link when that link's backlog is less than one tick of capacity: queued, unsent bits `< channels × speed × dt`. One take may then queue every shard of the task on that link. Queued take (`reserveOnRoute`) and its 10 s bound are deleted (D25.7): a busy first link means no room, and the router queue takes the head instead.
- **Store and forward (base).** A transfer occupies one channel of one link at a time. At each link it waits in that link's queue, then sends for `bits / speed` seconds. A link with several channels (uplinks with `lag`) sends several shards at once.
- **Queue order.** FIFO by the time it joined the queue (ties: task ID, then shard index). With `qos`, smallest `bits` first (ties FIFO).
- **Per tick**, each channel has `dt` seconds. A link serves its queue head on its first free channel. Partial sends carry their remaining bits to the next tick. Several small transfers can finish on one channel in one tick.
- On finishing a link with latency `λ`, the transfer waits `ceil(λ / dt)` ticks before moving on.
- A transfer that finishes a link joins the next link's queue at the end of the transfers step and is served from the next tick. Each link therefore costs at least one tick.
- A transfer that finishes its last link reaches its target in the same tick and goes to the admission step.

**Cut-through** (`cutThrough`). When a transfer is at the head of its current link's queue and every remaining link on its path has a free channel, it crosses all of them at once: it holds one channel on each for `bits / slowest speed + 0.001 s × links` (plus latencies), then arrives. Otherwise it moves one link at a time as above.

**Interruptions.** If a link on a transfer's remaining path goes `dark`, or its target becomes `dark`, `crashed`, `cold`, `offline` or `goingOffline`, or is removed, the transfer is cancelled. Its task returns to the queue front as a whole: every shard's transfer and reservation is cancelled and admitted shards are aborted. If a shard of that task has already completed, the task fails with the matching cause instead (§6.9).

**No deadline in transit.** A transfer belongs to a taken task, so its delay never fails it. It still holds the reserved slot.

### 7.5 Delivery

At the admission step, each arrived transfer is handled in order of system index, then arrival:
- If the system cannot run the shard (§6.3), its task fails with `misroute` and its siblings are aborted (§4.2).
- Otherwise the shard takes its reserved slot and is queued. This is admission; pickup already happened when it was taken (§7.6).
- A transfer to a system waking from S3 is not delivered before the wake ends (§9.3).

### 7.6 Routing step

Routers have no routing capacity (D12.5, D18.4): transfer speed is the only throttle. Any internal per-tick bound exists for engine safety only, never binds in play and is never shown. The step has two phases (D25.7).

```text
// 1. Dispatch router queues, top-down: global, sites, zones, racks; index order within a scope.
for each router R that exists, in that order:
    while R.queue is not empty:
        tree = split(R, R.queue.front)    // §7.7; null when it can't be split now
        if tree is null: break            // strict FIFO: nothing behind the front dispatches
        reserve(tree); R.queue.pop()

// 2. Take market heads at the top router.
repeat while the round is running:
    head = the queue's head
    if head can't run on the fleet (§6.3): stop        // it blocks; §5.2 decides cantRun
    if top.queue is empty and (tree = split(top, head)) is not null:
        reserve(tree)                                  // taken: split now
    else if top.queue has a free slot:
        top.queue.push(head)                           // taken: held in the router queue
    else: stop                                         // it waits; its clock runs
    head is taken; the next task becomes the head with headTick = now

reserve(tree):  // atomic: every reservation in the tree, or none
    for each system leaf: reserve a slot (it counts as admitted for every room check)
                          and queue one shard transfer on the first link of its path
    for each router-queue leaf: push the share into that router's queue
```

- Order is strict. When the head can't be taken, nothing behind it is tried.
- Every take is pickup, whether it splits now or enters the top router's queue. Transfer time never counts against the 10 s; a slow first link only delays the next take.
- A transfer is served from the tick after it is routed, because the transfers step runs before routing (§14.1).
- **Gather** (`splitGather`, rule `gather`): `split` returns null unless at least half of the router's candidates after filters have room, or the entry has waited 10 s in the queue. With `gather`, a head that can't be split this way goes into the queue as above.
- **Shard stealing** (`shardSteal`, `stealRoom`), at the start of phase 1. Each `onMarket` system that has a free running slot and an empty queue takes the newest not-started shard queued on another system in its rack (with `stealRoom`, in its zone). Systems go in index order; the victim is the highest-index system with a queued shard, ties by newest take. The shard moves as a transfer over the victim's and the thief's paths below their lowest shared router. It keeps its reserved-slot semantics on the thief and frees the victim's slot. At most one steal per system per tick.

### 7.7 Splitting a task

`split(R, e)` cuts entry `e` (a task of `s` units, or a share of `u` units) at router `R` into a split tree (D25.2). Let `ĝ` be the task's effective grain (§5.1).

1. **Candidates.** The children of `R` that have room for `e` now. A system has room to take (§6.4), first-link room included. A child router has room if a system below it does or its queue has a free slot (§7.1); minimum-split shares count systems only. Children must be connected by a port. Nothing else is checked: not gates, not load, not speed. For a rack load balancer, children are its systems (storage nodes excluded).
2. **Filters.** Apply the router's switched-on filters in the order of §8.4. A filter that would remove every candidate is skipped for this decision.
3. **Count.** `n = max(1, min(|candidates|, floor(u / ĝ), floor(W_u / (r × 1 s))))`, where `W_u = u × Σ perUnit` is the entry's work. `r` is the target's nominal rate: a system's compute rate (lanes × clock × cores, at `e = 1` and factor 1), or its GPU domain's ordinary rate for families with GPU stages. For a child router, `r` is the fastest system rate in its subtree, read from the D24 summaries.
   - **Split floor** (D25.11): every shard carries at least 1 s of work at its target's nominal rate. So only tasks that are big for the machine split, and every shard lasts at least 10 ticks.
   - The floor never cuts below the minimum split (§7.8), or below the shards needed to fit the memory hierarchy and VRAM (§6.3).
   - It also never cuts below `nNoDisk = ceil(wsPerUnit × u / ((cache + RAM) / Keff − wsFixed))`, the split that keeps every shard off disk (D25.11 item 2, D26.6), as far as the grain and 256 caps allow. For a child router, cache + RAM and `Keff` are the subtree's smallest, from the same memo as `r`.
   - If `n` is still below the shards this entry must place on distinct systems, `split` returns null.
4. **Shares.** The strategy (§8.3) sets each candidate's weight; `firstFit` and `roundRobin` weigh all equally. The strategy also orders the walk; `firstFit` uses index order. Take the first `n` candidates in walk order, or, for weighting strategies, the `n` with the largest weights, ties in walk order.
   - Give each `floor(u × w_i / Σw)` units.
   - A candidate whose share is below `ĝ` is dropped and the rest are reweighted, until every share is at least `ĝ`.
   - Then the remainder goes to the first candidate in walk order.
   - Base: equal whole-unit shares, the remainder to the first child.
5. **Recursion.** A share for a system is a **shard** for it. A share for a child router is split by that router in the same step, with its own filters and strategy, over its own candidates. If that router has no system with room for it but has a free queue slot, the share enters its queue instead. The tree's leaves are systems and router queues.
6. **Capability wait.** With the `capability` filter on, `split` also returns null when some leaf shard would not fit its target system (§6.3 gates 1 and 3). The entry then waits, in the router queue or as the head, instead of misrouting.
   - A router-queue entry that can never dispatch fails instead: when its split fails although the router has children with room, and no system below that router in the static capability set (§6.3, gates per shard, the smallest share it could cut) can run it, its task fails `misroute` with that gate as the detail and its slot frees. A blocked front entry is tried again only after something below its router changes (a slot, queue slot or first link frees, a mode, build or research change), after Gather's 10 s, or each tick for a minimum split behind the `health`, `power` or `thermal` filter.

Without the `capability` filter, a shard can land on a system that cannot run it. It fails `misroute` on delivery (§7.5), and so does its whole task. A region-locked task at a global scheduler without the `region` filter is split like any other task; a shard that reaches a site outside its region misroutes.

**What first-fit spread does.** With every child idle, a task is cut into equal shares across the whole fleet, up to 256. Identical systems finish their shards together and free up together, so the next head is cut just as wide.

With mixed hardware or uneven frees, the base rule shows its two weaknesses:
- the slowest child sets the task's finish time;
- a lone system that frees first can take the whole next head as one shard.

The researched strategies, Gather and shard stealing answer these (§8).

### 7.8 Minimum split (distributed tasks)

A task with `members > 1` needs a **minimum split** (D25.6). Any router places it; no placement research is needed.

1. **Rule.** At least `members` shards, on distinct `onMarket` or `asleep` systems with a link, each with room (§4.3), spanning at least `minZones` zones, all in `region` when set. Shares of a minimum-split task never enter child-router queues.
2. **Split.** `split` at the top router walks down as in §7.7. At each router, a candidate counts for as many shards as it has systems with room below it (after filters). If the tree can't reach `members` shards, or `minZones` zones, `split` returns null. Its shards are then `n >= members` with `n = min(systems with room, 256, floor(s / ĝ))`.
3. **Atomic.** All shards are placed and their slots reserved in the same routing step, or none are. Reserved slots count as admitted for later placements.
4. **Pickup.** The head is taken when its split is reserved, or when the top router takes it into its queue. A queued minimum-split task dispatches only when its whole minimum split can be placed. Meanwhile it blocks its queue (strict FIFO), and systems below keep draining until enough have room. If neither happens by the end of its head window, it fails: `timeout`, or `cantRun` per item 6.
5. **Run.** Shards run independently (§6) and complete separately. The task is met, and paid, when the last completes (§6.8).
6. **Blocking capability.** If the task can't run on the fleet (§6.3: too few capable systems for `members`, too few zones, no site in `region`, or no split that fits), the head blocks the line. Recheck after relevant purchases. If it is still impossible at its head deadline, it fails once as `cantRun` with that detail.
7. **`checkpointing`** (any split task). When a shard is lost after pickup, its task does not fail at once. The router that placed the shard places one replacement shard of the same units: same rules, one system below that router, with a deadline 10 s from the loss. The replacement restarts from the first stage. If none is picked up in time, the task fails with the lost shard's cause.

A shard never needs a link faster than the links on its own path; an uplink above many shards needs their combined speed (§7.2).

## 8. Scheduling vocabulary

`docs/research.md` decides which strategies, filters and split rules exist and when they unlock. This section fixes what each does. Every entry has a distinct, testable effect. A researched network strategy or filter is available at every network scope the player has opened, unless the table limits its scope.

### 8.1 System strategies

They order one choice: which task in the system's queue starts next. The market order is fixed (§5.2): a system always takes the head and never picks from the queue behind it. Ties always go to the earlier take, then the lower task ID. A system with no scheduler behaves as `fifo` with `K = 1`, `Q = 0`. The strategy belongs to the scheduler part.

`est(shard)` is the shard's remaining duration at this system's current uncontended rates, with compute at `min(max(1, floor(units / g)), hardware threads)` mean-rate threads. The queue holds shards; "task" in this table means a shard.

| ID (node) | Order | Testable effect |
|---|---|---|
| `fifo` (`fifoSched`) | Earliest take first. | Completion order equals take order for equal tasks. |
| `sjf` (`sjf`) | Smallest `est` first. | Slots free sooner, so the head is taken sooner in a mixed queue. A large queued task can wait behind later small ones. |
| `timeSlice` (`timeSlice`) | Earliest take first; `Keff = 2K`; compute shared equally (§6.6); no chaining. | Twice the running slots, so the head is taken sooner; each task finishes later; tasks shorter than a tick lose the rest of it. |
| `priority` (`priorityQ`) | Highest `payout / est` first. | More Credits per second from the running set; a slow-paying task can wait long in the queue. |
| `mlfq` (`mlfq`) | `sjf`, but a queued task that has waited 3 s or more starts first (earliest take of those). | No queued task waits much past 3 s plus one task length; slot turnover close to `sjf`. |

### 8.2 System rules

| Rule | Effect | Section |
|---|---|---|
| `workStealing` | Free threads join running shards holding fewer than `floor(units / g)` threads. | §6.5 |
| `numaAware` | Keep a task on one socket when it fits. | §6.5 |
| `smt` | Two threads per core at `smtShare` each. | §6.2, §6.5 |
| `dma` | No thread held during the RAM and disk parts of `mem` stages; `Keff = K`. | §6.5 |
| `hotPages` | Hot data stays in fast tiers: the disk part touches `M × f_d²` bits (D26). | §6.6 |
| `unifiedMemory` | VRAM pools with RAM and disk; overflow runs at those tiers' rates (D26.4). | §6.3, §6.6 |
| `prefetch` | The queue-front shard is placed early; idle RAM bandwidth advances its first RAM part. | §6.6 |

### 8.3 Network strategies

Every strategy works on the candidates that have room now (§7.7), so no strategy sends a shard to a full system. Under D25 a strategy sets two things in `split`: the **walk order** (which candidates get shards when `n` is smaller than the candidate count, and who gets the remainder) and each candidate's **weight** (its share size). Shares are whole units of at least `ĝ` (§7.7 step 4).

Definitions for a candidate `c`:
- `conns(c)`: admitted + reserved shards over the `onMarket`/`asleep` systems in `c`;
- `free(c)`: free slots (`slots − admitted − reserved`) over its systems, plus its router queue's free slots;
- `rated(c)`: `Σ` rated compute ops/s of `c`'s systems that have room (lanes × clock, at `e = 1` and factor 1);
- `link(c)`: the speed of `c`'s top link (a system's port, a rack's uplinks summed, a zone's uplinks summed);
- `finish(c, u)`: for a system, `Σ est` of its admitted and reserved shards divided by `Keff`, plus the transfer time of `u` units over the remaining path at current link speeds, plus `est` of `u` units; for an aggregate, the minimum over its systems;
- `latency(site)`: its backbone link latency (0 for the gateway) plus the entry's payload time over that link.

| ID (node) | Scopes | Walk order and weight | Testable effect |
|---|---|---|---|
| `firstFit` (base, every router) | all | Index order; equal weights. | Every child with room gets an equal share; the remainder goes to slot 1. Blind to gates, so misroutes happen. |
| `roundRobin` (`lbRoundRobin`) | all | Cyclic from the router's pointer; equal weights; then pointer = the last child used + 1. | When the grain limits `n` below the candidate count, the children that get shards rotate, and so does the remainder. |
| `leastConn` (`lbLeastConn`) | all | Fewest `conns` first; weight `free(c)`. | A nearly full child gets a small share; its siblings take more. |
| `weighted` (`lbWeighted`) | all | Index order; weight `rated(c)`. | Mixed-generation racks get shares in proportion to speed, so the shards finish together. At room scope a rack with 12 free servers gets 12 times the share of a rack with one. |
| `leastWork` (`lbLeastWork`) | all | Lowest `finish` first; shares water-filled so every chosen child's `finish(c, share)` is as equal as whole units allow. | Lowest predicted completion of the last shard; accounts for slow links and backlog. |
| `binPack` (`binPacking`) | all | Index order; only candidates with a system at `running + reserved < Keff` (filling to the running limit, not the queue) and whose own supply was below 90% usage last tick (rack scope: the PSU; zone: the PDU; site: the UPS; global: the grid feed); equal weights. If none qualifies, as `firstFit`. | Shards pack onto running slots on cool supplies; queues and the idle tail stay empty and reach S3. |
| `linkAware` (`topologyAware`, D25.9) | zone, site, global | Index order; weight `min(rated(c), link(c) / bitsPerOp)`, where `bitsPerOp = 1` (payload is work). | A rack behind a slow uplink gets a small share instead of holding the task back. |
| `latency` (`latencyAware`) | global | The single site with the lowest `latency + finish`; ties index. A minimum split that one site can't hold spills to the next. | Tasks stay in one region unless it is busy. |
| `price` (none yet; allowed by program D1.7) | global | The single site with the lowest marginal energy price (§9.10); ties `latency`; spills as `latency`. | Work moves to cheap regions. |
| `affinity` (`lbAffinity`, program D7.7) | all | A task is **specialized** when its family's `affinity` is `accelerator` (`docs/tasks.md`). Specialized tasks split only over candidates containing an `accelerator` system with room; other tasks only over candidates containing a `general` system with room. If no candidate of the preferred class has room, as `firstFit`. Equal weights. | Accelerators stay free for GPU, tensor and big-memory work. Unlike `capability`, it states a preference, not a gate. |

**Site and global scope (program D24).** At the data plane (candidates: zones) and the global scheduler (candidates: sites), `leastWork` and `latency` use a maintained summary instead of the exact `finish` over every system. A zone ranks by its best class: per capability class, the lowest queued work among the zone's systems of that class that can admit now, over the class's `Keff`. To that it adds the entry's est on that class and its transfer time over the zone's backbone and zone links. Only classes that pass the task's gates count. Queued work is the Σ est of the shards a system holds (reserved, queued and running), each at compiled rates (e(T), clock factor and contention at 1) and counted whole until it completes. A site ranks as its best zone; `latency` adds `latency(site)` as before. Ties go to the lowest index. The summary is kept per class and updated on take, completion and hardware change. Within a room (room and rack load balancers), `finish` stays exact. `leastWork` water-fills over the summaries' ranks.

### 8.4 Filters

Applied in this order; each is skipped if it would remove every candidate.

| ID (node) | Scopes | Removes candidates that… |
|---|---|---|
| `region` (`regionAware`) | global | …are not in the task's region (only for region-locked tasks). |
| `capability` (`lbCapability`) | all | …contain no system that can run a shard of `ĝ` units (§6.3). It also makes `split` wait rather than dispatch a leaf shard that would not fit its target (§7.7 step 6). |
| `health` (`lbHealth`) | all | …have a supply overload timer `tOver > 0` or a rack crash timer `tHot > 0` (for a system: its PSU, PDU and rack; for a rack: its PDU and rack; for a zone: its UPS and lump; for a site: its grid feed), from the previous tick. |
| `power` (`lbPowerAware`) | all | …have a supply (rack scope: the system's PSU; zone scope: the rack PDU; site scope: the UPS; global scope: the grid feed) at usage `>= 0.90` or `tOver > 0`, from the previous tick. |
| `thermal` (`thermalAware`) | zone, site, global | …are at `>= 90 °F` (racks at zone scope; zones at site scope; a site's hottest zone at global scope). |
| `local` (`zoneAware`, D25.9) | zone, site, global | …all but one. It keeps the first candidate in walk order whose systems with room could take the entry's whole split by themselves (`min(256, floor(u / ĝ))` shards, or its minimum split, zones and region). If none can, it keeps all. At site scope it first drops zones with a dark UPS. A rack, zone or site failure then kills only the tasks inside it. |

Filters combine: with `capability` and `health` both on, a candidate qualifies only through a system that passes both.

### 8.5 Split rules

Placements are gone (D25.6): every router places minimum splits (§7.8). These rules change how routers split and rebalance.

| ID (node) | Scope | Effect |
|---|---|---|
| `gather` (`splitGather`) | every router | `split` waits until at least half the candidates after filters have room, or the entry has waited 10 s in the router queue (§7.6). A lone early system no longer takes a whole task. |
| `shardSteal` (`shardSteal`) | rack | A free system steals a not-started shard queued on a sibling (§7.6). |
| `stealRoom` (`stealRoom`) | zone | Stealing spans the zone's racks (§7.6). |
| `checkpointing` (`checkpointing`) | every router | A lost shard is re-placed within 10 s instead of failing its task (§7.8). |

## 9. Power

### 9.1 Draw

Every powered part draws:

**Watts follow work.** Payout is 1 Credit per op or bit (program D2). Rate parts draw in proportion to their rated rate, and pushing them above their generation's native rate costs more per unit. CPU cores and RAM use the hardware energy ratios in `hardware-progression.md` §3 instead of the generic push exponent:

```text
CPU: native = baseLanes[g_core] × clockBase[g_core]; rate = lanes × installedRatedClock
RAM: native = bandwidthBase[g_ram]; rate = native × 1.5^(L - 1)
push = max(1, rate / native)
a = -ln(decay[g]) / ln(1.5)
E = nativeRatio[g] / push^a
nativeFullW = native / (0.010 × nativeRatio[g])
fullW = rate / (0.010 × E)
idleW = 0.1 × min(nativeFullW × push^0.25, fullW)
loadW = fullW - idleW
```

CPU `nativeRatio = [10, 6, 3, 2]`, `decay = [0.92, 0.93, 0.95, 0.9625]`. RAM `nativeRatio = [10, 10, 6, 3, 3, 2]`, `decay = [0.92, 0.92, 0.93, 0.95, 0.95, 0.9625]` for SDRAM through DDR5. These are **(s)**. `E` is potential gross per electrical Credit at the fixed home reference tariff, separate from `η_cfg` and `e(T)`. Regions still bill actual watts at their own tariff. The core's installed generation owns its ratio, including with a newer oscillator. Apply no additional generic `push^0.3` penalty and no additional heat division by `E`. `E < 1` warns of normalized operating loss; it never blocks a purchase or automatically shuts down the part.

Other parts keep their catalog power rule:

```text
generic rate part (drive, switch port, uplink, data plane port, backbone link, load balancer, global scheduler; GPU/NPU unless their catalog overrides it):
  native  = its rate at L1 of its own generation
  push    = max(1, rate / native)                          // rate = current rated rate at e = 1, factor 1
  idleW   = idleShare × wPerUnit × native × push^0.25      // idleShare = 0.1 (s)
  loadW   = wPerUnit × rate × push^0.3                     // so loadW grows as x^1.3, as in v2
cooler:   idleW = 0.1 × wpw[g] × base[g] × x^0.25;  loadW = wpw[g] × base[g] × x^1.5
other parts (clock, caches, package, scheduler, row, frame): idleW = idle[g] × x^0.25, no load
actualW = idleW × idleFactor + loadW × u × loadFactor
```

- A core's `rate` is `lanes × clockHz`. Its clock's levels therefore raise the core's watts, not the clock's.
- Generic `wPerUnit` (W per unit/s) **(s)**: GPU 0.5; NPU 0.125; drive IO 1; links 0.01 at 1 kHz under the D18.5 rule (A.3), subject to GPU catalog overrides. CPU/RAM use `E` above. A native core's full-use electrical share is 10%, 16.67%, 33.33% or 50% of potential gross by era, before supply loss and cooling (§9.2, §10.5). Pushed levels increase that share. Actual net income depends on completed tasks, utilization and all supporting hardware.
- Watts are game watts and span W to TW; the HUD uses SI prefixes.
- `x` is the level factor of the part's curve (§12.1).
- `u` is the part's utilization this tick, in `[0, 1]`.
- `idleFactor` and `loadFactor` are 1 unless §9.3 changes them.
- A part in a mode that draws 0 W draws nothing, idle included.

| Part | `u` |
|---|---|
| core | busy time (tasks and research) / `dt` |
| clock, L1, L2, L3, package | mean `u` of the socket's cores |
| scheduler | `(running + queued) / slots` |
| RAM module, GPU, NPU, drive | its pool's consumption / budget |
| switch port, uplink, data plane port, backbone link | sending time / `dt`, mean over channels |
| load balancer, global scheduler | tasks routed / (`R × dt`), at most 1 |
| cooler | duty `d` (§10.5) |
| row, shells, frames | 0 (idle only) |

Infrastructure is powered when anything below it draws power. A rack's cooler, switch and load balancer draw while any of its systems or storage nodes does; likewise a zone's network rack, room cooling and UPS, a site's data plane and grid feed, and the global scheduler and backbone links.

GPU models use the coefficient and split idle rules in `gpu-progression.md`, not the generic level curve. For displayed generation `g`, tier index `k` and series watt multiplier `z`, `w = 0.5 * 0.9^(g-1) * z * 10/(10+k)`. Push is `x=2.5^upgrades`; load is `w * ratedOps * x^0.3`. Core idle and VRAM idle are each `0.05 * w * nativeOps * x^0.25`; HBM halves only VRAM idle. Integrate task and research duty per physical card over stage events. Every powered card draws its own idle watts, unused cards draw no load, and linked pooling never bills a card twice. Existing supplies, heat and energy-ledger phases consume these watts.

### 9.2 Supplies

| Supply | Part | Feeds | Input from |
|---|---|---|---|
| board PSU | `psu` | its system's parts | rack PDU (before Rack: utility) |
| rack PDU | `pdu` | the rack's PSU inputs, storage node PSUs, cooler, switch, load balancer | zone UPS (before Room: utility) |
| UPS | `ups` | the zone's PDU inputs, network rack, room cooling | site grid feed (before Global: utility) |
| grid feed | `grid` | the site's UPS inputs and data plane | utility |

The global scheduler and backbone links draw from utility. Utility has no limit.

Bottom up, each tick:

```text
D     = delivered W = Σ actualW of the parts it feeds + Σ input of the supplies it feeds
usage = D / capacity
loss  = D × lossFraction × m(usage)
input = D + loss                                  // what its parent sees
m(usage) = 1 if usage <= 0.90; 1.5 if 0.90 < usage <= 1.00; 3 if usage > 1.00
lossFraction = loss[g] + lossPerLevel × (L − 1)   // Appendix A; pushing an old supply makes it lossier
```

Loss is real power: it is billed and becomes heat in the lump that holds the supply (§10.3).

Before System the board PSU is dormant: no capacity limit, no usage shown, no loss. It appears with the System view.

**`dualFeed`.** A zone may hold a second UPS. Each rack PDU input is split equally between the two. If one UPS is dark, the other carries every PDU input alone.

### 9.3 Power and clock modifiers

Each is a research rule (Appendix C). Factors multiply.

| Rule | Condition | Effect |
|---|---|---|
| `coreIdle` (C1, C3, C6) | A core idle for at least `afterS` (0, 1, 1 s). The deepest researched state applies, limited by the system's C-state limit (hot setting). | That core's `idleFactor` = 0.5, 0.15 or 0.02. A task starting on a core in C3 or C6 starts after `wakeS` (0.2 or 1 s), a physical latency. |
| `packageIdle` | Every core of a socket idle the whole tick. | That socket's clock, caches and the scheduler: `idleFactor = 0.2`. |
| `s3Sleep` | A system in a rack with no admitted or reserved task for 10 s, and not holding research (D27). | Mode `asleep`: every part's `idleFactor = 0.03`, no load. An asleep system is never a split candidate (D31). When a router can't split an entry for lack of awake room, it wakes that shortage, lowest index first (or in its start controller's order). They are `onMarket` after `s3WakeS` (2 s, or the controller's level), drawing idle meanwhile. |
| `dvfs` (system switch, default on once researched) | At allocation the system's queue is empty and nothing is reserved on it. | Its cores: clock × 0.5, core and clock `loadFactor` 0.3. |
| `turbo` (system switch) | Not under `dvfs`; previous tick's PSU usage < 0.90; from Rack on, rack `T < 80 °F`. | Clock × 1.25, core and clock `loadFactor` 1.8. |
| `thermalThrottle` | Rack `T >= 95 °F`; holds until `T < 90 °F`. | The rack's systems: clock × 0.5, core and clock `loadFactor` 0.5. |
| `powerCap` (supply switch on PSU and PDU) | See §9.5. | Clock × `capFactor`. |
| `ramWatts` (`lowVoltRam`) | Always. | RAM idle and load × 0.7. |
| `ecc` | ECC modules. | RAM idle and load × 1.1. |
| `vramScale` (`hbm`) | GPUs. | VRAM idle share × 0.5 only. Core idle and load watts stay unchanged. |
| `npuTensorOnly` | NPUs. | Tensor-only, zero GPU cores. Use the frozen NPU coefficient 0.125 and its own legacy power curve, independent of GPU models. |

A clock factor scales the core rate (§6.2). The **effective clock** is `clockHz × clockFactor`.

### 9.4 Overload and failure

Each supply has an overload timer `tOver`, in seconds:
- If `usage > 1.00`: `tOver += dt`. Otherwise `tOver = max(0, tOver − dt)`.
- If `tOver >= 10`: the supply **fails**:
  1. every system below it becomes `dark` and every part below it, infrastructure included, draws 0 W;
  2. every task queued or running there fails with `power`; transfers crossing its links or heading there return to the queue front;
  3. `tOver = 0` and a reboot timer of `bootSeconds` starts.
- When the reboot timer ends, the supply is back. Systems below it return to their §4.3 mode with no extra boot.

A failure reaches exactly the subtree under the failed supply: a system, a rack, a zone or a site.

**`upsRideThrough`.** When a grid feed fails, each zone whose UPS is generation 2 or newer keeps running on battery for up to 30 s. If the grid reboots within that time, the zone loses nothing. Otherwise the zone goes dark at 30 s. Battery time is billed as normal.

**`loadShed`.** While a UPS or grid feed has `tOver >= 5`, systems below it run no research, and once per second the rack below it with the lowest PDU usage is switched offline (§4.4).

### 9.5 Power capping

With `powerCap`, a board PSU or rack PDU can be set to cap (hot switch). It keeps `capFactor ∈ {0.1, 0.2, …, 1.0}`, saved in state, starting at 1.
- During the tick, every core clock below it is multiplied by its `capFactor` (and by its ancestors' factors).
- After the power step: `need` = its delivered watts recomputed with its cores' load at `capFactor = 1`. If `need > capacity`, step `capFactor` down by 0.1 for each 10% of excess, to at least 0.1; if `need <= 0.9 × capacity`, step it up by 0.1.
- A capped supply's `tOver` only counts ticks where its idle draw plus child supply inputs alone exceed capacity. Compute load never makes it fail.

### 9.6 Utility and regional prices

Each site bills at its region's energy price (§3.3). Parts fed from utility (global scheduler, backbone links) bill at the gateway's price. Before Global, everything bills at the home price.

### 9.7 What draws between rounds

Between rounds hardware is `paused` and draws nothing, unless research runs (§11.3). A paused unit costs nothing.

### 9.8 Ledger: payouts, Data and energy

Once per tick, at the ledger step, in this order:

```text
// 1. Credits from completed tasks (integers)
wallet += Σ over distinct payout values (count × payout)

// 2. Data, through a sub-unit meter (float64)
dataMeter += Σ over completed tasks, in family index order, (count × payout / dataRatio)
whole = floor(dataMeter);  data += whole;  dataMeter -= whole

// 3. Energy, through a sub-Credit meter (float64)
for each price region r in index order:
    // D31: rack batteries cover their PDU input first (§9.9); generation covers the site's grid input next (§9.10)
    energyMeter += (Σ top-level supply inputs and utility-fed parts billed at r, net of battery and generation) × dt × price_r
                 + Σ fromGen × dt × fuelPrice
energyMeter += Σ battery refills × 0.25 × marginal price      // Return-to-market tick only
whole = floor(energyMeter);  wallet -= whole;  energyMeter -= whole
```

- "Completed tasks" are tasks met this tick: a split task joins the sums once, with its full payout, in the tick its last shard completes (D25.5). Finished shards of unmet tasks add nothing.
- `whole` is an integral float64, converted to an integer `Amount` exactly (`BigInt(whole)`). Above 2^53 Credits per tick the meter's fraction is lost; that is harmless.
- The wallet changes only by whole Credits, so it never holds a fraction (program D2).
- The wallet may go negative only through energy debits. Purchases need `wallet >= price`. Research starts need `data >= cost` (§11.1).
- Round totals and the HUD's energy cost use the whole Credits debited.

### 9.9 Rack batteries (D31)

A rack's **Power control** unit (its fifth infrastructure slot, under the cooler) holds the rack's battery and its smart start (§4.4) as one part. Its generations are Lead-acid (gen 0, basic start), Li-ion (gen 1, adds the `busy` trigger and batch wake) and LFP (gen 2). Levels follow the flow curve: battery capacity ×2 per level and wake latency by level (§4.4). The empty slot is locked until `powerCtl` is researched; then it is bought from its add plate like any infrastructure part.
- **Discharge.** While the round runs and the rack is powered, the rack PDU's input for the tick (servers in any mode, cooler, switch, LB and losses) is drawn from the battery first: `fromBattery = min(batteryJ, pduInput × dt)`, `batteryJ −= fromBattery`. Only the rest is billed (§9.8). A battery adds no capacity: PDU usage, `tOver`, losses and heat are unchanged.
- **Battery time** shown on the rack plate and LCD: `batteryJ / pduInput` seconds at current draw, while discharging.
- **Recharge.** At Return to market (and auto-return) every battery refills to capacity, billed on that tick at `refillJ × 0.25 × the site's marginal price` (§9.10).
- **Size.** L1 capacity is 60 s of a fresh era rack at full draw **(s)**: about 10 min of an idle awake rack, so it covers boots, wakes and the D30 climb.
- A `standby` rack draws nothing and keeps its charge.

### 9.10 Off-grid generation (D31)

A site may hold a **Generation** part: Solar farm, Wind farm, Fuel cell, Own plant (generations 0–3, flow curve, output ×2 per level).
- Output `genW = baseW[g] × 2^(L−1) × factor`, where factor is the region's sun (solar), wind (wind) or 1. L1 base is 10% of the grid feed's generation-0 capacity **(s)**. Output is constant in time.
- Each tick, `fromGen = min(gridInput, genW)` is billed at the fuel price (0 for solar and wind, 0.4 × region price for fuel cells, 0.25 × for an own plant). Only `gridInput − fromGen` is imported at the region price. Generation adds no grid-feed capacity. Surplus is lost.
- **Marginal price** of a site: its fuel price while `genW > gridInput`, else the region price. It prices battery refills (§9.9), the `price` strategy (§8.3) and the global controller's `cheapest` order.
- Region factors (sun / wind): `us-east` 1.0 / 1.0, `us-west` 1.3 / 0.9, `eu-west` 0.8 / 1.2, `eu-north` 0.5 / 1.5, `sa-east` 1.3 / 0.8, `af-south` 1.5 / 1.0, `ap-southeast` 1.2 / 0.7, `ap-northeast` 0.9 / 1.0 **(s)**.

## 10. Heat

### 10.1 Scope

Before Rack there is no thermal model: the system sits in 70 °F air with `e = 1`. From Rack on, each rack is one thermal lump. From Room on, each zone is one thermal lump. Before Room, a rack sits in a fixed 70 °F room. There are no board, site or world lumps.

All lumps start at their surroundings' temperature and never go below the 50 °F floor.

### 10.2 Surroundings

- A rack's surroundings are its zone lump (70 °F before Room).
- A zone's surroundings are its site's outside air, `Tout` of the region (§3.3). Room cooling rejects heat to it (program D1.7).

### 10.3 Heat input

```text
Hrack = Σ over its systems (Σ actualW of their parts) / (η_cfg × e(Track))
      + Σ PSU losses (systems and storage nodes) + storage node part watts
      + PDU loss + switch W + load balancer W

Hzone = Σ over its racks (moved out of the rack this tick, §10.5)
      + Σ rack cooler W
      + network rack W + UPS loss(es)
```

Rack cooler watts heat the zone, not the rack. Room cooling watts go outside. Grid feed loss goes outside.

Lower configuration or thermal efficiency means more heat for the same electrical draw: a system at `η_cfg × e = 0.5` heats its rack twice as much as one at 1. The CPU/RAM hardware ratio `E` already affects electrical watts in §9.1. Do not apply that ratio again here. Heat is a game quantity; the bill still counts electrical watts once.

### 10.4 Efficiency e(T)

`e` uses the rack's temperature at the start of the tick.

| `T` (°F) | `e(T)` |
|---|---|
| `T <= 50` | 1.10 |
| `50 < T < 70` | `1 + 0.005 × (70 − T)` **(s)** |
| `70 <= T <= 80` | 1.00 |
| `T > 80` | `max(0.25, 1 − 0.025 × (T − 80))` **(s)**: 0.50 at 100 °F |

`e` multiplies every compute and GPU rate in the rack, together with each system's `η_cfg` (§6.2). RAM, storage and network rates are not affected.

### 10.5 Coolers and the lump equation

Each lump has one cooler: the rack cooler, or the zone's room cooling. A cooler has rated capacity `Qc` in W and duty `d ∈ [0, 1]`.

```text
Gc    = d × Qc / ΔT                        // cooler conductance, W/°F; ΔT = 20 (s)
Gp    = leak × Qc / ΔT                     // conductance to the surroundings
Tsup  = Tsurround − ΔT                     // cooler supply temperature
Teq   = (H + Gc × Tsup + Gp × Tsurround) / (Gc + Gp)
T'    = max(50, Teq + (T − Teq) × exp(−dt / τ))
moved = Gc × (T − Tsup) + Gp × (T − Tsurround)          // W leaving the lump into its surroundings
```

- `leak` is `rackLeak = 0.1` **(s)** for racks, × 0.6 with `hotColdAisle` and × 0.5 more with `containment` (`roomLeak`). For zones, `leak = zoneLeak = 0.1` **(s)**.
- `H`, `moved` and every `Tsurround` use start-of-tick temperatures. All lumps update together, so their order does not matter.
- **Settling.** If `|T' − Teq| < 0.05`, set `T' = Teq`. A settled lump with unchanged inputs changes nothing, which lets idle ticks be skipped (`docs/architecture.md` §1.1).
- **Room step cap.** A zone lump's step never passes the equilibrium it would reach with its racks' outflow counted. The cap only binds when the racks conduct far more than the room, and it prevents a numeric blow-up (`phys/thermal.ts` `lumpStep`).
- At `d = 1` and `H = Qc`, `Teq = Tsurround`:
 a cooler rated for the load holds the rack at room temperature. At twice the load's capacity it holds about 60 °F in a 70 °F room. That is over-cooling.
- When the rack is colder than its room, heat leaks in through `Gp` and the cooler must work harder.
- `τ` comes from the cooler's technology (Appendix A): rack air 60 s, rack water 6 s; room air 300 s, water 30 s, closed loop 30 s **(s)**. Water is 10× faster than air. An air-cooled rack keeps cooling down for minutes after its load stops.

**Duty.** A powered cooler runs at `d = 1` (program: full duty, no setpoint). With `rackSetpoint` (rack coolers, setpoint 55–80 °F) or `roomSetpoint` (room cooling, 55–80 °F), the player sets a setpoint `S` (default 70 °F) and the cooler runs at:

```text
d = clamp((H − Gp × (S − Tsurround)) / ((Qc / ΔT) × (S − Tsup)), 0, 1)
```

An unpowered cooler has `d = 0`.

**Cooler watts.** `idleW + loadW × d × lift(T)`, with `lift(T) = 1 + 0.03 × max(0, 70 − T)` **(s)**. Holding a lump below 70 °F costs more watts per watt removed.

**`economizer`.** While a zone's `T > Tout + 5`, its room cooling's watts are × 0.1.

Fan sprites spin at `d`. The rack cooler shows `Track` in °F.

### 10.6 Thermal runaway

`H` grows as `e` falls, so a rack whose heat outruns its cooler heats faster and faster. The cooler plate shows the margin: `H / Qc` and the current `Teq`. `thermalThrottle` (§9.3) is the researched safety net.

### 10.7 Crash

Each rack and zone has a crash timer `tHot`, in seconds:
- If `T >= 100`: `tHot += dt`. Otherwise `tHot = max(0, tHot − dt)`.
- If `tHot >= 10`: the lump **crashes**:
  1. every system in it becomes `crashed` and draws 0 W (for a zone: every system in every rack of the zone);
  2. every task queued or running there fails with `heat` (after live migration, §6.11); transfers heading there return to the queue front;
  3. `tHot = 0`; a recovery timer starts;
  4. infrastructure keeps running: coolers, switches, load balancers, supplies.
- It recovers at the first tick where at least `bootSeconds` have passed and `T < 90`. Systems return to their §4.3 mode.

## 11. Research mechanics

### 11.1 Projects

- `docs/research.md` lists projects. Each has a **Data cost** (whole Data), a `work` volume in compute ops, prerequisites, and effects (Appendix C). The research plate shows Data, work and any exact Credit fee. GPU generation 1 costs 0 Credits; generations 2 through 9 charge `16 * B(g)` Credits once at actual start, in addition to Data and running energy. Other nodes retain their existing fees. The accepted GPU ruling supersedes D3 only for these explicit fees.
- **Costs are paid when a project actually starts.** Require both Data and any `creditCost`, then debit them atomically once. Switching and resuming preserve progress and paid status and charge neither again. Cancellation refunds neither currency. Nothing else costs Data.
- One project is active. With the `researchQueue` ceiling the player may queue more, up to that many in total. Queuing reserves and debits neither currency. When the active project completes, the next queued project starts in the same tick only if both balances cover its costs. Otherwise it waits at the head with the missing Data/Credit reason and starts at the first eligible research step.
- Progress is float64 ops. It is kept across losses, rounds, switching and cancellation.
- Completion is checked at the research step (§14). Effects apply from the next tick.
- Research work is CPU compute only (D27). GPUs and NPUs do not research.

### 11.2 Research is a task that cuts the line (D27)

Starting a project, or the next queued project starting, puts the **research task** at the front of the market queue.

- **In line.** It is the head. It has no clock, and it can't time out, be dismissed or fail on the queue. Nothing behind it is taken while it waits, and the first task behind it has no clock either. Auto-skip leaves the line alone.
- **Taken.** At the route step (§14, step 4), before routing, every system with room takes it: a free slot by the usual rule (§6.4, one take per slot per tick) and at least one free hardware thread. Each holder keeps **one slot and one thread** during a round (a fine-grain divisible task, D25: one shard per system with room) until the project completes. It has no payload and no transfer, and it pays no Credits or Data. When it is taken, the next task becomes the head with a fresh 10 s.
- **Running.** A holder researches at `threadRate × clockFactor × η_cfg × threads held`, times its rack's e(T). Its threads count as busy for tasks and for power (§9.1), and a holder never sleeps.
- **Lost.** A holder that leaves `onMarket` or `paused` (dark, crashed, cold, offline, draining) lets go. When no holder is left, the task is back at the queue front with its progress kept.
- **Done.** When the project completes, every holder lets go, and the next queued project, if any and paid, enters the line.
- **One at a time.** Only one project is in line or running.

The trade-off is the point. Research during a round holds slots and threads, and the tasks behind it wait, so it costs SLA. The research modes (Background, Shared, Focus) and idle-time research are retired.

### 11.3 Between rounds

The market is paused, but research still runs. If a project is active and not stopped, every server in `paused` mode with a link takes it on all its threads, and holders spread over any threads that free up. Their infrastructure is powered (§9.1), heat and overload rules apply, and the energy is billed. Systems that are offline, or hold no research, draw nothing. At Return to market the holders keep their slot and threads, and tasks take the rest.

### 11.4 Insolvency

At the ledger step, if the wallet is negative after the energy debit, research **stops**: the project is kept but marked `stoppedInsolvent`, and from the next tick no system runs research. The wallet can go negative by at most one tick's bill this way. A stopped project resumes when the player resumes it with a non-negative wallet, or automatically at the next Return to market.

## 12. Parts and prices

### 12.1 Generations, levels and curves

Each part type has generations `g = 0, 1, …` and levels `L >= 1`. A generation becomes buyable when the research effect `gen: (part, g)` is complete; generation `g >= 1` of a part also needs its generation 0 (the research doc's rule 2). Levels inside a generation are never gated by research, only by the ceilings in §12.2. GPUs instead use the accepted model-ID and `upgrades=0..5` contract in §12.6. Generic adapters may derive `gen=g-1` and `level=upgrades+1`; those values are not the saved GPU build.

| Curve | Level factor `x(L)` | Level range | Primary capacity |
|---|---|---|---|
| `flow` | `2^(L−1)` | `1 … 11 + g` | `base[g] × x` |
| CPU `clock` | `1.5^(L−1)` | `1 … 36` for every generation | `clockBase[g] × x` Hz |
| RAM | capacity ladder below; bandwidth `1.5^(L−1)` | `1 … 36` for every generation, including ECC/registered | capacity base × ladder × registered factor; bandwidth base × bandwidth factor |
| `core` | `L` | `1 … 8 + 2g`, and `base[g] × L <= lanesPerCore` | `base[g] × L` lanes |
| `linear` | `L` | `1 … 8 + g` | `base[g] × L` |
| `fixed` | 1 | 1 | — |

RAM capacity factors by level are `[1, 2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 640, 768, 896, 1024, 1280, 1536, 1792, 2048, 3072]`. Its bandwidth has its own factor. Registered DIMM research multiplies ECC module capacity by 2 without changing bandwidth or level. This replaces `ramLevelBonus = 4`; no CPU/RAM upgrade extends beyond L36. `l3LevelBonus` still extends L3. Other secondary capacities follow their catalog curves. CPU/RAM no longer inherit the generic `flow` level or price formulas.

Old CPU/RAM hardware may run faster than later generations' native parts. Crossing a tier's native rate or becoming loss-making adds no purchase gate. Only L36 is the level ceiling. Show marginal payback and whole-part operating loss separately, and leave normally affordable/researched upgrades enabled through L35 → L36.

### 12.2 Ceilings

Ceilings come from research (Appendix C). Starting values:

| Ceiling | Start | Limits |
|---|---|---|
| `coreSites` | 1 | cores per CPU; at most 32 (program D7.2) |
| `lanesPerCore` | 1 | core level (§12.1) |
| `threadsPerCore` | 1 | hardware threads per core |
| `cpuSockets` | 1 | CPUs per system: 2 (`dualSocket`), then 4 (`quadSocket`) (program D7.3); an `accelerator` board allows at most 2 |
| `ramSlots` | 1 | RAM modules on a `general` board, at most 4; an `accelerator` board has 8 |
| `gpuSlots` | 1 | GPUs and NPUs on a `general` board, at most 2 (`dualGpu`); an `accelerator` board has 8 |
| `driveSlots` | 1 | drives |
| `rackPorts` | 4 | rack switch ports |
| `roomPorts` | 4 | room switch ports |
| `uplinks` | 1 | uplinks per switch |
| `roomRows` | 2 | rows per zone |
| `siteZones` | 2 | zones per site |
| `regions` | 1 | open regions |
| `researchQueue` | 1 | projects active plus queued |

`"archCap"` means the cap in `docs/architecture.md`.

### 12.3 Prices

```text
installPrice(g)        = ceil(price[g])
upgradePrice(g, L→L+1) = ceil(upgrade[g] × x(L)^1.2 × drive)
clock or RAM upgrade  = ceil(upgrade[g] × 1.7^(L−1) × drive)
```

- `x(L)^1.2` makes each generic flow level cost about 2.3× the last (program D5.6). Clock/RAM instead use 1.7× step prices against 1.5× throughput and declining efficiency, per the later CPU/RAM ruling. Their starting per-generation bases remain in A.1 pending campaign calibration.
- `drive` is the number of lanes on the CPU for a clock (an oscillator retunes every lane it drives), and 1 for every other part. CPU parts are then × CPU count (§12.3 Special prices).

- `price[g]` and `upgrade[g]` are per-generation values (Appendix A), calibrated to `scripts/market-model.ts`: a generation's L1→L2 upgrade costs about a quarter of the model's level bundle in that era (3 s of a boot chip's output; 15 s of a kHz system's; 90 s of an MHz system's; 240 s of a GHz system's), and installs track the model's rung costs.
- `ceil` rounds up to a whole Credit, in exact decimal arithmetic. All prices are whole Credits (program D2).

Every price below, after its multipliers, is rounded up with `ceil` to whole Credits.

Special prices:
- **Extra units.** A core, RAM module, GPU, NPU or drive bought when `n >= 1` of that kind are already in the system (per socket for cores) costs `installPrice × 1.25^(n − 1)` **(s)**; cores use 1.65 **(s)**, as in v2.
- **CPUs.** Every CPU action costs its single-CPU price × the system's CPU count (program D7.3). Adding a CPU costs a copy of CPU 1: its package, cores, clock and caches at their generations and levels, priced as in §13.3.
- **Accelerator board.** Installing it costs `acceleratorBoard` (A.4) on top of the parts.
- **ECC.** An ECC module costs 1.25 × the module price, upgrades included.
- **Upgrade all.** The RAM and drive plates raise every unit of the same generation one level; price is the sum. The GPU plate adds one hot upgrade to each eligible card below its five-upgrade cap and sums exact per-model prices.
- **Rows.** A zone's `n`th row costs `upgradePrice(row, L = n − 1)`.
- **Shells** (rack frame, storage node chassis, zone, site) have fixed prices and escalation (Appendix A.4).

### 12.4 Upgrade versus replace

- **Upgrade** keeps the generation and adds one level. It is hot.
- **Replace** installs the newest researched generation at level 1. It is cold (§4.5). The plate also offers a **capacity-preserving replace**: the lowest native level whose primary capacity is at least the current one, priced as install plus every intervening upgrade.
- **Replace CPU** on the System board replaces, in one cold change, every package, core, clock and cache of the system with the newest researched CPU generation: cores and caches at the lowest level that preserves their capacity (lanes, bits), the clock at L1. Its price is the sum.
- CPU and RAM quotes preview throughput, full-use electrical draw and normalized energy ratio. RAM replacement preserves capacity bits and shows bandwidth separately. Payback uses the change in net income at the same workload and tariff. If that change is non-positive, show **No payback at this load**. If the part's operating cost exceeds its output, separately show **Costs more to run than it produces**. Neither warning disables an upgrade. Fab research must be affordable on a profitable prior-era fleet before loss-making overclocks are needed. See `hardware-progression.md` §§5–6.
- A replacement that cannot hold what the part holds is not offered at that level; the plate names the shortfall.
- Within a generation, capacity grows as `x` while load watts grow as `x^1.3` (§9.1), so energy per unit of work rises as you push old parts. A native generation starts back at `push = 1` and opens a higher level ceiling. Replace wins over a horizon; upgrade wins short.

The part plate shows, for both options: price, capacity after, watts after at current utilization, energy cost change per minute, and payback `price / gain` when the net-income gain at current load is positive ("No payback at this load" otherwise).

### 12.5 Switches, data plane and backbone

Per port with index `k` in generation `g` with base `k0 = baseK[g]`:

```text
watts = §9.1 rate-part rule, with rate = speed(k) and native = speed(k0)

// D14 price parity: a step Y = speed(k) -> X = speed(k+1) on a link that carries m streams
x, y  = X / m, Y / m                                   // the per-stream speeds
c     = clamp(floor(log10(x) / 3), 0, 3)               // CPU clock generation whose native range holds x
b     = clockBase[c] = 1, 1e3, 1e6, 1e9 Hz
u     = clockUpgrade[c] = 3, 1.5e4, 9e7, 2.4e11        // A.1 clock `upgrade` by generation, per lane
α     = ln 1.7 / ln 1.5 ≈ 1.30869                      // clock price ×1.7 per ×1.5 speed
portStep(k→k+1) = ceil(m × u / 0.7 × ((x / b)^α − (y / b)^α))
```

- **Why this formula.** A native clock of generation `c` at level `L` runs at `b × 1.5^(L−1)`, and its step `L → L+1` costs `u × 1.7^(L−1)` (§12.3, one lane). Summing those steps from speed `y` to `x` gives exactly `u / 0.7 × ((x/b)^α − (y/b)^α)`. So a port step buys the same speed gain for the same Credits as native clock work at that frequency. There is no per-generation `portStep` constant.
- **Streams `m`.** A rack-switch server port and the lone system's port carry 1. A rack uplink and a room network-rack port carry a rack, `m = 12`. A room uplink, a data-plane port and a backbone link carry a room, `m = 288`. These are the D13 default-speed ratios. Pricing at the per-stream speed and multiplying by `m` makes a link cost what its `m` server ports would cost for the same per-stream gain.
- **Examples.** Lone system's port: 1 → 2 kHz costs 31,654; 2 → 5 kHz 123,006; 5 → 10 kHz 260,111. Reaching 10 kHz costs 415,000 in total, which matches the kHz clock work over the same span. 100 kHz costs 8.9e6 in total, 1 MHz 1.5e8 and 100 MHz 5.3e10. A gen 1 rack port step 5 → 10 GHz costs 4.2e12.
- `ceil` in exact decimal arithmetic, like every price (§12.3).

- **Per-port upgrades.** Each port and each uplink steps up independently, up to `topK[g]`, once its structure exists (§7.2, D15). A step is also offered by tapping the link in the world, as "x → x" with price and Buy (D15.4).
- **Same-speed toggle.** When on, the plate offers one action instead of per-port ones. Let `kmax` be the highest port index. If every port is at `kmax`, the target is `kmax + 1`; otherwise it is `kmax`. The action raises every port below the target to the target. Its price is the sum of all the per-port steps it performs. The toggle does not cover uplinks. A port bought while the toggle is on arrives at the common speed, priced with its steps.
- **Port count.** `ports` lies between `minPorts` and the ceiling (`rackPorts`, `roomPorts`). The `j`th port beyond `minPorts` costs `ceil(portAdd[g] × portAddGrowth^(j−1))`. A new port arrives at `baseK[g]`.
- **Uplinks.** Up to the `uplinks` ceiling. Extra uplinks cost like a port.
- **Install and replace.** `installPrice(g)` buys the switch with `minPorts` ports and one uplink at `baseK[g]`. Replacing keeps the port and uplink count (extra ports priced at the new generation) and sets each port to `clamp(k, baseK[g'], topK[g'])`.
- **Data plane.** One port per zone, created with the zone at no extra cost. All its ports share one index `k`. A step costs `portStep(k→k+1)` with `m = 288`, × zones. Latency belongs to the generation.
- **Backbone link.** One link from the gateway to one site, one index `k`, latency by generation. Each link is bought separately at `installPrice`.

### 12.6 GPU models and exact prices

`gpu-progression.md` is the accepted numeric catalog. Buy preconfigured GSMT model IDs, generations 1 through 9, series 3/5/7/9 and tiers 30/50/60/70/80/90. The nine clock classes are 1 kHz, 10 kHz, 100 kHz, 1 MHz, 10 MHz, 100 MHz, 1 GHz, 10 GHz and 100 GHz. Series emphasize cores, VRAM, clock and all specs respectively. Higher tiers improve every spec. `3350` is gen 3, core-heavy, tier 50, in the 100 kHz class.

Save `GpuBuild {kind:'gpu', model:GpuModelId, upgrades:number}` and validate through one central evaluator. No model objects or inferred model IDs enter saves. For `B(g)=4,000,000 * 10^(g-1)`, native price is `P=B(g) * seriesPrice * tierPrice`. Hot upgrades `u=0..5` multiply cores and VRAM by `2^u`, clock by `1.25^u` and ordinary rate by `2.5^u`. The next upgrade costs `ceil(P * 3^u / 10)` for `u<5`, with no install escalation. Calculate these amounts with integers and convert decimal strings to `Amount`.

Install escalation counts other GPUs only. With `n` other GPUs after removing a replacement target, charge `ceil(P * 5^e / 4^e)`, `e=max(0,n-1)`. NPU count does not affect it. Configuration copies pay native install plus all hot upgrades. Any model replacement is cold, including same-generation tier changes. Hot upgrades preserve work and holds; future rates change at the next tick boundary.

Series 9 costs more than the combined comparable 3/5/7-series cards, including the accepted successive-slot comparison. Native G990 is the strongest and most efficient native model in its generation. Hot pushes reduce efficiency and cap at five. Capacity-preserving replacement must preserve both GPU cores and VRAM and show clock, rate and watts separately. Do not assume a faster next-generation card satisfies an old core floor.

Next-generation research costs `160 * B(currentGen)` Credits, half the current G990 price `320 * B(currentGen)`, plus Data and work before buying any model. For gen 3, 3990 costs 128,000,000,000 Credits; gen-4 research costs 64,000,000,000, and research plus native 4960 costs 176,000,000,000, excluding energy. These local comparisons establish choices, not campaign balance.

Bump the save/catalog revision and reset old v3 GPU builds, configurations, accelerator research and pool state together. Do not migrate a model from old ops/s. Acceptance needs legal campaign and per-card performance evidence, delta invariance and all-card research/power accounting. CPU/RAM specialized integration remains outside this GPU wave.

### 12.7 Router queues (D25.7)

Every router (rack LB, room LB, data plane, global scheduler) has a queue level `L`, 1 to 32. Its queue holds `L` entries (§7.1). A level is a hot upgrade, one slot at a time, on the same 1→32 ladder as the CPU scheduler queue (D7.2). It is priced by D14 price parity with `y = L × b` and `x = (L + 1) × b` per stream:

```text
lbQueueStep(L → L+1) = ceil(m × u / 0.7 × ((L + 1)^α − L^α))     α = ln 1.7 / ln 1.5
```

| Router | Streams `m` | Era of the clock it is priced against (`b`, `u`) | L1→2 | L31→32 | 1 → 32 total |
|---|---:|---|---:|---:|---:|
| rack LB | 12 | kHz (1e3, 1.5e4) | 379,843 | 976,161 | 2.4e7 |
| room LB | 288 | MHz (1e6, 9e7) | 54,697,330,406 | 1.4e11 | 3.4e12 |
| data plane | 864 | GHz (1e9, 2.4e11) | 4.4e14 | 1.1e15 | 2.7e16 |
| global scheduler | 6,912 | GHz (1e9, 2.4e11) | 3.5e15 | 9.0e15 | 2.2e17 |

- **Why this formula.** Each slot is priced like raising every stream the router carries by one unit of its era's base clock (1 kHz at Rack, 1 MHz at Room, 1 GHz at Global). So a slot costs about what the clock work it buffers would cost, and its price grows gently with `L`, like the CPU queue. The first rack slot is about a sixth of the LB itself (2.4e6); the first room slot about half the room LB (9.5e10).
- It is bought by tapping the load balancer in its rack or room slot (the upgrade callout, "Queue L → L+1", D15.4), on the LB plate, or on the network rack. The data plane and global scheduler are upgraded on their plates. It is never research-gated: the structure that has the router is the gate.
- `ceil` in exact decimal arithmetic, like every price (§12.3). A configuration stores the level (§13.1) and prices every step up to it.

## 13. Configurations

### 13.1 What a configuration stores

A configuration is a named, serializable description of a unit. It never stores runtime state: tasks, temperatures, timers, utilization, transitions, research, counters.

| Kind | Stores |
|---|---|
| system | board type; CPU count; for CPU 1 (copied to all): package g; cores (g, L each); clock (g, L); L1, L2, L3 (g, L) or none. Scheduler (g, L, strategy) or none. RAM modules (g, L, ECC). GPUs (kind, model ID, upgrades); legacy NPUs (kind, gen, level). Drives (g, L). PSU (g, L, cap switch). DVFS, turbo and C-state settings. Online switch. |
| storage node | drives (g, L); PSU (g, L) |
| rack | cooler (g, L, setpoint); power control (g, L, start settings: start with, wake trigger, order; D31) or none; PDU (g, L, cap switch); load balancer (g, L, strategy, filters, queue level `L` 1–32); switch (g, ports with `k` each, uplinks with `k` each, toggle); a system or storage-node configuration per occupied server slot; online switch |
| zone | rows; room switch (as rack switch); room load balancer (as rack); room cooling (g, L, setpoint); UPS(s) (g, L, room start controller and settings, D31); a rack configuration per occupied slot; online switch |
| site | data plane (g, `k`, strategy, filters, queue level); grid feed (g, L); a zone configuration per zone; online switch |

### 13.2 Add-new plate

Tapping an empty server slot, the next free rack slot, the Zone item or the Site item opens the add-new plate. Options:

1. **Barebones** (always available).
   - Accelerator system (with `accelSystem`): as a general barebones system on the `accelerator` board, with one CPU.
   - System, at any CPU tier `g` whose chip generation is researched: one socket with package g, one core g at L1, clock g L1, L1 g L1, and a PSU: the newest researched PSU generation at the lowest level whose capacity covers the system's full-load watts (its top level if none does). No scheduler, RAM, GPU or storage.
   - Storage node (with `sharedStorage`): chassis, one drive of the newest researched generation at L1, PSU as above.
   - Rack: frame; cooler gen 0 L1; PDU gen 0 L1; load balancer gen 0 L1 on `firstFit` with a 1-slot queue; switch gen 0 with 4 ports and 1 uplink at 1 kHz. No servers.
   - Zone: shell; network rack with room switch gen 0 (4 ports, 1 uplink, base speed) and room load balancer gen 0 L1 on `firstFit` with a 1-slot queue; 2 rows; room cooling gen 0 L1; UPS gen 0 L1. No racks.
   - Site: shell; data plane gen 0 at base speed on `firstFit`; grid feed gen 0 L1; one barebones zone. Placed at a free map location in an open region.
2. **Copy** a sibling: a system or storage node in this rack, a rack in this zone, a zone in this site, a site in the world.
3. **Saved** (with `configSave`): any saved configuration of that kind.

### 13.3 Pricing and locks

- A configuration's price is the price of building it from nothing: every part's `installPrice` plus every upgrade to its level, extra-unit multipliers, ECC, ports, port steps, uplinks, rows and shells with their escalation. Nested configurations add their own prices.
- The plate shows the total before the player confirms. Buying needs `wallet >= price`.
- A configuration is **locked** if any generation, strategy, filter or rule in it is not researched, or it exceeds a ceiling. The plate shows it greyed with the first missing item by name, for example "Needs Rack water".
- It is also locked if it does not fit the target: more servers than slots, more racks than free rack slots, more zones than the `siteZones` ceiling allows.

### 13.4 Loading onto an existing unit

With `configSave`, the save icon's plate can apply a saved configuration of the same kind to an existing unit. Part by part:
- same generation, lower or equal level: upgrade to the configured level, paying only the missing levels (hot);
- same generation, higher level: keep it (no downgrade, no charge);
- different generation, or missing: install it (cold);
- present but not in the configuration: remove it (cold).

Settings (strategies, filters, toggles, setpoints) are applied for free. Port speeds never step down. The change is cold if any part is installed or removed, otherwise hot. The price is shown before confirming.

### 13.5 Saving and names

- With `configSave`, each system, storage node, rack, zone and site shows a small save icon. Tapping it prompts for a name.
- Names: 1–24 characters after trimming, unique per kind, compared case-insensitively. Saving under an existing name asks to overwrite.
- Up to 32 saved configurations per kind **(s)**, kept in the save file.
- Saved names appear only in add-new and apply plates, never in the world.

## 14. Tick order

### 14.1 Steps

Every tick runs these steps in this order. "Now" is the tick index `t`.

| # | Step (architecture phase) | What happens |
|---|---|---|
| 1 | Timers (`timers`) | Advance `bootSeconds` transitions, drains, reboots, crash recoveries, C-state, S3 and wake timers, and the auto-return countdown (§4.6) by `dt`. Apply those that end: boots, wakes, colds and reboots return systems to their §4.3 mode; offline transitions finish; drains that finished last tick start their transition; crash recoveries whose conditions hold; auto-return fires Return to market. |
| 2 | Market (`market`) | Round `running` only. Advance `I` by round age (`docs/tasks.md` §3.1). No arrivals: the queue's window is already full, because every task that leaves it is replaced in the same step (§5.2). |
| 3 | Transfers (`links`) | Every link sends for `dt` (§7.4). Transfers that finish a link join the next link's queue at the end of the step; transfers that finish their last link arrive. The pre-Rack pipe is not here; it runs inside Execution. |
| 4 | Routing (`route`) | From Rack on: shard stealing, then dispatch every router queue top-down, then take heads while §7.6 allows (split now or into the top router queue). Each take promotes the next head (`headTick = t`) and draws one replacement at the back of the window. New transfers are served from the next tick. |
| 5 | Admission (`admit`) | Arrived transfers are delivered (§7.5), by system index, then arrival. Misroutes fail here. |
| 6 | Execution (`run`) | §6.7 for every system in index order: before Rack, head pulls and pipe transfers; then stages, shard completions, chaining and research ops (§11.2, §11.3). Each pull promotes and draws as in step 4. A task whose last shard completes is met and adds its full `W` to `deliveredWork` (D25.5). |
| 7 | Deadlines (`deadlines`) | The head only. If this is tick `headTick + 99` and it is still untaken, it fails once: `cantRun` if it can't run on the fleet (§6.3), `timeout` otherwise. The next task becomes the head with `headTick = t + 1`, and one replacement is drawn. Every checkpoint replacement past its deadline fails its task. Then every taken task whose completion window ends this tick (`takeTick + deadline − 1`) and that is not met fails once as `late` (D26.5); its shards and router-queue shares are aborted. |
| 8 | Power (`power`) | §9.1–§9.5, bottom up: draws, usage, losses, overload timers, failures and their lost tasks, ride-through, load shedding, cap factors for the next tick. |
| 9 | Heat (`thermal`) | §10.3–§10.7: heat inputs, duties, cooler watts for the next tick, every lump's new temperature from start-of-tick values, crash timers, crashes and their lost tasks, throttle state for the next tick. |
| 10 | Ledger (`ledger`) | §9.8: Credits, Data, energy debit. Then insolvency (§11.4). |
| 11 | SLA (`round`) | Recompute SLA. If `running` and `SLA < 0.80`, end the round (§4.1) and freeze the report. |
| 12 | Research (`research`) | Add this tick's research ops to the project; complete it; start the next queued project if Data covers it (§11.1). |
| 13 | Windows (`events`) | HUD windows (§16.1), feed outcomes, event ring. |

A unit that fails or crashes in tick `t` is billed for tick `t` and draws nothing from tick `t + 1`. The power step uses cooler watts and duties from the previous tick's heat step. The heat step uses this tick's power losses.

**Player actions** apply between ticks, in submission order, at the next tick boundary. Actions never run inside a tick.

### 14.2 Determinism

- Systems, links, supplies and lumps are processed in index order wherever order matters.
- No step reads a value computed by a later step of the same tick, except the "previous tick" values named above.
- Snapshots, quotes and saves are observations. They never change state or draw RNG.

### 14.3 RNG

All randomness goes through `src/game/core/rng.ts` with its state threaded explicitly.
- **Round preparation** draws the round seed once at initialization or the previous round's end. Seed the private `rng.ts` generator and freeze per-family round jitters in catalog order, as described in `docs/tasks.md` §3.5. It then draws the first five tasks. Return and auto-return start that prepared queue without drawing.
- **Queue draws.** Each task that leaves the window (taken, failed or dismissed) causes exactly one draw at the back: a family, then a size, at the current `I`, from the saved generator. Draws happen in the order tasks leave: routing step, then execution in system index order, then the deadline step, then player actions in submission order. No view, save or snapshot draws.
- No other domain draws. Ties use index and ID. Save/load continues the stored window and RNG words without regeneration. The draw sequence depends on how fast hardware takes tasks; it is still deterministic for a given state and tick partition.

### 14.4 Amount versus float64

| Integer `Amount` | float64 | Integer (safe) |
|---|---|---|
| wallet, Data, prices, payouts, research Data costs, round and offline totals, per-tick energy debits | work, `deliveredWork`, `failedWork`, `G`, rates, payload, workingSet, capacities, watts, joules, energy and Data meters, energy prices, `dataRatio`, temperatures, timers, utilization, intensity, research progress, factors, port speeds | ticks, task IDs, `met`, `failed`, `dismissed`, `headTick`, counts of cores, ports, slots, members, shards, router-queue levels and entries, levels, generations, ladder indices; size, grain and shard units; stage work (whole ops and bits) |

## 15. Offline progress

- When the player returns after an absence, the platform worker runs the real `advanceGame` for the elapsed time, capped at `offlineCapHours`: 8 h, raised by research to 12 h (`offline12`, before Rack), 24 h (`offline24`, Rack) and 48 h (`offline48`, Room) (program D1.10, D19.3). The 48 h cap needs the offline-catch-up budget re-measured at Room-era fleets.
- Offline time plays out as foreground time would with no player input: the current round runs to its end; auto-return, if researched and on, starts new rounds; between rounds the active project runs, is billed, and stops on insolvency.
- No purchases or setting changes happen offline.
- At the largest fleet a 24 h catch-up may take about 100 s in the worker, behind a progress display (program D4.8). The binding budget stays a 2 h round in 10 s or less.

- The return report shows credited time, rounds completed, met, failed by cause, gross payouts, Data earned, energy cost, net, and research completed.
- Saves store the full state including `pendingMs`. A save made mid-absence resumes the same catch-up without renewing the cap.

## 16. Interface contract

The mockups decide the look. This section lists only the data each surface needs from the sim, through `RenderSnapshot` and plate selectors. Every light and animation is driven by one of these values at its real rate.

### 16.1 HUD

| Field | Source |
|---|---|
| Credits | wallet, whole Credits, larger than body text |
| Data | data balance, whole Data, larger than body text |
| Net per minute | (payouts − energy debits) over the trailing 60 s (or since load, if shorter), scaled to a minute, whole Credits |
| SLA | §4.2, one decimal |
| Round state | `running` / `ended` / `between`, round number, elapsed time |
| Auto-return | seconds left while counting |
| Research | project name, progress fraction, mode, `stoppedInsolvent`, missing Data/Credit reason |

### 16.2 Feed

| Field | Notes |
|---|---|
| Window | The queue's first five entries, head first (§5.2): stable IDs, names, numerical work (ops), size, grain, minimum split and requirements, transfer time at the current first-link speed, `committed`/dismissible status and any missing requirement on current hardware. Unsupported tasks show without telemetry. Between rounds the next round's five show as "after Return". |
| Head clock | The head's real seconds left (`headTick + 100` ticks, minus now). Only the head has one. A blocked head shows its missing requirement. |
| In transfer | Each transfer's task ID, shard index and shard count, link, bits sent and bits total, so the pipe can draw the task moving at its real speed. Each level snapshot carries its own links' transfers (§16.4). |
| Counts | in transfer, queued, running, held in router queues; taken, met and dismissed this round |
| Recent outcomes | the last 16 met and failed tasks, each failure with its cause |
| Live counters (`telemetry`) | failures this round by cause |
| Market | `I`; measured takes per second over the trailing 10 s. No authored arrival rate exists. |

### 16.3 Plates

The core tray offers only physical `Add core`. Selecting a core shows facts and task details, without generic upgrade/replace controls. Clock and cache controls belong to the CPU. Keep existing backend lane research. Reuse `selectContextualResearchTree` for contextual research and preserve `selectResearchTree` for GPU model lookup. Desktop and CPU prototypes do not select a production layout.

- **Part:** name, generation, level, capacities, idle/load/actual watts, utilization, hot or cold label per action, upgrade price, replace price, capacity-preserving replace, payback (§12.4), locked reasons.
- **GPU:** model ID, upgrades, VRAM, cores, actual clock, effective rate, perf/W, per-card duty and reservation. Task GPU requirements show only cores and VRAM. Upgrade/replacement quotes show both capacities, clock, rate, actual system watts and exact price. Controls keep stable geometry.
- **Supply:** delivered W, capacity, usage, loss W, `m`, `tOver` (once nonzero), cap switch and `capFactor`.
- **Cooler:** `T`, `Teq`, `H / Qc`, duty, setpoint, watts, `tHot`, throttle state.
- **Switch:** ports with `k`, speed and busy flag; uplinks; toggle; port count; prices per port and for the toggle action.
- **Power control** (D31): battery charge and time at current draw; Start with `n` of 12, wake trigger, order; upgrade and replace. The room UPS plate and the global scheduler plate carry the same Start row for racks and sites.
- **Load balancer:** strategy, filters, available options, queue level `L/32` with its entries (family, units, whether a whole task or a share), the next queue step "Queue L → L+1" with price and Buy (§12.7), takes per second, misroutes this round. No placements and no reserve switch (D25).
- **Port** (opened from the CPU view's pipe): speed, transfer in progress, share of time the cores waited on it. Before Rack: the fixed 1 kHz and "Upgrade at the Rack switch" (D15). From Rack on: next step price and Buy, as "x → x" (D15.4).
- **Network rack:** the room switch and room load balancer, as above.
- **Configuration:** the options of §13.2 with total price and locked reason; the save-name prompt.
- **Research:** project name, Data cost, optional exact Credit fee, work volume, progress, effective research rate (ops/s), mode, queue with missing Data/Credit reasons, paid status and locked reasons.
- **Round report:** §4.7.


### 16.4 World

| Level | Data per element |
|---|---|
| CPU | Exactly four parts (program D7.1): clock, cache (one block, total bits; L1, L2, L3 on its plate), scheduler, cores. Per core: lanes, busy fraction this tick, the shard on each thread (task ID, shard index, family, progress fraction, and how many threads that shard holds, so cores running one shard draw as one group), research share, C-state. Effective clock. Cache bits used / capacity per level, and the running shards' bits that spilled past cache (D26.7). Scheduler: queue entries, reserved count, running count, `K`, `Q`, strategy. Empty core sites up to `coreSites`. The inbound pipe (D10.4) is the incoming connector, not a fifth part: its speed, the task in transfer with bits sent / total, and whether the core is waiting on it. Tapping it opens the port plate (§16.3): before Rack the fixed 1 kHz and "Upgrade at the Rack switch"; from Rack on, the next step as "x → x". |
| System | Board type, CPU count, `η_cfg`. The memory tiers filling (D26.7): cache, RAM and disk capacity, used bits, spilled bits (bits that didn't fit a faster tier) and rate. The shard arriving on the system's port and each running shard (task ID, shard index of count, units, threads held, GPU domain), so a shard is drawn splitting between the CPU and the GPU card. PSU usage, `tOver`, loss W. RAM used / capacity and bandwidth use per module. Per-card GPU/NPU duty, VRAM holds and assigned tasks; GPU model ID, upgrades, cores, clock and effective rate. Drive IO use and holds. Mode. |
| Rack | Power control (under the cooler): battery charge, battery time at current draw, awake count of total, next wake. Per server slot: mode, busy fraction, admitted and reserved shard counts. Every shard transfer on the uplinks and ports (task ID, shard index of count, target slot, bits sent of total), so a task is drawn arriving on the uplink and fanning out to the servers. LB queue entries.
 Per port and uplink: busy flag and speed. Load balancer routes per second. Cooler `T` and duty. PDU usage and `tOver`. `tHot`. |
| Room | Per rack: `T`, mode, PDU usage. Shard transfers on the zone link and rack uplinks, as for Rack. Room LB queue entries. Network rack ports busy. Room cooling duty; zone `T`. UPS usage and `tOver`. `tHot`. |
| Global | Per site: region, zones, modes, hottest `T`, grid usage. Shard transfers on the data planes and backbone. Data plane and global scheduler queue entries. Backbone links busy and speed. Global scheduler routes per second. |

**Where data sits** (D26.7). Each running shard reports its placement (bits in cache, RAM, disk) and the tier of its current `mem` part, and each taken task its window ticks left.

**Completion pops** (D25.5). A payout pop appears only when a task is met, at the system, core or GPU card that ran its last shard, with the full task payout. A finished non-final shard frees its slot visibly but shows no payout.

A `dark` or `crashed` unit is visibly dark or broken. A `boot`, `goingOffline` or `cold` unit shows its seconds left; an `asleep` one shows it is asleep.

## 17. Removed from v2

Do not port these:

- Research Credit fees; research borrowing a single core; Data from every fifth delivery; Data per bit of reward.
- Board cooling and per-part hotspots; the 25 °C ambient; throttle-then-fault isolation; self-test recovery.
- The numeric policy `anchor-f64-v2`: anchors, 10^-21 s tick grids, analytic full-queue overflow, cached numeric quotes, the 2^-1074 J energy meter.
- The continuous demand law, batches, the 256-result service window, priority deadlines, research-licensed families, commissioned routes.
- Buffers, the package backplane, the server chassis part, ToR/spine/gateway/vault parts, row banks and feeders, CRAC row pairs.
- Kits, the free-parent rule, site hall permits.
- Economy mode, operating escrow, research reserve.
- Cache bandwidth: cache is a capacity gate only.
- Rebuild, Silicon, Reflow, architecture perks.

## Appendix A: parts catalog

**D16 re-price.** Before Rack, income is capped by the 1 kHz pipe at about 700 Credits/s (D15), so the path to Rack is priced to that cap:
- SDRAM 3e5; DDR 4.5e5.
- A full kHz CPU (package, core, clock, L1, L2, L3, scheduler) costs 2e6. A barebones kHz server (package, core, clock, L1) costs 5e5.

After Rack, each part's install price is scaled by the ratio of the model's re-fitted rung price to its old one, using the rung that first buys that part:
- Rack infrastructure and shells: 1/85 (`Rack, 12 servers`).
- MHz fab parts: 1/7.
- Room infrastructure, shells and rows: 1/21.
- GHz fab parts: 1/27.
- Data center parts and the zone shell: 1/9.
- Regions parts and the site shell: 1/11.

Rounding keeps every part's price increasing with generation. Upgrade prices, RAM from DDR2 on, GPU, storage, NPU, PSU and the accelerator board keep their values. The values below include the re-price.

All prices and capacities are **(s)**. They are calibrated to `scripts/market-model.ts` (program D5.6): capacities at L1 follow the model's fleet ladder per era, upgrades follow its level bundle, and installs follow its rung costs. Gates are research node IDs from `docs/research.md` §4.1; IDs marked † are new nodes this spec needs (Appendix D). Generations map to eras: Hz (boot to System), kHz (`fabKhz`, Rack), MHz (`fabMhz`, Room), GHz (`fabGhz`, Data center, Regions).

GPU catalog numbers below follow the accepted binding GPU ruling, rather than the earlier era-based starting values. GPU model clocks and generations have their own nine-step ladder.

### A.1 CPU and system

Rate parts draw by §9.1 with the `wPerUnit` listed; "idle" is for non-rate parts only.

| ID | Generations | Gates | Curve | `base` by g | Secondary by g | Watts | `price` by g | `upgrade` by g |
|---|---|---|---|---|---|---|---|---|
| `cpu` | Hz, kHz, MHz, GHz package | start, `fabKhz`, `fabMhz`, `fabGhz` | fixed | — | — | idle 0.1, 100, 1e5, 1e8 | 500, 5e4, 2.1e8, 9.3e10 | — |
| `core` | Hz, kHz, MHz, GHz core | start, `fabKhz`, `fabMhz`, `fabGhz` | core | lanes 1, 2, 4, 8 | — | hardware energy ratio §9.1; native 10, 6, 3, 2 | 6000, 1.25e5, 4.3e8, 1.9e11 | 10, 1.2e5, 1.5e9, 7.7e12 |
| `clock` | Hz, kHz, MHz, GHz oscillator | start, `fabKhz`, `fabMhz`, `fabGhz` | clock, 1.5×; L1–36 every generation | Hz 1, 1e3, 1e6, 1e9 | — | idle 0.1, 100, 1e5, 1e8 (core carries the load) | 20, 2e5, 8.6e8, 3.7e11 | 3, 1.5e4, 9e7, 2.4e11 per lane driven; 1.7× per level |
| `l1` | L1 by tier | start, `fabKhz`, `fabMhz`, `fabGhz` | flow | bits 1, 1024, 2^20, 2^30 | — | idle 0.1, 100, 1e5, 1e8 | 20, 1.25e5, 4.3e8, 1.9e11 | 3, 1.2e5, 1.5e9, 7.7e12 |
| `l2` | L2 by tier | `l2Cache`, `fabKhz`, `fabMhz`, `fabGhz` | flow | bits 8, 8192, 2^23, 2^33 | — | idle 2 × `l1` | 4e4, 5e5, 8.6e8, 3.7e11 | 12, 1.2e5, 1.5e9, 7.7e12 |
| `l3` | L3 by tier; gen 4 Stacked L3 | `l3Cache`, `fabKhz`, `fabMhz`, `fabGhz`, `stacked3d` | flow (+`l3LevelBonus`) | bits 64, 65536, 2^26, 2^36, 2^39 (gen 4: 8× gen 3) | — | idle 6 × `l1` (gen 4: gen 3 watts) | 2e5, 7e5, 1.7e9, 7.4e11, 4e13 | 12, 1.2e5, 1.5e9, 7.7e12, 7.7e12 |
| `scheduler` | Run queue, Multilevel, Work queue, Cluster runtime | `fifoSched`, `fabKhz`, `fabMhz`, `fabGhz` | linear, L 1–8 for every g | `K` 1, 2, 3, 4 (≤ 32) | `Q` 2, 4, 4, 4 (≤ 32, program D7.2) | idle 0.1, 100, 1e5, 1e8 | 1000, 3e5, 4.3e8, 1.9e11 | 100, 1.2e5, 1.5e9, 7.7e12 |
| `ram` | SDRAM, DDR, DDR2, DDR3, DDR4, DDR5 (per module) | `memController`, `ddr`, `ddr2`, `ddr3`, `ddr4`, `ddr5` | RAM ladder §12.1; bandwidth 1.5×; L1–36, registered ECC capacity ×2 | bits 64, 128, 2^20, 2^30, 2^32, 2^38 | bit/s 16, 32, 3.2e4, 6.4e7, 2.56e8, 1.28e11 | hardware energy ratio §9.1; native 10, 10, 6, 3, 3, 2 | 3e5, 4.5e5, 5e6, 3e10, 5e10, 5e13 | 12, 12, 1.2e5, 1.5e9, 1.5e9, 7.7e12; 1.7× per level |
| `gpu` | 216 GSMT models, displayed generations 1..9 | `gpuGen1` through `gpuGen9` | model + 0..5 hot upgrades | cores × actual clock | model VRAM × hot upgrades × `vramMult` | model coefficient and split idle, §9.1 | exact catalog price, §12.6 | `ceil(P * 3^u / 10)` |
| `npu` | Four explicit legacy rows, g0..3 | `npu`; plus `gpuGen2` / `tensorCores` / `matrixGpu` for g1/2/3 | flow, L1..11+g | ops/s 32, 64000, 128000000, 256000000000 | VRAM bits 64, 524288, 1073741824, 549755813888, × `vramMult` | 0.125 W per op/s, legacy curve | 3000000, 7500000, 45000000000, 75000000000000 | 12, 120000, 1500000000, 7700000000000 |
| `storage` | HDD, SSD, NVMe, SCM (per drive): the disk tier (D26) | `storageCtl`, `ssd`, `nvme`, `scm` | flow | bits 2048, 2^24, 2^34, 2^44 | IO bit/s 1, 2,000, 1.6e7, 6.4e10 (D26.2 re-base; were 16, 3.2e4, 6.4e7, 1.28e11) | drive 1 W per bit/s | 2e6, 5e6, 3e10, 5e13 | 12, 1.2e5, 1.5e9, 7.7e12 |
| `psu` | Bench, 80 Plus, Bronze, Gold, Platinum, Titanium | `systemBoard`, `psu80`, `psuBronze`, `psuGold`, `psuPlatinum`, `psuTitanium` | flow | W 256, 1024, 1e5, 4e5, 2e8, 4e11 | — | supply (loss only) | 1000, 1e5, 1e6, 3e6, 1e10, 1e13 | 12, 12, 1.2e5, 1.2e5, 1.5e9, 7.7e12 |

- GPU tensor technology grants factor 4 to displayed generations 4+ with `tensorCores`, or factor 8 to generations 6+ with `matrixGpu`, replacing 4. NPU tensor factors are its own fixed 1, 1, 4, 8. No new NPU generations or GPU parity follow from the nine-model-generation ladder.
- `vramMult` is a total multiplier on GPU and legacy NPU capacity: 1 initially, 4 with `gddr6`, 16 with `hbm`. HBM replaces 4; it never compounds to 64. The retained `vramPerLevel` rule ID sets this total despite its legacy name. VRAM has no separate track.
- The model's per-system capacity at each era's L1: Hz quad chip 16 ops/s; kHz 3.2e4; MHz 6.4e7; GHz 1.28e11 (4 cores at the research doc's lane ceilings). Cache, RAM, GPU and storage bases match the model's rungs.
- **Pipe pricing** (D13, D14, D15). There is no `pipe` part. The lone system's pipe is its rack-switch port (A.3, gen 0), fixed at 1 kHz until the Rack. Then it steps on the rack switch at the §12.5 parity price with `m = 1`: reaching 10 kHz costs about 415,000 Credits, the same as kHz-tier clock work over that span.

### A.2 Rack, room, site and global

| ID | Generations (tech) | Gates | Curve | `base` by g | Watts | `price` by g | `upgrade` by g |
|---|---|---|---|---|---|---|---|
| `rackCooler` | Fan tray (air), High-flow air (air), Rear-door water (water), Direct-to-chip water (water) | `rack`, `rackAir2`†, `rackWater`, `rackWater2`† | flow | `Qc` W 5e5, 5e6, 5e9, 5e12 | `wpw` 0.01, 0.008, 0.004, 0.003 (D19) | 2.4e6, 1.2e7, 4.3e11, 3.7e14 | 1.5e6, 1.5e6, 1.8e10, 9e13 |
| `powerCtl` (D31, rack slot under the cooler) | Lead-acid, Li-ion, LFP | `powerCtl`, `powerCtlLiIon`, `powerCtlLfp` | flow | battery J: 60 s of a fresh era rack at full draw **(s)**; wake latency 2 → 0.25 s by L1–5 | idle 0.01 × a PDU's | `≈ 40 × capacityJ × home price` **(s)** | flow |
| `pdu` | Basic, Metered, Switched | `rack`, `meteredPdu`, `switchedPdu` | flow | W 1e6, 1.6e7, 1e11 | supply | 2.4e6, 1.2e7, 1.4e11 | 1.5e6, 1.5e6, 1.8e10 |
| `lb` (rack) | Basic (one generation, D18.3) | `rack` | fixed; queue level 1–32 (§12.7) | no routing capacity (D12.5) | idle 160 | 2.4e6 | — |
| `lb` (room) | Room basic (one generation, D18.3) | `room` | fixed; queue level 1–32 (§12.7) | no routing capacity (D12.5) | idle 2560 | 9.5e10 | — |
| `row` | Row | `room` | linear, L = rows ≤ `roomRows` | 8 rack slots per row | idle 1e4 | — | 2.4e11 |
| `roomCooler` | CRAC (air), High-flow CRAC (air), Chilled water (water), High-delta chilled water (water), Closed loop (closedLoop), Two-phase closed loop (closedLoop) | `room`, `roomAir2`†, `chilledWater`, `chilledWater2`†, `closedLoop`, `closedLoop2`† | flow | `Qc` W 2e10, 2e11, 2e12, 2e14, 2e15, 2e16 | `wpw` 2e-5, 1.6e-5, 8e-6, 6e-6, 4e-6, 3e-6 (D19) | 9.5e10, 3.8e11, 7.1e11, 1.1e15, 6.7e15, 1.8e16 | 7e10, 7e10, 7e10, 3.7e14, 3.7e14, 1.5e15 |
| `ups` | Standby, Online, Lithium | `room`, `upsOnline`, `upsLithium` | flow | W 5e10, 2e11, 1e14 | supply | 9.5e10, 2.9e11, 6.7e15 | 7e10, 7e10, 3.7e14 |
| `grid` | Utility feed, Substation, HV intake | `dataCenter`, `substation`, `hvIntake` | flow | W 1e15, 8e15, 6.4e16 | supply | 3.3e14, 1.1e15, 9.1e15 | 1.5e15, 1.5e15, 1.5e15 |
| `globalScheduler` | Global scheduler | `regions` | flow | `R` tasks/s 4096 | routing 10 W per task/s | granted free | 1e15 |

Supplies have no idle or load watts. Their only draw is their loss (§9.2).

| ID | `loss` by g | `lossPerLevel` |
|---|---|---|
| `psu` | 0.30, 0.20, 0.15, 0.10, 0.07, 0.04 | 0.01 |
| `pdu` | 0.04, 0.03, 0.02 | 0.005 |
| `ups` | 0.12, 0.06, 0.03 | 0.005 |
| `grid` | 0.05, 0.03, 0.02 | 0.002 |

Cooler `τ` (s) by generation: `rackCooler` 60, 60, 6, 6; `roomCooler` 300, 300, 30, 30, 30, 30 **(s)**.

Supply/cooler bases above predate the CPU/RAM energy-ratio revision and are starting values, not verified coverage. Re-size against native and pushed fleets using §9.1, including supply loss, cooling and utilization. CPU/RAM draw no longer follows a common 2.5× step. The balance acceptance checks are in `hardware-progression.md` §6.

### A.3 Ladder parts

Links draw by the D18.5 rule, not the rate-part rule: at speed S, full-use watts are `wPerUnit × 1e3 × (S / 1e3)^0.3` with `wPerUnit` = 0.01, and idle is 10% of that. A 1 kHz pipe draws 10 W at full use, a 10 GHz rack uplink idles at 126 W, and a 5e19 bit/s data-plane port idles near 1e5 W. Faster links move each bit for far less energy, so links stay a small share of the servers they feed even where the re-based speeds run ahead of server traffic. Watts depend on the port's speed, not its generation. Before Rack the pipe draws 0.01 W per bit it sends.

The re-based catalog (D12.2, D13; `src/game/build/catalog/network.ts`). Names give each generation's top speed. Port-step prices follow the §12.5 parity formula with the streams `m` shown. Install prices and port additions are placeholders for the balance pass.

| ID | Generations (top) | Gates | `baseK` = default, by g | `topK` by g | Streams `m` | Latency by g (s) | `price` (install) by g | `portAdd` by g / growth |
|---|---|---|---|---|---|---|---|---|
| `switch` (rack) | 500 GHz, 5 THz, 2 PHz, 20 PHz, 5 EHz, 50 EHz, 500 EHz | `rack`, `sw100k`, `sw1M`, `sw10M`, `sw100M`, `sw1G`, `sw10G` | 0, 20, 28, 31, 38, 41, 44 | 26, 29, 37, 40, 47, 50, 53 | ports 1; uplinks 12 | 0 | 2.4e6, 1.2e7, 4.3e11, 4.8e11, 3.7e14, 3.3e15, 9.1e15 | 2.4e5, 1.2e6, 4.3e10, 4.8e10, 3.7e13, 3.3e14, 9.1e14 / 1.25 |
| `roomSwitch` (network rack) | 50 PHz, 500 PHz, 5 EHz, 50 EHz, 500 EHz, 5 ZHz, 50 ZHz | same as rack | 21, 24, 32, 35, 42, 45, 48 | 41, 44, 47, 50, 53, 56, 59 | ports 12; uplinks 288 | 0 | 9.5e10, 9.5e10, 1.4e11, 4.8e11, 3.7e14, 3.3e15, 9.1e15 | 4.8e9, 4.8e9, 4.8e9, 1.4e10, 1.1e13, 1.1e14, 2.7e14 / 1.1 |
| `dataPlane` | Copper, Fiber, DWDM | `dataCenter`, `dpFiber`, `dpDwdm` | 50, 53, 56 | 59, 62, 65 | 288, × zones | 0.2, 0.1, 0.05 | 3.3e14, 1.1e15, 3.3e15 | — |
| `backbone` | Leased line, Dark fiber, DWDM, Subsea | `regions`, `bbDarkFiber`, `bbDwdm`, `bbSubsea` | 53, 56, 59, 59 | 62, 65, 68, 68 | 288 | 0.4, 0.2, 0.1, 0.1 (Subsea between continents × 0.5) | 9.1e15, 2.7e16, 9.1e16, 2.7e17 | — |

**Re-base (D10, applied by D12.2).** The old A.3 speeds were sized for a payload of `2^-14` bits per unit of size. Under D10 a task's payload is its work, so links must carry roughly what the systems below them compute:

| Era | Per-system compute (model, L1 to max) | Per-port need | Old gen top | Old gap |
|---|---|---|---|---|
| kHz, Rack | 3e4 – 3e7 ops/s | 50 kHz – 50 MHz | 10 kHz – 100 kHz | ×5 – ×500 |
| MHz, Rack/Room | 6e7 – 6e10 ops/s | 100 MHz – 100 GHz | 1 – 10 MHz | ×100 – ×10^4 |
| GHz, Global | 1e11 – 3e13 ops/s | 200 GHz – 50 THz | 1 – 10 GHz | ×100 – ×10^4 |

Uplinks need about 12× a port, room uplinks about 288× (24 racks × 12). Proposed rule for the catalog owner: a native link generation's top carries its era's native server at L36, and its base is 1/1,000 of that. Keep the starter rack's ports at 1 kHz (program §6) by giving gen 0 a 10^6 span, 1 kHz – 1 GHz. The table above applies it. `scripts/market-model.ts` still assumes ports keep pace from Rack on. The old "link wall near `I ≈ 53`" no longer holds.

**Default port speeds (D13).** A port's default is its generation's base speed `speed(baseK)`. Defaults follow the re-base above: a rack-switch generation's reference is its top / 1,000 (gen 0 keeps the user's 1 kHz default for system ports). Room network-rack defaults carry about 12 of those rack ports: `ladderUp(12 × rack reference)`. Data plane and backbone defaults carry a full room, 24 room ports: `ladderUp(24 × room default)`. They pair with the room-switch generation of their era. Each column is non-decreasing, and each tier is at least the one below it.

| Gen | Rack switch: default port (reference) | Room network rack: default port | Data plane: default | Backbone: default |
|---|---|---|---|---|
| 0 | 1 kHz, `k 0` (reference 500 MHz) | 10 GHz, `k 21` | 50 EHz, `k 50` (opens with room gen 5) | 500 EHz, `k 53` (opens with room gen 6) |
| 1 | 5 GHz, `k 20` | 100 GHz, `k 24` | 500 EHz, `k 53` | 5 ZHz, `k 56` |
| 2 | 2 THz, `k 28` | 50 THz, `k 32` | 5 ZHz, `k 56` | 50 ZHz, `k 59` |
| 3 | 20 THz, `k 31` | 500 THz, `k 35` | — | 50 ZHz, `k 59` (Subsea: latency only) |
| 4 | 5 PHz, `k 38` | 100 PHz, `k 42` | — | — |
| 5 | 50 PHz, `k 41` | 1 EHz, `k 45` | — | — |
| 6 | 500 PHz, `k 44` | 10 EHz, `k 48` | — | — |

`ladderUp(x)` is the lowest 1-2-5 rung at or above `x`. Rack-switch tops stay as re-based; data plane and backbone tops are their default + 9 rungs (×1,000).

### A.4 Shells

| Shell | Price **(s)** | Escalation per existing unit |
|---|---|---|
| Rack frame | 2.4e6 | none |
| Storage node chassis | 5e6 | none |
| `acceleratorBoard` (accelerator system board) | 3e12 | none |
| Zone shell | 3.3e14 | × 2 per zone already in the site |
| Site shell | 4.5e15 | × 4 per site already in the world |

Free containers (§3.2) cost nothing and do not count toward escalation.

### A.5 TypeScript shape

The generic-row sketch below predates the CPU/RAM revision. Runtime integration must add explicit clock/RAM curve metadata and hardware-ratio power rules through the contract owner. Do not route these rows through the sketch's generic `flow`, `levelMax` or `upgradePrice` helpers. Their authoritative formulas are §§9.1, 12.1 and 12.3, detailed in `hardware-progression.md`. GPU contracts are owned by the GPU progression workstream.

```ts
type Curve = 'flow' | 'core' | 'linear' | 'fixed';
type CoolTech = 'air' | 'water' | 'closedLoop';
type PartScope = 'chip' | 'system' | 'rack' | 'room' | 'site' | 'global';
type WattsRule =
  | { kind: 'rate'; wPerUnit: number }           // §9.1 rate parts
  | { kind: 'idle'; idle: number[] }             // per generation, × x^0.25
  | { kind: 'cooler'; wpw: number[] }
  | { kind: 'supply'; loss: number[]; lossPerLevel: number };

interface PartRow {
  id: PartId; scope: PartScope; names: string[]; gates: string[];
  curve: Curve; levelMax?: number;
  base: number[]; base2?: number[];              // per generation, at L1
  watts: WattsRule;
  price: number[]; upgrade: number[];           // whole Credits, per generation
  upgradeDrive?: 'lanes';                        // clock: × lanes on the socket
  tech?: CoolTech[]; tau?: number[];             // coolers
  tensorFactor?: number[];                       // legacy NPU; GPU models use their evaluator
}

interface LadderRow {
  id: 'switch' | 'roomSwitch' | 'dataPlane' | 'backbone'; scope: PartScope; names: string[]; gates: string[];
  baseK: number[]; topK: number[]; latency: number[];
  minPorts: number; portCeiling?: 'rackPorts' | 'roomPorts';
  wPerUnit: number;                              // 0.01 W per bit/s at 1 kHz; D18.5 rule (A.3)
  price: number[]; streams: number; uplinkStreams?: number;
  portAdd?: number[]; portAddGrowth?: number;
}

const levelFactor = (c: Curve, L: number) => (c === 'flow' ? 2 ** (L - 1) : c === 'fixed' ? 1 : L);
const levelMax = (r: PartRow, g: number, bonus = 0) =>
  r.levelMax ?? (r.curve === 'flow' ? 11 + g : r.curve === 'core' ? 8 + 2 * g : r.curve === 'linear' ? 8 + g : 1) + bonus;
const ladderSpeed = (k: number) => [1, 2, 5][k % 3]! * 10 ** (3 + Math.floor(k / 3));
const upgradePrice = (r: PartRow, g: number, L: number, lanes = 1) =>
  Math.ceil(r.upgrade[g]! * levelFactor(r.curve, L) ** 1.2 * (r.upgradeDrive === 'lanes' ? lanes : 1)); // compute in exact decimal in the sim
```

## Appendix B: constants

**(s)** marks a starting value.

| Constant | Value |
|---|---|
| `tickMs` | 100 **(s)** |
| `headSeconds` | 10: the head must be taken by the end of tick `headTick + 99` |
| `bootSeconds` (online and offline transitions, mid-round add, cold change, supply reboot, crash minimum) | 10 at base; lowered by `fastBoot` (5 s, then 2 s) |
| `slaThreshold` | 0.80 |
| `slaGrace` (G) | 10 × the largest of the five opening tasks' work **(s)** |
| `overloadFailSeconds` | 10 |
| `supplyMultiplier` | 1 at usage ≤ 0.90; 1.5 at ≤ 1.00; 3 above |
| `crashTempF`, `crashSeconds`, `recoverTempF` | 100, 10, 90 |
| `floorTempF` | 50 |
| `homeToutF` | 70 |
| `eff` curve | flat 70–80 °F; +0.005/°F below 70 to 1.10 at 50; −0.025/°F above 80, floor 0.25 **(s)** |
| `coolerDeltaF` (ΔT) | 20 **(s)** |
| `rackLeak`, `zoneLeak` | 0.1, 0.1 **(s)** |
| `liftPerF` | 0.03 **(s)** |
| `tau` rack air / water | 60 / 6 s **(s)** |
| `tau` room air / water / closed loop | 300 / 30 / 30 s **(s)** |
| `setpointRangeF`, `setpointDefaultF` | 55–80, 70 |
| `economizerMarginF`, `economizerWattsFactor` | 5, 0.1 |
| `energyPrice` | per region (§3.3); home 0.010 Credits/J **(s)**, float64 |
| `creditsPerWorkUnit` | 1 (program D2) |
| `wPerUnit` | GPU model coefficient in §9.1; legacy NPU 0.125; drive 1 (W per unit/s); links 0.01 at 1 kHz under the D18.5 rule **(s)**; CPU/RAM use their hardware energy ratios |
| `idleShare` | 0.1 **(s)** |
| `pushWattsExponent` | 0.3 (load watts grow as `x^1.3`) |
| `priceLevelExponent` | 1.2 (about ×2.3 per flow level, program D5.6) |
| `queueVisible` | 5: the window, head first (§5.2) |
| `takesPerSlotPerTick` | 1 (§6.4) |
| Lone system's port | rack-switch gen 0 default, 1 kHz (`k = 0`), fixed until Rack (D15) |
| Port-step parity (§12.5) | `clockBase` 1, 1e3, 1e6, 1e9; `clockUpgrade` 3, 1.5e4, 9e7, 2.4e11; α = ln 1.7 / ln 1.5; streams `m` 1 / 12 / 288 |
| `firstLinkRoomTicks` | 1 tick of capacity (D25.7 deleted the 10 s queued-take bound) |
| `maxShards` | 256 shards per task (D25.1; the architecture's members cap) |
| `routerQueueLevels` | 1 at base, at most 32 (§12.7) |
| `gatherShare`, `gatherWaitSeconds` | 0.5, 10 (§7.6) |
| `checkpointWindowSeconds` | 10 (§7.8) |
| `dataRatio` | 10 to 100 Credits per Data, per family (`docs/tasks.md`) |
| `smtShare` | 0.6 |
| `socketSpanRamFactor` | 0.5 |
| `cStates` (factor / after / wake) | C1 0.5 / 0 / 0; C3 0.15 / 1 / 0.2; C6 0.02 / 1 / 1 s |
| `packageIdleFactor` | 0.2 |
| `s3` (after / factor / wake) | 10 s / 0.03 / 2 s |
| `dvfs` (clock / load) | 0.5 / 0.3 |
| `turbo` (clock / load / max usage / max °F) | 1.25 / 1.8 / 0.90 / 80 |
| `throttle` (at / until / clock / load) | 95 / 90 / 0.5 / 0.5 |
| `powerCapStep`, `powerCapMin` | 0.1, 0.1 |
| `loadShedAtSeconds` | 5 |
| `upsRideThroughSeconds` | 30 |
| `mlfqAgingSeconds` | 3 |
| `cutThroughPerHopSeconds` | 0.001 |
| `ioConcurrency` | 1; 4 with `ncq` |
| Cache-tier traffic cost | 0 s: cache serves at core speed (D26.2) |
| Drive IO at L1 (D26.2) | HDD 1, SSD 2,000, NVMe 1.6e7, SCM 6.4e10 bit/s: 1/16, 1/16, 1/4 and 1/2 of their era's RAM bandwidth **(s)** |
| Completion windows (D26.5) | `rackDist` 120 s, `roomDist` 180 s, `multiAz` 240 s, `region` 120 s, Exchange Feed 60 s, × size jitter **(s)** |
| `eccPriceFactor`, `eccWattsFactor` | 1.25, 1.1 |
| `lowVoltRamFactor` | 0.7 |
| `extraUnitGrowth`, `extraCoreGrowth` | 1.25, 1.65 **(s)** |
| `autoReturnDelaySeconds` | 120; 15 with `cronTuning` |
| `offlineCapHours` | 8; then 12, 24 and 48 by research (D1.10, D19.3) |
| `roundReportsKept` | 20 **(s)** |
| `recentOutcomes` | 16 **(s)** |
| `hudNetWindowSeconds` | 60 |
| `configNameMax`, `savedConfigsPerKind` | 24, 32 **(s)** |

## Appendix C: research effect contract

The research doc's effect union (§9 there) is the contract. This table says what each effect does in this spec.

```ts
type ResearchEffect =
  | { kind: 'gen'; part: PartId; gen: number }
  | { kind: 'ceiling'; key: CeilingId; value: number | 'archCap' | 'all' }
  | { kind: 'strategy'; scope: Scope; id: StrategyId }
  | { kind: 'filter'; scope: Scope; id: FilterId }
  | { kind: 'view'; level: ZoomLevel }
  | { kind: 'rule'; id: RuleId; params?: Readonly<Record<string, number>> };
```

| Effect | Meaning here |
|---|---|
| `gen (part, g)` | Generation `g` of the part becomes buyable (§12.1). `gen (vram, g)` sets `vramMult` (A.1). `gen (zone, 0)`, `gen (site, 0)`, `gen (row, 0)` allow buying zones, sites and rows. |
| `ceiling` | Sets the named ceiling (§12.2). |
| `strategy`, `filter` | Makes the option selectable on routers of that scope (`net` = every network scope opened), §8. System strategies need a scheduler. D25 removed the `placement` effect. |
| `view` | Opens a zoom level and grants its free container (§3.2). |

| Rule ID | Section | Rule ID | Section |
|---|---|---|---|
| `workStealing` | §6.5 | `qos` | §7.4 |
| `numaAware` | §6.5 | `numaAware` | informational |
| `smt` | §6.2, §6.5 | `linkScale` | informational; values are in A.3 |
| `socketSpanPenalty` | §6.6 | `subseaLatency` | §7.2 |
| `dma` | §6.5 | `coreIdle` | §9.3 |
| `prefetch` | §6.6 | `packageIdle` | §9.3 |
| `multiChannel` | §6.2 | `s3Sleep` | §9.3 |
| `ecc` | §6.3, §9.3, §12.3 | `dvfs` | §9.3 |
| `hotPages` (was `virtualMemory`) | §6.6 | `turbo` | §9.3 |
| `unifiedMemory` | §6.3, §6.5, §6.6 | | |
| `tensorRate` | §6.2, A.1 | `powerCap` | §9.5 |
| `gpuLink` | §6.2 | `loadShed` | §9.4 |
| `npuTensorOnly` | §6.3, §9.3 | `lossFraction`, `supplyCapacity` | informational; values are in A.2 |
| `vramScale` | §9.3 | `dualFeed` | §9.2 |
| `ramWatts` | §9.3 | `upsRideThrough` | §9.4 |
| `registeredCapacity` | §12.1: `rdimm`, ECC module capacity ×2; no added levels | | |
| `ncq` | §6.2, §6.6 | `thermalThrottle` | §9.3 |
| `sharedStorage` | §6.10 | `rackSetpoint`, `roomSetpoint` | §10.5 |
| `gather` | §7.6, §8.5 | `rackWater` | informational; values are in A.2 |
| `shardSteal`, `stealRoom` | §7.6, §8.5 | | |
| `cutThrough` | §7.4 | `roomLeak` | §10.5 |
| `economizer` | §10.5 | `telemetry` | prerequisite only; live counters in the feed (§16.2) |
| `autoReturn` | §4.6 | `gracefulDrain` | §4.4, §4.5 |
| `bootSeconds` | §4.5, §9.4, §10.7 | `configSave` | §13 |
| `rollingUpgrade` | §4.5 | `hotPlug` | §4.5 |
| `liveMigration` | §6.11 | `hotSwap` | §4.5 |
| `checkpointing` | §7.8 (any lost shard) | | |

## Appendix D: alignment with `docs/research.md`

Points where this spec differs from the research doc, and what the research doc should change:

| Topic | Research doc | Spec | Action |
|---|---|---|---|
| Cooling generations (program D1.11) | Rack: Air `rack`, Water `rackWater` (gen 1). Room: 3 generations. | Rack: 2 air + 2 water generations; `rackWater` is gen 2. Room: 2 air, 2 water, 2 closed loop. | Add nodes `rackAir2`, `rackWater2`, `roomAir2`, `chilledWater2`, `closedLoop2`; renumber `rackWater` to gen 2, `closedLoop` to gen 4. |
| GPU progression and VRAM | Nine `gpuGen` nodes; separate tensor technology and total VRAM multipliers. | Accepted GSMT catalog, core/VRAM gates and runtime domains, §§6, 12.6. | Regenerate tree and fees from the research appendix; no separate VRAM part. |
| `fastBoot` (D1.8) | One step, 10 s → 5 s, pending approval. | One `bootSeconds` for transitions, adds, cold changes, reboots and crash minimum; 10 → 5 → 2 s. | Mark approved; add a second node for 2 s. |
| Base router (D1.5) | Base is round robin, blind to state and full queues. | Base is `firstFit` at every scope; it already skips full, booting, crashed and offline units. | Add a `roundRobin` strategy node. Update the "Base behavior" table. `lbHealth` and `binPacking` keep the research doc's definitions (D4.4); §8.3 and §8.4 follow them. |
| Offline cap (D1.10, D19.3) | Fixed at 8 h. | 8 → 12 → 24 → 48 h by research (`offline12`, `offline24`, `offline48`). | Add two nodes with an `offlineCap` rule (suggest `cronTuning` and `researchQueue` as hosts, as the research doc proposed). |
| `lbCapability` | Checks "threads". | `threads` is gone (D25.3); the grain is never a gate (§6.3). | Done under D25. |
| `rackSetpoint` range | 55–80 °F | 55–80 °F, also used for `roomSetpoint` | none |
| `price` strategy | none | Allowed by D1.7, defined in §8.3 | Add a node if wanted. |
| CPUs and boards (D7) | Renamed nodes: `accelSystem`, `lbAffinity`, `quadSocket`; `octaChannel` requires `accelSystem`; `quadGpu` and `gpuBaseboard` removed | up to 2 (`dualSocket`), then up to 4 (`quadSocket`) CPUs per general system; at most 4 RAM and 2 GPUs on a general board; 8 RAM (`octaChannel`) and 8 GPUs only on the `accelerator` board (`accelSystem`); cores per CPU ≤ 32 | Aligned. `stacked3d` is stacked L3 (L3 gen 4, A.1), not cores. |
| Research cost (D3) |
 Work volume only. | Data cost paid at start, plus work volume (§11.1). | Add a whole-Data cost to every node. |
| Architecture caps | "architecture cap" placeholders | Rows 3, zones 3, room ports 24, sites 8; `regions` opens 4 regions, `intercontinental` all 8 (§3.3) | Cite the numbers. |

| Gateway | "Backbone scheduler: round robin over sites" | Tasks enter at the gateway site; other sites are reached over their backbone link (§7.2). | none |
| Network speed (D10, D15) | `netSpeed` removed. | Link steps open with the structure they plug into (§7.2). | Regenerate the tree (163 nodes). |
| `lbReserve`, `sjf`, `mlfq` (D10) | Effects name the feed and pickup deadlines. | Queue-only ordering; aging (§8.1). `lbReserve` became `shardSteal` under D25. | Done. |
| Gang placements (D25) | `gangRack`, `gangRoom`, `zoneAware`, `globalGang` grant placements. | Minimum split is base (§7.8); split rules and the `local` filter (§8.4, §8.5). | Done: `splitGather`, `stealRoom`, `zoneAware` → `local`, `globalGang` deleted (161 nodes). |

## Appendix E: alignment with `docs/tasks.md`

The tasks doc's §10 mismatches and how this spec resolves them:

| # | Mismatch | Resolution |
|---|---|---|
| 1 | Earlier warm-up needed hardware-dependent market inputs. | Superseded by D10: an endless queue pulled by hardware, with round-age difficulty (§5.2). No input controls demand. |
| 2 | Level prices grew `x^0.75` (×1.68 per level) while income grows ×2. | Level prices now grow `x^1.2`, about ×2.3 per flow level (§12.3, D5.6). Prices are per-generation arrays calibrated to the model. |
| 3 | HDD IO of 4 bit/s made `storage` 4–8× heavier than modeled. | HDD IO base is 16 bit/s, the model's value (A.1). |
| 4 | Research work tiers W4–W7 vs real throughput. | Research owner (D5.6). The spec's capacities now match the model's ladder, which the research owner can size against. |
| 5 | `fifoSched` lands a queue inside round 1. | Research and balance timing (W1 size). The spec keeps the model's FIFO `Q = 2` at L1. |
| 6 | Opening Data ratios 12 and 15. | Accepted; the tasks doc owns `dataRatio`. |
| 7 | ECC from Rack only. | Accepted; no pre-Rack family needs ECC. |
| 8 | `replWrite` in `rackDist`. | Accepted; band codes are the tasks doc's. |
| 9 | Multi-region families can't be expressed. | Kept: one `region` per task (§5.1). |
| 10 | Per-family round jitters need draws beyond the one round seed. | Prepare once with a private generator seeded by the round seed (§14.3). Return anchors the prepared plan without drawing again. |
| 11 | Earlier distributed sampling deferred arrivals with a carry. | Superseded by D10. A distributed task is one queue entry and pays once (§5.2). |
| 12 | D10 makes payload equal work. | `payloadPerUnit` is retired; `payloadBits` is derived (§5.1). The A.3 link catalog needs a re-base (A.3 note). |

Where the spec differs from the model's assumptions (`scripts/market-model.ts`), for the balance owner:
- **Levels are per part.** CPU clocks and RAM bandwidth grow 1.5× per level, while RAM capacity follows its own ladder. A player who levels only the clock gains on compute stages only.
- **CPU/RAM energy grows in importance by era.** Native energy ratios are 10, 6, 3 and 2, with declining efficiency per level. Supporting power, cooling, utilization and tariffs determine live net income. The prior 1%/8% calibration is superseded for these parts. The model's campaign pacing must be re-proved against the new clocks and watts.
- **Routing, misroutes, power and heat** are not modeled. The network is modeled as the pre-Rack pipe only; from Rack on the model assumes ports keep pace (A.3 re-base).
- **Fleets are heterogeneous** and research costs Data plus energy, where the model folds research into rung costs.
