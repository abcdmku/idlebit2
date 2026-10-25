# Decisions

> **Ship note, 25 Oct 2026 (D17).** The game shipped as idlebit2 in a fresh repository. The v3 trees were hoisted one level (`src/game/v3/x` is now `src/game/x`, `scripts/v3/x` is now `scripts/x`, `/v3.html` is now `/`), and the v2 code, the mockups, the archived docs and the pre-ship briefs were removed. The v3 docs lost their prefix: `v3-program.md` is `decisions.md`, `v3-architecture.md` is `architecture.md`, `v3-tasks.md` is `tasks.md`, `v3-research.md` is `research.md`. Mentions below of removed files (`docs/mockups/`, `docs/archive/`, `docs/v2-*`, the v3 briefs, v2 code) are historical; those files remain in the BitRouge repository.

Lead: the v3 orchestrator, 24 October 2026. Every v3 agent reads this file first, then `AGENTS.md`, then `docs/v2-program.md` sections 1, 2 and 7. The user's verbatim requirements are in Appendix A.

The decisions below are binding. If one is wrong, contradicts the user's text, or blocks you, say so in your report under **Objections**. Do not work around it. Where this file gives a number as a "starting value", the balance owner may tune it with probe evidence; every other number is fixed.

## 1. What stays from v2

- **The pixel world is the interface.** The v2 mockup in `docs/mockups/v2/` sets the quality bar. No website patterns: no card stacks, tab bars, nav bars or list pages. Semantic zoom runs Chip → System → Rack → Room → Global, with tap to drill in.
- **Every light and animation is real state at its real rate** (`docs/v2-program.md` §7). That covers the new parts too: switch port LEDs are real transfers, the SLA meter is the real SLA, feed countdowns are real deadlines, and cooler fans spin at real duty.
- **Upgrade or replace is the core decision.** Levels within a generation are cheap but lose perf-per-watt. Native next-generation parts cost more and are efficient. Research gates every new part and generation.
- **Start simple and slow, then gain speed and complexity.** Choices come often early.
- **Concise copy, stable geometry, phone 390×780 first.**
- **Project rules** (`AGENTS.md`): the sim stays pure in `src/game`; `advanceGame` is delta-invariant including RNG; currencies are `Amount`; randomness goes through `rng.ts`; timing comes from hardware rates; `npm run verify` stays green at every handoff.

## 2. What v3 removes

- The continuous "no game over" campaign. Rounds replace it.
- (Superseded by D3: **Data stays** as the second currency, earned from tasks and spent on research.)
- Board cooling. Nothing on a system board cools; cooling starts at the rack.
- The v2 exact-anchor numeric policy (`anchor-f64-v2`, analytic overflow, cached numeric quotes). The v3 sim is fast by construction (§13).
- Rebuild, Silicon, Reflow and architecture perks remain cut.

## 3. The round loop

The player's infrastructure serves a global **market** of tasks in **rounds**.

1. **Return to market** starts a round. SLA resets to 100%, the market curve restarts using the next round already prepared at round end, and every online unit starts accepting tasks.
2. During a round, tasks arrive, systems run them, and completed tasks pay Credits. The player can buy, upgrade, research and reconfigure while the round runs.
3. The market ramps up (§4). Sooner or later the infrastructure can't keep up, tasks fail, and SLA falls.
4. **When SLA falls below 80%, the round ends at once.** Queued and in-progress tasks are dropped without counting. Every system pauses. Paused hardware draws no power and costs nothing.
5. **Between rounds** the player builds, upgrades, replaces, researches (§9) and saves configurations. Nothing is lost: infrastructure and Credits carry over.
6. **Return to market** is all-or-nothing: every online unit rejoins together. Units the player has taken offline stay out.

**SLA.**
- SLA counts tasks: `SLA = (met + 10) / (met + failed + 10)`. The 10 is a grace prior (a starting value), so one early failure can't end a round.
- SLA covers the whole round, is global across all infrastructure, and is shown to one decimal.
- A task is **met** when it completes. It **fails** when:
  - its pickup deadline expires while no eligible fleet configuration can run it;
  - it is routed to a system that can't run it;
  - it isn't picked up within 10 s (§5);
  - its in-progress work is lost to a power failure, a thermal crash, a part swap or an offline toggle;
  - for a distributed task, any member is lost.
- The feed and the round report name the cause of each failure, so the player can always answer "why did SLA drop?".

**Online and offline.**
- Every system, rack, room and site has an online switch. Offline means off the market. An offline unit can still run research (§9). With no research running, it is powered down.
- While a round runs, any online/offline change takes 10 s (Fast boot research shortens it). Between rounds it is instant.
- Adding a unit mid-round boots it for 10 s before it accepts tasks.

**Hot and cold changes.**
- A level upgrade is hot: it applies instantly with no downtime.
- A cold change takes the unit offline for 10 s and loses its in-progress work. Cold changes are replacing a part with a new generation, adding or removing a part, and loading a configuration onto an existing system.
- This makes replacements mostly a between-rounds decision. A late "hot swap" research removes the downtime for server replacements at Rack and above.
- There are no refunds. A replaced or removed part is scrapped.

**Idle play.** A paused round costs nothing, so an absent player never loses Credits. Mid-game research adds **auto-return**: rejoin the market N seconds after a round ends. Offline progress plays the current round to its end, then whatever auto-return and research allow, up to an 8 h cap.

## 4. Tasks and the market

**Feed.** Exactly one logical task arrives every 2 seconds while a round runs. Five saved future tasks show their frozen IDs, names, numerical work and requirements, and scheduled arrival times. The first five arrive at +2, +4, +6, +8 and +10 seconds. Future tasks have no active pickup countdown. Arrived, unpicked tasks wait in a separate global pending feed, visible at every zoom level, with a 10-second pickup window. Unsupported tasks stay pending and can become eligible after a purchase. Whole-fleet-impossible work stays pending rather than being routed to a guaranteed failure. At its deadline it fails once as `cantRun` if still unsupported, otherwise `timeout`. Existing routing research and misroutes remain.

**Task shape.** Each task is an instance of a family template:

| Field | Meaning |
|---|---|
| `family` | Realistic workload name: parity check, CRC32, integer sort, regex match, JSON parse, SQL query, image thumbnail, video transcode, ML inference, training shard, MapReduce, replicated write, LLM training, and so on. |
| `stages` | Ordered stages of `{resource, work}`: compute ops, RAM stream bits, GPU ops, storage IO bits. Duration at constant rates is `sum(work/rate)`, as in v2. |
| `threads` | The most cores the task can use. Early families are single-threaded. |
| `workingSet` | Bits that must fit in cache, or in RAM once RAM exists. This is a hard gate. |
| `gates` | Other hard gates: VRAM, storage capacity, a minimum scheduler or LB capability. |
| `payloadBits` | Bits transferred over each network hop to reach the system (§6). |
| `members` | Systems needed at once. 1 for ordinary tasks. Distributed tasks need N, each meeting a per-member spec. |
| `zones` / `region` | Late families need members in at least 2 availability zones, or a site in a named region. |
| `payout` | Authored exact Credits. Hardware, routing and service never multiply it. |

**Curve.**
- The market has an **intensity** `I` that rises during a round. Task size, requirements and the family mix are functions of `I`; arrivals remain one task every 2 seconds.
- Families enter and leave the mix at authored intensity windows, so the round moves from 1-bit CPU operations, through RAM, GPU and storage work, to distributed, multi-AZ and region-locked work.
- Every round follows the same curve. Variation comes from the round seed: family weights jitter, sizes jitter by up to about ±20%, and each scheduled task freezes its family and size when generated.
- `I` follows the existing base ramp with running round age only. Hardware, idle time, utilization, SLA and feed occupancy never accelerate difficulty or throttle arrivals. No hardware warm-up, Poisson gaps, bursts or arrival caps apply.
- Late tasks pay far more than early ones. Surviving longer is how a round earns.

A player may dismiss future or uncommitted pending work for free. Future dismissal marks the existing slot until its due time; pending dismissal removes the record. Neither changes cadence, SLA, Credits or Data. Already committed work remains non-dismissible after requeue. Round end prepares the next five tasks once while paused; Return and auto-return anchor those same IDs and descriptors without regenerating them. The schedule, RNG and commitment flags are saved. Bump the save version and reset old pre-live saves; the implementation owner chooses the exact version.

The task designer owns the family catalog and the curve constants in `docs/tasks.md`.

## 5. Running tasks: systems and schedulers

**Start state:**
- one CPU with one core at 1 Hz;
- 1 bit of cache;
- no scheduler, no RAM, no GPU, no storage.

**Pickup.**
- A task is picked up when a system admits it: it starts on a core, or it enters that system's scheduler queue.
- A task that isn't picked up within 10 s of arriving fails.
- Network transfer before admission counts against the 10 s.

**With no scheduler**, a system runs one task at a time. When it completes a task, it immediately takes the next one: the oldest waiting task it can run.

**System scheduler** (a chip part, gated by research):
- It gives the system a queue of Q admitted tasks and up to K concurrent tasks.
- A queued task has been picked up, so it no longer has a deadline.
- When a running task completes, the next queued task starts immediately.
- Each running task uses at most `threads` cores. Spare cores sit idle unless another task can use them. Extra cores therefore pay off only with a scheduler or multi-threaded families. The research order makes this legible: the first scheduler comes before the second core.

**Capability.**
- Compute rate per core = lanes × clock × thermal efficiency (§8).
- Cache and RAM are capacities that gate `workingSet`. RAM bandwidth sets the speed of RAM stream stages.
- GPU models provide core count, actual clock, VRAM and derived ops/s. Task GPU requirements are cores and VRAM only. Storage gives capacity and IO bits/s.
- Dual- and quad-channel RAM multiply RAM bandwidth.

**Strategies.**
- Schedulers run at four scopes: system (on the chip), network (the rack load balancer), room/data center (the room network rack and site data plane) and global (the backbone scheduler).
- Each scope has researchable strategies, chosen per unit.
- Every strategy must have a distinct, testable effect on the sim. Examples:
  - **FIFO:** oldest first.
  - **Shortest job first:** more tasks per second, which helps the count-based SLA, but old tasks can expire.
  - **Round robin time slicing:** admits more tasks than cores and shares the cycles, so pickup stays fast while completion slows.
  - **Least connections / load-aware:** routes to the least-loaded system.
  - **Capability-aware:** never routes a task to a system that can't run it.
  - **Thermal- or power-aware:** steers work away from hot racks or loaded supplies.
  - **Bin packing:** consolidates work so idle systems can sleep (C-states).
  - **Gang scheduling:** required to place distributed tasks.
- The basic rack load balancer is **FIFO first-fit**: it sends each task to server 1, and if server 1 is full it tries server 2, and so on. It checks nothing else, so routing mismatches are a real early-Rack pain that research fixes.

## 6. Structure, zoom and networking

**Zoom ladder and unlocks.** Each step is unlocked by research.

