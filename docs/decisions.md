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
| System | 30–60 min |
| Rack | **5–8 h** |
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