| Level | What the player sees | Build tray |
|---|---|---|
| Chip | The CPU die: cores, cache, clock and (once researched) the scheduler. | Core, Cache, Clock, Scheduler |
| System | The board. | **CPU, RAM, GPU, Storage**. No cooling. The board PSU is a fixed board part, upgraded by tapping it. |
| Rack | A cabinet with **4 infrastructure slots** (cooling, power, load balancer, switch) and **up to 12 server slots**. Servers are the only part that can have several instances. | Cooling, Power, Load balancer, Switch. Servers are added by tapping an empty slot. |
| Room | One data hall, which is one availability zone. The **network rack in the top-left corner** is the room switch with its built-in load balancer. Racks are bought by tapping the next free slot, as in the approved mockup. | **Switch** (this replaces the mockup's "Rack" item), Row, Cooling, Power |
| Global | The world map with the player's sites. Each site shows its AZ halls. | Site, Backbone, Scheduler, **Zone** (this replaces Storage) |

- A system is one server. The first Rack research mounts the player's existing system as server 1 of a free starter rack.
- **New racks come with basic infrastructure:** air cooling, a basic PDU, a 4-port 1 kHz switch and a FIFO first-fit load balancer. They have no servers.
- **The "Data center" research** opens the Global level with the player's first site and lets them add zones (AZ halls) to it. Each zone is a room. A site's zones share its internal **data plane**.
- **The "Regions" research** opens new sites. Another zone costs less than another site, but region-locked tasks need sites in their regions.
- The Room level shows one AZ at a time, with an in-world way to move between a site's zones.

**Networking** starts at Rack. A lone system has an integrated link that is never a constraint.

Switches:
- A rack switch has P ports. Each port connects one server, and a server without a port gets no tasks. There is also one uplink.
- Port speed starts at **1 kHz** (1,000 bit/s) and climbs a 1-2-5 ladder: 1, 2, 5, 10, 20, 50, 100, 200, 500 kHz, then 1 MHz and on through GHz. The switch generation caps the top speed, which is the upgrade-or-replace decision again.
- **Each port upgrades independently**, at its own cost, and ports may run at different speeds.
- A **"same speed on all ports" toggle** makes one upgrade raise every port, priced at the sum of the per-port costs.
- Port count is upgradeable too.
- **A task crosses each hop at its full `payloadBits`.** Transfer time is `payloadBits / port speed`. A port carries one transfer at a time, and the uplink is shared by the whole rack. Port LEDs light only while a real transfer runs.

Load balancers and higher hops:
- The **load balancer** takes its own rack slot. It tells the switch where each task goes, using its strategy, and its routing capacity is upgradeable.
- In a room, the network rack holds the room switch (one port per rack) and the room load balancer. Tapping that rack opens its configuration: load balancer strategy, port speeds and port count.
- The site **data plane** links a site's zones. The global **Backbone** links sites. Both have bandwidth and latency that are upgraded or replaced.

**Distributed tasks.**
- All of a distributed task's members must be admitted within the same 10 s window, on systems that each meet the member spec. That needs gang scheduling at the lowest scope that contains all of them.
- Each member receives `payloadBits / members` over the network.
- The task completes when every member completes, and it pays once.
- Networking and cooling are what make these tasks possible. A single-system task never needs a switch faster than its own port.

## 7. Power

Supplies:
- system PSU (a board part);
- rack PDU (the rack's Power slot);
- room UPS (the room tray's Power);
- site grid feed.

**Overload.**
- Each supply has a usage ratio: delivered watts divided by capacity.
- While usage is above 100%, the supply's overload timer counts up. At or below 100%, the timer counts down at the same rate, to zero. For example, 8 accumulated seconds take 8 seconds to clear.
- **At 10 accumulated seconds the supply fails.** Everything below it goes dark, all in-progress work there is lost and counts as failed, and the overload timer resets.
- The failed unit reboots automatically after 10 s.

**PSU heat.**
- Every supply converts part of what it delivers into waste heat: its loss fraction. Better supply generations, such as 80 Plus tiers, lower that fraction.
- The waste heat is multiplied by usage: **×1 up to 90%, ×1.5 above 90%, ×3 above 100%.**

**Draw.**
- Every part draws idle watts plus load watts × utilization. Energy costs Credits continuously, at a price per joule.
- Research such as C-states and power capping changes idle draw and overload behavior.

## 8. Heat, efficiency and cooling

**Before Rack there is no thermal model.** A lone system sits in room air at a constant 70 °F with efficiency 100%. Heat starts mattering at Rack.

**Temperatures.**
- Each rack and each room is one thermal lump with its own temperature, in °F.
- Outside air is 70 °F. Ambient starts at 70 °F.
- The rack cooler shows the rack's temperature in-world, as a real readout.

**Efficiency** `e(T)` is set by the rack's temperature:

| Rack temperature | Efficiency |
|---|---|
| 70–80 °F | 1.00 |
| Above 80 °F | Falls 2.5% per °F, so 0.50 at 100 °F |
| Below 70 °F | Rises 0.5% per °F, to at most 1.10 at the 50 °F floor |

All three rates are starting values.

`e(T)` scales every compute rate in that rack. Heat produced is `watts × PSU multiplier / e(T)`, so lower efficiency makes more heat. That is the user's "3:1 vs 9:1" rule, and it can run away thermally.

**Crash.**
- A rack or room at **100 °F or above** accumulates crash time. Below 100 °F the time counts down at the same rate, as with power.
- **At 10 s it crashes:** its servers halt, their in-progress work is lost, and they draw no load.
- It reboots after at least 10 s, once its temperature is below 90 °F.

**Cooling.**
- Rack cooling removes heat from the rack lump and **dumps it into the room lump**. Room cooling removes room heat to the outside.
- A cooler runs at its full rated capacity, with its fans at full duty, so over-provisioned cooling pulls the rack below 70 °F. Its watts grow as it holds a lower temperature against heat leaking in from the room. That is the over-cooling trade.
- Research adds **variable-speed control**: coolers hold a setpoint instead of running flat out, which saves power. The fans then show the real lower duty.
- Each lump approaches its equilibrium exponentially, with time constant τ. **Air is slow**: a rack keeps cooling down well after its load stops.
- Rack cooling technologies:
  1. Air.
  2. Water: **τ is 10× shorter** and fewer watts per watt removed.
- Room cooling technologies, each more efficient than the last:
  1. Air (CRAC).
  2. Water (chilled water).
  3. Closed-loop water.
- The balance target is that over-cooling to about 60 °F is worth it under heavy load, but not free.

## 9. Research

- Research runs on the player's machines. A project is a **compute work volume**. Any compute counts toward it, and the machines doing it draw load power, so research always costs energy.
- **During a round**, research priority is one of:
  - **Background:** idle cycles only; tasks preempt it.
  - **Shared:** research reserves 25% of online capacity.
  - **Focus:** research reserves 100% of online capacity.
  - Offline units run research at full speed in any mode.
  - Shared and Focus can hurt SLA. That is the trade the user asked for.
- **Between rounds**, every online and offline unit runs the active project at full speed. Their energy is the Credit cost. Research stops if Credits can't pay.
- One project runs at a time. Mid-game research adds queued projects.
- The tree must expand far beyond v2. The research designer reviews the original game, IdleBit (`C:\Users\Borg\Documents\GitHub\IdleBit`), and the v2 tree, and writes `docs/research.md`. The tree spans:
  - compute: clock generations, cores, lanes, cache levels;
  - memory: RAM generations, dual and quad channel, ECC;
  - acceleration: GPU and VRAM;
  - storage;
  - scheduling strategies at every scope;
  - networking: switch generations, port counts, load balancer strategies, data plane, backbone;
  - power: PSU tiers, C-states, P-states, power capping;
  - cooling: air, water, closed loop, variable speed;
  - structure: System, Rack, Room, Data center, Regions;
  - operations: hot swap, auto-return, queued research, configuration templates.
- Every node names its mechanical effect in the spec's vocabulary. No node may be a flat "+x% income" modifier with no mechanism behind it.
- The research view stays the v2 research wafer (variant A), reorganized to hold the larger tree.

## 10. Economy

- **Credits** and **Data** are the two currencies (D2, D3). Completed tasks pay Credits per bit computed, plus Data at the family's ratio. Energy is billed continuously in Credits, so the HUD shows net income.
- Parts have generations and levels. CPU/RAM use the later **CPU/RAM progression** ruling in §15a, based on the user's calculation examples. Other parts keep their own catalog's upgrade-versus-replace rules.
- A paused or offline, powered-down unit costs nothing.

## 11. Configurations

- **Tapping an empty server slot opens a configuration plate, not a price.** It offers three ways to add a system:
  1. **Barebones** at any unlocked tier (Hz, kHz, MHz, GHz and so on): that generation's CPU at level 1 with its base cache, and nothing else.
  2. **Copy** a system already in this rack.
  3. **Saved**: load a named configuration.
- Each option shows its total price before you confirm. A configuration that needs unresearched parts is shown locked, with the reason.
- **Racks** (tapping the next room slot) and **zones and sites** use the same plate. A barebones rack is the basic-infrastructure rack.
- **Save icon.** A small save icon on each system, rack, room and site saves its configuration under a player-chosen name. Saved names appear only in these add-new plates, never in the world.
- A configuration stores generations, levels, port speeds, strategies and toggles. It never stores runtime state.

## 12. UI direction

- **Chip view.**
  - The user called it "messy" and disliked its "imperfect grid pattern"; "the system design is much stronger".
  - Rebuild the chip view on a strict, regular grid with the System board's clarity: an evenly spaced pad ring, blocks on grid cells, orthogonal traces, and no floating text boxes.
  - Live state appears as meters and lights, not sentences.
- **Board price labels.** Today's floating "15 Credits" tags overlap parts and each other. Prices belong in the tray and on plates. In the world, a buildable site may show at most a small, fixed-position price marker that never overlaps another part.
- **HUD.** Credits, net/min, and SLA with a round state: running, ended or between rounds. Controls never move.
- **Feed.** The global feed is a pixel-world object, visible at every level, with real countdowns and failure causes.
- **Round end** is an in-world plate with a short report: duration, met, failed by cause, peak intensity and Credits earned. **Return to market** is one clear control, used both there and between rounds.
- **New plates:** the switch (ports, per-port speed, the same-speed toggle, port count), the load balancer (strategy, capacity), the room network rack, the configuration plate and the save-name prompt. All are in the plate language.
- Rack coolers show °F. Supplies show usage and the overload timer once it is nonzero. A failed or crashed unit looks visibly dark or broken.

## 13. Simulation architecture

- **A new v3 simulation replaces the v2 sim.** There are no compatibility layers. The save schema becomes v3 and old saves reset. v2 sim modules are deleted once their v3 replacement is wired in.
- **Fixed tick.** The sim advances in fixed 100 ms ticks (a starting value). `advanceGame` accumulates elapsed time and runs whole ticks, carrying the remainder in state. That makes it delta-invariant by construction. Each tick draws RNG in a fixed order.
- Hardware rates are constant within a tick. The accepted GPU runtime ruling updates GPU contention shares at stage events; CPU/RAM/IO sharing stays unchanged. Physical quantities (work, heat, temperature, timers) are float64. **Credits are `Amount`**: each tick sums payouts as `count × authored price` and adds energy cost once, so `Amount` math is per tick, never per bit.
- **Per-tick cost scales with infrastructure, not task count.** New fixed-cadence arrivals are individual count-1 records. Keep the existing cohort pool for execution, fixtures and distributed members. Hot loops use struct-of-arrays and typed arrays. The architecture owner sets fleet caps (racks per room, zones per site, sites) that meet the budgets.
- **Snapshots** are built per visible level, incrementally, and never compute quotes. Quotes are lazy, for the open plate and the visible tray only.
- **Budgets** (binding; measured with `npm run bench`):

  | Path | Budget |
  |---|---|
  | Boot frame: advance 50 ms plus snapshot | 0.5 ms or less |
  | Frame at the largest allowed fleet | 4 ms or less |
  | One 2 h round at the largest fleet, offline in the worker | 10 s or less |
  | 24 h active-bot balance campaign | 5 min of wall time or less |

## 14. Pacing targets

Times are for an active player who buys the sensible thing when they can afford it.

| Milestone | Target |
|---|---|
| First purchase | under 30 s |
| First round ends | 4–8 min |
| System unlocked | 20–40 min |
| Rack unlocked | 1.5–3 h |
| Room unlocked | 5–8 h |
| Data center (zones) | 10–14 h |
| Regions | 18–25 h |
| Round length | early 4–10 min; mid 10–25 min; late 20–45 min |
| Warm-up per round | under 3 min |
| Choice gaps | a meaningful decision at least every 2 min in the first hour, and every 5 min after |

## 15. Program

**Wave 0, design** (now). Parallel agents, each owning disjoint files:
- spec: `docs/game-spec.md`
- tasks and market: `docs/tasks.md` and `scripts/market-model.ts`
- research: `docs/research.md`
- architecture: `docs/architecture.md`
- mockups, under `docs/mockups/v3/` (a copy of v2), split by file ownership

The lead reviews all of it before implementation.

**Wave 1, implementation.** It uses the module map in `docs/architecture.md`:
- the sim, split by domain: core and tick, market and rounds, execution and network, power and heat, research and catalog and configurations;
- renderer core and levels;
- UI shell and plates;
- platform;
- balance probes;
- the perf bench.

**Wave 2, integration.** Delete the v2 sim, then QA screenshots against the v3 mockups, the balance proof and the perf proof.

## 15a. Decision log

Later decisions append here. They are as binding as the sections above.

**D1, 24 Oct, from the research tree review** (`docs/research.md`):

1. **Shared capacity.** The working sets of concurrent tasks share a system's cache and RAM. Admission checks the sum of the running tasks' working sets.
2. **One IO stage per drive.** A drive serves one IO stage at a time. Command queuing research lifts this.
3. **VRAM** belongs to the GPU model and scales with native specs and hot upgrades. GDDR6 sets total capacity multiplier 4; HBM sets 16. There is no separate VRAM upgrade track. The GPU progression ruling below supersedes the old generation/level catalog.
4. **Task tags.** Families carry a `tensor` tag (tensor units accelerate them) and an `ecc` gate (they need ECC RAM). The task designer adds both.
5. **The base rack load balancer is FIFO first-fit** (user correction). It routes each task to the first server, in slot order, that can admit it right now. A server is full when it is busy with no scheduler or its queue is full; booting, crashed and offline servers count as full. It checks nothing else: no task gates, no load and no speed, so a task that lands on a server it cannot run fails as a misroute. If every server is full, the task waits in the feed and can expire. Round robin, least connections, capability-aware and the rest are researched strategies and filters. The same first-fit default applies to the room load balancer (over racks), the site data plane (over zones) and the backbone (over sites).
6. **Strategy changes are hot.** Changing a strategy, filter or setpoint is instant and loses no work, in or between rounds.
7. **Regions differ in energy price and outside air temperature.** Room cooling rejects heat to the site's outside air. A price-aware backbone strategy is allowed.
8. **Fast boot** (user correction) shortens the 10 s online/offline transition, as well as the post-failure reboot and the cold-change downtime. All three share one boot time, 10 s at base, that Fast boot research lowers (for example to 5 s, then 2 s).
9. **Auto-return** arrives at about 1 h. Later research shortens its rejoin delay.
10. **The offline cap** may grow with research: 8 h, then 12 h, then 24 h.
11. **Cooling technologies have generations.** Rack cooling stays two technologies, air and water, and each carries several generations so rack cooling keeps improving through the late game. For example, water generations add rear-door and direct-to-chip. Room cooling is air, then water, then closed loop, also with generations.
12. **The starter rack switch** has 4 ports. 8-port and 12-port research are cheap and come early in Rack. This tension is intended.

**D2, 24 Oct: user UI and economy notes.** Both are binding.

1. **One text size.** Every label, value, plate line, tray caption, feed entry and button uses the same body text size. Only two things are larger: the Credits display at the top of the HUD, and headers such as plate titles. Emphasis comes from colour or weight, never from extra sizes.
2. **Credits are whole numbers.**
   - **Payout.** Credits are earned per bit computed. A task pays exactly 1 Credit per unit of work it computed: the sum of its stage work in ops and bits. Network payload transfer is not computation and does not pay. There are no premiums or multipliers; bigger and harder work pays more because it is more work.
   - **Integers.** Prices, payouts, the wallet and report totals are all integers.
   - **Energy** accrues in an internal sub-Credit meter. The wallet is debited one whole Credit at a time as the meter crosses each whole Credit, so the wallet never holds a fraction.
   - **Display.** No Credit amount anywhere ever shows a fraction. Large values may use compact notation, such as 1.24M. Rates show whole Credits per minute.

**D3, 24 Oct: user note, Data stays.** This is binding and supersedes §2's removal of Data and §9's "compute work only".

1. **Two currencies.** The HUD shows Credits and Data, both larger than body text (D2.1).
2. **Earning.** Completed tasks earn Data as well as Credits, at a family ratio between **10:1 and 100:1 Credits per Data**.
   - Data-rich families yield near 10:1: analytics, logs, storage, indexing, ML.
   - Plain compute families yield near 100:1.
   - The ratio is authored per family and jitters slightly per round seed.
3. **Integers.** Data is a whole number too. It accrues in an internal sub-unit meter, and only whole Data is credited and shown.
4. **Spending.** Research costs **Data**, paid when a project starts, **plus its compute work volume**, which runs on the player's machines and costs energy in Credits (§9). Both are shown on the research plate. Nothing else costs Data.
5. **Failures.** A failed task earns neither Credits nor Data.

**D4, 24 Oct: spec, architecture and research reconciliation.** Binding. Where documents disagree, this list wins.

1. **Failure causes.** There are exactly six: `timeout` (Timed out), `cantRun` (Can't run), `misroute` (Misrouted), `power` (Power), `heat` (Heat) and `swap` (Swap). `swap` covers a cold change or an offline toggle that kills work. A distributed task records the root cause of the member loss that killed it. There is no `member` cause.
2. **Pickup deadline.** A task that arrives in tick `a` must be admitted by the end of tick `a + 99`, which is 100 ticks. Otherwise it fails at the end of that tick. The spec's wording wins over the architecture's `arrival + 100`.
3. **PSU heat.** The ×1 / ×1.5 / ×3 multiplier applies to the supply's own waste heat (its loss), not to all watts. That waste is billed and heats its lump. Confirmed as the spec has it.
4. **`lbHealth` and `binPacking`.** The research doc's definitions win:
   - `lbHealth` skips units whose supply overload timer or rack crash timer is above zero.
   - `binPacking` fills units in slot order up to their running limit K, and skips any whose supply would pass 90%.
   
   The spec follows.
5. **`threads` is a maximum, not a gate.** The capability filter never checks `threads`.
6. **Gateway site.** The market enters only at site 0. Other sites are reached over the backbone.
7. **Cohorts and purity.** Unconditional cohort records and the pure `advanceGame` copy are accepted. The copy cost is re-measured at G3.
8. **Offline time.** A 24 h offline catch-up at the largest fleet may take about 100 s in the worker, behind a progress display. The binding budget stays a 2 h round in 10 s or less.
9. **v2 backup.** The v2 working tree is backed up at `C:\Users\Borg\backups\bitrouge-v2-pre-v3-2026-10-24-1452.tgz`. Another backup is taken right before the Wave 2 delete step.

**D5, 24 Oct: task catalog review** (`docs/tasks.md`, `scripts/market-model.ts`). Binding.

1. **Warm-up superseded.** The accepted task lifecycle ruling below removes hardware-dependent warm-up. Difficulty follows the existing base ramp with running round age.
2. **Burst rule superseded.** One logical task arrives every 2 seconds. The SLA grace prior of 10 stays.

3. **Failure detail.** A failure cause may carry a one-word detail in the feed and the round report, for example "Can't run · RAM" or "Timed out · port".
4. **Rounds against a wall.** A round pinned against a structural wall should end within about 60 min. Balance (S2) tunes the band entries at G4 to keep it there.
5. **Endgame.** The network wall at about `I = 53`, past intercontinental, is the endgame for now.
6. **Prices and rates follow the model.**
   - Generic flow prices grow about 2.3× per level (the model's fit). The later CPU/RAM progression ruling replaces this with 1.7× step prices for clock and RAM only.
   - The starting drive speed must not make the storage band 4–8× heavier than modeled.
   - Research work tiers and Data costs are re-derived from the model's fleet capacity and its Data income per era: about 6.5e4 Data per round at 1 h, 2e14 at 8 h and 2e16 at 24 h.
   
   The spec and research doc owners update their numbers. Balance re-proves them at G4.

**D6, 24 Oct: watts, and user mockup feedback.** Binding.

1. **Watts follow work** (spec §9.1, accepted).
   - A part's draw is proportional to its rated rate, and rises as `x^1.3` when it is pushed past its generation's native rate.
   - The original 1%-of-payout at L1 and 8% after 10 pushed levels calibration is superseded for CPU/RAM by the later CPU/RAM progression ruling. Other parts follow their catalog.
   - Watts are game watts, shown with SI prefixes (kW, MW, GW, TW, PW).
   - Players mostly read the usage bars and percentages; the absolute watt number is secondary.
   - The rejected alternative was realistic watts with a different energy price per era.
2. **User feedback on the v3 mockups.**
   - **Research view:** "not a fan of research wafer, I like the idea but it doesn't look good and it's trying a bit too hard." Redesign it simpler and calmer, keeping the wafer idea only if it reads cleanly.
   - **Global:** "unresolved, the design needs some work." Redesign it.
   - **Room:** "power overlapped twice". The utility power feed and the network rack both crowd the top-left corner, and power reads twice. Give power and network separate, single, clear representations.
   - **Task icons:** they "can have a little more detail, it's hard to tell what the icon represents". Make the family icons more detailed and recognizable.
   - **CPU view:** possible feedback that core and CPU should be one view, with a simpler CPU graphic. The user partly retracted it ("oops ignore"); the lead is confirming.

**D7, 24 Oct: user rulings on CPUs and systems.** Binding; supersedes the D6.2 CPU note.

The user's words:

> "core and cpu should be one view and it feels unresolved. the graphic for the cpu has too many unrelated elements simplify it. the cpu should have clock, cache size, scheduler (queue size), cores. queue and core count size should max at 32, cache and clock continues to the full range"
>
> "systems can have up to 4 cpus and four ram but it hurts efficency. later you can unlock dual cpu but 8x ram and 8x gpu slots for spealized workloads (as well as a new load ballencer mode)"

1. **The CPU view.** The Chip level is renamed **CPU**. It is the single view of one CPU and shows exactly four things:
   - **Clock:** the rate.
   - **Cache:** its size in bits.
   - **Scheduler:** queue size and running slots.
   - **Cores.**
   
   Remove everything unrelated: decorative pad rings, gutters, vias, separate IN/OUT pad furniture, and any element that isn't one of the four. Task flow may be shown only where it is real state on those four parts. The tray stays Core, Cache, Clock, Scheduler.
2. **Caps.**
   - **Cores per CPU:** at most 32.
   - **Scheduler queue Q:** at most 32. Running slots K are also at most 32, bounded by cores.
   - **Cache size:** no cap below the full range, from 1 bit to the GHz era's largest sizes. **Clock:** Hz → kHz → MHz → GHz generations, each with 36 levels under the later CPU/RAM ruling. Old hardware may exceed newer tiers' native clocks. THz/PHz displayed overclocks do not require new native CPU generations.
3. **CPU sockets per system:** 1 to 4.
   - Every CPU in a system is identical: an extra CPU copies CPU 1's generation and levels, and an upgrade applies to all of them, priced × CPU count.
   - The system pools all its CPUs' cores under one scheduler queue.
   - Sockets are gated by research (2, then 3 and 4).
4. **RAM slots per general system:** 1 to 4, gated by research. RAM channels (dual, quad) stay bandwidth technology.
5. **Multi-CPU and multi-RAM hurt efficiency.** A system has a configuration efficiency `η_cfg = socketFactor(n) × dimmFactor(m)`. It multiplies compute rate and divides heat, exactly like the thermal `e(T)`, and the two combine as `η_cfg × e(T)`. Starting values:
   - sockets 1 / 2 / 3 / 4 → 1.00 / 0.92 / 0.85 / 0.78;
   - DIMMs 1–2 → 1.00, 3 → 0.95, 4 → 0.90.
   
   The system plate shows efficiency. So a big box is denser per rack slot and per switch port, and can hold big working sets and members, but it is less efficient than several small boxes.
6. **The specialized accelerator system**, unlocked later by research, is a different board: **2 CPU sockets, 8 RAM slots, 8 GPU slots**, with no DIMM penalty up to 8 because it is built for that. It is for specialized workloads: GPU-heavy, tensor and big-memory families. It is a choice on the configuration plate, as a barebones type.
7. **A new load-balancer mode, Workload affinity.** It is researched alongside the accelerator system. It routes specialized families (GPU, tensor, big-memory) to accelerator systems first, and general families to general systems first, falling back to first-fit when the preferred class is full. It is distinct from capability-aware, which only prevents misroutes and has no preference.

**CPU/RAM progression, 24 Oct: user's cost and efficiency examples.** Binding design direction; supersedes the CPU/RAM portions of D5.6, D6.1 and D7.2. Detailed formulas and source provenance are in `docs/hardware-progression.md`.

The user supplied `cpu_cost_spec.csv` and `ram_game_spec_sheet.csv` and asked to update the game rules around their examples. They said the THz/PHz extensions are illustrative and need not be included as new native tiers. Their follow-up rejects early tier-boundary caps: keep upgrading beyond the next tier even after operating costs exceed output. They accepted a common 36 or 32 levels; use 36 to match the sheets. This correction supersedes the earlier L18/L6 clock and L18/L22 RAM version of this ruling.

1. **Progression has an efficiency cost.** A level raises throughput, price and energy per unit. A new generation restores efficiency relative to pushed old hardware. Native efficiency also gets worse by era, so management matters more as the game progresses. Research grants availability; a hardware purchase is still required.
2. **Overlapping CPU generations.** Clocks grow 1.5× per level **(s)**. Every generation has L1–36, or 35 purchases from native. L19 exceeds the next tier's native clock. Old hardware keeps its own energy penalty as its actual rate crosses later tiers. Native CPU generations stop at GHz for now; actual clock prefixes may exceed it. No special GHz cutoff.
3. **Energy ratios.** CPU native potential-gross/electrical-cost ratios are 10, 6, 3 and 2 **(s)** at the fixed 0.010 Credits/J reference price, retaining 0.92, 0.93, 0.95 or 0.9625 per clock step **(s)**. The last two retentions are tuned from the source to the user's operating-loss target. Isolated native-lane operating loss first appears at L29/L26/L23/L20. Core generation owns the ratio, and lane/clock push is measured against that core's native rate. Replace the generic CPU/RAM push exponent, without billing it twice. Tariffs, supporting hardware, C-states, low-voltage RAM, configuration and thermal effects remain separate.
4. **RAM has separate capacity and bandwidth curves.** Keep SDRAM through DDR5 and their research gates. Bandwidth grows 1.5×; capacity follows all 36 steps of the source ladder. Every module has L1–36. Registered DIMM research grants 2× ECC capacity **(s)** instead of adding levels beyond the common ceiling. Native energy ratios map to eras as 10, 10, 6, 3, 3 and 2. Existing low-voltage and channel research retain their effects.
5. **Prices and choices.** Clock/RAM upgrade prices grow 1.7× per level **(s)**, initially keeping the current per-generation price bases. Quotes distinguish an upgrade's lack of marginal payback from a whole part costing more to run than it produces. Neither warning, negative net income, nor crossing a tier's native rate blocks an otherwise legal affordable upgrade. Keep L35 → L36 available even at operating loss. Preserve the choice among a hot level, more hardware, next-generation research and cold replacement. The next fab must be attainable using a profitable prior-era fleet.
6. **Integration status.** The parallel CPU/RAM pass updates rules, preserves source CSVs and adds an isolated formula probe. It does not edit shared runtime paths while the GPU workstream owns them. The contract owner must integrate specialized curves/power rules and save ceilings. Legal campaigns must re-prove research pacing, meaningful purchases, supplies and cooling. An isolated probe does not establish a balanced full game.

### GPU progression and runtime, 24 Oct

Accepted by the lead. This named ruling supersedes prior GPU catalog, count-gate and whole-tick sharing text, and D3's fee policy for GPU generation research only. It does not change the CPU/RAM progression ruling above. Numeric rules are in `docs/gpu-progression.md`; execution contracts are in `docs/gpu-runtime.md`.

1. Buy preconfigured GSMT model IDs. Displayed generations 1..9 have clock classes 1 kHz, 10 kHz, 100 kHz, 1 MHz, 10 MHz, 100 MHz, 1 GHz, 10 GHz and 100 GHz. Series 3 emphasizes cores, 5 VRAM, 7 clock, 9 all specs. Tiers are 30, 50, 60, 70, 80 and 90. Higher tiers scale all specs. At comparable generation, tier and push, series 9 costs more than combined series 3+5+7. Native G990 has the generation's best performance and efficiency.
2. Adopt the progression document's native, hot-upgrade, exact-price, energy and family core-floor formulas. Save `GpuBuild {kind:'gpu', model:GpuModelId, upgrades:number}`, with `upgrades=0..5`, and legacy `NpuBuild {kind:'npu', gen, level}`. One central evaluator validates model IDs and specs. Never store a GPU model object or infer a model from ops/s. Generic adapters may expose `gen=g-1`, `level=upgrades+1`.
3. GPU gen 1 research costs 0 Credits. For displayed `g=2..9`, charge `16 * B(g)` exact Credits, `B(g)=4,000,000 * 10^(g-1)`, plus accepted Data and work. Charge once on actual start, including queued start; never on queue. Require both currencies, debit atomically, keep paid status across switches/resumes and refund neither on cancel. Next-gen research costs half the current G990 before model purchase. The research appendix carries decimal-string `RESEARCH_CREDITS` metadata for optional runtime `ResearchDef.creditCost?: Amount`.
4. Family GPU gates are fixed integer `gpuCoresMin` and scaling VRAM only. No minimum GPU clock, rate, generation, model or device count exists. Work volume still sets duration. Each unlinked actual card must satisfy both gates. Linked GPUs sum cores, VRAM and per-card ordinary/tensor rates. NPUs never join the GPU pool.
5. Use eight bounded physical accelerator slots plus linked domain 8, with eighteen ordinary/tensor clocks. Choose the largest compatible uncontended rate for the family's mode, then physical slot order. Reserve VRAM at task start through completion or loss. Ordinary and tensor stages share one active-task denominator per domain; update shares at stage events inside a tick. This supersedes the earlier progression proposal's engine serialization and predicted-finish selection. CPU/RAM/IO sharing stays unchanged.
6. Keep four explicit legacy NPU rows. Gates are AND lists: g0 `npu`; g1 `npu` + `gpuGen2`; g2 `npu` + `tensorCores`; g3 `npu` + `matrixGpu`. NPU runs only tensor tasks with zero GPU-core minimum and contributes zero GPU cores. Its specs, tensor factors, level curve and watts do not inherit the nine-generation GPU catalog. GPU research uses ordinary rates; NPU research uses its legacy tensor rate. Bill actual task and research duty per card once.
7. General boards keep one shared accelerator slot, then two with `dualGpu`; accelerator boards have eight. Remove stale four-GPU comments, constants and views. Accelerator boards are a density choice rather than a forced device-count gate.
8. Bump save/catalog versions and reset old v3 GPU builds, configurations, accelerator research and pool state. No speculative migration. Preserve exact `Amount`, hardware-derived work timing, RNG order and delta invariance.
9. CPU/RAM specialized curves and hardware-ratio power remain required by `hardware-progression.md`, including its bounded idle split. Do not overwrite them with generic PartLevel flow math. No CPU/RAM runtime implementation belongs to this GPU wave. The CPU correction remains binding: cores only have clock; cache and queue belong to the CPU.
10. Existing task windows, work, payouts and Data ratios remain. Local catalog arithmetic checks passed; legal campaign balance and maximum-fleet performance remain unproved. Acceptance requires legal research/purchase progression, per-card progress/duty evidence, reservation conservation, save continuation and uneven-partition delta checks. Do not infer a balanced campaign from the old homogeneous model.

### Task lifecycle and onboarding, 24 Oct

Accepted latest rule. This overrides D5.1–2 and earlier arrival sampling, caps, warm-up and arrival-time `cantRun` rules. `docs/v3-onboarding-task-plan.md` holds the detailed contract.

- One logical task arrives every 20 simulation ticks while running. Work and requirements grow with round age on the existing curves.
- Save exactly five real future tasks with reserved identities and frozen descriptors. Refill after each due slot. No pickup clock runs before arrival.
- Each arrival gets the full 10-second pickup window, through the end of `arrivalTick + 99`. Unsupported work remains pending, including work the whole fleet cannot run. At expiry fail once as `cantRun` or `timeout` as appropriate.
- Free future dismissal marks the slot in place; free pending dismissal removes only uncommitted feed work. No SLA or reward changes. Admission or network reservation permanently commits a task, including after requeue or split.
- Round end prepares the paused next-round five once. Return and auto-return anchor the same IDs, descriptors and dismissal flags at +2 through +10 seconds. Saving, loading and snapshot reads never regenerate the forecast or draw RNG. Bump the save version with a pre-live reset.
- D1/D2/D3 desktop and C1/C2/C3 CPU layouts remain three review prototypes each under `docs/mockups/v3/onboarding/`. No production pair has been chosen. The core tray offers only physical Add core, core selection is facts-only, and clock/cache controls belong to the CPU. Preserve backend lane research and the completed contextual research selector; GPU model lookup retains the full selector.

The CPU/RAM 36-level specialized ruling and its deferred runtime integration remain unchanged. This lifecycle change does not retune GPU models, progression, work, rewards, balance or performance limits.

**D8, 25 Oct: GPU energy calibration.** Binding.

1. **GPU energy follows the CPU's era targets.** Gross-to-energy ratios set the target. Native CPUs in the Hz/kHz/MHz/GHz eras run at 10/6/3/2 (`docs/hardware-progression.md`). Scale the GPU watts coefficient so a native X990 card lands at its clock era's CPU target:
   - generations 1–3 (kHz class) at about 6;
   - generations 4–6 (MHz class) at about 3;
   - generations 7–9 (GHz and up) at about 2.

   The other native series and tiers sit somewhat below their generation's X990. A card pushed to u5 lands near break-even, roughly 1.0–1.3. This replaces "native GPU efficiency improves 10% per generation" and matches the CPU rule that native efficiency falls era by era. Pick the coefficient with `scripts/gpu-balance.ts`, run as a parameter sweep.
2. **Supplies must fit.** Watts are game watts (D6.1). PSU and supply catalogs must hold every native card at u0, and a pushed card up to u1, on the PSU generation of its era. Raise supply capacities where the sweep shows they don't.
3. **One `SAVE_VERSION` bump** covers the catalog change and the removal of the dead `gpuDevices` column.

**D9, 25 Oct: state ownership for speed.** Binding. This settles architecture §9 "Purity costs a copy".

1. **Two paths, one rule set.**
   - `advanceGame(state, ms)` stays pure and remains the reference for tests.
   - `advanceGameOwned(state, ms)` takes ownership of its input. It updates the input's hot buffers in place, returns the new state object, and marks the input consumed. A DEV-mode check throws if a consumed state is read or advanced again.
2. **Platform uses the owned path.** The platform store, runtime and offline worker use `advanceGameOwned`, because they hold the only live reference.
3. **Snapshots never alias live buffers.** Snapshots, selectors and saves must never keep a reference to live hot buffers; they copy what they publish. An audit test proves it.
4. **Equivalence test.** The owned and pure paths must produce identical states over random partitions, including RNG words, so delta invariance still holds.
5. **The other measured costs are fixed in the same pass:** repeated accelerator anchoring, clock scans, and `ALWAYS_VISIT` disabling the rack skip.
6. **Budget unchanged:** `gpuPowered` p95 ≤ 4 ms. AGENTS.md records the exception.

**D10, 25 Oct: tasks are pulled, never throttled.** User correction. Binding. It supersedes §4's arrival rates, warm-up and bursts, D5.1–D5.2, and the onboarding plan's fixed 2 s arrival cadence.

The user's words:

> tasks ARE NOT THROTTLED you just have 10 seconds to take the next one off the queue. you can process them instantly the pipe in starts at 1khz which is upgraded later once you can upgrade network speeds so the only throttling is the speed you can transfer tasks in (a 1000 op task takes 1 sec to land on a 1khz network, you should see this in the animation)

1. **The market is an endless, ordered queue,** generated from the round's seeded curve. The player always sees the next five, head first.
2. **No cadence and no throttle.** Hardware pulls the head as soon as it has room:
   - a free core, with no scheduler;
   - a free CPU queue slot, with a scheduler;
   - a free server, at network scales, through the load balancer.
   
   Taking a task is immediate.
3. **The 10 s rule.** The head must be taken within 10 s of becoming the head. Only the head's clock runs.
   - If the 10 s run out, the head fails (`timeout`) and the next task becomes the head with a fresh 10 s.
   - Dismissing the head is free and promotes the next task at once.
   - A head no online hardware can run blocks the line until it is dismissed or times out.
4. **The inbound pipe.** Every machine receives tasks over a network link from the very start.
   - **Rate:** the first CPU's pipe runs at **1 kHz** (1,000 bits/s). A task's transfer size equals its op count, so transfer time = ops / link speed. A 1,000-op task takes 1 s to land at 1 kHz.
   - **Capacity and overlap:** a link carries one transfer at a time. With a scheduler, transfers prefetch into free queue slots and overlap compute; without one, the core waits for the transfer.
   - **Upgrades:** link speed upgrades are researched early and climb the 1-2-5 ladder.
   - **Animation:** each task travels down the pipe at its real speed.
5. **Difficulty grows only through task size and requirements,** which rise with round time (intensity). The arrival rate never changes. A round fails when hardware can't keep each next task inside its 10 s, or can't run it.
6. **SLA is work-weighted.** SLA = work delivered ÷ work resolved, with resolved = delivered + failed, counted in ops. Count-weighting can't work with unlimited supply, because millions of early tiny tasks would make a round unendable. The grace prior is 10 tasks' worth of the round's opening size. The round still ends below 80%.
7. **Research shares,** since compute is never idle now:
   - Background reserves 10% of compute;
   - Shared reserves 25%;
   - Focus reserves 100%;
   - between rounds, research runs at 100%.
8. **Dismissal.** Any of the five visible tasks can be dismissed for free; the rest shift up. Running, transferring or queued work can't be dismissed.

**D11, 25 Oct: one typeface (user).** Binding.

1. **Chakra Petch for all text:** HUD, plates, tray, feed, research, labels drawn on canvas, mockups and the live game. Source: https://fonts.google.com/specimen/Chakra+Petch (SIL Open Font License).
2. **Bundled locally.** Font files live in `public/assets/fonts/chakra-petch/` with `OFL.txt`, so the game makes no external font requests. Weights 400, 500, 600 and 700 (plus italics only if used).
3. **The size rules still hold (D2.1).** One body size; only the Credits and Data figures and headers are larger. Emphasis comes from weight (500/600/700) and colour.
4. **Canvas waits for the font.** Canvas text waits for the font to load (`document.fonts.load`) before the first draw that uses it, so labels never flash in a fallback face.

**D12, 25 Oct: D10 follow-through.** Binding. It answers the rules owner's open questions; see `docs/tasks.md` §12 and spec "Changes since D9".

1. **Offset round start.** Every round runs the same curve, but opens at the market intensity the player has earned: start `I` = max(0, previous round's peak `I` − 6), and the first round starts at 0. The ramp is `T(I) = min(250, 25 × 2^(I/12))` seconds per unit. The start-back (6) and the ramp cap are starting values for balance. This replaces "restarts at I = 0" in §3 step 1 and spec §4.1, and the warm-up rules are gone for good. Individual tasks still vary by seed, so the curve stays similar between rounds.
2. **Link catalog re-base.** Payload equals work (D10.4). The spec's A.3 re-base rule applies to every link from Rack up (switch ports, uplinks, data plane, backbone), so links run at speeds that fit the work their era carries.
3. **Dismissal stays free,** as the user asked. A mid-game research node, "Auto-skip", dismisses heads that no online hardware can run. It's an automation reward for idle play, and it never dismisses runnable work.
4. **Saturate the pipe honestly.** A transfer shorter than one frame shows as a single landing flash on the pipe, not a fake slow packet. Packets visibly travel only when transfer time is long enough to see.
5. **No routing budget.** Load balancers have no tasks-per-second capacity. Transfer speed is the only throttle, as the user ruled. Load balancer upgrades change strategy, filters and placement only. Any internal per-tick bound exists only for engine safety, never binds in play, and is never shown.
6. **First Data at about 9 s is fine.** No retune.

**D13, 25 Oct: inbound speed comes from the upstream port (user).** Binding; it refines D10.4 and D12.2.

> system get 1khz because thats the switch default value. a rack would be default speed of a datacenter network rack port, and datacenter room for the backbone speed

1. **Each unit's inbound pipe is the port it plugs into upstream.** Its speed is that port's speed:
   - a system plugs into a rack-switch port, and the switch default is **1 kHz**;
   - a rack's uplink plugs into a port on the room's network rack, at that switch's default port speed;
   - a room (AZ) connects to the backbone at the backbone's default speed.
2. **Before the upstream device exists, the unit is still on its default port.** At boot the lone system's pipe is a 1 kHz rack-switch port, and upgrading the pipe is upgrading that port: per-port pricing and the 1-2-5 ladder, gated by `netSpeed`. When the Rack opens, the system keeps that same port as port 1, at whatever speed it has reached.
3. **Defaults come from the upstream device's catalog generation.** The default speed scales up at each tier, so higher tiers are never slower by default. The spec owner sets the room network-rack and backbone defaults in A.3, consistent with the re-base: roughly the traffic of 12 rack ports per rack uplink, and of a full room per backbone link.
4. **D10.4's "the rack uplink starts at port 1's speed" is withdrawn.** A rack uplink starts at the room network rack's default port speed.

**D14, 25 Oct: network speed is priced like compute at the same frequency (user).** Binding.

> that's way too cheap for khz tier

The user is reacting to the D13 pricing, where reaching a 10 kHz pipe cost 510 Credits.

1. **Price parity.**
   - A port-speed step to frequency X costs about what a native clock upgrade to X costs in the generation that runs at X. A kHz pipe step is priced like kHz-tier clock work, an MHz step like MHz-tier clock work, and so on.
   - Uplinks, data plane and backbone links scale from the same curve by their default-speed ratio.
   - The same-speed toggle still prices the sum of the ports it changes.
2. **Research timing (revised 25 Oct after the model run).**
   - `netSpeed` stays early, Hz era tier W2, with parity prices.
   - With 36-level CPUs, a dual-core Hz chip outruns a 1 kHz pipe by round 2, at about 6.5 min.
   - Holding `netSpeed` to the end of the Hz era stalls the era: System at 2:11, and Regions never reached.
   - Parity pricing alone answers the user's "too cheap": reaching 10 kHz costs about 415,000 Credits, exactly the equivalent clock span.
3. **Balance check.** The pipe binds in round 2, and its upgrades are priced as kHz-tier work. The model misses the Rack and Data center bands by about 20 and 45 min; the G4 balance pass tunes them.

**D15, 25 Oct: L2 shell, original System, and when links can be upgraded (user).** Binding.

> L2 is the best but system looks bad it should be the i want the system from the original design and the animation from cpu => system -> rack -> data room -> world. upgrades should be done by clicking on the item as well. the pipe cant be upgraded until you get to the switch in racks and the link for racks once you get to data rooms

1. **Shell.** The game shell is **layout L2, Control deck**: `docs/mockups/v3/onboarding/layout-L2/`, with its 8 px grid and integer art scale (N = 3 on desktop, 2 on phone).
2. **System level.** The System level uses **the original System board design**: the approved board in `docs/mockups/v3/levels/system*` and `docs/mockups/v3/qa/a/final2/3-system-phone.png`. It is shown whole and on its own: not cropped, no dimmed neighbour boards.
3. **Semantic zoom.** The zoom keeps the original animation: CPU → System → Rack → Room → World, with drill-in and zoom-out between levels as in the v2/v3 mockup (`docs/mockups/v3/core/view.js`) and the ported renderer transitions (`src/render/core/transition.ts`).
4. **Click to upgrade.** Tapping a part in the world selects it and offers its upgrade right there, as "x → x" with price and Buy. The deck's build rows stay as a second path to the same actions.
5. **When links can be upgraded.** This supersedes D13.2's pre-Rack pipe upgrades and D14.2's early `netSpeed`.
   - A system's port (the pipe) stays at the switch default of 1 kHz **until the player has a Rack**. Its speed is upgraded on the rack switch.
   - A rack's uplink stays at the room network-rack default **until the player has a Room**. It is upgraded on the room's network rack.
   - By the same rule, a room's backbone link is upgraded once Global is open.
   - Before then, the link shows its fixed speed and where it becomes upgradeable ("upgrade at the Rack switch").
6. **Rebalance.** Before Rack, a system's income is capped by the 1 kHz pipe, at 1,000 ops/s. Tasks too large to transfer and finish inside the 10 s window fail. That pressure is the push to the Rack. The rules owner re-tunes the opening and the Hz era so the Rack is reached in its §14 band.

**D16, 25 Oct: pre-Rack re-price under the pipe cap.** Binding. It accepts the rules owner's "what must give" list (`docs/tasks.md`, D15 section).

Before Rack, income is capped by the 1 kHz pipe at about 700 Credits/s and about 60,000 Data per hour. Costs on the path to Rack follow that cap.

1. **Research Data.**
   - `rack` moves to tier W6 × 3, about 30,000 Data. It was W7, at 1.8e8.
   - W4, W5 and W6 drop to about 4,000, 6,000 and 10,000. That puts `systemBoard` at about 12,000 and `fabKhz` at about 30,000.
2. **Credit prices.**
   - The SDRAM module drops to about 3e5 (from 2e6).
   - kHz fab parts drop to about 2e6 in total.
   - A barebones kHz server drops to about 5e5.
   - Post-Rack rungs follow the model's re-fitted prices.
3. **GPU and storage don't change.** Their bands open above the pipe wall, so they pay off only after Rack.
4. **`netSpeed` is deleted, and so is the `linkSpeed` ceiling.** Link steps unlock with structures (D15.5).

**D17, 25 Oct: final layout tweaks and the ship plan (user).** Binding.

> move global queue to the top since all scene have the tasks arrive form the top. rack view can show other racks (make sure the position in the rows are correct) and you can horizontally scroll. active rack is normal and other are darkened to focus on the correct rack. implement this to the real game and finish building out anything else to ship this then push to a new github repo called idlebit2 and clean up the codebase to only have this game and no other junk in it

1. **Global task queue at the top.** The queue (the next tasks) sits at the top of the L2 shell, under the HUD band, because tasks enter every level from the top. The pipe descends from the queue into the world. The bottom-right phone thumb zone keeps the actions: the head task's Dismiss, Buy, and Research.
   - *Note (user, 25 Oct):* the head task's big card moved back below, above the deck, and SLA moved to the centre of the HUD with the currencies stacked at the top right; the strip's cards no longer slide.
2. **Rack row view.**
   - The Rack level shows the whole row of racks, each at its true position in the room's row.
   - The view scrolls horizontally along the row, with a drag on phone and the wheel or a drag on desktop.
   - The active rack renders normally; the other racks are darkened, to keep focus.
   - Tapping another rack makes it active.
3. **Ship.** Port L2, with D15, D16 and these tweaks, into the live game on desktop and phone, on the D10 task model. Then finish whatever else shipping needs.
4. **Repository.**
   - Remove the v2 code, old prototypes and junk.
   - Move v3 into `src/` (architecture §5.2).
   - Keep only this game: the v3 docs and the final mockup reference.
   - Publish to a new GitHub repository named `idlebit2` with a fresh history.

**D18, 25 Oct: D10 implementation follow-ups.** Binding.

1. **D15.6 isn't a separate rule.** Taking is pickup (D10). A system that is still transferring and computing its current task can't take the head, so the head's 10 s run out, and that's how oversized tasks fail before Rack. No extra check.
2. **The `timeout · link` detail is dropped.** A timeout is a timeout.
3. **Routing capacity is gone (D12.5),** so research nodes whose only effect was `routingCapacity` (`lbL4`, `lbAsic`) are either repurposed with a real mechanical effect or deleted. The balance owner decides, and the tree stays valid.
4. **Dead data fields** (`FamilyDef.payloadBits`, router budgets in spec §7.6–7.7) are removed.
5. **Link power must be sane.** A link's idle and load watts scale with its speed, but stay a small share of the power of the servers it feeds in its era; idle links never dominate a site's draw. The balance owner fixes the link watts formula, which today makes re-based links idle at about 4.7e19 W.
6. **Ship gate:** the real campaign bot must reach System, Rack and Room inside the §14 bands, the frame budgets must pass (boot 0.5 ms, rack 1 ms, max fleet 4 ms), and the 2 h offline round must take 10 s or less.

**D19, 25 Oct: a months-long game (user).** Binding. It replaces the §14 milestone table from System onward.

> rack should take a few hours 5-8hrs then data center a few days, then multiple data centers in a few weeks. the full game should take a few months to get all datacenters up and running

| Milestone | Target |
|---|---|
| First purchase | under 30 s |
| First round ends | 4–8 min |
| System | **20–30 min** (D19 amendment, 25 Oct) |
| Rack | **5–7 h** (D19 amendment, 25 Oct) |
| First data center (Room) | **2–4 days** |
| Data center tier (zones) | about 1–2 weeks |
| Multiple data centers (a second site, Regions) | **2–4 weeks** |
| All data centers running (every site, max fleet) | **2–4 months** |

1. **Player model.**
   - Times are for an engaged idle player: several check-ins a day, buying sensibly, with auto-return and offline progress doing the rest.
   - Offline time counts up to the researched offline cap.
   - The early hours stay active and choice-dense (§14 choice gaps).
   - After Rack the game shifts to longer-horizon goals: saving for rooms, sites and generations.
2. **How to prove it.**
   - The design model proves the long horizon: days, weeks and months.
   - The real bot campaign proves the first 24 h: first purchase, round 1, System and Rack.
   - The balance owner reports both.
3. **Offline caps.** The offline cap and auto-return research must make a months-long idle game work: 8 h at base, extended by research. Offline catch-up must stay within the perf budget at every scale.

**D20, 25 Oct: round 1 ends in about a minute without upgrades (user).** Binding.

> round one should end in about a minute if you dont upgrade.

1. **With no purchases at all**, round 1 ends at about **60 s** (45–75 s across seeds). By then the opening tasks have outgrown the 1 Hz core and the 1-bit cache: heads time out, or need more cache than the CPU has.
2. **The player who upgrades** keeps going. Buying the first cheap upgrades (cache, clock) as they come extends round 1 to the 4–8 min band. That band now means "an active player", not "an idle player".
3. **The early curve must teach it:** the first failures should name their cause clearly (Can't run · cache, Timed out), so the player sees why the round ended and what to buy.

**D21, 25 Oct: the bot plays at 1,000×–10,000× (user).** Binding.

> the game bot should be able to play at 1000x 10000x speed or something

1. **Headless campaigns run at 1,000× real time or faster** through at least the first week of game time, and at 10,000× in the early game (boot through Rack). At 1,000×, 24 h of game takes about 86 s and a week about 10 min. The 300 s budget for a 24 h campaign in §13 tightens to 86 s.
2. **How:**
   - The bot advances with `advanceGameOwned` in large chunks.
   - It decides at a sensible cadence, for example every few game-seconds early and every few game-minutes late, never every tick.
   - Seeds run in parallel in worker threads.
   - Quiescent skips cover between-round time.

   Results stay exact: one fixed tick, delta-invariant, with no bot-only rules.
3. **Months-long pacing (D19)** is then proven with the real sim wherever the speed allows, and with the design model beyond that.
4. **Watch mode (dev only).** A URL flag lets the user watch the bot play in the browser at a chosen speed, for example `/v3.html?bot=active&speed=1000`. The bot drives public actions only, and the HUD shows the speed.

**D21 revision (user):**

> 10000x was an example, runs should alway be fastest possible while being stable and take less than a few minutes

- There is no fixed multiplier. Bot campaigns and balance runs always go as fast as the sim allows, flat out with no wall-clock pacing, and must stay stable: deterministic, no crashes, bounded memory.
- Every individual run finishes within a few minutes of wall time (target 3 min or less).
- Long horizons are proven by **chaining stages**. Each stage starts from the previous stage's saved state (the save format round-trips exactly) and runs within the time limit. That proves weeks and months with the real sim, in pieces.
- The 1,000×/10,000× figures above become examples only. Measured speedups are still reported per era.

**D22, 25 Oct: no task numbers on screen (user).** Binding.

> task numbers are irrelevant i think

A task shows as its family icon and name, plus its values: ops, bits, payout and clock. Task IDs stay internal, for identity, saves and animation keys, and never appear on screen. That covers the queue, the now card, cores, callouts, plates and reports.

**D23, 25 Oct: task type icons and colours (user).** Binding.

> design well formed icons for types of task and color code task types

1. **Seven or eight task types.** Each task belongs to a player-facing type, grouped from the catalog bands: Compute (bit and integer ops), Parallel (multi-thread), Memory (RAM-bound), Accelerated (GPU, tensor), Storage (IO), Distributed (multi-system), Multi-zone, Regional. The grouping is display-side, derived from the family's band.
2. **One colour per type,** used consistently: queue cards, the now card, core status, queue wells, the research "answers" and the round report. Colours harmonize with the palette and stay distinct.
3. **Well-formed icons.** Every type has a clean silhouette on the pixel grid, readable at the art scale (16 px art cell; N = 3 on desktop, 2 on phone). Types differ in shape as well as colour, so they stay distinct for colour-blind players. Family icons follow their type's style and colour.

**D24, 25 Oct: site- and global-scope routing uses maintained summaries.** Binding. It's a spec change for performance.

1. **Summary ranking above the room.** At site (data plane) and global (backbone) scope, the `latency` and `leastWork` strategies rank each candidate site or zone by a **maintained summary**:
   - its best predicted finish (queued work over rate) among its systems that can take the task now;
   - kept per capability class;
   - updated incrementally on take, completion and hardware change.
   
   They no longer compute the exact minimum over every system at decision time. Within a room, routing stays exact.
2. **Offline target.** The 2 h offline round at `fleetMax` must reach 10 s or less. The phys power phase becomes change-driven (contract R34: exec raises a per-system "touched" signal, and power recomputes only touched systems).
3. **Fallback ship gate.** If the 10 s offline target isn't met in this pass, the game still ships when the 2 h offline round at `roomFull` (where players spend weeks) takes 10 s or less and `fleetMax` takes 60 s or less behind the catch-up progress display. Optimization then continues after ship.

**D25, 25 Oct: divisible tasks and load-balancer queues (user).** Binding. It supersedes the fixed `threads` count (§4 task shape, D4.5), gang placement as a research gate (§6 "Distributed tasks", D1.5's gang notes), queued take (`reserveOnRoute`) and the per-member payload rule. Backlog item: the flat economy after Rack.

The user's words:

> tasks should be built from smaller tasks meaning all large tasks should be broken down to cpu/gpu ops eventually this is how tasks flow through larger systems down to you indivual components and is what makes having multiple systems worthwhile.

> load balancers should have the queue slots upgradable menaing it can hold more tasks than one if all systems its balancing are occupied

> pay is done for the full task only.

Why it fixes the flat economy: a whole task runs on one system, so its latency is `W / rate` and its working set must fit one box, whatever the fleet size. Late tasks then outgrow a single server's memory and finish after the round has ended, and a second rack adds little. A split task finishes in about `W / (n × rate)` and needs only `1/n` of the memory per box. Each doubling of the fleet lets a task one size step larger (+1.18 `I`) both fit and finish, so income per round roughly doubles (§D25.10).

1. **Divisible tasks.**
   - Every task is divisible work made of **shards**. A router splits a task among its children. A system splits its shard among its hardware threads, and its GPU stages run on its GPU domain. Every large task is broken down to CPU and GPU ops in the end.
   - A task has a **size** `s` in whole units. Its stage work is `coefficient × s`, and its work is `W = s × pay/unit`, as before. Shards hold whole units.
   - Each family has a **grain** `g`: the fewest units that must run together. The grain's work is `g × pay/unit` ops and bits. The effective grain is `max(g, ceil(s / 256))`, so a task has at most 256 shards (§8). No shard is smaller than the effective grain, and a task smaller than one grain is a single shard.
   - Shards keep the parent task's ID, family and descriptor, and add a shard index and their units. They are routed, transferred, admitted, queued and run as tasks are today.
   - **Gates per shard.** Fixed gates apply to every shard: fixed working set, GPU cores, ECC, tensor and region. Size-scaling gates apply to the shard's units: working set `wsFixed + wsPerUnit × units`, VRAM and storage capacity.
   - Grains (`docs/tasks.md` §5): Compute families are coarse (4,096 units). Parallel, GPU and distributed families are fine (16–64). Memory families are medium (256). A few are serial (65,536): JSON Parse, Backup and Payroll.
   - **Accepted deviation (25 Oct, implementation):** task sizes are not raised to one grain. An ordinary task smaller than its grain is drawn as is and runs as one shard; only minimum-split tasks are sized to at least `members × grain`.
2. **Base split: FIFO first-fit spread.**
   - At take time the router walks its children in index order. Every child that has room takes one shard. The shard count is `n = max(1, min(children with room, floor(units / effective grain)))`. Shares are equal whole units, and the remainder goes to the first child.
   - A child router **has room** if a system below it has room to take (§6.4 of the spec, first-link room included) or its own queue has a free slot (item 7).
   - A share sent to a child router is split again by that router in the same step, over its own children with room. A child router whose systems are all full, but whose queue has a free slot, takes its share into that queue.
   - Nothing else is checked: no gates, load or speed. A split that lands a shard on a system that can't run it misroutes, and the whole task fails (item 5). This keeps D1.5's dumb default.
   - **Smarter splits are research** (item 9): shares in proportion to child rate (`weighted`), to free slots (`leastConn`) or to predicted finish (`leastWork`), link-aware shares (`topologyAware`), a wait-for-half rule (Gather), shard stealing, and a local filter that keeps a task in one rack, zone or site.
3. **Inside a system.**
   - A starting shard takes `min(free hardware threads, max(1, floor(units / g)))` threads, using the thread assignment order of spec §6.5. This replaces the family's fixed `threads`.
   - With `workStealing`, free threads join running shards that hold fewer threads than `floor(units / g)`.
   - GPU stages keep the domain rate model (GPU runtime ruling).
   - Families differ by grain. Compute is coarse and serial-ish, so before Rack the Hz-era lesson still holds: extra cores pay off through the scheduler. Parallel is fine and fills every core.
4. **Split at take.**
   - The split tree is decided in the routing step that takes the head (or that dispatches a router-queue entry). It ends at systems, or at child-router queues. Every slot and queue reservation in it is made atomically, or none is.
   - Each shard is its own transfer along its full path from the market, at `units × pay/unit` bits.
   - A shared upper link carries the shards one after another by store-and-forward (FIFO, ties by shard index). Extra channels (`lag`) carry several shards at once. So a rack uplink carries the rack's whole share in turn, while the server ports carry their shards in parallel.
   - The bandwidth hierarchy therefore matters: an uplink must be about as fast as the ports below it combined, or it becomes the rack's throttle.
   - First-link room is unchanged: the router may take while its top link's backlog is under one tick of capacity. A take may then queue the whole task's bits on that link.
5. **Pay for the full task only** (user ruling, revised). It replaces the earlier pay-per-shard draft.
   - Shards pay nothing on their own. A finished shard frees its slot, threads, memory and VRAM at once, but its work earns nothing until the task is met.
   - The task pays its full payout once, `W` Credits plus `W / dataRatio` Data, when its **last** shard completes. The task is met at that moment for the work-weighted SLA.
   - The payout pop appears on the component that completed the last shard: its system, and the core or GPU card that ran the final stage.
   - If any shard fails (misroute, power, heat, swap), the task fails at once with its full `W` and the shard's cause. Nothing is paid. Its other shards are aborted: queued, running and in-transfer shards and router-queue shares are freed and their work is discarded.
   - Round end drops every shard and router-queue entry. A task with finished shards but no completed last shard pays nothing and counts as neither met nor failed.
6. **Distributed families.**
   - `members` becomes a **minimum split**: at least `members` shards on distinct systems, spanning at least `minZones` zones, all inside `region`. The whole split is placed atomically, as gang placement is today.
   - Shares of a minimum-split task go only to systems with room, never into child-router queues.
   - Owning enough systems, zones and regions is the gate. Placement needs no research. The `gang` placement and the `cantRun · gang` detail are removed. A task with more members than the static capability set has systems fails `cantRun · members`.
   - When the split can't meet its minimum now, the task waits, either as the head with its clock running or in a router queue.
   - Reconciling the gang nodes: gang placement becomes base, and the four `gang*` nodes become split research (item 9).
7. **Load-balancer queues.**
   - Every router has a **queue**: the rack LB, the room LB, the site data plane and the global scheduler. It holds whole tasks, or shares from a parent router, that are taken but not yet dispatched.
   - A router queue is a logical hold. A queued entry moves no bits; its transfers start only when it is dispatched, along the full path from the market.
   - **Take.** If the top router's queue is empty and the head can be split now, the head is split directly. Otherwise, if the queue has a free slot, the router takes the head into its queue. That is pickup: the head's clock stops and the entry is committed. Otherwise the head waits.
   - **Dispatch.** At the start of every routing step, each router, from the top down and in index order within a scope, dispatches its queue strictly FIFO with its split rule, for as long as the front entry can be split. Nothing behind a blocked front entry dispatches.
   - Queue entries have no deadline. If the router's own unit goes dark, crashes, takes a cold change or goes offline, its entries return to the market queue front (spec §6.9). At round end they are dropped.
   - **Size.** The base queue holds 1 entry. It is upgradable one slot per level, `L = 1 … 32`, on the same 1→32 ladder as the CPU queue (D7.2). The upgrade is hot. It is bought by tapping the load balancer in its rack or room slot (the upgrade callout, D15.4), or on the LB plate.
   - **Price.** Price parity (D14, spec §12.5) with `y = L × b` and `x = (L + 1) × b` per stream: `lbQueueStep(L → L+1) = ceil(m × u / 0.7 × ((L+1)^α − L^α))`. Each scope uses the era it opens in and the streams it carries:

     | Router | `m` | Era (`b`, `u`) | L1→2 | L31→32 | 1 → 32 total |
     |---|---:|---|---:|---:|---:|
     | rack LB | 12 | kHz (1e3, 1.5e4) | 379,843 | 976,161 | 2.4e7 |
     | room LB | 288 | MHz (1e6, 9e7) | 5.5e10 | 1.4e11 | 3.4e12 |
     | data plane | 864 | GHz (1e9, 2.4e11) | 4.4e14 | 1.1e15 | 2.7e16 |
     | global scheduler | 6,912 | GHz | 3.5e15 | 9.0e15 | 2.2e17 |

   - **Queued take is retired.** `reserveOnRoute`, the 10 s first-link bound and the LB plate's reserve switch are deleted. A busy first link now simply means "no room", and the router queue absorbs it.
   - The queue doesn't move the throughput wall; it absorbs stagger. In steady state it is full and drains at fleet rate. What it buys is fewer head timeouts while children free up unevenly, and a place for large minimum-split tasks to wait with their clock stopped.
8. **Bounds and performance.**
   - Shards per task are at most `min(systems with room, 256, floor(s / g))`, and since D25.11 at most `floor(W / (r × 1 s))`. Shards in flight are at most the total system slots, plus at most 32 queue entries per router (609 routers at the largest fleet). That is today's bound plus 19,488.
   - Shard completions per tick stay low because a shard is at least 1/256 of its task. The model (§D25.10) measures 0.5–14 shard starts per tick from 1 rack to 3 rooms, flat above 1 room. The architecture's 13 events per task become about 10 per shard, plus one parent completion.
   - **Data layout.** Each shard is a count-1 record in the existing SoA pool, with `parent` (the old `gang` column) and `units` (f64). The gang pool becomes the **parent pool**: one row per split task with shards placed, shards done, units, `W`, lost cause and checkpoint deadline. Router queues are fixed rings in `hot.rq` (32 per router). Sibling shards may share a cohort record while they wait on the same link with equal units, but only as an optional optimization (architecture §1.4).
   - The `npm run bench` budgets stand unchanged: the boot frame, the largest-fleet frame and the 2 h offline round, with D24's fallback gate.
9. **Research.** `docs/research.md` lists the node changes. In short:
   - `gangRack` becomes **Gather** (`splitGather`). A router dispatches only when at least half its eligible children have room, or when the entry has waited 10 s.
   - `lbReserve` becomes **Shard stealing** (`shardSteal`). A free system takes a not-yet-started shard queued on a sibling in its rack.
   - `gangRoom` becomes **Cross-rack stealing** (`stealRoom`).
   - `topologyAware` becomes the **link-aware** split strategy: shares in proportion to what each child's link and compute can absorb.
   - `zoneAware` becomes the **local** filter: keep a task in one rack, zone or site when that child can take the whole split.
   - `globalGang` is deleted: cross-site placement is base. The tree has 161 nodes.
   - `checkpointing` now covers any lost shard.
   - `workStealing` and `lbCapability` get new text. `lbCapability` also turns would-be misroutes into waits: a capability-aware router never dispatches a split whose shards don't fit their targets.
10. **Model check** (`npx tsx scripts/market-model.ts --fleet`, `--horizon=100`; `docs/tasks.md` §9 F–G). The fleet is homogeneous kHz L8 servers, the round is the settled round, and the figures are the mean of 3 seeds:

    | Systems | 12 | 24 | 48 | 96 | 288 | 576 | 864 |
    |---|---:|---:|---:|---:|---:|---:|---:|
    | Peak `I`, split | 33.1 | 34.0 | 35.1 | 36.0 | 37.6 | 38.6 | 39.3 |
    | Credits/round, split | 1.4e11 | 2.7e11 | 5.6e11 | 1.1e12 | 3.2e12 | 6.3e12 | 9.5e12 |
    | First round after the step, split | — | 30:03 | 30:43 | 29:42 | 32:15 | 29:46 | 27:51 |
    | Credits/round, whole (pre-D25) | 1.2e11 | 2.3e11 | 4.2e11 | 7.9e11 | 4.0e11 | 8.2e11 | 3.0e9 |

    - **Each doubling** adds about 1 `I` and ×2 income per round. The first round after a step is about 5 min longer; settled rounds return to about 25 min, set by the D12 start-back.
    - **Whole tasks** collapse from one room on, on `Can't run · RAM`.
    - **The opening** is unchanged, because one system has no router: an un-upgraded round 1 ends at 0:48 in the model (the real sim measures 55–67 s), and an active round 1 at 4:27.
    - **D19 milestones** stay in band: System 0:51, Rack 6:48, Room 2 d 7 h, Data center 9 d 18 h, Regions 18 d 18 h, every data center 92 d 18 h. The last needed the Max fleet rung's `payMin` raised from 1.3e6 to 4.3e6.

11. **Split floor** (lead amendment, after the sim's perf run). Top hardware finishes 1/256 of a task in microseconds. At max links the 6,912-server fleet ran about 421,000 live shard transfers and about 20 s per take tick.
    - **Rule.** Every shard carries at least 1 second of work at its target's nominal rate. For a system that is its compute rate, or its GPU domain rate for families with GPU stages. For a child router it is the fastest system rate in its subtree, read from the D24 summaries.
    - **Count.** `n = max(1, min(children with room, floor(units / ĝ), floor(W_entry / (r_target × 1 s))))`.
    - **Exceptions.** The floor never cuts below the minimum split (`members`), or below the shards needed to fit the hierarchy and VRAM (D26).
    - **Item 2, the no-disk term** (approved by the lead with D26). The floor also never cuts below `nNoDisk = ceil(wsPerUnit × units / ((cache + RAM) / Keff − wsFixed))`, the split that keeps every shard's working set off disk, as far as the grain and 256 caps allow. The target's cache + RAM comes from the same per-router memo as `r`: the most conservative (smallest) value in the subtree. Without this term the 1 s floor kept small-RAM, fast-CPU boxes on few big shards that spilled to disk, and splitting stopped reducing spill: model H2 had whole and split at 63–71% disk work. With it, split spills 13–20% (D26.6). The shard-event bound still holds, because each such shard holds about one machine's fast memory of data.
    - **Why.** Only tasks that are big for the machine get split. Every shard is visible for at least 10 ticks, and the shard-event bound holds.
    - **Fleet scaling.** The model (`--fleet` against `--fleet --nofloor`, `docs/tasks.md` §9 F) shows the floor leaves D25.10's fleet scaling intact. It caps splits only where a task is small relative to one machine, which is never the throughput or latency wall.

**Implementation contract (D25).** Three owners work in parallel. The names below are binding; anything else is the owner's choice. Bump `SAVE_VERSION` from 6 to 7 with a pre-live reset (no migration).

*Sim (`src/game/**`):*
- **Types** (`types/`). Changes:
  - `FamilyDef`: drop `threads`; add `grain: number` (size units). `members` keeps its name with the minimum-split meaning.
  - `TaskRequirementsView`: `threads` becomes `grain`; add `size: number` (units).
  - `RouterBuild`: drop `placements` and `reserveOnRoute`; add `queueLevel: number` (1–32).
  - Remove `PlacementId`, the `placement` research effect, the `setPlacement` and `setReserveOnRoute` actions and the `reserveOnRoute` rule.
  - `RuleId`: add `gather`, `shardSteal`, `stealRoom`. `FilterId`: add `local`. `RouteStrategyId`: add `linkAware`.
  - New action `{ type: 'upgradeRouterQueue'; unit: ScopeRef }`. New quote request `{ kind: 'routerQueue'; unit: ScopeRef }`, returning one quote: next level, `cost` from `lbQueueStep`, effect `{ slots: L → L+1 }`, locked at 32.
- **Records.**
  - The record pool keeps `count = 1` for shards. Rename `gang` → `parent` (i32, −1 for an unsplit task) and add `units: f64`. The record's `payout` is unused for shards; pay comes from the parent row.
  - The parent pool (was `GANG`) has columns: `taskId f64`, `family u16`, `units f64`, `work f64`, `minShards u16`, `placed u16`, `done u16`, `lostCause u8`, `replaceDeadline i32`, `next i32`.
  - An unsplit task (`n = 1`) has no parent row.
- **Router queues.**
  - `hot.rq`: per router, ring columns `rqTask f64`, `rqParent i32`, `rqUnits f64`, `rqSince i32`, plus `rqHead`/`rqLen` per router.
  - Router index order: global 0, then sites, zones, racks.
  - Saved with `hot`. `compiled.<scope>.lbQueueSlots u8` comes from `queueLevel`.
- **Routing** (`net/`). One `split(router, entry) → SplitTree | null` used for both takes and dispatch:
  - The candidates are the children with room, after filters.
  - Then the strategy's shares: equal for `firstFit` and `roundRobin`; proportional for `weighted`, `leastConn` and `linkAware`; water-filled for `leastWork`; one site for `latency` and `price`.
  - The effective grain and minimum split are enforced, and the share rounding follows spec §7.7.
  - The tree is reserved atomically. Then one transfer per shard on its path.
  - The routing step: dispatch the router queues top-down, then take heads (spec §7.6).
  - Delete `hops.ts`'s `QUEUED_TAKE_TICKS` path and `gang.ts`; their callers move to `split`.
- **Exec.**
  - Admission is per shard, and gates are per shard.
  - Threads at start are `min(free, max(1, floor(units / grain)))`.
  - On completion: free the shard; `done += 1`. When `done === placed`, the task is met: tally its full `W` and Data once in the ledger tallies, raise one completion event at that system and part, and free the parent row.
  - On any shard loss, fail the task once with the full `W` and abort its siblings (records, transfers, router-queue shares), unless `checkpointing` re-places the shard.
- **Static capability** (spec §4.3, §7.8). A task can run when some `k` in `[members, min(capable systems, 256, floor(s / g))]` gives shards of `ceil(s / k)` units that fit the `k`-th largest capable system. It also needs the zone and region conditions.
- **Tests that matter.** No other unit tests.
  1. Delta invariance on a 2-rack fixture with splits and router queues, random partitions, including RNG words.
  2. Owned-vs-pure equivalence on the same fixture.
  3. A 4-system rack takes a 4,000-unit Parallel task as 4 shards of 1,000, and pays `W` once on the tick the last shard completes, not before.
  4. One misrouted shard fails the task with its full `W`, pays nothing and frees all its siblings.
  5. With all systems full, a 1-slot LB queue takes the head (its clock stops) and dispatches it FIFO when a system frees. A full queue leaves the head's clock running.
  6. A `members = 8` task waits until 8 systems have room, then places all 8 in one step.
  7. Shard work at 1, 2 and 4 systems: completion time halves per doubling within ±1 tick.
  8. Save round-trip mid-split.
  9. `lbQueueStep(1 → 2)` on a rack LB is 379,843 Credits.

  Each new strategy, filter and rule keeps the existing distinct-effect test (architecture §7.4), rewritten for splits.
- **Snapshot** (`view/`). See the render items below. No quotes in snapshots.

*Render (`src/render/**`):*
- `TransferView` gains:
  - `shard: number` (index), `shards: number` (task total) and `units: number`;
  - `from: NodeRef | null` (null for the market) and `to: NodeRef`;
  - `key: number`, stable per shard transfer;
  - `link` adds `'uplink'`.
  
  `FeedSnapshot.transfers` stays capped at 16. Each level snapshot instead carries its own flows:
  - `RackSnapshot.flows: readonly TransferView[]` covers the rack uplink and every port, at most 12 + uplinks × 4.
  - `RoomSnapshot.flows` covers the zone link and the rack uplinks.
  - `GlobalSnapshot.flows` covers the data plane and backbone.
  - `SystemSnapshot.inbound: TransferView | null` covers the system's port.
- **Split animation.** A task arrives from the top, then visibly splits.
  - Rack: shards cross the uplink in turn, enter the switch, then fan out over the ports in parallel to their servers.
  - Room: the zone link, then the rack uplinks.
  - Global: the data plane, then the zones.
  - Group transfers by `taskId`. All shards of a take appear in the same tick with the same `taskId` and consecutive `shard` indices. Draw the fork at the router where the shard paths diverge.
  - No synthetic motion: positions come from `bitsSent / bits`. Shorter than one frame is a landing flash (D12.4).
- **Inside a system.** `TaskView` gains `taskId`, `shard`, `shards`, `units`, `threads` (held now) and `accelDomain` (exists). Draw one shard entering the board on the port, splitting to the CPU (as `threads` lanes on the CPU mini) and the GPU card for GPU stages.
- **CPU level.** `CoreView` gains `shard: number | null` and `shardThreads: number`, so the cores running one shard are drawn as one group.
- **Completion pops.**
  - `CompletionView` gains `taskId`, `shards` and `work`. It is raised **only when a task is met** (its last shard), at the system, CPU/core or GPU card of that last shard.
  - `credits` and `data` are the full task payout.
  - Finished non-final shards raise `ShardDoneView { seq, tick, system, cpu, core, gpu, taskId, shard, tau }` in `RenderSnapshot.shardsDone` (newest 2,048). These are a no-pay "slot freed" tick, never a payout pop.
- **Router queues.** `LbView` gains `queue: { slots: number; level: number; entries: readonly LbQueueEntryView[] }` with `LbQueueEntryView { taskId, family, units, shard: number | null, sinceTick }`. Draw queued entries in the LB's slot. `LbView.reserveOnRoute` and `placements` are removed.

*UI (`src/ui/**`):*
- **LB plate and callout.**
  - Show "Queue L/32" with filled wells for `lb.queue.entries`.
  - The callout on tapping the LB in its rack or room slot offers "Queue L → L+1", price and Buy, from `quote({ kind: 'routerQueue', unit })`. Use the same stable geometry as other callouts, and show it locked at 32.
  - Remove the queued-take (reserve) switch and the placement toggles. Add the `local` filter and the `linkAware` strategy to the existing lists.
- **Queue strip** (`FeedSnapshot.window`).
  - A head taken into a router queue leaves the window like any taken task. It then shows in the LB's wells, so "taken" reads from the LB, not the strip.
  - Taken counts include router-queue takes.
  - The head's clock row reads "In LB queue" for a returned or queued entry only if it is shown in the strip. It never shows a countdown for a taken task.
- **Task cards.** Show `grain` in place of `threads` ("Grain 64"). Show `members` as "Min split 8". Delete the `gang` icon text; the cluster type icon (D23) stays.
- **Round report and feed.** `cantRun · gang` no longer exists; `members` names the shortfall ("Can't run · members 8").

**D26, 25 Oct: memory hierarchy, spill and completion windows (user).** Binding. It supersedes D1.1's "cache or RAM" capacity gate, the `virtualMemory` rule, the `storage` stage resource and the storage gates (spec §6.3, §6.10), and the six-cause list of D4.1, which now has seven.

The user's words:

> I think we might need to rethink storage. because cpu cache can overflow to ram and ram can overflow to hard drives. obviously ram has much more storage than cache but its much slower and same with hdd. so a task shouldn't need an hdd but it might require a lot of bits to be sorted / processed which hdds would help do that task sooner but it will take longer to complete of course. gpu ram is seprate until much later when you do reaserch to have unified ram (which can overflow to hdds as well) some tasks later on should have a time frame to co.plete them as well so you can't co tinue to rely on slow hardware

1. **Memory hierarchy with spill.**
   - A system's memory tiers are cache (Σ L1+L2+L3 over its CPUs), RAM (Σ modules) and disk (Σ drives, plus the rack storage node's free capacity with `sharedStorage`).
   - At start, a shard's working set (`wsFixed + wsPerUnit × units`) is placed fastest tier first in the system's free capacity. Whatever doesn't fit spills to the next tier. The placement is fixed for the shard's life and released when it completes or is lost.
   - The only memory gate is the whole hierarchy, cache + RAM + disk. A shard that doesn't fit the free hierarchy waits, skipped and not blocking. Statically, a task the fleet can't hold fails `cantRun`.
   - **Refined:** the detail names the deepest tier the system has: `cache` (cache only), `RAM` (no drive) or `disk` (the whole hierarchy). This keeps the D20 opening's `Can't run · cache` word exactly. A generic `memory` word would lose the hint about the next purchase.
   - **Queue cap (lead ruling, implementation):** while a task waits in a system's queue with a running slot free (memory or threads hold it back), the system admits only while queued + reserved < Q, so the queue never holds more than the Q the player bought (spec §6.4).
   - At boot the only tier is 1 bit of cache. The opening is unchanged: an un-upgraded round 1 ends at 0:48 in the model (the real sim measures 55–67 s), on `Can't run · cache`.
2. **Spill costs time, never correctness.**
   - The `ram` stream and `storage` IO stage resources fold into one `mem` resource: bits touched.
   - At start, a `mem` stage of `M` bits splits by the placement fractions `f_c, f_r, f_d` into parts run in order. The cache part is free. The RAM part, `M f_r` bits, runs at RAM bandwidth, pooled with channels as before. The disk part, `M f_d` bits, runs at disk IO (Σ drives with striping, `ioConcurrency` holds, `ncq`).
   - So per stage: `time = compute / rate + M f_r / ramRate + M f_d / diskRate`.
   - **Refined:** cache traffic has no time term. Cache serves at core speed, inside the compute time, and the catalog gives cache no bandwidth. The opening families have no memory traffic, so nothing early changes.
   - The fractions are frozen at start, so the parts are ordinary stages on the existing RAM and IO clocks: deterministic and delta-invariant.
   - **Drive IO is re-based** so disk is much slower than RAM. Its L1 rate is 1/16 (HDD, SSD), 1/4 (NVMe) or 1/2 (SCM) of the era's RAM bandwidth: 1, 2,000, 1.6e7 and 6.4e10 bit/s. They were equal to RAM before, which made spill free. These are starting values.
   - Bits touched still pay 1 Credit each (D2). Where they sit changes only time.
3. **Storage is data-heavy work.**
   - No family needs a drive. The old `disk b/u` capacity gates join each family's working set (`wsPerUnit` + old `diskPerUnit`), and the old IO coefficients join its memory traffic.
   - The `storage` band becomes **data-heavy** work: 8–16 b/u working sets and many bits touched. Big RAM runs it fast. A drive lets a small machine hold it, slowly. A box with neither walls on `Can't run · RAM`.
   - Spill to disk is base. `virtualMem` becomes **Hot pages** (`hotPages`): a spilled shard's disk traffic is `f_d²` of its memory traffic instead of `f_d`.
   - `memController`, `storageCtl`, `ssd`, `nvme`, `scm`, `raid0`, `ncq`, `dma`, `prefetch` and `sharedStorage` keep their places with tier text (research doc §10).
4. **GPU memory is separate.**
   - GPU stages need their VRAM need (`vramPerUnit × units`) on one compatible domain. VRAM stays a hard gate with no spill.
   - **`unifiedMemory`** (GHz W14, Acceleration, requires `hbm` and `gpuGen8`) pools VRAM with system RAM and disk. A VRAM need beyond the card's free VRAM is placed in free RAM, then on disk. The GPU stage's `G` ops then add RAM and disk parts of `G × v_r` and `G × v_d` bits, at those tiers' rates.
   - The tree has 162 nodes.
5. **Completion windows.**
   - **Band.** Every family whose window opens at `I ≥ 26` carries a window, starting with `rackDist`; that is the four distributed bands, 18 families. Nothing before Rack does, so the opening and the pre-Rack lessons stay intact.
   - **Formula.** `deadline = ceil(windowS_f × j / dt)` ticks, where `j` is the task's frozen size jitter and `windowS_f` is 120 s for `rackDist`, 180 s for `roomDist`, 240 s for `multiAz`, 120 s for `region`, and 60 s for Exchange Feed. These are starting values.
   - **Why constant seconds.** The window scales with task size through `j`. Across intensity, the market's own size scale is the era's reference: a fleet that holds the 10 s head clock at `I` finishes a mean task there in about one take interval. So a fleet that keeps up meets a fixed window, and one that has fallen behind on hardware doesn't.
   - **Clock.** It runs from take (pickup), router-queue time included. A task not met by the end of tick `takeTick + deadline − 1` fails `late`, with its full `W` in the SLA and no pay. Its shards and router-queue shares are aborted. Under D25 the window covers the whole task, up to its last shard.
   - **Detail.** `late` takes `disk` or `RAM`: the slowest tier its shards' traffic touched.
   - **Cards.** They show the window ("done in 2 min"); a taken task shows its time left.
   - **Window size: why 2× the first draft.** At 60 / 90 / 120 / 60 s, the D25.11 floor's smaller shards queued behind full K+Q system queues, and even well-built split fleets went flat (peak about 30.4 at every size). We tested two fixes, measuring from the first shard's start and doubling the windows, and both restored D25.10's scaling. We kept "from take", as recommended, and doubled the windows.
6. **It works with D25.**
   - Size-scaling gates are per shard, so a wider split shrinks each shard's working set: it spills less and runs faster.
   - D25.11 item 2 (the floor never cuts below the no-disk split) keeps that true under the floor.
   - In the model, splitting cuts disk work from 66–72% to 18–23% on a small-RAM fleet, and income rises up to 2.7× at 288 systems. More systems also means more fast memory: the second reason fleets matter.
7. **What the player sees.**
   - The System and CPU views show the tiers filling: cache, then RAM, then disk, with spilled bits hatched.
   - A running shard shows where its data sits and which tier its current memory part is on.
   - Cards show "Done in 2 min"; taken tasks count down.
   - The round report counts `late` with its detail, and the share of work that ran from RAM and from disk.
8. **Model check** (`docs/tasks.md` §9, D26 run; `npx tsx scripts/market-model.ts --memory`, `--fleet`, `--horizon=100`).
   - **Opening:** unchanged.
   - **D19 milestones:** in band. System 0:54, Rack 6:51, Room 2 d 13 h, Data center 9 d 18 h, Regions 18 d 8 h, every data center 86 d 20 h.
   - **Spill against fast memory** (one rack): 3.5e10 against 1.0e11 Credits per round. With an HDD-speed drive, 4.8e9.
   - **Windows force upgrades:**
     - an under-levelled room loses 1.2 `I` and its rounds end on `Late`;
     - whole tasks go flat at about 31 `I` with thousands of `Late` per round;
     - a well-built split fleet loses about 0.6 `I`.
   - **D25.10 scaling holds** with the floor and windows: 32.4 → 37.5 peak `I`, and ×65 income from 1 rack to 3 rooms.

**Implementation contract (D26).** Three owners work in parallel. The names are binding. Bump `SAVE_VERSION` by one with a pre-live reset, after D25's bump.

*Sim (`src/game/**`):*
- **Types.**
  - `Resource = 'compute' | 'mem' | 'gpu'`; `ram` and `storage` are removed. `MemTier = 'cache' | 'ram' | 'disk'`.
  - `FamilyDef`: drop `diskPerUnit` and the `storage` stage (fold both per `docs/tasks.md` §5). Add `windowS: number | null`.
  - `TaskInstance` / descriptor: add `deadline: number | null` (ticks, frozen at draw) and `takeTick: number | null`.
  - `FailCause` adds `'late'`. `FailDetail` adds `'disk'` and drops `'storage'`.
  - `RuleId`: `virtualMemory` becomes `hotPages`; add `unifiedMemory`.
  - `RoundReport` gains `spill: { ramWork: number; diskWork: number }`: the `W` of met tasks weighted by RAM and disk traffic share.
- **Catalog.** Drive IO bases are 1, 2,000, 1.6e7 and 6.4e10 bit/s.
- **Exec.**
  - Hot per system: `usedDisk`.
  - Record columns `memC`, `memR`, `memD` (f64), written at start by fastest-first placement and released once.
  - Expand `mem` stages into RAM and disk parts at start (the cache part is skipped). `hotPages` uses the `f_d²` traffic split.
  - With `unifiedMemory`, place VRAM overflow and append the parts after the GPU stage.
  - The static capability check uses the hierarchy (spec §6.3).
- **Net.** Extend `floorShards` / `split` (`src/game/net/floor.ts`) with the D25.11 item 2 `nNoDisk` term. It uses the target's cache + RAM and `Keff` from the same per-router memo as `r`, taking the subtree's smallest value.
- **Market.**
  - Draw `deadline` from `windowS × j`.
  - Set `takeTick` on split or router-queue take; router-queue entries keep it.
  - The deadlines phase pops a 4,096-bucket ring of parent IDs (architecture §1.4) and fails unmet tasks `late`, aborting siblings and router-queue shares.
- **Tests that matter.** No other unit tests.
  1. Delta invariance and owned-vs-pure on a small-RAM spill fixture with windows, under random partitions, including RNG words.
  2. Boot round 1 with no purchases ends on `Can't run · cache` within 45–75 s.
  3. A shard whose working set is 2× RAM on a box with a drive runs its `mem` stage in `M/2 / ramRate + M/2 / diskRate` (±1 tick). The same box without a drive gets `Can't run · RAM`.
  4. Splitting a spilling task over 4 systems with room removes its disk part entirely: each shard fits cache + RAM.
  5. A task not met by `takeTick + deadline − 1` fails `late` with its full `W`, pays nothing and frees all its shards. Time in a router queue counts.
  6. With `unifiedMemory`, a VRAM need 2× the card runs. Without it, it is `cantRun · VRAM`.
  7. Save round-trip mid-spill.

*Render (`src/render/**`):*
- `SystemSnapshot.memory: { tiers: readonly MemTierView[] }` with `MemTierView { tier: MemTier; capacityBits: number; usedBits: number; spilledBits: number; rateBits: number | null }`. `spilledBits` counts bits that sit in this tier because they didn't fit a faster one. `rateBits` is null for cache. Draw the three bars filling cache → RAM → disk with spilled bits hatched.
- `ChipSnapshot.cache` gains `spilledOutBits`: bits of running shards that didn't fit cache.
- `TaskView` gains:
  - `placement: { cache: number; ram: number; disk: number }` (bits);
  - `memTier: MemTier | null` (the tier its current `mem` part runs on);
  - `windowEndTick: number | null` (`takeTick + deadline − 1`).

  Draw the shard's data where it sits, and a traffic light on the tier it is reading now, at the real rate.
- GPU `PartView` gains `unifiedSpillBits`.
- Every light and animation is real state at its real rate. Spill hatching is state, not decoration.

*UI (`src/ui/**`):*
- **Cards.** Queue cards for families with a window show "Done in 2 min" (`windowS × j`). Taken tasks show the time left, in the LB queue wells and in the running/now card, and turn warning at 25% left. Requirements show "Memory 2.1 Mb" (the working set), never "storage". Stable geometry.
- **Failures.** `Late` and `Late · disk` / `Late · RAM` in the feed. `Can't run · disk` is the new hierarchy word.
- **Report and plates.**
  - The round report shows the late count and "From disk: 18% of work".
  - The system plate gets a memory row: three tier bars with capacity, use and spill. The drive plate shows IO as "spill speed".
  - The research view shows `hotPages` and `unifiedMemory` with their effects.

**D27, 25 Oct: research is a task that cuts the line (user).** Binding. It supersedes D10.7 (research shares), the Background / Shared / Focus modes and idle-time research (spec §11.2, §11.3).

> research should cut in line to be the next item in line

1. **Starting a project** pays its Data (and any Credit fee) as before, and puts the project at the **front of the market queue**. It is the head. The old head drops behind it, and gets a fresh 10 s when it becomes the head again.
2. **Running it.** Research has no head clock and can't time out or fail on the queue. The next systems with room take it, like any task (slots, one take per slot per tick), each on the threads it has free. It has no payload or transfer, so it starts when taken. It pays no Credits or Data. Its work is the project's work volume, as CPU compute; when that is done, the project completes.
   - Under D25 it is fine-grain divisible: every system with room takes a share, so a fleet researches faster.
   - Lost to power, heat or a swap, it keeps its progress and goes back to the queue front.
3. **One at a time.** Only one project is in line or running.
4. **The modes are retired.** No research shares, no idle-time research, and GPUs no longer research. Between rounds the market is paused but research still runs: every paused server takes it on all its threads.
5. **The trade-off is the point.** While research holds a slot, the heads behind it wait: research costs SLA risk during a round and nothing between rounds. Work volumes are re-tuned to about N seconds of the era's typical hardware at unlock (`docs/research.md` §3.2): W1 20 ops (5–10 s at 2–4 Hz) up to W7 3e7. Data costs are unchanged. The D20 opening holds (round 1 without purchases ends at 0:55–1:07).
6. **Implementation.** `hot.sys.researchThreads` per holder, `G.researchHolders` and `G.researchProject`; the take runs at the start of the route step (`exec/researchTask.ts`). A holder counts one slot and its threads as busy. **Amendment (lead, 25 Oct):** during a round a holder keeps one thread per system, so research slows the market instead of stopping it (a mid-round take on an idle box otherwise held every thread until the project ended, and the rack queue filled with tasks that could not start); between rounds holders spread over every thread. `SAVE_VERSION` 9, pre-live reset. The feed carries `FeedSnapshot.research: ResearchQueueEntryView | null` beside the task `window`; task entries gain `kind: 'task'`.

**D28, 25 Oct: SLA is a plain count ratio over a rolling window (user).** Binding. It supersedes D10.6 (work-weighted SLA with a grace prior).

> SLA could show the ratio of completed vs taken (dismissed doesnt show but should show at the end of the game)

> i think sla isnt calced correctly

1. **Formula.** `SLA = met / (met + failed)`, counting tasks, over the **last 50 resolved tasks of the round** (all of them before 50). `failed` covers every cause: timeout, cantRun, misroute, late, power, heat and swap. A split task counts once. Dismissed tasks, tasks dropped at round end and research (D27) are outside it. The HUD shows "SLA 92.0% · 46 / 50".
2. **No hidden grace prior.** The shown ratio equals the shown percent. The 80% check starts once 10 tasks have resolved this round; before that the HUD shows "warming up".
3. **Why a window (lead ruling).** A whole-round count let early small tasks hold a round above 80% long after the wall: in the real sim one System-era round ran 76 min (1,722 met, 431 failed) because each failing head takes its full 10 s. The last-50 window ends a round within about a minute of the wall at any fleet size.
4. **What "not calced correctly" was.** The HUD showed task counts (met, failed) next to a work-weighted percent with a grace prior, so "41 / 44" could read 70% or 99%. The bookkeeping itself was sound: an audit test (`market/sla.test.ts`) checks every tick of a split, windowed, dismissing, researching rack that the round counters equal the sim's own met and failed events, each task once.
5. **Round report.** Keeps the whole round's met, failed and dismissed totals, and the met and failed work.
6. **Tuning.** The D20 opening is re-tuned for counts: the ramp is `T(I) = min(250, 4.5 × 2^(I / 3.5))`, AND Mask opens at I 0.6 (weight 14) and Compare at 1.6 (weight 10). Round 1 without purchases ends at 0:38–1:18 (median 0:57) on Can't run · cache; an active round 1 at 4:23–5:10.
7. **Fields.** `hud.sla`: `met` and `failed` (the window), `percent`, `checking` (10 resolved), `window` (50), `roundMet`, `roundFailed`. `deliveredWork`, `failedWork` and `grace` remain until the UI stops reading them. `SAVE_VERSION` 11 (the window lives in `hot.g`).

**D29, 25 Oct: the default switch port is 100 kHz (user).** Binding. It amends D13 and D15.

> we want the 1khz bottleneck to hit around the time you can upgrade the switch so you might need to scale to rack differently or maybe the network speed 100khz by default so when you start hitting the 100khz limit on systems you are getting close to unlocking mhz/racks

1. **Default speed.** Switch generation 0's default port is **100 kHz** (k = 6). The lone system's pipe before Rack is that port, fixed until the Rack switch (D15 stands).
2. **Rack-era ports** step up from 100 kHz into MHz at the clock-parity prices (D14), which keep them in MHz; switch generation 1 (`sw100k`) starts at 1 MHz. The generation tops stay where they were, because rack uplinks (room-switch speeds) are validated against them. D25's "an uplink must carry its ports combined" stands.
3. **Pacing intent.** Compute climbs through Hz at the CPU level to about 1 kHz around System (20–30 min), through kHz across the System era, and reaches the 100 kHz pipe as Rack comes within reach (5–7 h). Before that, compute is the bottleneck, so kHz upgrades pay all through the System era.
4. **Lead ruling on the climb (options a and i).** The CSV kHz clock climbs in about 15–60 s per level, so the lane and core multipliers are Data-gated across the System era (superscalar and quadCore at W6, outOfOrder and octaCore at W7), and the kHz core's energy decay is 0.85 per pushed level instead of the CSV's 0.93 (`hardware-progression.md` §3 departure): a kHz core turns uneconomic near 18k ops/s, so compute climbs with cores toward the 100 kHz pipe. `fabKhz` is W4 again (needs `systemBoard` and `pipelining`). The CSV clock prices stay.
5. **Rack** is research tier W8 (12,000,000 Data), sized to the System era's income under the 100 kHz pipe.

**D19 amendment, 25 Oct (user):**

> system should be closer to 20-30 mins and rack at 5-7 hours is good

System's band is **20–30 min** (was 30–60), and Rack's is **5–7 h**. `systemBoard` is research tier W3 (6,000 Data).

**D30, 25 Oct: every round starts from the beginning; intensity advances per task (user).** Binding. It replaces D12.1's offset start (previous peak − 6) and the time-based ramp `dI/dt = 1/T(I)`.

> tasks shouldn't start relative to you they should always start from the beginning. when you have fast systems they will just blast through the lower tasks

1. **Start at zero.** Every round starts at `I = 0`; the prepared next-round queue is drawn from 0.
2. **Intensity by task drawn.** Each task drawn into the queue (it replaces one taken, failed or dismissed) is drawn at the current `I`, then `I ← I + 1/k(I)` with `k(I) = 9 + 0.3 I + 0.03 I²` tasks per unit of `I` **(s)**. Hardware never changes the curve, only how fast a round moves along it: fast systems blast through the small early tasks. Dismissing draws a replacement and so advances `I`.
3. **Round length.** The quadratic term gives later intensities more tasks per unit (each about 2–3% bigger than the last near the Rack-era wall), so a round lasts minutes near its wall at any fleet size.
4. **What stays.** Family windows and weights, D26 windows and bands stay keyed on `I`. `I` advances at draw events, which are already deterministic, so delta invariance holds. Saves keep `I`.
5. **Measured (real sim, `scripts/balance/opening.ts`, 8 seeds).** Round 1 without purchases ends at 0:36–1:16 (median 0:55) on Can't run · cache; an active round 1 at 7:39–9:03.

**D31, 25 Oct: power at scale: start controllers, rack batteries and off-grid generation (user).** Binding. It amends `s3Sleep` (spec §9.3), Return to market (§4.1), §4.4 and the energy ledger (§9.8).

The user's words:

> maybe we can have battery or off grid power for global tier and smart start sequence research that can ease the early phases of starting up

> battery could be rack level which increases the time until billed for each rack

> battery/smart startup should show up as a new rack space under the cooling (they are one unit for both)

> smart start can be a power upgrade as well and you would configure it there per rack, data rooms can trigger which racks are powered on and global schedulers which datacenters come online these are all new research and upgrades that come at the correct phase

**The problem.**
- Under D30 every round restarts at `I = 0`, so a large fleet sits through tiny tasks with every system awake.
- The free 10 s warm-up is scrapped (user): booting and waking systems draw and bill idle watts like any powered part.
- Idle is about 10% of full draw, plus cooler and supply overhead. Through the climb a big data center bills more than it earns (item 6).

**The answer.** Start controllers make the powered fleet follow demand, rack batteries make each rack's opening (boot included) unbilled, and off-grid generation lowers the bill for the whole round.

1. **Sleep never gets split work (D25 fix).**
   - An `asleep` or `standby` system is never a split candidate. Under D25's spread, the old rule ("a route to an asleep system wakes it") woke every sleeping system on every take, so `s3Sleep` saved nothing.
   - Asleep systems wake by **demand** through the router above them.
   - **Base demand wake** (with `s3Sleep`, no controller): when a router can't split an entry because no awake child has room, or a minimum split lacks awake systems, it wakes that shortage, lowest index first. That is 1 system for an ordinary task, or the missing members.
   - A woken system is `onMarket` after `s3WakeS` (2 s), a physical latency, drawing idle watts while it wakes. The head's clock keeps running.
   - Systems still fall asleep after 10 s with nothing admitted or reserved and not holding research (D27).
2. **Start controllers: smart start as a power upgrade at each scope.** Each is a part with research generations and Credit levels, plus a small configuration on its plate.

   | Scope | Part (slot) | Controls | Opens |
   |---|---|---|---|
   | Rack | **Power control** (`powerCtl`), the battery and smart start as one unit in a new rack slot under the cooling (item 3) | which **systems** are awake at round start, and their wake order | Rack era (`powerCtl`, kHz W8) |
   | Room (zone) | `roomStart`, on the room's **UPS** (room Power) | which **racks** are powered at round start, and their order | Room era (`roomStart`, MHz W11) |
   | Global | `globalStart`, on the **global scheduler** | which **sites (data centers)** and their zones are online at round start, and their order | Global, with Regions (`globalStart`, GHz W14) |

   - **Configuration** (the same three stable controls at every scope, saved per unit):
     - **Start with** `n`: units awake or powered at Return to market (1 … the unit count; default 1).
     - **Wake when**: `head waits ≥ X s`, with X from 1 to 9 and default 2. The second-generation part adds `busy ≥ Y %`: the awake units' busy fraction over the last 10 s, Y from 50 to 95 and default 75.
     - **Order**: rack `slot` or `fastest` (rated compute); room `slot` or `coolest` (rack °F); global `slot`, `cheapest` (site marginal price, item 4) or `nearest` (backbone latency).
   - **Step.**
     - Each second in which the trigger holds, the controller wakes the next units in its order: 1 unit at generation 0, or `ceil(25% × awake)` at generation 1 (predictive).
     - Demand waking (item 1) still adds any shortage at once.
     - **Levels** cut the wake latency of the units it controls: L1–5 give 2, 1.5, 1, 0.5 and 0.25 s (0.25 s above L5).
     - **Generation 1** (predictive) is Power control gen 1 at the rack, and `startPredict` for the room and global controllers.
   - **Power states.**
     - A **system** that is not woken is `asleep`: 0.03 × idle, no load.
     - A **rack** a room controller has not powered is `standby`: the rack and everything in it draw 0 W, including the cooler, switch, LB and battery. Powering a rack on takes `rackOnS` (2 s at L1, cut by the room controller's level). Its own rack controller then starts its "Start with" systems.
     - A **zone or site** the global controller has not brought online is `standby` in the same way, with `siteOnS` 5 s at L1.
   - **Hierarchy.** A controller acts only while its unit is powered: a `standby` rack ignores its own controller until its room powers it on. Without a controller at a scope, every unit at that scope is powered at Return (today's behavior).
   - **Back to sleep.** Systems fall asleep by `s3Sleep` (10 s idle). A room controller returns a rack to `standby` after all its systems have slept for 30 s, and a global controller does the same for a site after its racks have been off for 60 s. A unit holding research (D27) never sleeps.
   - **Saves and configurations.** `StartCtl { gen, level, startWith, trigger: { headWaitS, busyPct | null }, order }` lives on `RackBuild.power.start`, `ZoneBuild.power.start` and `GlobalBuild.scheduler.start`. Named rack, room and site configurations store it, and Copy copies it (spec §13.1).
   - **With D25.** Splits see only awake systems in powered racks. A wake adds candidates from the next tick. The D25.11 floor is unchanged.
   - **With D30, the climb.**
     - Demand doubles every 1.18 units of `I`, which is about 15–35 tasks under D30's `k(I)`. When the fleet just keeps up, takes come every few seconds, so a doubling takes about 30–70 s.
     - Generation 0 doubles a rack of `n` awake systems in `n` seconds (at most 12 s), and a room of `n` racks in `n` s (at most 24 s). Generation 1 doubles any scope in about 3 s.
     - The head's worst added wait is the trigger plus the latency, `X + wake` (4 s at defaults), inside its 10 s. So waking keeps pace and costs no early SLA, as long as the trigger is at 4 s or less at generation 0.
3. **Rack batteries: time until billed.**
   - **One unit, its own slot (user).** The battery and the rack's smart start are one part, **Power control** (`powerCtl`).
     - It has a new, **fifth** rack infrastructure slot, drawn directly **under the cooling unit**. Slot order, top to bottom: cooling, power control, power (PDU), load balancer, switch. This supersedes the 4-slot rack of program §6 and D1.
     - The slot shows empty and locked ("Needs Power control") until `powerCtl` is researched. Then tapping it opens the add plate with the price, as for any infrastructure part.
     - A generation or level raises the battery's capacity and the smart start's capability together.
   - **Discharge.** While the round runs and the rack is powered, the rack's PDU input is drawn from the battery, not billed. That input covers servers (booting, waking, asleep or busy), cooler, switch, LB and losses. When it is empty, utility billing starts as normal. A `standby` rack draws nothing and doesn't touch its battery.
   - **Battery time** is `charge J ÷ current PDU input W`, so it scales with the rack's draw. It stacks with the controllers: a rack started with one awake system draws a few percent of full, so its battery lasts many times longer.
   - **Sized for the opening.** L1 holds 60 s of a fresh era rack at full draw. That is about 10 min of a fully awake idle rack, which covers a mid-round boot (10 s at idle) and the D30 climb with room to spare. Staged, it lasts far longer.
   - **Recharge.** Each battery refills fully at Return to market (and auto-return).
     - **Pick: billed at 25% of its site's marginal price (item 4).** Why: it keeps the opening cheap rather than free, makes every round's surge covered whatever the gap between rounds (15 s auto-return included), and keeps offline catch-up deterministic. With renewable off-grid headroom at the site, the marginal price is 0, so the refill is free.
     - The refill is billed on the Return tick and shown in the round report.
   - **Not a supply.** A battery adds no capacity: PDU usage, overload and heat are unchanged. Battery time is billing time only.
   - **Generations and levels.**
     - Generation 0, Lead-acid (kHz, Rack): basic start control.
     - Generation 1, Li-ion (MHz): adds the predictive `busy` trigger and batch waking.
     - Generation 2, LFP (GHz): the largest capacity per level.
     - All three use the flow curve: capacity ×2 per level, L1–11+g; wake latency follows the level (item 2).
     - Price parity: install `≈ 40 × capacityJ × home price`. A battery pays back in about 50 full openings at 75% off.
   - **The Power control unit's face, its plate and the rack LCD** show "BAT 4:12": time left at current draw, counting down only while it discharges. Then they show "GRID", next to the awake count "6/12".
4. **Off-grid generation (Global).**
   - A site part, **Generation**, installed at the site plate.
   - Generations are technologies:
     - Solar farm (`solarFarm`, GHz W12): output × the region's sun factor.
     - Wind farm (`windFarm`, GHz W13): × wind factor.
     - Fuel cell (`fuelCell`, GHz W13): constant output, fuel at 0.4 × region price.
     - Own plant (`ownPlant`, GHz W14): constant and large, fuel at 0.25 × region price.
   - Output is constant in time; the game has no day/night.
   - **Use.** Each tick the site's grid-feed input is met first by generation, up to its output; only the rest is imported at the region price. Generation adds no grid-feed capacity.
   - **Surplus** is lost, except that it sets the site's **marginal price**: 0 for renewables, the fuel price for fuel kinds, the region price without headroom. That price is used for rack-battery refills (item 3) and by the `price` strategy and the global controller's `cheapest` order.
   - **Region factors** (sun, wind):

     | Region | Sun | Wind |
     |---|---:|---:|
     | `us-east` | 1.0 | 1.0 |
     | `us-west` | 1.3 | 0.9 |
     | `eu-west` | 0.8 | 1.2 |
     | `eu-north` | 0.5 | 1.5 |
     | `sa-east` | 1.3 | 0.8 |
     | `af-south` | 1.5 | 1.0 |
     | `ap-southeast` | 1.2 | 0.7 |
     | `ap-northeast` | 0.9 | 1.0 |

     A sunny cheap region gets cheaper, while dear `eu-west` or `ap-northeast` saves most per watt generated.
   - **Sizing and price.** L1 output is 10% of the site's grid-feed generation base; output ×2 per level. Price parity: install `≈ 4 h × output × home price`, renewables 1.5× the fuel kinds.
5. **Eras.**
   - **Rack era (kHz):** Power control gen 0 (`powerCtl`, kHz W8). Racks first idle here.
   - **MHz:** Power control gen 1 (`powerCtlLiIon`, MHz W10), then the room controller (`roomStart`, MHz W11) with Room. `startPredict` (MHz W11) brings the room and global controllers' generation 1.
   - **GHz:**
     - Power control gen 2 (`powerCtlLfp`, GHz W12).
     - Generation (`solarFarm` W12 … `ownPlant` W14).
     - The global controller (`globalStart`, W14) with Regions, the first time there is more than one data center to stage.
   - The node rows are in `docs/research.md`, "D31 proposed nodes"; the sim agent adds them to the tree data after the current CPU-content pass.
6. **Model note (back of envelope; the real sim must measure the climb).** Let `G` be a large GHz fleet's potential gross per second at full use, with full electrical draw about `0.45 G` (a native share of 0.35 plus supply loss and cooling) and idle about `0.045 G`. Assume the D30 climb (utilization under 10%) is 10% of a 25-min round, at about 5% utilization, and the rest runs at 80%. Boot and wake now bill (no free warm-up).

   | Case | Energy share in the climb | Energy share over the round |
   |---|---:|---:|
   | Baseline: all powered, all awake | about 130%: it loses money | 46.8% |
   | Start controllers, generation 0 (powered ≈ 2 × load; sleepers 0.03; standby racks 0) | about 50% | 46.2% |
   | + Power control battery at L1 (covers the climb several times over) | about 12% (only the 25% refill) | 45.6% |
   | + renewable generation at 30% of peak draw | 0% | about 29% |
   | Same with a fuel cell instead | about 20% | about 36% |

   - **Controllers and batteries** fix the opening the user worried about: net per minute turns positive from the first second, boot included. They move the whole-round share by only about 1 point, because idle energy is small next to load once tasks are big.
   - **Off-grid generation** is the whole-round lever.
   - **Sizes and prices** are starting values: balance re-measures the climb's length and share in the real sim and sizes battery L1 to cover it.

**Implementation contract (D31).** One `SAVE_VERSION` bump with a pre-live reset.

*Sim (`src/game/**`):*
- **Modes.** `UNIT_MODES` adds `standby` (powered off by a start controller: 0 W, not a split candidate). Hot `hot.rack.powered`, `hot.zone.powered` and `hot.site.powered` (u8), `hot.sys.wakeT` (exists for S3), plus per-controller `busy10s` (EMA) and `triggerSince` (tick).
- **Split and wake.**
  - `split` excludes `asleep` and `standby` systems, and routers below a `standby` unit.
  - `wake(router, k)` in `net/` picks units in the controller's order.
  - Base demand wake runs in `split` when it returns null for lack of awake room.
  - Controller steps run in a `start` sub-phase at the start of the route step, top-down (global, zones, racks), before the D25 dispatch, and only for powered units.
- **Return to market.** Each powered scope applies its controller's "Start with": global, then zones, then racks. Units without a controller start powered and awake.
- **Parts.**
  - **Rack: `powerCtl`.** A fifth rack infrastructure part, `RackBuild.powerCtl: { gen, level, start: StartCtl } | null`, with gen 0–2 and a flow level: battery capacity ×2 per level, and wake latency by level.
  - **Infra slot.** `InfraSlot` adds `'powerCtl'`, and `QuoteRequest.infra.slot` with it. Install goes through `addPart`/`installInfra` on that slot once researched.
  - **Layout.** The rack layout constant lists the five slots in draw order: cooling, powerCtl, power, lb, switch.
  - **Room and global.** `roomStart` (on the UPS, `ZoneBuild.power.start`) and `globalStart` (on the global scheduler, `GlobalBuild.scheduler.start`) are `StartCtl` parts. Gen 0 is basic; gen 1, from `startPredict`, adds the `busy` trigger and batch waking. Linear levels L1–5 set the wake latency.
  - Actions `setStartConfig { unit: ScopeRef; startWith; headWaitS; busyPct | null; order }`, hot and validated against the part's generation. Upgrades use `upgradePart`.
- **Battery.**
  - Capacity comes from `powerCtl`; hot `hot.rack.batteryJ` (f64), saved.
  - In the power step, while the round runs and the rack is powered, take `min(batteryJ, pduInput × dt)` and bill only the rest.
  - At Return, refill and bill `refillJ × 0.25 × siteMarginalPrice`.
- **Generation.**
  - `SiteBuild.generation: PartLevel | null` (gen 0–3 = solar, wind, fuel cell, own plant); compiled `site.genW` = output × region factor; the region table gains `sun` and `wind`.
  - Ledger: `fromGen = min(gridInput, genW)`, billed at the fuel price; the rest imported at the region price.
  - `siteMarginalPrice` feeds the battery refill, the `price` strategy and the `cheapest` order.
- **Report.** `RoundReport.energy: { billed, fromBattery, batteryRefill, fromGeneration, fuel }`.
- **Tests that matter.**
  1. Delta invariance and owned-vs-pure on a room fixture with all three controllers, batteries and mid-round wakes.
  2. No split ever targets an asleep or standby system.
  3. A gen-0 rack controller started with 1 system wakes the rest within `n` seconds under a rising D30 climb with no head timeouts.
  4. A standby rack draws 0 W and its battery doesn't drain. A rack without Power control powers all its systems at Return.
  5. A rack's first `capacityJ / inputW` seconds of a round (boot included) bill 0, then bill at the price; Return refills it and bills 25%.
  6. A site with a 30% generator imports only draw above its output, and its racks' refills cost 0.
  7. Configuration copy and save round-trip `StartCtl`.

*Render (`src/render/**`):*
- `ServerSlotView.state`: draw `asleep` dim and `standby` dark, with a wake pulse during `wakeT`.
- `RackSlotView` (room) and `ZoneView` / `SiteView` (global) get `powered: boolean` and `wakeMs: number | null`.
- `RackSnapshot.powerCtl: PowerCtlView | null`, where `PowerCtlView` has:
  - `{ generation, level }`;
  - `battery: { capacityJ, chargeJ, secondsLeft: number | null, discharging: boolean }`;
  - `start: StartCtlView` with `StartCtlView { generation, level, startWith, headWaitS, busyPct, order, awake, total, nextWakeInMs }`.
- **The rack cabinet draws a fifth infrastructure unit directly under the cooler**: the Power control box, with a charge bar, the battery time and an awake-count readout. An empty slot draws an empty bay with a lock until researched.
- The rack LCD shows "BAT 4:12", then "GRID", and the awake count "6/12". The slot's hit target opens its plate.
- `RoomSnapshot.power.start` and `GlobalSnapshot.scheduler.start` use `StartCtlView` too.
- `SiteView.generation: { kind, outputW, usedW, marginalPrice } | null`.
- Every light is real: the battery bar drains at the real draw rate.

*UI (`src/ui/**`):*
- **Power control plate** (tap the new slot under the cooling):
  - empty: the add/buy row with its price, or the lock reason;
  - installed: a battery row ("Battery L2 · 4:12 at current draw", charge bar), the upgrade and replace callouts;
  - a **Start** row with three fixed controls: "Start with [n] of 12" stepper, "Wake when head waits [X] s" stepper (plus "or busy ≥ [Y] %" once gen 1), and an "Order" toggle (Slot / Fastest);
  - the tray at Rack lists Power control as a fifth infrastructure item.
- **Room power plate (UPS):** the same Start row for racks (Order: Slot / Coolest).
- **Global scheduler plate:** the same Start row for sites (Order: Slot / Cheapest / Nearest).
- **Site plate:** a Generation row with output, use and fuel, plus its buy and upgrade callout.
- **Configuration plates** show and copy the Start settings.
- **Research view** shows the new nodes. **Round report** adds the energy breakdown lines.
- Controls never move: the steppers keep fixed geometry, and locked options are greyed until their generation is owned.

## 16. Shared rules for agents

- **Shared checkout.** Other agents work in the same checkout at the same time. Edit only the files your brief gives you. Never revert someone else's edits. Run no git command that changes state.
- **Node 24** is at `C:\nvm4w\nodejs`. It isn't on PATH, so prepend it: `export PATH="/c/nvm4w/nodejs:$PATH"`.
- **Dev server:** http://127.0.0.1:6174 (`npm run dev`, strictPort). If it's already up, reuse it.
- **Screenshots:** local headless Chrome over CDP. See `scripts/qa-v2/**`, `%TEMP%/br-final/` and `%TEMP%/br-v2/capture.mjs`.
- **Reports** are short and factual: files changed, decisions taken, how you verified, open questions, and objections to this program.

## Appendix A: the user's v3 requirements, verbatim

> Game Systems Updates
>
> Continue development using Opus subagents.
>
> 1. UI & Infrastructure
>
> The early CPU UI is messy. I don't like the imperfect grid pattern; the system design is much stronger.
>
> System Board
>
> The system board menu bar should contain: CPU, RAM, GPU, Storage. Cooling should not be introduced until the rack level.
>
> Rack
>
> Each rack contains four infrastructure components: Cooling, Power, Load balancer, Switch. Servers occupy the remaining slots and are the only component that can have multiple instances in a rack, you can have up to 12 servers per rack.
>
> New racks include basic cooling, power, switching, and load balancing. Players add systems themselves.
>
> Data Center Room
>
> Replace the component labeled rack with switch. Players purchase racks by clicking the next available slot in the room, as shown in the mockup.
>
> Creating & Saving Infrastructure
>
> Clicking Add New System should open a configuration menu rather than displaying a price. Options: Create a barebones system at an unlocked tier (Hz, kHz, MHz, GHz, etc.). Copy another system in the rack. Load a saved system configuration.
>
> Add a small save icon to each system, rack, and data center room so players can save and name configurations. Saved names should appear only when selecting a new system.
>
> Apply the same concept to creating new racks and data centers.
>
> 2. Gameplay Loop & Tasks
>
> The game starts with a single CPU core at 1 Hz and 1 bit of cache, without a scheduler.
>
> If a task arrives that the CPU cannot handle, it fails and negatively impacts SLA.
>
> - Completing a task immediately starts the next task in the queue.
> - each task much better picked up within 10 seconds or the task is failed, hurting SLA.
> - SLA is global across all systems and persists for the entire round.
> - The round ends when SLA falls below 80%.
> - Systems then stop accepting tasks and enter a paused state without draining credits.
> - Players can return their infrastructure to the market to begin another round.
> - Returning to the market is all-or-nothing. Once players have data centers, all data centers return together, unless they disconnent (take offline) systems, racks, rooms, or data centers. Bringing any of these online or offline while on market takes 10 seconds.
>
> Incoming Tasks
>
> Tasks should be inspired by realistic computing workloads.
>
> - Start with simple CPU operations.
> - Gradually introduce larger tasks requiring RAM, GPUs, storage, and other resources.
> - Eventually include distributed tasks spanning multiple systems and data centers.
> - Cooling and networking aren't necessarily required for individual tasks, but become necessary for tasks spanning systems.
>
> For example, a large LLM workload might require 300 systems, each containing 2 TB of RAM and 8 GPUs. This is only an example, not an actual task requirement.
>
> Players should be able to see the incoming global tasks, separate from any system queue.
>
> Task progression should be relatively consistent between rounds, but not fixed. The complexity curve remains similar while individual tasks vary slightly.
>
> Scheduling
>
> System, network, and data center schedulers introduce the ability to buffer tasks in queues and handle multiple tasks simultaneously.
>
> Researchable scheduling strategies include FIFO, round robin, load balancing, and others.
>
> 3. Research & Progression
>
> The research tree is missing many technologies from the original game. Review the original game and expand it significantly.
>
> Include technologies such as dual-channel RAM, quad-channel RAM, C-states, scheduling algorithms, and other improvements to system efficiency, speed, and capabilities.
>
> Research uses the player's machines and can run:
>
> - During rounds: Consumes resources that would otherwise handle incoming tasks, potentially harming SLA.
> - Between rounds: Consumes credits because systems must run to perform research.
>
> Research should unlock capabilities across systems, networking, power, and cooling.
>
> 4. Networking & Load Balancing
>
> Networking becomes a constraint starting at the rack level and above. Global networking is called the Backbone.
>
> Once a task enters a system, it is limited by that system's internal components. Routing tasks across multiple systems introduces switch speed constraints.
>
> Switches
>
> - Start at approximately 1 kHz, limiting how quickly tasks can arrive at CPUs/systems. tasks are transfered at the total bits a task is.
> - Support progressive upgrades such as 10, 20, 50, 100, 200, 500, 1,000 kHz, followed by MHz, GHz, etc.
> - These are example values; choose appropriate progression values.
> - Allow upgrades to the number of switch ports.
> - Each port has an independent speed upgrade cost.
> - Ports can operate at different speeds.
> - Include a toggle to keep all ports at the same speed, with upgrade costs reflecting the number of ports affected.
>
> Load Balancers
>
> Load balancers occupy a separate rack slot and tell the switch how to route tasks between systems.
>
> At the data center room level, load balancing is built into the network rack in the top-left corner.
>
> Clicking this rack should allow players to configure the load balancer and upgrade network speed and capacity.
>
> 5. Power, Heat & Cooling
>
> Power consumption generates heat, and excessive heat reduces system efficiency.
>
> Power
>
> Power failures can affect individual systems, racks, data center rooms, or entire data centers. Any in-progress work within the affected infrastructure is lost.
>
> - Power fails when usage exceeds 100% of supplied capacity for 10 accumulated seconds.
> - Overload time accumulates while usage exceeds 100%.
> - When usage drops below the threshold, the overload timer cools down at the same rate.
> - For example, 8 accumulated seconds of overload requires 8 seconds to return to zero.
>
> PSU heat generation: up to 90% usage 1×; above 90% 1.5×; above 100% 3×.
>
> Temperature & Efficiency
>
> - Ambient temperature starts at 70°F.
> - Once ambient temperature exceeds 80°F (27°C), system efficiency begins decreasing.
> - Lower efficiency generates more heat.
> - For example, a system with 3:1 efficiency generates 3× more heat than one with 9:1 efficiency.
> - The rack cooler should display rack temperature.
> - ambient temperature of 100 degrees for 10 seconds will cause rack or rooms to crash
>
> Rack & Data Center Cooling
>
> Players can upgrade rack cooling beyond the heat being generated, allowing ambient temperature to fall below 70°F.
>
> Lower temperatures improve efficiency but require additional cooling power. Balance these effects so the strategy is worthwhile without being overpowered.
>
> Rack cooling transfers heat into the data center room. Each rack contributes to room temperature, requiring additional cooling capacity or better cooling technologies as infrastructure expands.
>
> Cooling Research
>
> Rack cooling: Start with air cooling. Research water cooling, which is more efficient and changes temperatures faster.
>
> Data center room cooling: Start with air cooling. Research water cooling. Research closed-loop water cooling. Each subsequent technology is more efficient.
>
> Air cooling should change temperatures slowly, even after system load stops. Water cooling should respond approximately 10× faster than air cooling.
>
> to get more zones (rooms) im a data center you have to unlock the datacenter tier, replace stoage at the data center tier for availability zones, a data center can have multiple az and has its own internal data plane. these then link to other global data centers. its cheaper to add az than new data centers but some taks will start to be region locked.
>
> Attached images: `cpu-ui-system-board.png` is the real game's System board at 22:45 into a run, with floating price labels. `data-center-zone-mockup.png` is the approved mockup's Data center room, where racks are bought by tapping the next room slot.
