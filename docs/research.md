# Research tree

Research designer, 24 October 2026. Inputs: `docs/decisions.md` (binding), IdleBit at `C:\Users\Borg\Documents\GitHub\IdleBit` (`src/game/content/research.ts`, `content/dispatcherJobs.ts`, `content/upgrades.ts`, the tier, cooling, accelerator, facility, cloud and automation definitions, `game-spec.md`, `FEATURES.md`), the v2 tree (the v2 spec §Research and Appendix A, and the v2 mockup research data, both in the BitRouge repository).

The tree has 170 nodes in ten categories, including D12 Auto-skip. The CPU-tab pass added eight later-era CPU nodes (§10). D26 (memory hierarchy) repurposed Virtual memory as Hot pages and added Unified memory. D25 (divisible tasks) turned the gang placements and queued take into split research and deleted Global gang; see §5.5. D15 removed Network speed: port steps open with the structure a link plugs into. The accepted GPU ruling adds nine generation nodes, separates tensor technology from generation unlocks, and adds exact Credit fees for generations 2 through 9. GPU campaign pacing remains unproved. Revision 2 applies the lead's decision log (program §15a, D1): FIFO first-fit load balancing, one shared boot time, VRAM per level, regional prices and outside air, a growing offline cap and cooling generations. Every number below is a starting value for the balance owner unless the program fixes it.

## 1. Rules the tree follows

Implementation status during the GPU wave: §5 and §9 are the accepted reference design, including all 36 CPU/RAM levels and `registeredCapacity { factor: 2 }`. Generated `tree.data.ts` and `tree.text.ts` match that source exactly. Runtime `RESEARCH` in `tree.ts` applies the two explicit overrides in `build/research/runtimeCompatibility.ts`: DDR describes deployed bandwidth-based watts, and RDIMM still grants `ramLevelBonus = 4` to ECC modules. Runtime definitions and research views use that actual effect copy. The 36-level curves, energy ratios and registered capacity multiplier remain pending CPU/RAM integration. Remove each override only after its stated runtime consumers and validation land; see `hardware-progression.md` §7. GPU definitions, fees, prerequisites and effects use the reference unchanged.

1. **Research gates parts, generations, ceilings, strategies and rules.** Levels inside a generation are never gated. The only gated quantities are named ceilings: cores per chip, lanes per core, RAM, GPU and drive slots, CPU sockets, switch ports, uplinks, rows, zones and regions.
2. **A generation needs two nodes.** A part's generation `g` needs the part's base node (for example `l2Cache`) and the node that opens that generation (for example `fabKhz`). This is v2's rule, kept.
3. **Fab nodes move the whole CPU package.** `fabKhz`, `fabMhz` and `fabGhz` open the next generation of every chip part (core, clock, L1, L2, L3, scheduler) and the matching Barebones tier on the configuration plate. RAM, GPU, VRAM, storage, PSU, switch, cooling and supply generations have their own nodes, so the player picks which bottleneck to modernize first. The later CPU/RAM progression ruling gives every clock/RAM generation 36 levels, with overlapping speeds and worsening energy ratios in `hardware-progression.md`. Research opens purchases; it never modernizes installed parts for free or forces replacement at a tier's native rate.
4. **Strategies are chosen per unit and switching is hot.** Changing a strategy, filter or setpoint on a unit is instant and loses no work, in or between rounds.
5. **Network nodes split into three kinds.**
   - Strategies: pick one per load balancer. First-fit is the free default; round robin, least connections, weighted, least work and bin packing are researched.
   - Filters: toggles on a load balancer that remove candidates before the strategy picks. These are capability, health, power, thermal, region and local. A filter that would remove every candidate is skipped for that decision.
   - Split rules (D25): how a router cuts a task into shards. The base is FIFO first-fit spread: equal shares to every child with room. Gather, shard stealing and cross-rack stealing are researched rules. Distributed tasks need no placement research: their `members` is a minimum split, gated by owning enough systems, zones and regions.
   A network strategy or filter, once researched, is available at every network scope the player has opened: rack load balancer, room load balancer, site data plane and backbone scheduler.
6. **No income multipliers.** Every effect changes a rate, a capacity, a watt figure, a loss fraction, a time constant, a ceiling, a routing decision or a latency. Payouts are authored and never touched.
7. **Every node answers something the player can see.** That is a market band entering the feed, or a failure cause in the round report.

### Base behavior before any research

Program D1.5 makes every network scope start as FIFO first-fit.

| Scope | Base |
|---|---|
| Market (D10) | An endless queue. Hardware takes the head when it has room; only the head has a 10 s clock. A head no hardware can run blocks the line. |
| Pipe (D10, D15) | Every system receives tasks over its rack-switch port, a 1 kHz inbound pipe; transfer time = work / speed. It can't be upgraded until the Rack switch exists. |
| System, no scheduler | One task at a time. On completion it takes the head, waits for its transfer, then runs it. |
| Rack load balancer | FIFO first-fit spread (D25.2). The head is split into equal whole-unit shards, one for every server, in slot order, that can admit now: at most 256 and never below the family's grain. A server is full when it is busy with no scheduler or its queue is full; booting, crashed and offline servers count as full. Nothing else is checked: no gates, load or speed. A shard that lands on a server it can't run misroutes and fails the whole task. If every server is full, the head goes into the LB queue (1 slot, upgradable to 32 with Credits); if that is full too, it waits in the market and can expire. |
| Room load balancer | The same spread over racks in slot order; each rack splits its share over its servers. A rack has room when a server can admit or its LB queue has a free slot. |
| Site data plane | The same spread over zones. |
| Global scheduler | The market enters at site 0, the gateway (D4.6). The same spread over sites; other sites are reached over their backbone link to the gateway. Region-blind. |
| Supplies | Loss fractions of generation 0 (§4.3). |
| Coolers | Full duty, no setpoint. |
| Boot time | 10 s, shared by every online/offline transition, post-failure reboot, mid-round add and cold change (D1.8). |

**First-fit piles load on low slots.** Server 1 runs full while server 12 idles. That pushes server 1's board PSU into the ×1.5 and ×3 heat bands and its overload timer. At room scope, rack 1 runs hot and its PDU loads up while later racks sit cool. Slow server 1 also queues work that a fast idle server 5 could finish sooner. The researched strategies answer this: round robin and least connections spread load, weighted and least-work spread it by speed, the health and power filters steer around supplies in trouble, thermal-aware steers around hot racks, and bin packing keeps the concentration but caps it by power headroom so the idle tail can sleep.

## 2. Market bands and problems

Band codes and families are `docs/tasks.md`'s (§4, §5). "I from" is the intensity where the band opens; "reached at" is the model's 24 h player.

| Code | Band | Example families | I from | First level | Model reached at |
|---|---|---|---:|---|---|
| `bits` | Bit ops, 1 thread, tiny working set | Bit Flip, Parity Check, Integer Add | 0 | CPU | 0:00 |
| `ints` | Integer and string work, working set in cache | CRC-32, Regex Match, Integer Sort | 4 | CPU | ~0:03 |
| `threads` | Multi-threaded compute | Hash Batch, LZ Compress, Monte Carlo | 10 | CPU | 0:07 |
| `ram` | Working set beyond cache, RAM stream stages | JSON Parse, Merge Sort, SQL Join | 12.5 | System | 0:13 |
| `gpu` | GPU core and VRAM gates | Thumbnail, Video Transcode, ML Inference | 15 | System | 1:22 |
| `storage` | Data-heavy work: large working sets and many bits touched (D26) | Log Ingest, Backup, Index Build | 16.5 | System | 1:22 |
| `rackDist` | Distributed, members fit in one rack | Replicated Write, MapReduce, Training Shard | 26 | Rack | 2:02 |
| `roomDist` | Distributed across racks in one zone | TeraSort, Render Farm, Large Training | 32 | Room | 3:48 |
| `multiAz` | Members in at least 2 zones | Active-Active DB, Quorum Write, Multi-hall Train | 41 | Data center | 6:08 |
| `region` | Needs a site in a named region | EU Residency, APAC Payments, Exchange Feed | 46.5 | Regions | 14:06 |

| Problem code | What the round report says |
|---|---|
| `pickup` | Not picked up within 10 s |
| `misroute` | Routed to a system that can't run it |
| `gate` | No online hardware can run it |
| `overload` | Supply failed, work lost |
| `heat` | Efficiency loss or thermal crash |
| `energy` | Net income eaten by the energy bill |
| `transfer` | Payload transfer too slow for pickup or completion |
| `downtime` | Work lost to a cold change, boot or offline toggle |
| `density` | Not enough capacity per server slot, rack slot or room slot |
| `idle` | Absent player, market not rejoined |

## 3. Work tiers

Research has two costs (D3): **Data**, paid in full when the project starts, and **compute work**, which runs on the player's machines. The Credit cost of the work is the energy they draw while doing it.

Under D19 both are fitted to the real campaign bot through Room and to the design model beyond it (§3.1).

The CPU/RAM progression revision changes that model's clock, bandwidth, capacity and energy assumptions. The timing tables below are prior calibration targets, not proof of the revised rules. Re-prove Data and work affordability on profitable prior-era fleets before requiring each fab; see `hardware-progression.md` §6. No new THz/PHz CPU fab is added.

### 3.1 Eras under D19

D19 stretches the game to months. Data and work are now fitted to the real campaign bot through Room and to the design model's engaged idle player beyond it (`scripts/market-model.ts --horizon=100`). The 24 h model windows this section used to list are superseded.

| Era (node that opens it) | Window (D19 target) | Real bot (seed 42) | Model (check-in player) |
|---|---|---|---|
| CPU, round 1 | 0:00–0:05 | round 1 ends 4:38–4:50 (1:00 without purchases) | — |
| System (`systemBoard`) | 30–60 min | 0:53 | 0:51 |
| kHz (`fabKhz`) | — | 3:33 | 3:33 |
| Rack (`rack`) | 5–8 h | 6:48 | 6:48 |
| MHz (`fabMhz`) | — | about 1 d 6 h | 1 d 20 h |
| Room (`room`) | 2–4 days | 3 d 2 h – 3 d 6 h | 2 d 19 h |
| GHz (`fabGhz`) | — | see `docs/tasks.md` §9 | 6 d 23 h |
| Data center (`dataCenter`) | about 1–2 weeks | see `docs/tasks.md` §9 | 10 d 18 h |
| Regions (`regions`) | 2–4 weeks | — | 20 d 18 h |
| Every data center (max fleet) | 2–4 months | — | 92 d 8 h |

### 3.2 Work tiers

D27 makes research a task that cuts the line: it holds a slot and its threads on the systems that take it, and the market waits behind it. So work is sized as **about N seconds of the era's typical hardware at unlock**: the mid-era clock (`docs/balance/hardware-progression/cpu_cost_spec.csv`) times the usual cores and lanes at that level. N is 10–20 s at the CPU level, where research holds the only core and the head behind it waits, and grows to about a minute from System on and a few minutes from Rack on. Between rounds every powered server takes it, on all its threads.

| Tier | Work (ops) | Era | Typical hardware at unlock | Duration |
|---|---:|---|---|---|
| W1 | 20 | CPU, round 1 (roots) | 1 core, 2–4 Hz | 5–10 s |
| W2 | 600 | CPU, round 2 | 1–2 cores, about 20 Hz, 2 lanes | about 15 s |
| W3 | 5,000 | CPU, rounds 2–4 | 2–4 cores, 50–100 Hz, 2 lanes | about 15 s |
| W4 | 1.5e5 | System opens | 4 cores, 0.3–1 kHz, 4 lanes | about 20 s |
| W5 | 3e5 | System, kHz | 2–4 cores, 0.5–2 kHz, 2–4 lanes | about 30 s |
| W6 | 1e6 | Late System, `rack` | the first kHz package, about 3e4–1e5 ops/s | 10–30 s |
| W7 | 3e7 | kHz, Rack | one kHz system to a starter rack, 2e5–1e6 ops/s | 30 s – 2 min |
| W8 | 2e8 | Rack, early | a starter rack, 1e6–1e7 ops/s; one thread per system in a round | 20–200 s between rounds |
| W9 | 5e9 | Rack, late, `fabMhz` | — | 3–4 h |
| W10 | 2e10 | MHz, `room` | — | about 12 h: the Room save-up is research time as much as Data |
| W11 | 2.5e10 | Room, `fabGhz` | — | about a day at the Room-entry fleet (research gets 1e5–5e5 ops/s); less as rooms fill |
| W12 | 3e10 | GHz, `dataCenter`, `zoneAware` | — | 1–2 days on the real Room fleet |
| W13 | 4e10 | Data center, `regions` | — | days |
| W14 | 6e10 | Regions, `intercontinental` | — | model era |
| W15 | 1e11 | Late regions | — | model era |

### 3.3 Data cost

Structure unlocks and fab generations cost 3× their tier, so each era jump is a save-up target: `systemBoard`, `fabKhz`, `rack`, `fabMhz`, `room`, `fabGhz`, `dataCenter`, `regions` and `intercontinental`. The real bot saves for the next milestone's path and spends at most a quarter of it on other nodes.

| Tier | Data | Milestone Data | Against the real Data income |
|---|---:|---:|---|
| W1 | 1 | 3 | First whole Data at 0:10 |
| W2 | 100 | 300 | Round 1 earns about 2,000 Data |
| W3 | 1,000 | 3,000 | Rounds 2–4 earn about 4,000 each |
| W4 | 12,000 | 36,000 | `systemBoard` lands at 0:46–0:53 under the 1 kHz pipe cap (D19: 30–60 min) |
| W5 | 15,000 | 45,000 | Pre-Rack Data income is about 60,000 per hour |
| W6 | 50,000 | 150,000 | `fabKhz` at 3:33 and `rack` at 6:20; **Rack** opens at 6:40–6:48 (D19: 5–8 h) |
| W7 | 1e6 | 3e6 | Rack-era nodes: 10–20 min of Rack Data (5e6–6e6 per hour) |
| W8 | 4e6 | 1.2e7 | under an hour of Rack Data |
| W9 | 1.5e7 | 4.5e7 | — | `fabMhz` at about 1 d 6 h |
| W10 | 4e7 | 1.2e8 | — | `room` starts at about 2 d 8 h; **Room** opens at 3 d 2 h – 3 d 6 h (D19: 2–4 days) |
| W11 | 6e7 | 1.8e8 | — | Room era: `fabGhz`, `stealRoom` |
| W12 | 2e8 | 6e8 | — | `dataCenter` (D19 zones: about 1–2 weeks) |
| W13 | 4e8 | 1.2e9 | — | `regions` (D19: 2–4 weeks) |
| W14 | 3e9 | 9e9 | — | `intercontinental` |
| W15 | 1e10 | 3e10 | — | Late regions; every data center at 2–4 months (model) |

W11–W15 are starting values from the real Room-era Data income (about 6e6 per hour while the bot holds one rack) and the design model's D19 timeline; the real chain proves them as far as it reaches (`docs/tasks.md` §9). Every value is an exact whole number as a double; the wallet holds Data as an exact integer.

## 4. Generation ladders and ceilings

### 4.1 Part generations

Names are proposals; the spec owner may rename them.

| Part | Gen 0 (opened by) | Gen 1 | Gen 2 | Gen 3 | Gen 4 | Gen 5 |
|---|---|---|---|---|---|---|
| Core, Clock, L1, Scheduler, CPU package | Hz (start) | kHz `fabKhz` | MHz `fabMhz` | GHz `fabGhz` | | |
| L2 / L3 | `l2Cache` / `l3Cache` | kHz `fabKhz` | MHz `fabMhz` | GHz `fabGhz` | | |
| RAM | SDRAM `memController` | DDR `ddr` | DDR2 `ddr2` | DDR3 `ddr3` | DDR4 `ddr4` | DDR5 `ddr5` |
| GPU adapter index | displayed gen 1 `gpuGen1` | displayed gen 2 `gpuGen2` | displayed gen 3 `gpuGen3` | displayed gen 4 `gpuGen4` | displayed gen 5 `gpuGen5` | displayed gen 6 `gpuGen6`; indices 6/7/8 are displayed gens 7/8/9, `gpuGen7`/`gpuGen8`/`gpuGen9` |
| NPU | `npu` | `npu` + `gpuGen2` | `npu` + `tensorCores` | `npu` + `matrixGpu` | | |
| Storage | HDD `storageCtl` | SSD `ssd` | NVMe `nvme` | Storage-class memory `scm` | | |
| Board PSU | Bench supply `systemBoard` | 80 Plus `psu80` | Bronze `psuBronze` | Gold `psuGold` | Platinum `psuPlatinum` | Titanium `psuTitanium` |
| Rack cooler (D1.11, spec A.2: air gens 0–1, water gens 2–3) | Fan tray `rack` | High-flow air `rackAir2` | Rear-door water `rackWater` | Direct-to-chip water `rackWater2` | | |
| Rack PDU | Basic PDU `rack` | Metered `meteredPdu` | Switched `switchedPdu` | | | |
| Load balancer (one generation; D18.3 deleted `lbL4` and `lbAsic`) | Basic LB `rack` | | | | | |
| Rack switch | 500 GHz `rack` | 5 THz `sw100k` | 2 PHz `sw1M` | 20 PHz `sw10M` | 5 EHz `sw100M` | 50 EHz `sw1G`; gen 6 500 EHz `sw10G` |
| Room switch | 50 PHz `rack` | 500 PHz `sw100k` | 5 EHz `sw1M` | 50 EHz `sw10M` | 500 EHz `sw100M` | 5 ZHz `sw1G`; gen 6 50 ZHz `sw10G` |
| Room cooler (spec A.2: air gens 0–1, water 2–3, closed loop 4–5) | CRAC `room` | High-flow CRAC `roomAir2` | Chilled water `chilledWater` | High-delta chilled water `chilledWater2` | Closed loop `closedLoop` | Two-phase closed loop `closedLoop2` (gen 5) |
| Room UPS | Standby UPS `room` | Online UPS `upsOnline` | Lithium UPS `upsLithium` | | | |
| Data plane | Copper `dataCenter` | Fiber `dpFiber` | DWDM `dpDwdm` | | | |
| Grid feed | Utility feed `dataCenter` | Substation `substation` | HV intake `hvIntake` | | | |
| Backbone | Leased line `regions` | Dark fiber `bbDarkFiber` | DWDM `bbDwdm` | Subsea `bbSubsea` | | |

**Switch generations cap port and uplink speed.** Ports and uplinks share one 1-2-5 ladder range per generation. D12 re-bases the tops to fit uplinks: 12 times a native server at L36 at Rack, 288 times at Room. The native server reference is 8/16/32 cores with 2/4/8 native lanes at kHz/MHz/GHz and clock multiplier 1.5^35. Room opens at MHz, so even its gen-0 switch fits MHz traffic. Round up to a ladder rung and raise each later generation's top by at least 10×. Data-plane ports fit one 288-server GHz room, and a backbone link fits three zones.

The starter Rack range still starts at 1 kHz. Its top rises to 500 GHz so the shared range also fits uplinks, superseding A.3's proposed 1 GHz starter top. Every other base is its top divided by 1,000. Ports can therefore buy uplink-scale speeds; prices, power and the port/uplink tension need a balance pass. Stable research IDs retain their old speed suffixes, while names identify generations.

### 4.2 Ceilings

Fleet caps follow `docs/architecture.md` §1.9. The largest fleet is 8 sites × 3 zones × 24 racks × 12 servers = 6,912 servers.

| Ceiling | Start | Ladder (node) |
|---|---|---|
| Servers per rack | 12 | user rule, no node |
| Cores per CPU | 1 | 2 `dualCore`, 4 `quadCore`, 8 `octaCore`, 12 `ringBus`, 16 `cores16`, 24 `meshCores`, 32 `chiplets` (cap, D7.2) |
| Scheduler queue Q and running K | Q 2, K 1 | levels; Q ≤ 32, K ≤ 32 and ≤ cores (D7.2) |
| Lanes per core | 1 | 2 `pipelining`, 4 `superscalar`, 8 `outOfOrder`, 12 `branchPredict`, 16 `simd`, 24 `fma`, 32 `wideVector`, 64 `dualVector`, 112 `matrixTiles` (the GHz core's L14 top) |
| L3 levels past `11 + g` | 0 | 1 `l3Slices`, 2 `edramL3` |
| Hardware threads per core | 1 | 2 `smt` |
| CPU sockets per system | 1 | 2 `dualSocket`, 4 `quadSocket`; 2 on accelerator systems |
| RAM slots | 1 | 2 `dualChannel`, 4 `quadChannel` (general cap); 8 on accelerator systems `accelSystem` (8-channel bandwidth `octaChannel`) |
| Registered ECC capacity multiplier | 1 | ×2 `rdimm`; clock/RAM level cap stays 36 |
| GPU slots | 1 | 2 `dualGpu` (general cap); 8 on accelerator systems `accelSystem` |
| Configuration efficiency `η_cfg` | 1.00 | sockets 1/2/3/4: 1.00/0.92/0.85/0.78; DIMMs 1–2: 1.00, 3: 0.95, 4: 0.90; none on accelerator boards up to 8 DIMMs (D7.5) |
| Drive slots | 1 | 4 `raid0` |
| Rack switch ports | 4 | 8 `portExpansion`, 12 `densePorts` |
| Room switch ports | 4 | 8 `portExpansion`, 16 `densePorts`, 24 `spineLeaf` (one per rack) |
| Uplinks per switch | 1 | 2 `lag`, 4 `lag4` |
| Research queue | 1 | 3 `researchQueue` |
| Racks per room | 16 (2 rows of 8) | 24 (3 rows) `hallExpansion` |
| Zones per site | 2 | 3 `zoneExpansion` |
| Sites, one per region | 1 | 4 `regions` (home + 3), 8 `intercontinental` |

### 4.3 Supply loss fractions

Program §7 says better generations lower the loss fraction. These are starting values.

| Supply | Gen 0 | Gen 1 | Gen 2 | Gen 3 | Gen 4 | Gen 5 |
|---|---|---|---|---|---|---|
| Board PSU | 30% | 20% | 15% | 10% | 7% | 4% |
| Rack PDU | 4% | 3% | 2% | | | |
| Room UPS | 12% | 6% | 3% | | | |
| Grid feed | 5% | 3% | 2% | | | |

## 5. The tree

Columns: id, short name, prerequisites, the zoom level where it first matters, era and work tier, the mechanical effect, and what it answers. An empty prerequisite cell means the node is a root.

### 5.1 Compute (29)

| id | Name | Requires | Level | Era / tier | Effect | Short | Answers |
|---|---|---|---|---|---|---|---|
| `pipelining` | Pipelining | | CPU | Hz W3 | Lane ceiling per core 1→2. The Core plate can now buy lane levels. | Cores run 2 ops a cycle | `bits`, `pickup` |
| `superscalar` | Superscalar | pipelining | CPU | Hz W4 | Lane ceiling 2→4. | Cores run 4 ops a cycle | `ints` |
| `outOfOrder` | Out-of-order | superscalar, fabKhz | CPU | kHz W7 | Lane ceiling 4→8. | Cores run 8 ops a cycle | `ints`, `threads` |
| `simd` | SIMD | outOfOrder, fabMhz | CPU | MHz W10 | Lane ceiling to 16. | Cores run 16 ops a cycle | `threads`, `rackDist` |
| `wideVector` | Wide vectors | simd, fabGhz | CPU | GHz W12 | Lane ceiling to 32. | Cores run 32 ops a cycle | `roomDist` member specs |
| `branchPredict` | Branch prediction | outOfOrder, rack | CPU | kHz W8 | Lane ceiling 8→12: a kHz core (2 base lanes) reaches L6 of its 10 levels. Lanes past native push the core's energy ratio down (`hardware-progression.md` §3). | Cores run 12 ops a cycle | `threads`, `pickup` |
| `fma` | Fused multiply-add | simd, room | CPU | MHz W11 | Lane ceiling 16→24: an MHz core (4 base lanes) reaches L6 of 12. | Cores run 24 ops a cycle | `rackDist`, `roomDist` |
| `dualVector` | Dual vector units | wideVector, dataCenter | CPU | GHz W13 | Lane ceiling 32→64: a GHz core (8 base lanes) reaches L8 of 14 and an MHz core its L12 top. | Cores run 64 ops a cycle | `multiAz`, `density` |
| `matrixTiles` | Matrix tiles | dualVector, regions | CPU | GHz W14 | Lane ceiling 64→112: a GHz core reaches its L14 top (8 × 14 lanes). From here every core generation is limited only by its catalog range (spec §12.1, `8 + 2g`). | Cores run 112 ops a cycle | `region`, `density` |
| `dualCore` | Dual core | fifoSched | CPU | Hz W3 | Core sites 1→2. The Core tray item is enabled. | Up to 2 cores per CPU | `pickup`, `bits` |
| `quadCore` | Quad core | dualCore, l2Cache | CPU | Hz W4 | Core sites 2→4. | Up to 4 cores per CPU | `threads` |
| `octaCore` | 8 cores | quadCore, fabKhz | CPU | kHz W7 | Core sites 4→8. | Up to 8 cores per CPU | `threads`, `density` |
| `cores16` | 16 cores | octaCore, fabMhz | CPU | MHz W10 | Core sites to 16. | Up to 16 cores per CPU | `rackDist`, `density` |
| `chiplets` | Chiplets | cores16, fabGhz | CPU | GHz W12 | Core sites to 32, the cap per CPU (D7.2). | Up to 32 cores per CPU | `roomDist`, `density` |
| `stacked3d` | Stacked cache | chiplets, dataCenter | CPU | GHz W13 | Cores stay capped at 32 (D7.2), so this is cache. L3 gen 4 (stacked SRAM): 8× L3 capacity per level at gen 3's watts, so big per-member working sets fit in cache. | Stacked L3: 8× cache per level | `region` member specs, `density` |
| `ringBus` | Ring bus | octaCore, rack | CPU | kHz W8 | Core sites 8→12. | Up to 12 cores per CPU | `threads`, `density` |
| `meshCores` | Mesh interconnect | cores16, room | CPU | MHz W11 | Core sites 16→24; `chiplets` takes them to the 32 cap. | Up to 24 cores per CPU | `roomDist`, `density` |
| `l3Slices` | L3 slices | l3Cache, fabMhz | CPU | MHz W10 | `l3LevelBonus` 0→1: every L3 generation gets one level past its `11 + g` top, 2× the top capacity, on the usual flow price and watt curves. | L3 cache gets 1 more level | `ram`, `rackDist` |
| `edramL3` | eDRAM L3 | l3Slices, fabGhz | CPU | GHz W12 | `l3LevelBonus` 1→2: two levels past the `11 + g` top, 4× the normal top capacity. | L3 cache gets 2 more levels | `ram`, `roomDist` |
| `fabKhz` | kHz fab | systemBoard, pipelining | System | kHz W4 | Gen 1 of core (2 base lanes), clock (1 kHz base), L1, L2, L3, scheduler and CPU package. Opens Barebones kHz. | Opens kHz chips and Barebones kHz | all bands, `energy` |
| `fabMhz` | MHz fab | fabKhz, rack | Rack | MHz W9 | Gen 2 of every chip part. Opens Barebones MHz. | Opens MHz chips and Barebones MHz | all bands, `energy` |
| `fabGhz` | GHz fab | fabMhz, room | Room | GHz W11 | Gen 3 of every chip part. Opens Barebones GHz. | Opens GHz chips and Barebones GHz | all bands, `energy` |
| `l2Cache` | L2 cache | pipelining | CPU | Hz W3 | New chip part L2, shared by all cores. Capacity 8× an L1 of the same level, for 2× the watts. Adds to the cache tier (D26): bits that fit cache cost no memory time, so bigger cache speeds RAM-heavy work and delays spill. | Adds shared L2 cache, 8× L1 size | `ints`, `gate` |
| `l3Cache` | L3 cache | l2Cache, systemBoard | System | Hz W5 | New chip part L3, shared. Capacity 64× an L1 of the same level, for 6× the watts. | Adds shared L3 cache, 64× L1 size | `ints`, `ram` before RAM |
| `smt` | SMT | timeSlice, octaCore | CPU | kHz W7 | Each core holds 2 running tasks. Scheduler K may reach 2× cores, still at most 32. Two tasks on one core each run at 0.6× the core's rate (1.2× combined). | Each core runs 2 tasks at once | `pickup` |
| `dualSocket` | Dual socket | octaCore, rack | System | kHz W8 | CPU sockets 1→2. Every CPU in a system is identical: CPU 2 copies CPU 1's generation and levels, and an upgrade applies to all, priced × CPU count. All cores pool under one scheduler (D7.3). Socket factor 0.92 in `η_cfg` (D7.5). A task whose threads span sockets runs its RAM stream stages at 0.5× bandwidth. | Up to 2 CPUs per system | `density`, `threads` |
| `quadSocket` | 4 sockets | dualSocket | System | kHz W9 | CPU sockets 2→4 (3 and 4). Socket factors 0.85 and 0.78. Denser per rack slot and switch port, less efficient than several small boxes. | Up to 4 CPUs per system | `density`, `rackDist` member specs |
| `dma` | DMA engine | memController | System | Hz W5 | While a shard is in the RAM or disk part of a memory stage (D26), its core is free for another shard. The shard keeps its scheduler K slot. | Cores free up during RAM and disk. | `ram`, `storage` |
| `prefetch` | Prefetcher | dma, l3Cache | System | kHz W6 | The shard at the front of the system queue is placed in the memory hierarchy early, and its first RAM part runs with RAM bandwidth no running shard is using (D26). | Queued shards preload from RAM | `ram` |

### 5.2 Memory (13)

| id | Name | Requires | Level | Era / tier | Effect | Short | Answers |
|---|---|---|---|---|---|---|---|
| `memController` | Memory ctrl | systemBoard | System | Hz W4 | RAM part gen 0 (SDRAM), 1 slot: the second memory tier (D26). Working sets that overflow cache sit in RAM and their traffic runs at RAM bandwidth; RAM adds to the hierarchy that gates them. | Adds RAM: 1 SDRAM slot | `ram`, `gate` |
| `ddr` | DDR | memController | System | Hz W5 | RAM gen 1: 2× gen-0 native bandwidth and capacity. Both generations have 36 levels; watts use the era's energy ratio, not a free bandwidth multiplier. | Opens DDR RAM: 2× speed and size | `ram` |
| `ddr2` | DDR2 | ddr, fabKhz | System | kHz W7 | RAM gen 2. | Opens DDR2 RAM | `ram` |
| `ddr3` | DDR3 | ddr2, fabMhz | System | MHz W10 | RAM gen 3. | Opens DDR3 RAM | `ram`, `rackDist` |
| `ddr4` | DDR4 | ddr3, room | Room | MHz W11 | RAM gen 4. | Opens DDR4 RAM | `roomDist` |
| `ddr5` | DDR5 | ddr4, fabGhz | Global | GHz W12 | RAM gen 5. | Opens DDR5 RAM | `multiAz` member specs |
| `dualChannel` | Dual channel | memController | System | Hz W5 | RAM slots 1→2. Capacity always sums. Two matched modules (same generation and level) run in dual channel: 2× module bandwidth; mismatched modules run single channel. No efficiency cost at 2 DIMMs. | 2 RAM slots; matched pairs 2× speed | `ram` |
| `quadChannel` | Quad channel | dualChannel, fabKhz | System | kHz W7 | RAM slots 2→4, the cap on a general system (D7.4). Four matched modules run quad channel. DIMM factors 0.95 at 3 and 0.90 at 4 in `η_cfg` (D7.5). | 4 RAM slots; matched sets 4× speed | `ram` |
| `octaChannel` | 8 channels | quadChannel, accelSystem, fabMhz | System | MHz W10 | On an accelerator system, 8 matched modules run 8-channel: 8× module bandwidth. General systems stay at 4 slots. | 8-channel RAM on accelerator boards | `gpu`, `roomDist` |
| `ecc` | ECC memory | ddr2, rack | Rack | kHz W8 | RAM modules can be bought as ECC: 1.25× price, 1.1× watts. Tasks with gate `ecc` need ECC RAM on every system they touch. | Buy ECC RAM for ECC tasks | `storage`, `rackDist`, `gate` |
| `rdimm` | Registered DIMM | quadChannel, ecc | Rack | MHz W9 | ECC module capacity ×2 at the same level and bandwidth. Every RAM generation still has all 36 levels. Replaces the old +4-level effect. See `hardware-progression.md`. | ECC RAM capacity ×2 | `rackDist`, `roomDist` per-member RAM |
| `lowVoltRam` | Low-voltage RAM | ddr2 | System | kHz W7 | RAM idle and load watts ×0.7 at the same rates. | RAM watts ×0.7 | `energy`, `overload` |
| `hotPages` | Hot pages | memController, storageCtl | System | Hz W5 | Rule (D26; was Virtual memory, now base): a spilled shard's hot data stays in fast tiers. Its disk traffic is `f_d²` of its memory traffic instead of `f_d`; the rest runs from RAM. A shard 25% on disk does 6% of its traffic there. | Spilled tasks touch disk less | `storage`, `ram` |

### 5.3 Acceleration (18)

GPU display generations are 1 through 9; `gen("gpu", g-1)` is their generic adapter effect. Every node opens 24 preconfigured models. Tier and hot upgrades cost Credits without extra research. GPU specs, exact prices, energy rules and fixed family core floors are in `gpu-progression.md`; execution follows the accepted `gpu-runtime.md`. GPU gates are cores and VRAM, never clock or device count.

Generation research charges the following Credit fee once at actual start, in addition to its Data cost and hardware work. Queuing debits neither currency. Wait until both balances cover the costs, then debit atomically. Switching and resuming retain paid status. Cancellation refunds neither cost. Non-generation acceleration nodes retain zero Credit fee.

| ID | Name | Requires | Level | Era / tier | Effect | Answers |
|---|---|---|---|---|---|---|
| `gpuGen1` | GPU gen 1, 1 kHz | memController | System | Hz W5 | Opens gen-1 models; 15,000 Data, 0 Credits, 1,500,000 work ops. | Opens 1 kHz GPU models | `gpu` |
| `gpuGen2` | GPU gen 2, 10 kHz | gpuGen1, fabKhz | System | kHz W7 | Opens gen-2 models and legacy NPU g1 when `npu` is also complete; 1,000,000 Data, 640,000,000 Credits, 200,000,000 work ops. | Opens 10 kHz GPU models | `gpu` |
| `gpuGen3` | GPU gen 3, 100 kHz | gpuGen2, rack | System | kHz W8 | Opens gen-3 models; 4,000,000 Data, 6,400,000,000 Credits, 1,000,000,000 work ops. | Opens 100 kHz GPU models | `gpu` |
| `gpuGen4` | GPU gen 4, 1 MHz | gpuGen3, fabMhz | System | MHz W10 | Opens gen-4 models; 40,000,000 Data, 64,000,000,000 Credits, 20,000,000,000 work ops. | Opens 1 MHz GPU models | `gpu` |
| `gpuGen5` | GPU gen 5, 10 MHz | gpuGen4, room | System | MHz W11 | Opens gen-5 models; 60,000,000 Data, 640,000,000,000 Credits, 25,000,000,000 work ops. | Opens 10 MHz GPU models | `gpu` |
| `gpuGen6` | GPU gen 6, 100 MHz | gpuGen5, fabGhz | System | GHz W12 | Opens gen-6 models; 200,000,000 Data, 6,400,000,000,000 Credits, 30,000,000,000 work ops. | Opens 100 MHz GPU models | `gpu` |
| `gpuGen7` | GPU gen 7, 1 GHz | gpuGen6, dataCenter | System | GHz W13 | Opens gen-7 models; 400,000,000 Data, 64,000,000,000,000 Credits, 40,000,000,000 work ops. | Opens 1 GHz GPU models | `gpu` |
| `gpuGen8` | GPU gen 8, 10 GHz | gpuGen7, regions | System | GHz W14 | Opens gen-8 models; 3,000,000,000 Data, 640,000,000,000,000 Credits, 60,000,000,000 work ops. | Opens 10 GHz GPU models | `gpu` |
| `gpuGen9` | GPU gen 9, 100 GHz | gpuGen8, intercontinental | System | GHz W15 | Opens gen-9 models; 10,000,000,000 Data, 6,400,000,000,000,000 Credits, 100,000,000,000 work ops. | Opens 100 GHz GPU models | `gpu` |
| `tensorCores` | Tensor cores | gpuGen4 | System | MHz W10 | Tensor stages on GPUs of displayed gen 4+ run at 4 times ordinary rate. Opens legacy NPU g2 when `npu` is complete. No GPU generation unlock. | Tensor work 4× on 1 MHz+ GPUs | `gpu`, `rackDist` |
| `matrixGpu` | Matrix engines | tensorCores, gpuGen6 | System | GHz W12 | Tensor stages on GPUs of displayed gen 6+ run at 8 times ordinary rate, replacing 4. Opens legacy NPU g3 when `npu` is complete. No GPU generation unlock. | Tensor work 8× on 100 MHz+ GPUs | `roomDist`, `multiAz` |
| `gddr6` | GDDR6 | gpuGen2 | System | kHz W7 | GPU and legacy NPU VRAM total multiplier becomes 4. No separate VRAM part. | GPU VRAM ×4 | `gpu` VRAM gates |
| `unifiedMemory` | Unified memory | hbm, gpuGen8 | System | GHz W14 | Rule (D26.4): GPU VRAM pools with system RAM. A shard's VRAM need beyond the card's free VRAM sits in free RAM, then on disk. GPU ops on those bits add RAM- and disk-rate traffic. Without it VRAM is a hard gate. | VRAM overflows to RAM and disk | `gpu`, `roomDist` |
| `hbm` | HBM | gddr6, fabMhz | System | MHz W10 | GPU and legacy NPU VRAM total multiplier becomes 16. Halves only GPU VRAM idle watts; NPU watts retain their own rule. | GPU VRAM ×16, half idle watts | `roomDist` |
| `dualGpu` | Dual GPU | gpuGen2, fabKhz | System | kHz W7 | Shared GPU/NPU slots 1 to 2, the general-board cap. | Up to 2 GPUs per system | `gpu` |
| `accelSystem` | Accelerator box | dualSocket, quadChannel, dualGpu | Rack | kHz W8 | Adds an accelerator board with 2 CPU sockets, 8 RAM slots and 8 shared GPU/NPU slots, with no DIMM penalty up to 8. A density choice for specialized work; no family requires eight GPU devices. | Adds accelerator board: 8 GPU slots | `gpu`, `rackDist`, `roomDist`, `density` |
| `gpuLink` | GPU link | dualGpu, gpuGen2 | System | kHz W7 | Links actual GPUs only. Cores, VRAM and per-card rates sum. NPUs remain separate. Without link, one actual card must pass both gates. | Linked GPUs pool cores and VRAM | `gpu` VRAM gates |
| `npu` | NPU | gpuGen2 | System | kHz W7 | Opens the frozen four-row legacy NPU catalog through its AND gates. Tensor-only tasks with zero GPU-core minimum may use a fitting NPU. No parity with the newest GPU generation. | Opens NPUs for tensor-only tasks | `energy` on inference |

NPU base rates, VRAM, tensor factors, prices and power stay explicit in `gpu-progression.md`. Higher NPU generations require both `npu` and the row's gate above, through the existing base-generation rule. NPU research uses its legacy tensor rate, as specified by the runtime contract; GPU research uses ordinary rate.

### 5.4 Storage (7)

| id | Name | Requires | Level | Era / tier | Effect | Short | Answers |
|---|---|---|---|---|---|---|---|
| `storageCtl` | Storage | systemBoard | System | Hz W5 | Storage part gen 0 (HDD), 1 drive slot: the disk tier (D26). No task needs a drive; a drive lets a small machine take a task whose working set overflows RAM, at drive IO speed. | Adds the disk tier: 1 HDD slot | `storage`, `gate` |
| `ssd` | SSD | storageCtl, fabKhz | System | kHz W7 | Storage gen 1: disk-tier IO 2,000 bit/s at L1 (1/16 of DDR2), 16× an HDD per level. | Opens SSD storage: faster spill | `storage` |
| `nvme` | NVMe | ssd, fabMhz | System | MHz W10 | Storage gen 2: disk-tier IO 1.6e7 bit/s at L1, 1/4 of DDR3 bandwidth. | Opens NVMe: spill at 1/4 RAM speed | `storage`, `rackDist` |
| `scm` | Storage-class mem | nvme, fabGhz | System | GHz W12 | Storage gen 3: disk-tier IO 6.4e10 bit/s at L1, 1/2 of DDR5 bandwidth. | Opens SCM: spill at 1/2 RAM speed | `multiAz` |
| `raid0` | Striping | storageCtl | System | Hz W6 | Drive slots 1→4. The disk tier's rate is the sum of all drives' IO rates; capacity sums. | Up to 4 drives, speeds add up | `storage` |
| `ncq` | Command queuing | ssd | System | kHz W7 | Drives serve up to 4 shards' disk traffic at once, sharing their rate. Base drives serve one at a time. | Drives serve 4 shards at once | `storage`, `pickup` |
| `sharedStorage` | Rack storage | raid0, rack | Rack | kHz W8 | A server slot may hold a storage node: a disk tier shared by the rack (D26). A server's working set spills onto it after its own drives; that traffic crosses both servers' switch ports. | Adds a shared rack disk tier | `storage`, `density` |

### 5.5 Scheduling (25)

System scope (the scheduler chip part):

| id | Name | Requires | Level | Era / tier | Effect | Short | Answers |
|---|---|---|---|---|---|---|---|
| `fifoSched` | FIFO scheduler | | CPU | Hz W1 | Scheduler part gen 0: queue Q = 2, K = 1 at L1; levels raise Q and K. Q is at most 32; K is at most 32 and at most the system's cores (D7.2). Strategy FIFO: oldest first. | Adds a 2-slot queue | `pickup` |
| `sjf` | Shortest job first | fifoSched | CPU | Hz W2 | Strategy SJF: the queued task with the least work at this system's rates starts first. Slots free sooner, so the head is taken sooner. A large queued task can wait behind later small ones. The market order never changes. | Scheduler: shortest job first | `bits`, `ints` |
| `timeSlice` | Time slicing | fifoSched | CPU | Hz W2 | Strategy time slicing: admits up to 2× K tasks; running tasks share cores in 100 ms slices, so n tasks on c cores each progress at c/n. Pickup stays fast; completion slows. | Scheduler: time slicing, 2× tasks | `pickup` |
| `priorityQ` | Priority | sjf | CPU | Hz W3 | Strategy priority: highest payout per unit work first. Trades task count for Credits. | Scheduler: best pay first | `energy`, late-round earnings |
| `mlfq` | Aging (MLFQ) | sjf, timeSlice | CPU | Hz W3 | Strategy MLFQ: SJF, but a queued task that has waited 3 s or more starts first. No queued task starves. | Scheduler: SJF that never starves | `pickup` |
| `workStealing` | Work stealing | quadCore | CPU | Hz W4 | Rule (D25.3): an idle thread joins a running shard that holds fewer threads than `floor(units / grain)`, mid-shard. | Idle cores join running shards | `threads` |
| `numaAware` | NUMA-aware | dualSocket | System | kHz W8 | Rule: a task stays on one socket when its threads fit there; it spans sockets only when they don't. | Tasks stay on one socket if they fit | `ram`, `rackDist` |

Network scopes (rack load balancer, then room, site and backbone):

| id | Name | Requires | Level | Era / tier | Effect | Short | Answers |
|---|---|---|---|---|---|---|---|
| `lbCapability` | Capability-aware | rack | Rack | kHz W8 | Filter: never route a shard to a system that fails its gates (working set, VRAM, storage, ECC). It removes children with no system that can run one grain. It never dispatches a split whose shards would not fit their targets: the task waits, in the LB queue or as the head, instead of misrouting (D25.9). The grain is not a gate. Cheap on purpose; it is the first Rack fix. | LB skips servers that can't run it | `misroute` |
| `lbRoundRobin` | Round robin | rack | Rack | kHz W8 | Strategy: rotate through servers that can admit, starting after the last one used. Spreads load and heat off slot 1. | LB: round robin across servers | `overload`, `heat` |
| `lbHealth` | Health checks | lbCapability | Rack | kHz W8 | Filter: skip servers whose board PSU overload timer or rack crash timer is above 0. First-fit already skips full and booting servers; this one stops feeding a server that is counting down to failure. | LB skips failing servers | `overload`, `heat` |
| `lbLeastConn` | Least conns | lbRoundRobin | Rack | kHz W8 | Strategy (D25): shares in proportion to each child's free slots, so a nearly full child gets a small share. | LB: shares by free slots | `pickup`, `overload` |
| `lbWeighted` | Weighted | lbLeastConn | Rack | kHz W8 | Strategy (D25): shares in proportion to each child's rated compute ops/s among its systems with room. For mixed-generation racks, where equal shares wait on the slowest server. | LB: shares by server speed | `pickup`, mixed fleets |
| `lbLeastWork` | Least work left | lbWeighted, telemetry | Rack | MHz W9 | Strategy (D25): shares chosen so every child's predicted finish (queued work / rate + transfer + its share / rate) is as equal as whole units allow. IdleBit's least-finish-time routing. | LB: shares that finish together | `pickup`, `transfer` |
| `lbPowerAware` | Power-aware | lbHealth, telemetry | Rack | MHz W9 | Filter: skip servers whose PSU usage would reach 90% with this task's load added. At room scope it does the same for racks by PDU. Predictive, where health checks are reactive. | LB skips servers near 90% power | `overload` |
| `binPacking` | Bin packing | lbRoundRobin, s3Sleep, telemetry | Rack | MHz W9 | Strategy (D25): shares go only to children with a free running slot (not a queue slot) whose supply is under 90%, in slot order; queues fill only when none qualifies. Load stays concentrated, so the idle tail reaches S3. | LB: pack servers, let idle ones sleep | `energy`, `overload` |
| `lbAffinity` | Workload affinity | accelSystem, lbCapability | Rack | kHz W8 | Strategy (D7.7, D25): GPU, `tensor` and big-memory families split only over accelerator systems, general families only over general systems; spread inside the preferred class, falling back to the other class when none has room. Unlike capability-aware it has a preference, not just a veto. | LB: GPU work goes to accelerators | `gpu`, `pickup`, `energy` |
| `shardSteal` | Shard stealing | lbHealth | Rack | MHz W9 | Rule (D25.9; was `lbReserve`, queued take, which the LB queue retired): a server with a free running slot and an empty queue takes the newest not-started shard queued on another server in its rack. The shard crosses both server ports. Tasks stop waiting on their slowest shard. | Free servers steal queued shards | `pickup`, `transfer` |
| `splitGather` | Gather | lbCapability | Rack | kHz W8 | Rule (D25.9; was `gangRack`; gang placement is base): a router dispatches a task only when at least half its eligible children have room, or when the entry has waited 10 s in its queue. It stops the first server to free up from taking a whole task alone. | Split wide, not to the first free server | `rackDist`, `pickup` |
| `stealRoom` | Cross-rack stealing | shardSteal, room | Room | MHz W11 | Rule (D25.9; was `gangRoom`): shard stealing spans every rack in the zone. A stolen shard crosses both rack uplinks and both ports. | Steal shards across racks | `roomDist`, `pickup` |
| `thermalAware` | Thermal-aware | lbPowerAware, room | Room | MHz W11 | Filter at room scope and above: weight racks by e(T) and skip racks at ≥90 °F. One rack is one lump, so this has no rack-scope effect. | Room LB avoids hot racks | `heat` |
| `topologyAware` | Topology-aware | stealRoom | Room | GHz W11 | Strategy `linkAware` (D25.9): shares in proportion to what each child can absorb, the lesser of its rated compute with room and its top link speed. A rack behind a slow uplink gets a small share. | Shares follow uplink speed | `transfer`, `roomDist` |
| `zoneAware` | Zone-aware | stealRoom, dataCenter | Global | GHz W12 | Filter `local` (D25.9) at room, site and global scope: keep only the first child that can take the whole split by itself and meets the task's zones and region; if none can, keep all. A rack, zone or site failure then kills only its own tasks. Skips zones with a dark UPS. | Keep a task in one rack, zone or site | `multiAz`, `overload`, `heat` |
| `regionAware` | Region-aware | regions | Global | GHz W14 | Filter at backbone scope: region-locked tasks go only to sites in their region. Without it they fail as misroutes. | Region-locked tasks route correctly | `region`, `misroute` |
| `latencyAware` | Latency-aware | regionAware | Global | GHz W14 | Strategy at backbone scope: route to the site with the least backbone latency + transfer + queue time. | Route to the fastest site | `transfer` |
| `priceAware` | Price-aware | latencyAware | Global | GHz W14 | Strategy at backbone scope: route to the site with the lowest energy price per joule that can admit, breaking ties by latency. Regions differ in price (D1.7). | Route to the cheapest-power site | `energy` |

### 5.6 Networking (18)

| id | Name | Requires | Level | Era / tier | Effect | Short | Answers |
|---|---|---|---|---|---|---|---|
| `sw100k` | Switch gen 1 | rack | Rack | kHz W8 | Switch gen 1: shared port/uplink ceiling 5 THz at Rack, 500 PHz at Room. | Switch ceiling 5 THz per rack | `transfer` |
| `sw1M` | Switch gen 2 | sw100k, fabMhz | Rack | MHz W10 | Switch gen 2: shared port/uplink ceiling 2 PHz at Rack, 5 EHz at Room. | Switch ceiling 2 PHz per rack | `transfer`, `rackDist` |
| `sw10M` | Switch gen 3 | sw1M, room | Room | MHz W11 | Switch gen 3: shared port/uplink ceiling 20 PHz at Rack, 50 EHz at Room. | Switch ceiling 20 PHz per rack | `roomDist` |
| `sw100M` | Switch gen 4 | sw10M, fabGhz | Room | GHz W12 | Switch gen 4: shared port/uplink ceiling 5 EHz at Rack, 500 EHz at Room. | Switch ceiling 5 EHz per rack | `roomDist` |
| `sw1G` | Switch gen 5 | sw100M, dataCenter | Global | GHz W13 | Switch gen 5: shared port/uplink ceiling 50 EHz at Rack, 5 ZHz at Room. | Switch ceiling 50 EHz per rack | `multiAz` |
| `sw10G` | Switch gen 6 | sw1G, regions | Global | GHz W14 | Switch gen 6: shared port/uplink ceiling 500 EHz at Rack, 50 ZHz at Room. | Switch ceiling 500 EHz per rack | `region` |
| `portExpansion` | 8-port switch | rack | Rack | kHz W8 | Port ceiling: rack 4→8, room 4→8. Servers 5–8 can get tasks. | 8 switch ports per rack and room | `density` |
| `densePorts` | 12-port switch | portExpansion | Rack | kHz W8 | Port ceiling: rack 8→12 (every server slot), room 8→16. | 12 rack ports, 16 room ports | `density` |
| `spineLeaf` | Spine-leaf | densePorts, room | Room | GHz W11 | Room port ceiling 16 → 24, one port per rack. | 24 room ports, one per rack | `density` |
| `lag` | Link aggregation | portExpansion | Rack | MHz W9 | Uplinks 1→2 per switch. Each uplink carries its own transfer. | 2 uplinks per switch | `transfer` |
| `lag4` | 4-way uplinks | lag, room | Room | GHz W11 | Uplinks 2→4. | 4 uplinks per switch | `transfer`, `roomDist` |
| `cutThrough` | Cut-through | lag, room | Room | MHz W11 | A multi-hop transfer takes payload / slowest hop + 1 ms per hop, instead of the sum of payload / hop (store and forward). | Faster multi-hop transfers | `transfer` |
| `qos` | QoS queues | lbCapability | Rack | kHz W8 | Transfers waiting on a busy port go smallest payload first. Base order is FIFO. | Small transfers go first | `pickup`, `transfer` |
| `dpFiber` | Fiber plane | dataCenter | Global | GHz W13 | Data plane gen 1: 10× bandwidth, 0.5× latency. | Fiber data plane: 10× bandwidth | `multiAz`, `transfer` |
| `dpDwdm` | DWDM plane | dpFiber | Global | GHz W13 | Data plane gen 2: same steps again. | DWDM data plane: 10× bandwidth | `multiAz` |
| `bbDarkFiber` | Dark fiber | regions | Global | GHz W14 | Backbone gen 1: 10× bandwidth, 0.5× latency. | Dark fiber backbone: 10× bandwidth | `region` |
| `bbDwdm` | DWDM backbone | bbDarkFiber | Global | GHz W15 | Backbone gen 2. | DWDM backbone: 10× bandwidth | `region` |
| `bbSubsea` | Subsea cable | bbDwdm, intercontinental | Global | GHz W15 | Backbone gen 3: halves latency on links between continents. | Halves intercontinental latency | `region` |

### 5.7 Power (21)

| id | Name | Requires | Level | Era / tier | Effect | Short | Answers |
|---|---|---|---|---|---|---|---|
| `cstateC1` | C1 halt | | CPU | Hz W1 | An idle core draws 0.5× idle watts. | Idle cores use half power | `energy` |
| `cstateC3` | C3 sleep | cstateC1, dualCore | CPU | Hz W3 | A core idle for 1 s draws 0.15× idle watts. Waking takes 0.2 s (a physical latency). | Idle cores drop to 0.15× watts | `energy` |
| `cstateC6` | C6 power gate | cstateC3, fabKhz | CPU | kHz W7 | A core idle for 1 s draws 0.02× idle watts. Waking takes 1 s. | Idle cores drop to 0.02× watts | `energy` |
| `packageC` | Package C-states | cstateC6, l3Cache | System | kHz W7 | When every core is idle, cache, clock and scheduler draw 0.2× idle watts. | Idle CPUs drop to 0.2× watts | `energy` |
| `s3Sleep` | Suspend (S3) | packageC, rack | Rack | kHz W8 | A server with no admitted task for 10 s sleeps at 0.03× its idle watts. Routing a task to it wakes it in 2 s, which counts against pickup. | Idle servers sleep after 10 s | `energy` |
| `dvfs` | P-states (DVFS) | cstateC1, systemBoard | System | Hz W5 | While a system's queue is empty, its running cores run at 0.5× clock and 0.3× load watts. Full clock returns when a task queues. | Cores downclock when queue is empty | `energy`, `overload` |
| `turbo` | Turbo boost | dvfs, fabKhz | System | kHz W7 | Cores run at 1.25× clock for 1.8× load watts while the board PSU is under 90% usage and (from Rack on) the rack is under 80 °F. They drop to 1× otherwise. | Cores boost to 1.25× clock | `pickup` |
| `powerCap` | Power capping | dvfs, telemetry | System | Hz W6 | A supply set to cap never exceeds 100% from compute load. Cores below it throttle clock in 10% steps instead, so the overload timer doesn't accrue. Applies to PSU and PDU. | Supplies cap at 100%, cores throttle | `overload` |
| `loadShed` | Load shedding | powerCap, room | Room | MHz W11 | When a UPS or grid overload timer reaches 5 s, research pauses and the least-used rack drains to offline. | Overload sheds the least-used rack | `overload` |
| `psu80` | 80 Plus | systemBoard | System | Hz W4 | Board PSU gen 1, loss 30%→20%. | 80 Plus PSU: loss 30% → 20% | `energy`, `heat` |
| `psuBronze` | 80 Plus Bronze | psu80, fabKhz | System | kHz W7 | PSU gen 2, loss 15%. | Bronze PSU: loss 15% | `energy`, `heat` |
| `psuGold` | 80 Plus Gold | psuBronze, rack | Rack | kHz W8 | PSU gen 3, loss 10%. | Gold PSU: loss 10% | `energy`, `heat` |
| `psuPlatinum` | 80 Plus Platinum | psuGold, fabMhz | Rack | MHz W10 | PSU gen 4, loss 7%. | Platinum PSU: loss 7% | `energy`, `heat` |
| `psuTitanium` | 80 Plus Titanium | psuPlatinum, fabGhz | Room | GHz W12 | PSU gen 5, loss 4%. | Titanium PSU: loss 4% | `energy`, `heat` |
| `meteredPdu` | Metered PDU | rack | Rack | kHz W8 | PDU gen 1: 4× capacity per Credit, loss 3%. | Metered PDU: 4× capacity, 3% loss | `overload` |
| `switchedPdu` | Switched PDU | meteredPdu, room | Room | MHz W11 | PDU gen 2: 4× again, loss 2%. | Switched PDU: 4× again, 2% loss | `overload` |
| `dualFeed` | A+B feeds | switchedPdu, upsOnline | Room | GHz W11 | Needs 2 UPSs in the room. Each rack draws from both. If one UPS fails, its racks stay up on the other, whose usage rises to match. | Racks draw from 2 UPSs | `overload`, `roomDist` |
| `upsOnline` | Online UPS | room | Room | MHz W11 | UPS gen 1: 4× capacity per Credit, loss 6%. | Online UPS: 4× capacity, 6% loss | `overload`, `energy` |
| `upsLithium` | Lithium UPS | upsOnline, dataCenter | Global | GHz W13 | UPS gen 2, loss 3%. If the site grid fails, rooms on it ride through on battery for 30 s, so the grid's 10 s reboot costs no work. | Lithium UPS: 30 s ride-through | `overload`, `multiAz` |
| `substation` | Substation | dataCenter | Global | GHz W13 | Grid gen 1: 8× capacity, loss 3%. | Substation: 8× grid, 3% loss | `overload` |
| `hvIntake` | HV intake | substation, regions | Global | GHz W14 | Grid gen 2: 8× capacity, loss 2%. | HV intake: 8× grid, 2% loss | `overload` |

### 5.8 Cooling (14)

| id | Name | Requires | Level | Era / tier | Effect | Short | Answers |
|---|---|---|---|---|---|---|---|
| `thermalThrottle` | Thermal throttle | rack | Rack | kHz W8 | At ≥95 °F a rack's servers run at 0.5× clock and load watts until it falls below 90 °F. Prevents most crashes at a throughput cost. | Hot racks throttle instead of crash | `heat` |
| `rackVarSpeed` | Fan control | rack, telemetry | Rack | kHz W8 | Rack coolers hold a player setpoint (55–80 °F) instead of full duty. Watts follow delivered duty; fans show the real duty. | Rack coolers hold a set temperature | `energy` |
| `rackAir2` | High-flow air | rack | Rack | kHz W8 | Rack cooler gen 1, still air: more capacity per Credit and fewer watts per watt removed (spec A.2). Air τ unchanged. | Opens high-flow rack air coolers | `heat` |
| `rackWater` | Rear-door water | rackVarSpeed, fabMhz | Rack | MHz W10 | Rack cooler gen 2, the first water generation: τ ×0.1 and fewer watts per watt removed (spec A.2). | Opens rack water cooling | `heat`, `energy` |
| `rackWater2` | Direct-to-chip | rackWater, fabGhz | Rack | GHz W12 | Rack cooler gen 3 (water): direct-to-chip water, the top rack cooler. Keeps rack cooling improving after the Room era. | Opens direct-to-chip water cooling | `heat`, `energy`, `density` |
| `hotColdAisle` | Hot/cold aisle | room | Room | MHz W11 | Room-to-rack heat leak coefficient ×0.6, so holding racks below room temperature costs less. | Rack heat leak ×0.6 | `heat`, `energy` |
| `containment` | Containment | hotColdAisle | Room | GHz W11 | Leak coefficient ×0.5 again (0.3× total). | Rack heat leak ×0.5 again | `heat`, `energy` |
| `roomAir2` | High-flow CRAC | room | Room | MHz W11 | Room cooler gen 1, still air: watts per watt removed 0.125 → 0.1 (spec A.2). | Opens high-flow room coolers | `heat` |
| `chilledWater` | Chilled water | room | Room | MHz W11 | Room cooler gen 2, the first water generation: watts per watt removed 0.05. | Opens chilled water room cooling | `heat`, `energy` |
| `chilledWater2` | High-delta water | chilledWater, fabGhz | Room | GHz W12 | Room cooler gen 3 (water): watts per watt removed 0.04. | Better chilled water cooling | `heat`, `energy` |
| `roomVarSpeed` | Chiller VFD | chilledWater, rackVarSpeed | Room | GHz W11 | Room coolers hold a setpoint instead of full duty. | Room coolers hold a set temperature | `energy` |
| `economizer` | Free cooling | chilledWater | Room | GHz W11 | While the room is more than 5 °F above its site's outside air, it rejects up to a rated heat flow at 0.1× normal cooler watts. Cold regions get more of it (D1.7). | Cool with outside air at 0.1× watts | `energy` |
| `closedLoop` | Closed loop | chilledWater, dataCenter | Global | GHz W13 | Room cooler gen 4, the first closed-loop generation: watts per watt removed 0.025. | Opens closed-loop room cooling | `heat`, `energy` |
| `closedLoop2` | Two-phase loop | closedLoop, regions | Global | GHz W14 | Room cooler gen 5 (closed loop): watts per watt removed 0.02. | Better closed-loop cooling | `heat`, `energy` |

### 5.9 Structure (8)

| id | Name | Requires | Level | Era / tier | Effect | Short | Answers |
|---|---|---|---|---|---|---|---|
| `systemBoard` | System | dualCore, l2Cache | System | Hz W4 | Opens the System level. The chip becomes the CPU on a board with a fixed board PSU (gen 0). Tray: CPU, RAM, GPU, Storage, each still gated by its own node. | Opens the System level | `ram`, `gpu`, `storage` |
| `rack` | Rack | fabKhz | Rack | kHz W6 | Opens Rack. A free starter rack with air cooler, basic PDU, 4-port gen-0 switch (ports at 1 kHz, shared port/uplink ceiling 500 GHz) and a round-robin load balancer. Server port speeds can now be upgraded on the rack switch (D15); before this the pipe is fixed at 1 kHz. The system becomes server 1. | Opens the Rack level | `density`, `rackDist` |
| `room` | Room | rack, fabMhz | Room | MHz W10 | Opens Room (one AZ hall): network rack with room switch and load balancer, CRAC, standby UPS, 2 rows. Rack uplinks can now be upgraded on the network rack (D15). | Opens the Room level | `density`, `roomDist` |
| `hallExpansion` | Third row | room, spineLeaf | Room | GHz W11 | A third row of 8 rack slots: racks per room 16 → 24. `spineLeaf` supplies ports for racks 17–24. | Racks per room 16 → 24 | `density` |
| `dataCenter` | Data center | room, stealRoom | Global | GHz W12 | Opens Global with the first site: copper data plane, utility grid feed, zones up to 2. Room uplinks can now be upgraded at the data plane; backbone links once `regions` adds them (D15). | Opens the Global level | `multiAz` |
| `zoneExpansion` | Third zone | dataCenter, zoneAware | Global | GHz W13 | Zones per site 2 → 3. | Zones per site 2 → 3 | `multiAz`, `density` |
| `regions` | Regions | dataCenter, zoneAware | Global | GHz W13 | Sites 1 → 4 (home + 3 regions), one site per region. Leased-line backbone gen 0. | Sites 1 → 4 across regions | `region` |
| `intercontinental` | Global reach | regions, bbDarkFiber | Global | GHz W14 | Sites 4 → 8: all 8 regions. | Sites 4 → 8, all regions | `region` |

### 5.10 Operations (17)

| id | Name | Requires | Level | Era / tier | Effect | Short | Answers |
|---|---|---|---|---|---|---|---|
| `telemetry` | Telemetry | systemBoard | System | Hz W5 | Supplies and coolers report usage and temperature to schedulers. Required by power-aware, least-work, power capping and fan control. The feed shows live failure counters by cause. | Live usage and temperature feeds | `overload`, `heat` |
| `autoReturn` | Auto-return | telemetry | System | Hz W5 | Rejoin the market 120 s after a round ends. Toggle. | Rejoin the market after 120 s | `idle` |
| `autoSkip` | Auto-skip | autoReturn, lbCapability | Rack | kHz W8 | Automatically dismisses a head that no online hardware can run (D12.3), promoting the next task at once. Dismissal stays free. Never dismisses runnable work. | Auto-skip tasks nothing can run | `idle`, `gate` |
| `cronTuning` | Cron tuning | autoReturn, rack | Rack | kHz W8 | Auto-return delay 120 s → 15 s. | Rejoin delay 120 s → 15 s | `idle` |
| `offline12` | 12 h offline | autoReturn | System | kHz W6 | Offline progress cap 8 h → 12 h (D1.10, D19.3). | Offline cap 8 h to 12 h | `idle` |
| `offline24` | 24 h offline | offline12, cronTuning | Rack | kHz W8 | Offline progress cap 12 h → 24 h. | Offline cap 12 h to 24 h | `idle` |
| `offline48` | 48 h offline | offline24, room | Room | MHz W11 | Offline progress cap 24 h → 48 h, for the days-long Room and Data center eras (D19). | Offline cap 24 h to 48 h | `idle` |
| `researchQueue` | Research queue | autoReturn, fabKhz | System | kHz W7 | Queue up to 3 projects; the next starts when one completes. | Queue up to 3 research projects | `idle` |
| `gracefulDrain` | Graceful drain | telemetry | System | Hz W6 | Taking a unit offline, or a cold change, first stops admission and waits for running tasks to finish. The 10 s starts after the drain. Queued tasks reroute or fail. | Units finish tasks before going down | `downtime` |
| `fastBoot` | Fast boot | gracefulDrain | System | kHz W6 | Boot time 10 s → 5 s. One boot time covers the online/offline transition, the reboot after a supply failure or crash, a mid-round add and cold-change downtime (D1.8). A crashed rack still waits until it is below 90 °F. | Boot time 10 s → 5 s | `downtime` |
| `warmBoot` | Warm boot | fastBoot, rack | Rack | MHz W9 | Boot time 5 s → 2 s, same scope as Fast boot. | Boot time 5 s → 2 s | `downtime` |
| `configSave` | Saved configs | rack | Rack | kHz W8 | The save icon and the Saved option on add plates. Barebones and Copy are free from the start. | Save server configurations | `density` |
| `rollingUpgrade` | Rolling upgrade | configSave, gracefulDrain | Rack | MHz W9 | Load a configuration onto every server in a rack as one action. Servers drain and go cold one at a time. | Upgrade a whole rack in one action | `downtime` |
| `hotPlug` | Hot-plug drives | storageCtl, rack | Rack | kHz W8 | Adding or replacing storage is hot: no downtime. | Swap storage with no downtime | `downtime` |
| `liveMigration` | Live migration | gracefulDrain, sw1M | Rack | MHz W10 | When a server goes offline, cold or crashes (not a supply failure), its running tasks move to another server in the rack with room. Their remaining state crosses both ports. | Tasks move off failing servers | `downtime`, `heat` |
| `hotSwap` | Hot swap | rollingUpgrade, room | Room | GHz W11 | Server replacement at Rack and above has no downtime (program §3). | Replace servers with no downtime | `downtime` |
| `checkpointing` | Checkpointing | stealRoom | Room | GHz W11 | A split task survives losing a shard if a replacement is placed within 10 s (D25.9). That shard restarts its units. | Split tasks survive a lost shard | `roomDist`, `overload`, `heat` |

### 5.11 Count

| Category | Nodes |
|---|---:|
| Compute | 29 |
| Memory | 13 |
| Acceleration | 18 |
| Storage | 7 |
| Scheduling | 25 |
| Networking | 18 |
| Power | 21 |
| Cooling | 14 |
| Structure | 8 |
| Operations | 17 |
| **Total** | **170** |

## 6. The first hours

The player starts with three roots, each answering a different first pain:

- `fifoSched` for heads timing out behind a busy core (and, under D10, for prefetching over the pipe);
- `pipelining` for raw speed;
- `cstateC1` for the energy bill.

The path below is the real campaign bot's (`src/game/probes/bot.ts`, seed 42, D19 and D20 constants). It plays an active player who saves Data for the next milestone and spends at most a quarter of that milestone's path on other nodes. Round 1 ends at 4:38–4:50; with no purchases at all it ends near 1:00 (D20). Level purchases (clock, cache, lanes, scheduler) come every 20–40 s in round 1.

| Time | Research (tier, Data) | Why now | Real alternative |
|---|---|---|---|
| 0:10 | `pipelining` (W1, 1 Data) | First whole Data arrives at about 0:10 | `fifoSched`; `cstateC1` for the bill |
| ~4:45 | Round 1 ends on "Timed out" at the 1 kHz pipe wall (`I` ≈ 14). Between rounds research runs at full speed. | | |
| 4:45–6:30 | `fifoSched`, `dualCore`, `l2Cache` (W1–W2), the path to `systemBoard` | Scheduler K needs a second core; `threads` families need 512–768 bits of cache | `sjf` or `timeSlice` |
| rounds 2 to Rack | no network node | The dual-core Hz chip outruns its fixed 1 kHz pipe in round 2. Until Rack, income is capped at 1,000 ops/s and tasks over 10,000 ops time out (D15) | |
| 5:00–10:00 | `sjf`, `timeSlice`, `superscalar`, `quadCore`, `priorityQ`, `mlfq`, `workStealing`, `cstateC3` (W2–W3) | The off-path budget allows them while `systemBoard` is saved for | `cstateC1` |
| 0:46–0:53 | `systemBoard` (W4, 36,000 Data) | "Can't run · RAM" from JSON Parse and Merge Sort. The first real save-up: about 40 min of capped Data | finish `cstateC3` first if the bill is high |
| 0:58–1:10 | `memController`, `psu80` (W4, 12,000 each) | `ram` band; the board PSU limits a fast Hz chip | `l3Cache` |
| 1:10–3:30 | save for `fabKhz` (W6 milestone, 150,000 Data) | Hz parts are at their ceilings; Credits pile up for kHz parts | W5 nodes within the off-path budget |
| 3:33 | `fabKhz` | kHz era: the upgrade-or-replace moment for the CPU. kHz parts speed research, not income: the pipe still caps it | |
| 3:50–4:00 | `gpuGen1`, `storageCtl` (W5, 15,000 each) | Their bands open above the pipe wall, so the first card and drive pay only after Rack | `hotPages`, `l3Cache` |
| 4:00–6:20 | save for `rack` (W6 milestone, 150,000 Data) | | `offline12` (W6) for an overnight gap |
| 6:20–6:50 | `rack` | **Rack** opens at 6:40–6:48. Ports step at once, servers are copied in, and the W5–W6 extras follow | |

That is about 17 nodes in the first hour and 34 by Rack. After the first hour Data, not compute, paces research, and the player makes most choices between rounds: a research pick every 10–20 min and part purchases as Credits allow. The real bot's longest gap without a decision before Rack is about 2 h, while it saves for `fabKhz` and `rack` with its Hz parts at their ceilings (an open pacing issue, see the report).

## 7. IdleBit mapping

Sources: `content/research.ts` (legacy research), `content/dispatcherJobs.ts` (dispatcher research), `content/upgrades.ts`, the content tier files, `automation.ts`, `facilityDefinitions.ts`, `infrastructureDefinitions.ts`, `cloudDefinitions.ts`, `planetary.ts`, `routing.ts`, `weightedFair.ts`, `thermal.ts`, `bootloader.ts`, `cState.ts`.

| IdleBit tech or upgrade | Verdict | v3 node(s) and reason |
|---|---|---|
| Decode Logic, Byte Operations, Bit Mutation, Shift Operations | Dropped | They unlocked task families. In v3 the market curve brings families in; research does not. |
| Cache Mapping | Adapted | Cache exists from the start; the next cache step is `l2Cache`, then `l3Cache`. |
| Cache / Cache Speed upgrades | Adapted | Cache levels stay ungated. Cache speed dropped: v3 cache is a capacity gate. |
| Benchmark Harness, benchmark compute tasks | Dropped | Payback inspection is UI work, and benchmark tasks don't exist in v3. |
| Multi-Core Control, Add Core | Adopted | `dualCore`, `quadCore`, `octaCore`, `ringBus`, `cores16`, `meshCores`, `chiplets` (32-core cap, D7.2). |
| Local Scheduler, CPU Queue Slot | Adopted | `fifoSched`; queue slots become scheduler Q levels. |
| System Scheduler, System Queue Slot, scheduler SKUs (2/4/6/12/24 slot) | Adapted | Scheduler levels (Q, K) and scheduler generations through the fab nodes. |
| Scheduler Watchdog, Deadlock Cooldown | Dropped | v3 has no deadlock; misroutes fail at once. The safety-net idea lives on in `powerCap` and `thermalThrottle`. |
| PSU Management | Adapted | `powerCap`. |
| PSU Capacity upgrade, PSU SKUs (Barebones, Compact, Balanced, Headroom) | Adapted | Board PSU levels plus the 80 Plus ladder (`psu80` to `psuTitanium`). |
| Bootloader (36 levels, boot 10 s → 0.1 s) | Adapted | `fastBoot` (10 s → 5 s) and `warmBoot` (→ 2 s), on the one boot time shared by online/offline, reboot and cold changes (D1.8). |
| RAM Control, dispatcher Memory controllers L1 | Adopted | `memController`. |
| Memory controllers L2–L4 (kHz, MHz, GHz eras) | Adapted | Split into `fabKhz`/`fabMhz`/`fabGhz` and the DDR ladder. |
| RAM Stick, RAM Capacity, RAM Frequency | Adapted | RAM levels, DDR generations, `rdimm` for capacity. |
| Dual Channel RAM | Adopted | `dualChannel`. |
| Quad Channel RAM | Adopted | `quadChannel`. |
| Oct Channel RAM | Adopted | `octaChannel`, on the accelerator system's 8 RAM slots. |
| System Bus, Install CPU | Adapted | `systemBoard` opens the board; more CPUs are `dualSocket` and `quadSocket` (D7.3). |
| Matched CPU | Adapted | Extra CPUs are identical copies of CPU 1 (D7.3); matching survives as the multi-channel RAM rule. |
| CRON Scheduler, CRON Job Slot, CRON Interval, Auto-Repeat | Adapted | `autoReturn` and `cronTuning`. |
| System Catalog, Custom Machine Assembly | Adapted | Barebones and Copy are free; `configSave` opens named configurations. |
| Thermal Control, board cooling tiers (Passive, Fan, Case airflow, Liquid) | Adapted | Board cooling is gone (program §2). Rack air and water with generations (`rackAir2`, `rackWater`, `rackWater2`); room air, water and closed loop (`roomAir2`, `chilledWater`, `chilledWater2`, `closedLoop`, `closedLoop2`). |
| Overclock presets (Stock, Boost, Performance, Extreme) | Adapted | `turbo`, one automatic P-state guarded by supply usage and rack temperature. Manual presets dropped. |
| Thermal throttling (25% floor) | Adapted | `thermalThrottle`, research-gated, so the crash rule bites first. |
| Specialized Compute, Accelerator scheduling | Adopted | `gpuGen1`. |
| Raster GPU 8, Tensor GPU 24 | Adapted | Nine GPU generations; separate `tensorCores` technology; VRAM multiplied by `gddr6`, `hbm`. |
| Edge NPU 4, Batch NPU 16 | Adapted | `npu`: low-watt inference part in a GPU slot. |
| Persistent storage, Local SSD, NVMe Array | Adapted | `storageCtl`, `ssd`, `nvme`, `raid0`. |
| Network fabric (NIC lanes), Gigabit NIC, Fabric NIC | Adapted | No NIC part: a lone system's link is never a constraint (program §6). The constraint moves to switch ports and generations. |
| Fleet routing (least-finish-time cross-node routing) | Adopted | `lbLeastWork`. |
| Frozen routing with missing-part placement | Dropped | v3 routes at the load balancer at arrival; `lbCapability` replaces placement-toward-missing-parts. |
| Weighted max-min fair share (`weightedFair.ts`) | Adapted | `timeSlice` shares cores fairly among running tasks. |
| Waiting queue + FIFO blocked-entry skip | Adopted | Base no-scheduler rule: take the oldest task it can run. |
| Aggregate cache pools, resident working sets | Adapted | Proposed rule that concurrent working sets share cache (§10 Q1). |
| Memory controllers idle gating (CPU 5%, RAM 10%) | Adapted | Split into `cstateC1`/`C3`/`C6`, `packageC`, `lowVoltRam`. |
| C-State Control (36 levels) | Adapted | A ladder of named states with real wake latencies instead of 36 abstract levels. |
| Memory Voltage Modifier (36 levels) | Adapted | `lowVoltRam`, one step. |
| kHz / MHz / GHz CPU Research | Adopted | `fabKhz`, `fabMhz`, `fabGhz`. |
| CPU tier efficiency decay per level | Adopted | Already the program's upgrade-vs-replace curve. No node needed. |
| Cluster Control, Rack Operations, Data Center Operations, Global Scheduling | Adapted | Structure nodes `rack`, `room`, `dataCenter`, `regions`. Their offline-window purpose is dropped. |
| Automation Buffers (2 h to 7 d offline windows) | Adapted | `offline12`, `offline24` and `offline48` raise the 8 h cap (D1.10, D19.3). |
| Rack templates (Half, 42U, High-density liquid) | Dropped | v3 has one rack form, 4 infrastructure slots + 12 servers. Liquid lives on as `rackWater`. |
| Facility templates (Workshop room, Edge DC "redundant plant", Regional DC) | Adapted | Room and zones; redundant plant becomes `dualFeed` and `upsLithium`. |
| Cloud SLA windows: zones, replica quorum, failover, p95 latency | Adapted | `zoneAware`, `checkpointing`, `latencyAware`. |
| Planetary phases (2, 3, 4 regions) | Adapted | `regions`, `intercontinental`. |
| Min-cost-flow regional routing | Adapted | `latencyAware`. |
| Server SKUs (Starter, Workshop, Dense) | Adapted | Barebones tiers on the configuration plate. |
| In-house research on one reserved core | Adapted | Background, Shared and Focus modes (program §9). |
| Outsourced research for Credits and Data | Dropped | Research is Data plus compute work on the player's machines. There is no paying to skip the work. |
| Data currency, research Data costs | Adopted | D3 keeps Data as the research start cost. Tasks earn it at 10:1 to 100:1. |
| Discovery by completion thresholds | Dropped | Prerequisites only; every locked node shows its reason. |
| Click Rate Tuning | Dropped | No clicking loop. |
| Finale charters, side arcs | Dropped | Campaign content; v3 has rounds. |

## 8. What the tree needs from other documents

| Need | Owner | Used by |
|---|---|---|
| Family tag `tensor` on inference and training families | Tasks | `tensorCores`, `matrixGpu`, `npu` |
| Task gate `ecc` on some `storage`, `rackDist` and later families | Tasks | `ecc`, `rdimm` |
| Families whose `workingSet` beats L1 in the first 10 minutes | Tasks | `l2Cache` must answer a real `gate` failure |
| Per-member GPU core and VRAM gates from the accepted progression table | Tasks | `accelSystem`, `gpuLink`; CPU/RAM gates remain separate |
| Region names and which regions open at `regions` vs `intercontinental` | Tasks, spec | `regions`, `intercontinental`, `bbSubsea` |
| Model VRAM and hot-upgrade capacity with total memory technology multipliers 4 and 16 | Spec | `gddr6`, `hbm`, `gpuLink` |
| Energy price and outside air temperature per region (D1.7) | Spec, tasks | `priceAware`, `economizer` |
| One boot time constant, 10 s base (D1.8) | Spec | `fastBoot`, `warmBoot` |
| Offline cap as a state value, 8 h base (D1.10) | Spec, platform | `offline12`, `offline24`, `offline48` |
| Room-to-rack heat leak coefficient as a named constant | Spec | `hotColdAisle`, `containment` |

## 9. Machine-readable appendix

The build owner regenerates runtime files from this source. Prerequisites are AND lists. `tier` indexes §3. The effect union is the contract between this tree and the sim; the sim owner may rename the ids.

```ts
export type ResearchCategory =
  | "compute" | "memory" | "accel" | "storage" | "scheduling"
  | "network" | "power" | "cooling" | "structure" | "operations";
export type ZoomLevel = "cpu" | "system" | "rack" | "room" | "global";
export type Era = "hz" | "khz" | "mhz" | "ghz";
export type WorkTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export const DATA_BY_TIER: Record<WorkTier, number> = {
  1: 1, 2: 100, 3: 2_500, 4: 9_000, 5: 8_000, 6: 50_000, 7: 1_000_000, 8: 2.7e6,
  9: 1.5e7, 10: 4e7, 11: 6e7, 12: 2e8, 13: 4e8, 14: 3e9, 15: 1e10,
};
/** Structure unlocks and fab generations cost 3x their tier's Data. */
export const MILESTONE_DATA_FACTOR = 3;
export const MILESTONE_IDS = ["systemBoard", "fabKhz", "rack", "fabMhz", "room", "fabGhz", "dataCenter", "regions", "intercontinental"] as const;

/** D27: about N seconds of the era's typical hardware at unlock; see §3.2. */
export const WORK_TIER_OPS: Record<WorkTier, number> = {
  1: 20, 2: 600, 3: 5_000, 4: 1.5e5, 5: 3e5, 6: 1e6, 7: 3e7, 8: 2e8,
  9: 5e9, 10: 2e10, 11: 2.5e10, 12: 3e10, 13: 4e10, 14: 6e10, 15: 1e11,
};

/** Whole-Credit Amount inputs. Omitted IDs cost zero Credits. Never convert through Number. */
export const RESEARCH_CREDITS: Readonly<Record<string, string>> = {
  gpuGen1: "0",
  gpuGen2: "640000000",
  gpuGen3: "6400000000",
  gpuGen4: "64000000000",
  gpuGen5: "640000000000",
  gpuGen6: "6400000000000",
  gpuGen7: "64000000000000",
  gpuGen8: "640000000000000",
  gpuGen9: "6400000000000000",
};

export type PartId =
  | "core" | "clock" | "l1" | "l2" | "l3" | "scheduler" | "cpu" | "psu"
  | "ram" | "gpu" | "npu" | "storage" | "storageNode"
  | "rackCooler" | "pdu" | "lb" | "switch" | "roomCooler" | "ups" | "row"
  | "dataPlane" | "grid" | "zone" | "site" | "backbone";

export type CeilingId =
  | "coreSites" | "lanesPerCore" | "threadsPerCore" | "cpuSockets"
  | "ramSlots" | "gpuSlots" | "driveSlots"
  | "rackPorts" | "roomPorts" | "uplinks" | "researchQueue"
  | "roomRows" | "siteZones" | "sites";

/** "net" = every network scope the player has opened (rack LB, room LB, site data plane, backbone). */
export type Scope = "system" | "rack" | "room" | "site" | "global" | "net";

export type StrategyId =
  | "fifo" | "sjf" | "timeSlice" | "priority" | "mlfq"
  | "firstFit" | "roundRobin" | "leastConn" | "weighted" | "leastWork" | "binPack" | "affinity" | "linkAware" | "latency" | "price";
/** "firstFit" is the free default at every network scope (D1.5); no node unlocks it. */
export type FilterId = "capability" | "health" | "power" | "thermal" | "region" | "local";
/** D25: placements are gone. Distributed tasks are minimum splits; split behaviour is strategies, filters and rules. */

export type RuleId =
  | "workStealing" | "numaAware" | "smt" | "socketFactor" | "dimmFactor" | "accelBoard" | "socketSpanPenalty" | "dma" | "prefetch"
  | "multiChannel" | "ecc" | "tensorRate" | "gpuLink" | "npuTensorOnly"
  | "vramPerLevel" | "vramScale" | "ramWatts" | "registeredCapacity" | "ncq" | "sharedStorage" | "hotPages" | "unifiedMemory" | "gather" | "shardSteal" | "stealRoom"
  | "cutThrough" | "qos" | "routingCapacity" | "linkScale" | "subseaLatency"
  | "coreIdle" | "packageIdle" | "s3Sleep" | "dvfs" | "turbo" | "powerCap" | "loadShed"
  | "lossFraction" | "supplyCapacity" | "dualFeed" | "upsRideThrough"
  | "thermalThrottle" | "rackSetpoint" | "rackWater" | "roomLeak" | "roomSetpoint" | "economizer"
  | "telemetry" | "autoReturn" | "autoSkip" | "gracefulDrain" | "bootSeconds" | "offlineCap" | "configSave"
  | "rollingUpgrade" | "hotPlug" | "liveMigration" | "hotSwap" | "checkpointing";

export type ResearchEffect =
  | { kind: "gen"; part: PartId; gen: number }
  | { kind: "ceiling"; key: CeilingId; value: number }
  | { kind: "strategy"; scope: Scope; id: StrategyId }
  | { kind: "filter"; scope: Scope; id: FilterId }
  | { kind: "view"; level: ZoomLevel }
  | { kind: "rule"; id: RuleId; params?: Readonly<Record<string, number>> };

export type AnswerCode =
  | "bits" | "ints" | "threads" | "ram" | "gpu" | "storage"
  | "rackDist" | "roomDist" | "multiAz" | "region"
  | "pickup" | "misroute" | "gate" | "overload" | "heat" | "energy"
  | "transfer" | "downtime" | "density" | "idle";

export interface ResearchNode {
  id: string;
  name: string;
  category: ResearchCategory;
  requires: readonly string[];
  level: ZoomLevel;
  era: Era;
  tier: WorkTier;
  /** Data paid when the project starts (D3). Whole number; these literals are exact doubles, and the wallet holds Data as an exact integer. */
  data: number;
  /** Whole-Credit decimal string, paid once at actual start, never on queue. */
  creditCost?: string;
  effects: readonly ResearchEffect[];
  answers: readonly AnswerCode[];
}

const gen = (part: PartId, g: number): ResearchEffect => ({ kind: "gen", part, gen: g });
const cap = (key: CeilingId, value: number): ResearchEffect => ({ kind: "ceiling", key, value });
const strat = (scope: Scope, id: StrategyId): ResearchEffect => ({ kind: "strategy", scope, id });
const filt = (scope: Scope, id: FilterId): ResearchEffect => ({ kind: "filter", scope, id });
const view = (level: ZoomLevel): ResearchEffect => ({ kind: "view", level });
const rule = (id: RuleId, params?: Record<string, number>): ResearchEffect => ({ kind: "rule", id, params });
const chipGen = (g: number) =>
  (["core", "clock", "l1", "l2", "l3", "scheduler", "cpu"] as const).map((p) => gen(p, g));

const n = (
  id: string, name: string, category: ResearchCategory, requires: string[],
  level: ZoomLevel, era: Era, tier: WorkTier, data: number, effects: ResearchEffect[], answers: AnswerCode[],
): ResearchNode => ({ id, name, category, requires, level, era, tier, data, creditCost: RESEARCH_CREDITS[id], effects, answers });

export const RESEARCH_V3: readonly ResearchNode[] = [
  // Compute
  n("pipelining", "Pipelining", "compute", [], "cpu", "hz", 3, 2_500, [cap("lanesPerCore", 2)], ["bits", "pickup"]),
  n("superscalar", "Superscalar", "compute", ["pipelining"], "cpu", "hz", 6, 50_000, [cap("lanesPerCore", 4)], ["ints"]),
  n("outOfOrder", "Out-of-order", "compute", ["superscalar", "fabKhz"], "cpu", "khz", 7, 1_000_000, [cap("lanesPerCore", 8)], ["ints", "threads"]),
  n("simd", "SIMD", "compute", ["outOfOrder", "fabMhz"], "cpu", "mhz", 10, 4e7, [cap("lanesPerCore", 16)], ["threads", "rackDist"]),
  n("wideVector", "Wide vectors", "compute", ["simd", "fabGhz"], "cpu", "ghz", 12, 2e8, [cap("lanesPerCore", 32)], ["roomDist"]),
  n("branchPredict", "Branch prediction", "compute", ["outOfOrder", "rack"], "cpu", "khz", 8, 2.7e6, [cap("lanesPerCore", 12)], ["threads", "pickup"]),
  n("fma", "Fused multiply-add", "compute", ["simd", "room"], "cpu", "mhz", 11, 6e7, [cap("lanesPerCore", 24)], ["rackDist", "roomDist"]),
  n("dualVector", "Dual vector units", "compute", ["wideVector", "dataCenter"], "cpu", "ghz", 13, 4e8, [cap("lanesPerCore", 64)], ["multiAz", "density"]),
  n("matrixTiles", "Matrix tiles", "compute", ["dualVector", "regions"], "cpu", "ghz", 14, 3e9, [cap("lanesPerCore", 112)], ["region", "density"]),
  n("dualCore", "Dual core", "compute", ["fifoSched"], "cpu", "hz", 3, 2_500, [cap("coreSites", 2)], ["pickup", "bits"]),
  n("quadCore", "Quad core", "compute", ["dualCore", "l2Cache"], "cpu", "hz", 6, 50_000, [cap("coreSites", 4)], ["threads"]),
  n("octaCore", "8 cores", "compute", ["quadCore", "fabKhz"], "cpu", "khz", 7, 1_000_000, [cap("coreSites", 8)], ["threads", "density"]),
  n("cores16", "16 cores", "compute", ["octaCore", "fabMhz"], "cpu", "mhz", 10, 4e7, [cap("coreSites", 16)], ["rackDist", "density"]),
  n("chiplets", "Chiplets", "compute", ["cores16", "fabGhz"], "cpu", "ghz", 12, 2e8, [cap("coreSites", 32)], ["roomDist", "density"]),
  n("stacked3d", "Stacked cache", "compute", ["chiplets", "dataCenter"], "cpu", "ghz", 13, 4e8, [gen("l3", 4)], ["region", "density"]),
  n("ringBus", "Ring bus", "compute", ["octaCore", "rack"], "cpu", "khz", 8, 2.7e6, [cap("coreSites", 12)], ["threads", "density"]),
  n("meshCores", "Mesh interconnect", "compute", ["cores16", "room"], "cpu", "mhz", 11, 6e7, [cap("coreSites", 24)], ["roomDist", "density"]),
  n("l3Slices", "L3 slices", "compute", ["l3Cache", "fabMhz"], "cpu", "mhz", 10, 4e7, [cap("l3LevelBonus", 1)], ["ram", "rackDist"]),
  n("edramL3", "eDRAM L3", "compute", ["l3Slices", "fabGhz"], "cpu", "ghz", 12, 2e8, [cap("l3LevelBonus", 2)], ["ram", "roomDist"]),
  n("fabKhz", "kHz fab", "compute", ["systemBoard", "pipelining"], "system", "khz", 4, 27_000, chipGen(1), ["bits", "ints", "threads", "energy"]),
  n("fabMhz", "MHz fab", "compute", ["fabKhz", "rack"], "rack", "mhz", 9, 4.5e7, chipGen(2), ["ram", "rackDist", "energy"]),
  n("fabGhz", "GHz fab", "compute", ["fabMhz", "room"], "room", "ghz", 11, 1.8e8, chipGen(3), ["roomDist", "energy"]),
  n("l2Cache", "L2 cache", "compute", ["pipelining"], "cpu", "hz", 3, 2_500, [gen("l2", 0)], ["ints", "gate"]),
  n("l3Cache", "L3 cache", "compute", ["l2Cache", "systemBoard"], "system", "hz", 5, 8_000, [gen("l3", 0)], ["ints", "ram"]),
  n("smt", "SMT", "compute", ["timeSlice", "octaCore"], "cpu", "khz", 7, 1_000_000, [cap("threadsPerCore", 2), rule("smt", { shareRate: 0.6 })], ["pickup"]),
  n("dualSocket", "Dual socket", "compute", ["octaCore", "rack"], "system", "khz", 8, 2.7e6, [cap("cpuSockets", 2), rule("socketFactor", { s2: 0.92 }), rule("socketSpanPenalty", { ramBandwidth: 0.5 })], ["density", "threads"]),
  n("quadSocket", "4 sockets", "compute", ["dualSocket"], "system", "khz", 9, 1.5e7, [cap("cpuSockets", 4), rule("socketFactor", { s3: 0.85, s4: 0.78 })], ["density", "rackDist"]),
  n("dma", "DMA engine", "compute", ["memController"], "system", "hz", 5, 8_000, [rule("dma")], ["ram", "storage"]), // D26: RAM and disk parts
  n("prefetch", "Prefetcher", "compute", ["dma", "l3Cache"], "system", "khz", 6, 50_000, [rule("prefetch")], ["ram"]),

  // Memory
  n("memController", "Memory ctrl", "memory", ["systemBoard"], "system", "hz", 4, 9_000, [gen("ram", 0)], ["ram", "gate"]),
  n("ddr", "DDR", "memory", ["memController"], "system", "hz", 5, 8_000, [gen("ram", 1)], ["ram"]),
  n("ddr2", "DDR2", "memory", ["ddr", "fabKhz"], "system", "khz", 7, 1_000_000, [gen("ram", 2)], ["ram"]),
  n("ddr3", "DDR3", "memory", ["ddr2", "fabMhz"], "system", "mhz", 10, 4e7, [gen("ram", 3)], ["ram", "rackDist"]),
  n("ddr4", "DDR4", "memory", ["ddr3", "room"], "room", "mhz", 11, 6e7, [gen("ram", 4)], ["roomDist"]),
  n("ddr5", "DDR5", "memory", ["ddr4", "fabGhz"], "global", "ghz", 12, 2e8, [gen("ram", 5)], ["multiAz"]),
  n("dualChannel", "Dual channel", "memory", ["memController"], "system", "hz", 5, 8_000, [cap("ramSlots", 2), rule("multiChannel")], ["ram"]),
  n("quadChannel", "Quad channel", "memory", ["dualChannel", "fabKhz"], "system", "khz", 7, 1_000_000, [cap("ramSlots", 4), rule("dimmFactor", { d3: 0.95, d4: 0.9 })], ["ram"]),
  n("octaChannel", "8 channels", "memory", ["quadChannel", "accelSystem", "fabMhz"], "system", "mhz", 10, 4e7, [rule("multiChannel", { accelChannels: 8 })], ["gpu", "roomDist"]),
  n("ecc", "ECC memory", "memory", ["ddr2", "rack"], "rack", "khz", 8, 2.7e6, [rule("ecc", { price: 1.25, watts: 1.1 })], ["storage", "rackDist", "gate"]),
  n("rdimm", "Registered DIMM", "memory", ["quadChannel", "ecc"], "rack", "mhz", 9, 1.5e7, [rule("registeredCapacity", { factor: 2 })], ["rackDist", "roomDist"]),
  n("lowVoltRam", "Low-voltage RAM", "memory", ["ddr2"], "system", "khz", 7, 1_000_000, [rule("ramWatts", { factor: 0.7 })], ["energy", "overload"]),
  n("hotPages", "Hot pages", "memory", ["memController", "storageCtl"], "system", "hz", 5, 8_000, [rule("hotPages", { diskExponent: 2 })], ["storage", "ram"]),

  // Acceleration
  n("gpuGen1", "GPU gen 1, 1 kHz", "accel", ["memController"], "system", "hz", 5, 8_000, [gen("gpu", 0)], ["gpu"]),
  n("gpuGen2", "GPU gen 2, 10 kHz", "accel", ["gpuGen1", "fabKhz"], "system", "khz", 7, 1_000_000, [gen("gpu", 1), gen("npu", 1)], ["gpu"]),
  n("gpuGen3", "GPU gen 3, 100 kHz", "accel", ["gpuGen2", "rack"], "system", "khz", 8, 2.7e6, [gen("gpu", 2)], ["gpu"]),
  n("gpuGen4", "GPU gen 4, 1 MHz", "accel", ["gpuGen3", "fabMhz"], "system", "mhz", 10, 4e7, [gen("gpu", 3)], ["gpu"]),
  n("gpuGen5", "GPU gen 5, 10 MHz", "accel", ["gpuGen4", "room"], "system", "mhz", 11, 6e7, [gen("gpu", 4)], ["gpu"]),
  n("gpuGen6", "GPU gen 6, 100 MHz", "accel", ["gpuGen5", "fabGhz"], "system", "ghz", 12, 2e8, [gen("gpu", 5)], ["gpu"]),
  n("gpuGen7", "GPU gen 7, 1 GHz", "accel", ["gpuGen6", "dataCenter"], "system", "ghz", 13, 4e8, [gen("gpu", 6)], ["gpu"]),
  n("gpuGen8", "GPU gen 8, 10 GHz", "accel", ["gpuGen7", "regions"], "system", "ghz", 14, 3e9, [gen("gpu", 7)], ["gpu"]),
  n("gpuGen9", "GPU gen 9, 100 GHz", "accel", ["gpuGen8", "intercontinental"], "system", "ghz", 15, 1e10, [gen("gpu", 8)], ["gpu"]),
  n("tensorCores", "Tensor cores", "accel", ["gpuGen4"], "system", "mhz", 10, 4e7, [gen("npu", 2), rule("tensorRate", { factor: 4, minGpuGen: 4 })], ["gpu", "rackDist"]),
  n("matrixGpu", "Matrix engines", "accel", ["tensorCores", "gpuGen6"], "system", "ghz", 12, 2e8, [gen("npu", 3), rule("tensorRate", { factor: 8, minGpuGen: 6 })], ["roomDist", "multiAz"]),
  n("gddr6", "GDDR6", "accel", ["gpuGen2"], "system", "khz", 7, 1_000_000, [rule("vramPerLevel", { factor: 4 })], ["gpu"]),
  n("unifiedMemory", "Unified memory", "accel", ["hbm", "gpuGen8"], "system", "ghz", 14, 3e9, [rule("unifiedMemory")], ["gpu", "roomDist"]),
  n("hbm", "HBM", "accel", ["gddr6", "fabMhz"], "system", "mhz", 10, 4e7, [rule("vramPerLevel", { factor: 16 }), rule("vramScale", { idle: 0.5 })], ["roomDist"]),
  n("dualGpu", "Dual GPU", "accel", ["gpuGen2", "fabKhz"], "system", "khz", 7, 1_000_000, [cap("gpuSlots", 2)], ["gpu"]),
  n("accelSystem", "Accelerator box", "accel", ["dualSocket", "quadChannel", "dualGpu"], "rack", "khz", 8, 2.7e6, [rule("accelBoard", { sockets: 2, ramSlots: 8, gpuSlots: 8 })], ["gpu", "rackDist", "roomDist", "density"]),
  n("gpuLink", "GPU link", "accel", ["dualGpu", "gpuGen2"], "system", "khz", 7, 1_000_000, [rule("gpuLink")], ["gpu"]),
  n("npu", "NPU", "accel", ["gpuGen2"], "system", "khz", 7, 1_000_000, [gen("npu", 0), rule("npuTensorOnly", { watts: 0.25 })], ["energy"]),

  // Storage
  n("storageCtl", "Storage", "storage", ["systemBoard"], "system", "hz", 5, 8_000, [gen("storage", 0)], ["storage", "gate"]),
  n("ssd", "SSD", "storage", ["storageCtl", "fabKhz"], "system", "khz", 7, 1_000_000, [gen("storage", 1)], ["storage"]),
  n("nvme", "NVMe", "storage", ["ssd", "fabMhz"], "system", "mhz", 10, 4e7, [gen("storage", 2)], ["storage", "rackDist"]),
  n("scm", "Storage-class mem", "storage", ["nvme", "fabGhz"], "system", "ghz", 12, 2e8, [gen("storage", 3)], ["multiAz"]),
  n("raid0", "Striping", "storage", ["storageCtl"], "system", "hz", 6, 50_000, [cap("driveSlots", 4)], ["storage"]),
  n("ncq", "Command queuing", "storage", ["ssd"], "system", "khz", 7, 1_000_000, [rule("ncq", { concurrent: 4 })], ["storage", "pickup"]),
  n("sharedStorage", "Rack storage", "storage", ["raid0", "rack"], "rack", "khz", 8, 2.7e6, [gen("storageNode", 0), rule("sharedStorage")], ["storage", "density"]),

  // Scheduling: system scope
  n("fifoSched", "FIFO scheduler", "scheduling", [], "cpu", "hz", 1, 1, [gen("scheduler", 0), strat("system", "fifo")], ["pickup"]),
  n("sjf", "Shortest job first", "scheduling", ["fifoSched"], "cpu", "hz", 2, 100, [strat("system", "sjf")], ["bits", "ints"]),
  n("timeSlice", "Time slicing", "scheduling", ["fifoSched"], "cpu", "hz", 2, 100, [strat("system", "timeSlice")], ["pickup"]),
  n("priorityQ", "Priority", "scheduling", ["sjf"], "cpu", "hz", 3, 2_500, [strat("system", "priority")], ["energy"]),
  n("mlfq", "Aging (MLFQ)", "scheduling", ["sjf", "timeSlice"], "cpu", "hz", 3, 2_500, [strat("system", "mlfq")], ["pickup"]),
  n("workStealing", "Work stealing", "scheduling", ["quadCore"], "cpu", "hz", 6, 50_000, [rule("workStealing")], ["threads"]),
  n("numaAware", "NUMA-aware", "scheduling", ["dualSocket"], "system", "khz", 8, 2.7e6, [rule("numaAware")], ["ram", "rackDist"]),
  // Scheduling: network scopes
  n("lbCapability", "Capability-aware", "scheduling", ["rack"], "rack", "khz", 8, 2.7e6, [filt("net", "capability")], ["misroute"]),
  n("lbHealth", "Health checks", "scheduling", ["lbCapability"], "rack", "khz", 8, 2.7e6, [filt("net", "health")], ["overload", "heat"]),
  n("lbRoundRobin", "Round robin", "scheduling", ["rack"], "rack", "khz", 8, 2.7e6, [strat("net", "roundRobin")], ["overload", "heat"]),
  n("lbLeastConn", "Least conns", "scheduling", ["lbRoundRobin"], "rack", "khz", 8, 2.7e6, [strat("net", "leastConn")], ["pickup", "overload"]),
  n("lbWeighted", "Weighted", "scheduling", ["lbLeastConn"], "rack", "khz", 8, 2.7e6, [strat("net", "weighted")], ["pickup"]),
  n("lbLeastWork", "Least work left", "scheduling", ["lbWeighted", "telemetry"], "rack", "mhz", 9, 1.5e7, [strat("net", "leastWork")], ["pickup", "transfer"]),
  n("lbPowerAware", "Power-aware", "scheduling", ["lbHealth", "telemetry"], "rack", "mhz", 9, 1.5e7, [filt("net", "power")], ["overload"]),
  n("binPacking", "Bin packing", "scheduling", ["lbRoundRobin", "s3Sleep", "telemetry"], "rack", "mhz", 9, 1.5e7, [strat("net", "binPack")], ["energy", "overload"]),
  n("lbAffinity", "Workload affinity", "scheduling", ["accelSystem", "lbCapability"], "rack", "khz", 8, 2.7e6, [strat("net", "affinity")], ["gpu", "pickup", "energy"]),
  n("shardSteal", "Shard stealing", "scheduling", ["lbHealth"], "rack", "mhz", 9, 1.5e7, [rule("shardSteal")], ["pickup", "transfer"]),
  n("splitGather", "Gather", "scheduling", ["lbCapability"], "rack", "khz", 8, 2.7e6, [rule("gather", { share: 0.5, waitS: 10 })], ["rackDist", "pickup"]),
  n("stealRoom", "Cross-rack stealing", "scheduling", ["shardSteal", "room"], "room", "mhz", 11, 6e7, [rule("stealRoom")], ["roomDist", "pickup"]),
  n("thermalAware", "Thermal-aware", "scheduling", ["lbPowerAware", "room"], "room", "mhz", 11, 6e7, [filt("room", "thermal")], ["heat"]),
  n("topologyAware", "Topology-aware", "scheduling", ["stealRoom"], "room", "ghz", 11, 6e7, [strat("net", "linkAware")], ["transfer", "roomDist"]),
  n("zoneAware", "Zone-aware", "scheduling", ["stealRoom", "dataCenter"], "global", "ghz", 12, 2e8, [filt("net", "local")], ["multiAz", "overload", "heat"]),
  n("regionAware", "Region-aware", "scheduling", ["regions"], "global", "ghz", 14, 3e9, [filt("global", "region")], ["region", "misroute"]),
  n("latencyAware", "Latency-aware", "scheduling", ["regionAware"], "global", "ghz", 14, 3e9, [strat("global", "latency")], ["transfer"]),
  n("priceAware", "Price-aware", "scheduling", ["latencyAware"], "global", "ghz", 14, 3e9, [strat("global", "price")], ["energy"]),

  // Networking
  n("sw100k", "Switch gen 1", "network", ["rack"], "rack", "khz", 8, 2.7e6, [gen("switch", 1)], ["transfer"]),
  n("sw1M", "Switch gen 2", "network", ["sw100k", "fabMhz"], "rack", "mhz", 10, 4e7, [gen("switch", 2)], ["transfer", "rackDist"]),
  n("sw10M", "Switch gen 3", "network", ["sw1M", "room"], "room", "mhz", 11, 6e7, [gen("switch", 3)], ["roomDist"]),
  n("sw100M", "Switch gen 4", "network", ["sw10M", "fabGhz"], "room", "ghz", 12, 2e8, [gen("switch", 4)], ["roomDist"]),
  n("sw1G", "Switch gen 5", "network", ["sw100M", "dataCenter"], "global", "ghz", 13, 4e8, [gen("switch", 5)], ["multiAz"]),
  n("sw10G", "Switch gen 6", "network", ["sw1G", "regions"], "global", "ghz", 14, 3e9, [gen("switch", 6)], ["region"]),
  n("portExpansion", "8-port switch", "network", ["rack"], "rack", "khz", 8, 2.7e6, [cap("rackPorts", 8), cap("roomPorts", 8)], ["density"]),
  n("densePorts", "12-port switch", "network", ["portExpansion"], "rack", "khz", 8, 2.7e6, [cap("rackPorts", 12), cap("roomPorts", 16)], ["density"]),
  n("spineLeaf", "Spine-leaf", "network", ["densePorts", "room"], "room", "ghz", 11, 6e7, [cap("roomPorts", 24)], ["density"]),
  n("lag", "Link aggregation", "network", ["portExpansion"], "rack", "mhz", 9, 1.5e7, [cap("uplinks", 2)], ["transfer"]),
  n("lag4", "4-way uplinks", "network", ["lag", "room"], "room", "ghz", 11, 6e7, [cap("uplinks", 4)], ["transfer", "roomDist"]),
  n("cutThrough", "Cut-through", "network", ["lag", "room"], "room", "mhz", 11, 6e7, [rule("cutThrough", { perHopMs: 1 })], ["transfer"]),
  n("qos", "QoS queues", "network", ["lbCapability"], "rack", "khz", 8, 2.7e6, [rule("qos")], ["pickup", "transfer"]),
  n("dpFiber", "Fiber plane", "network", ["dataCenter"], "global", "ghz", 13, 4e8, [gen("dataPlane", 1), rule("linkScale", { bandwidth: 10, latency: 0.5 })], ["multiAz", "transfer"]),
  n("dpDwdm", "DWDM plane", "network", ["dpFiber"], "global", "ghz", 13, 4e8, [gen("dataPlane", 2), rule("linkScale", { bandwidth: 10, latency: 0.5 })], ["multiAz"]),
  n("bbDarkFiber", "Dark fiber", "network", ["regions"], "global", "ghz", 14, 3e9, [gen("backbone", 1), rule("linkScale", { bandwidth: 10, latency: 0.5 })], ["region"]),
  n("bbDwdm", "DWDM backbone", "network", ["bbDarkFiber"], "global", "ghz", 15, 1e10, [gen("backbone", 2), rule("linkScale", { bandwidth: 10, latency: 0.5 })], ["region"]),
  n("bbSubsea", "Subsea cable", "network", ["bbDwdm", "intercontinental"], "global", "ghz", 15, 1e10, [gen("backbone", 3), rule("subseaLatency", { factor: 0.5 })], ["region"]),

  // Power
  n("cstateC1", "C1 halt", "power", [], "cpu", "hz", 1, 1, [rule("coreIdle", { factor: 0.5, afterS: 0, wakeS: 0 })], ["energy"]),
  n("cstateC3", "C3 sleep", "power", ["cstateC1", "dualCore"], "cpu", "hz", 3, 2_500, [rule("coreIdle", { factor: 0.15, afterS: 1, wakeS: 0.2 })], ["energy"]),
  n("cstateC6", "C6 power gate", "power", ["cstateC3", "fabKhz"], "cpu", "khz", 7, 1_000_000, [rule("coreIdle", { factor: 0.02, afterS: 1, wakeS: 1 })], ["energy"]),
  n("packageC", "Package C-states", "power", ["cstateC6", "l3Cache"], "system", "khz", 7, 1_000_000, [rule("packageIdle", { factor: 0.2 })], ["energy"]),
  n("s3Sleep", "Suspend (S3)", "power", ["packageC", "rack"], "rack", "khz", 8, 2.7e6, [rule("s3Sleep", { afterS: 10, factor: 0.03, wakeS: 2 })], ["energy"]),
  n("dvfs", "P-states (DVFS)", "power", ["cstateC1", "systemBoard"], "system", "hz", 5, 8_000, [rule("dvfs", { clock: 0.5, loadWatts: 0.3 })], ["energy", "overload"]),
  n("turbo", "Turbo boost", "power", ["dvfs", "fabKhz"], "system", "khz", 7, 1_000_000, [rule("turbo", { clock: 1.25, loadWatts: 1.8, maxUsage: 0.9, maxF: 80 })], ["pickup"]),
  n("powerCap", "Power capping", "power", ["dvfs", "telemetry"], "system", "hz", 6, 50_000, [rule("powerCap", { step: 0.1 })], ["overload"]),
  n("loadShed", "Load shedding", "power", ["powerCap", "room"], "room", "mhz", 11, 6e7, [rule("loadShed", { atTimerS: 5 })], ["overload"]),
  n("psu80", "80 Plus", "power", ["systemBoard"], "system", "hz", 4, 9_000, [gen("psu", 1), rule("lossFraction", { psu: 0.2 })], ["energy", "heat"]),
  n("psuBronze", "80 Plus Bronze", "power", ["psu80", "fabKhz"], "system", "khz", 7, 1_000_000, [gen("psu", 2), rule("lossFraction", { psu: 0.15 })], ["energy", "heat"]),
  n("psuGold", "80 Plus Gold", "power", ["psuBronze", "rack"], "rack", "khz", 8, 2.7e6, [gen("psu", 3), rule("lossFraction", { psu: 0.1 })], ["energy", "heat"]),
  n("psuPlatinum", "80 Plus Platinum", "power", ["psuGold", "fabMhz"], "rack", "mhz", 10, 4e7, [gen("psu", 4), rule("lossFraction", { psu: 0.07 })], ["energy", "heat"]),
  n("psuTitanium", "80 Plus Titanium", "power", ["psuPlatinum", "fabGhz"], "room", "ghz", 12, 2e8, [gen("psu", 5), rule("lossFraction", { psu: 0.04 })], ["energy", "heat"]),
  n("meteredPdu", "Metered PDU", "power", ["rack"], "rack", "khz", 8, 2.7e6, [gen("pdu", 1), rule("lossFraction", { pdu: 0.03 }), rule("supplyCapacity", { pdu: 4 })], ["overload"]),
  n("switchedPdu", "Switched PDU", "power", ["meteredPdu", "room"], "room", "mhz", 11, 6e7, [gen("pdu", 2), rule("lossFraction", { pdu: 0.02 }), rule("supplyCapacity", { pdu: 4 })], ["overload"]),
  n("dualFeed", "A+B feeds", "power", ["switchedPdu", "upsOnline"], "room", "ghz", 11, 6e7, [rule("dualFeed")], ["overload", "roomDist"]),
  n("upsOnline", "Online UPS", "power", ["room"], "room", "mhz", 11, 6e7, [gen("ups", 1), rule("lossFraction", { ups: 0.06 }), rule("supplyCapacity", { ups: 4 })], ["overload", "energy"]),
  n("upsLithium", "Lithium UPS", "power", ["upsOnline", "dataCenter"], "global", "ghz", 13, 4e8, [gen("ups", 2), rule("lossFraction", { ups: 0.03 }), rule("upsRideThrough", { seconds: 30 })], ["overload", "multiAz"]),
  n("substation", "Substation", "power", ["dataCenter"], "global", "ghz", 13, 4e8, [gen("grid", 1), rule("lossFraction", { grid: 0.03 }), rule("supplyCapacity", { grid: 8 })], ["overload"]),
  n("hvIntake", "HV intake", "power", ["substation", "regions"], "global", "ghz", 14, 3e9, [gen("grid", 2), rule("lossFraction", { grid: 0.02 }), rule("supplyCapacity", { grid: 8 })], ["overload"]),

  // Cooling
  n("thermalThrottle", "Thermal throttle", "cooling", ["rack"], "rack", "khz", 8, 2.7e6, [rule("thermalThrottle", { atF: 95, untilF: 90, clock: 0.5 })], ["heat"]),
  n("rackVarSpeed", "Fan control", "cooling", ["rack", "telemetry"], "rack", "khz", 8, 2.7e6, [rule("rackSetpoint", { minF: 55, maxF: 80 })], ["energy"]),
  n("rackAir2", "High-flow air", "cooling", ["rack"], "rack", "khz", 8, 2.7e6, [gen("rackCooler", 1)], ["heat"]),
  n("rackWater", "Rear-door water", "cooling", ["rackVarSpeed", "fabMhz"], "rack", "mhz", 10, 4e7, [gen("rackCooler", 2), rule("rackWater", { tau: 0.1, wattsPerWatt: 0.5 })], ["heat", "energy"]),
  n("rackWater2", "Direct-to-chip", "cooling", ["rackWater", "fabGhz"], "rack", "ghz", 12, 2e8, [gen("rackCooler", 3)], ["heat", "energy", "density"]),
  n("hotColdAisle", "Hot/cold aisle", "cooling", ["room"], "room", "mhz", 11, 6e7, [rule("roomLeak", { factor: 0.6 })], ["heat", "energy"]),
  n("containment", "Containment", "cooling", ["hotColdAisle"], "room", "ghz", 11, 6e7, [rule("roomLeak", { factor: 0.5 })], ["heat", "energy"]),
  n("roomAir2", "High-flow CRAC", "cooling", ["room"], "room", "mhz", 11, 6e7, [gen("roomCooler", 1)], ["heat"]),
  n("chilledWater", "Chilled water", "cooling", ["room"], "room", "mhz", 11, 6e7, [gen("roomCooler", 2)], ["heat", "energy"]),
  n("chilledWater2", "High-delta water", "cooling", ["chilledWater", "fabGhz"], "room", "ghz", 12, 2e8, [gen("roomCooler", 3)], ["heat", "energy"]),
  n("roomVarSpeed", "Chiller VFD", "cooling", ["chilledWater", "rackVarSpeed"], "room", "ghz", 11, 6e7, [rule("roomSetpoint")], ["energy"]),
  n("economizer", "Free cooling", "cooling", ["chilledWater"], "room", "ghz", 11, 6e7, [rule("economizer", { aboveOutsideF: 5, watts: 0.1 })], ["energy"]),
  n("closedLoop", "Closed loop", "cooling", ["chilledWater", "dataCenter"], "global", "ghz", 13, 4e8, [gen("roomCooler", 4)], ["heat", "energy"]),
  n("closedLoop2", "Two-phase loop", "cooling", ["closedLoop", "regions"], "global", "ghz", 14, 3e9, [gen("roomCooler", 5)], ["heat", "energy"]),

  // Structure
  n("systemBoard", "System", "structure", ["dualCore", "l2Cache"], "system", "hz", 3, 7_500, [view("system"), gen("psu", 0)], ["ram", "gpu", "storage"]),
  n("rack", "Rack", "structure", ["fabKhz"], "rack", "khz", 8, 8.1e6, [view("rack"), gen("rackCooler", 0), gen("pdu", 0), gen("lb", 0), gen("switch", 0)], ["density", "rackDist"]),
  n("room", "Room", "structure", ["rack", "fabMhz"], "room", "mhz", 10, 1.2e8, [view("room"), gen("roomCooler", 0), gen("ups", 0), gen("row", 0)], ["density", "roomDist"]),
  n("hallExpansion", "Third row", "structure", ["room", "spineLeaf"], "room", "ghz", 11, 6e7, [cap("roomRows", 3)], ["density"]),
  n("dataCenter", "Data center", "structure", ["room", "stealRoom"], "global", "ghz", 12, 6e8, [view("global"), gen("dataPlane", 0), gen("grid", 0), gen("zone", 0), cap("siteZones", 2)], ["multiAz"]),
  n("zoneExpansion", "Third zone", "structure", ["dataCenter", "zoneAware"], "global", "ghz", 13, 4e8, [cap("siteZones", 3)], ["multiAz", "density"]),
  n("regions", "Regions", "structure", ["dataCenter", "zoneAware"], "global", "ghz", 13, 1.2e9, [gen("site", 0), gen("backbone", 0), cap("sites", 4)], ["region"]),
  n("intercontinental", "Global reach", "structure", ["regions", "bbDarkFiber"], "global", "ghz", 14, 9e9, [cap("sites", 8)], ["region"]),

  // Operations
  n("telemetry", "Telemetry", "operations", ["systemBoard"], "system", "hz", 5, 8_000, [rule("telemetry")], ["overload", "heat"]),
  n("autoReturn", "Auto-return", "operations", ["telemetry"], "system", "hz", 5, 8_000, [rule("autoReturn", { delayS: 120 })], ["idle"]),
  n("autoSkip", "Auto-skip", "operations", ["autoReturn", "lbCapability"], "rack", "khz", 8, 2.7e6, [rule("autoSkip")], ["idle", "gate"]),
  n("cronTuning", "Cron tuning", "operations", ["autoReturn", "rack"], "rack", "khz", 8, 2.7e6, [rule("autoReturn", { delayS: 15 })], ["idle"]),
  n("offline12", "12 h offline", "operations", ["autoReturn"], "system", "khz", 6, 50_000, [rule("offlineCap", { hours: 12 })], ["idle"]),
  n("offline24", "24 h offline", "operations", ["offline12", "cronTuning"], "rack", "khz", 8, 2.7e6, [rule("offlineCap", { hours: 24 })], ["idle"]),
  n("offline48", "48 h offline", "operations", ["offline24", "room"], "room", "mhz", 11, 6e7, [rule("offlineCap", { hours: 48 })], ["idle"]),
  n("researchQueue", "Research queue", "operations", ["autoReturn", "fabKhz"], "system", "khz", 7, 1_000_000, [cap("researchQueue", 3)], ["idle"]),
  n("gracefulDrain", "Graceful drain", "operations", ["telemetry"], "system", "hz", 6, 50_000, [rule("gracefulDrain")], ["downtime"]),
  n("fastBoot", "Fast boot", "operations", ["gracefulDrain"], "system", "khz", 6, 50_000, [rule("bootSeconds", { seconds: 5 })], ["downtime"]),
  n("warmBoot", "Warm boot", "operations", ["fastBoot", "rack"], "rack", "mhz", 9, 1.5e7, [rule("bootSeconds", { seconds: 2 })], ["downtime"]),
  n("configSave", "Saved configs", "operations", ["rack"], "rack", "khz", 8, 2.7e6, [rule("configSave")], ["density"]),
  n("rollingUpgrade", "Rolling upgrade", "operations", ["configSave", "gracefulDrain"], "rack", "mhz", 9, 1.5e7, [rule("rollingUpgrade")], ["downtime"]),
  n("hotPlug", "Hot-plug drives", "operations", ["storageCtl", "rack"], "rack", "khz", 8, 2.7e6, [rule("hotPlug")], ["downtime"]),
  n("liveMigration", "Live migration", "operations", ["gracefulDrain", "sw1M"], "rack", "mhz", 10, 4e7, [rule("liveMigration")], ["downtime", "heat"]),
  n("hotSwap", "Hot swap", "operations", ["rollingUpgrade", "room"], "room", "ghz", 11, 6e7, [rule("hotSwap")], ["downtime"]),
  n("checkpointing", "Checkpointing", "operations", ["stealRoom"], "room", "ghz", 11, 6e7, [rule("checkpointing", { windowS: 10 })], ["roomDist", "overload", "heat"]),
];
```

Catalog tests to add with it: ids are unique; every `requires` id exists; the graph is acyclic; exactly the roots `fifoSched`, `pipelining` and `cstateC1` have no prerequisites; `fifoSched` is an ancestor of `dualCore`; `lbCapability` requires only `rack`; every `gen(part, g)` with `g > 0` has a node for `gen(part, g - 1)`, except gen 0 of core, clock, L1 and CPU, which the player owns at the start; no node has a lower tier than any of its prerequisites; every node's `data` equals `DATA_BY_TIER[tier]`, times `MILESTONE_DATA_FACTOR` for `MILESTONE_IDS`. A throwaway script run on 24 October 2026 passed all of these.

### GPU generator handoff

Keep the existing ten-field `n(...)` tuples and numeric Data arguments. Copy `RESEARCH_CREDITS` into generated `tree.data.ts` using the generator's existing `block(name)` extractor, then set optional runtime `ResearchDef.creditCost = amount(RESEARCH_CREDITS[id])` for IDs present in the map when constructing definitions. Use the binding optional `ResearchDef.creditCost?: Amount` field; omitted costs mean zero. No Data type change is needed. The appendix uses an optional decimal-string `creditCost` before conversion to runtime `Amount`. Update the sync test's node-count assertion to 164 and regenerate both data and effect text. This doc does not edit generated files.

`tensorRate.params.minGpuGen` uses displayed GPU generations 4 and 6; compare against the parsed model generation, not the internal adapter index. Take the largest applicable factor, replacing 4 with 8 rather than multiplying them. NPU tensor factors remain fixed by its own four catalog rows. `vramPerLevel` is the retained effect ID for a total VRAM multiplier, despite its legacy name. HBM sets 16 and does not compound to 64. `vramScale` halves only GPU VRAM idle watts.

## 10. Open questions and objections

### Applied under D10 and D12

D10's Network speed node and queue-only SJF, aging and Queued take text are applied in §5 and §9. D12's Auto-skip is an Operations node at Rack, kHz W8, costing 400,000,000 Data. It requires both Auto-return and Capability-aware routing, making it a mid-game automation reward after the player can identify incompatible work. It dismisses only heads that no online hardware can run.

The sync test (`src/game/build/research/tree.sync.test.ts`) byte-compares §5 and §9 with generated `tree.data.ts` and `tree.text.ts` and asserts 170 nodes after the CPU-tab pass (162 after D26, 161 after D25; the research owner updates the assertion). Regenerate both files with `WRITE_TREE=1 npx vitest run src/game/build/research/tree.sync.test.ts`. The §9 catalog checks still apply, including the three roots, acyclic prerequisites, nondecreasing tiers and exact tier Data costs.

### Applied under D25 (divisible tasks, LB queues)

| Node | Before | After |
|---|---|---|
| `gangRack` → `splitGather` (Gather) | Placement `gang` at rack scope; required for `rackDist`. | Rule `gather`: a router dispatches only when at least half its eligible children have room, or after 10 s in its queue. Gang placement is base (minimum split). |
| `lbReserve` → `shardSteal` (Shard stealing) | Rule `reserveOnRoute` (queued take, 10 s first-link backlog). | Rule `shardSteal`: a free server takes a not-started sibling shard in its rack. The LB queue (Credits, 1–32 slots) replaces queued take. |
| `gangRoom` → `stealRoom` (Cross-rack stealing) | Placement `gang` at room scope; required for `roomDist`. | Rule `stealRoom`: stealing spans the zone. `topologyAware`, `zoneAware`, `dataCenter` and `checkpointing` now require it. |
| `topologyAware` | Placement `topology`: gang members in the fewest racks. | Strategy `linkAware`: shares follow each child's link and compute capacity. |
| `zoneAware` | Placements `zone` and `gang` at site scope; required for `minZones ≥ 2`. | Filter `local` (room, site, global): keep a task in one child when it can take the whole split. Multi-AZ placement is structural. |
| `globalGang` | Placement `gang` at global scope. | Deleted: cross-site splits are base. 161 nodes. |
| `checkpointing` | A lost gang member is re-placed within 10 s. | Any lost shard is re-placed within 10 s. |
| `workStealing`, `lbCapability`, `lbLeastConn`, `lbWeighted`, `lbLeastWork`, `binPacking`, `lbAffinity` | Whole-task routing text. | Split text (§5.5). |

Tiers and Data costs are unchanged. The `PlacementId` type and the `placement` effect are removed from §9.

### Applied under D26 (memory hierarchy, spill, completion windows)

| Node | Before | After |
|---|---|---|
| `virtualMem` → `hotPages` (Hot pages) | Working sets may exceed RAM into storage, with an IO stage of 2× the excess. | Spill to disk is base (D26.1). The rule cuts a spilled shard's disk traffic to `f_d²` of its memory traffic. |
| `unifiedMemory` (new, GHz W14, requires `hbm`, `gpuGen8`) | — | VRAM pools with RAM and disk; overflow costs RAM and disk time (D26.4). |
| `memController`, `storageCtl`, `ssd`, `nvme`, `scm`, `raid0`, `ncq`, `sharedStorage` | RAM and drives are gates; IO stages need a drive. | RAM and drives are tiers of one hierarchy. Drive generations set spill speed (IO re-based to 1/16, 1/16, 1/4, 1/2 of their era's RAM bandwidth). |
| `dma`, `prefetch`, `l2Cache`, `l3Cache` | RAM stream and IO stages. | RAM and disk parts of memory stages; cache traffic is free. |

The tree has 162 nodes. Tiers and Data costs are unchanged; `unifiedMemory` costs W14 Data and work.

### Applied under the CPU-tab pass (later-era CPU nodes)

> in later parts of the game there will still be lower level upgrades

The research screen tabs nodes by the part they grow from (`src/game/view/researchParts.ts`), and the CPU tab ran thin after Hz. Eight nodes keep the CPU's own parts growing through kHz, MHz and GHz. Each uses an effect the runtime already consumes: the `lanesPerCore` and `coreSites` ceilings, and the `l3LevelBonus` ceiling, which `build/locks.ts` already applies to L3 but no node granted. Data and work follow §3's tiers.

| Part | kHz | MHz | GHz |
|---|---|---|---|
| Clock (lanes) | `branchPredict` 12 | `fma` 24 | `dualVector` 64, `matrixTiles` 112 |
| Cores | `ringBus` 12 | `meshCores` 24 | — (32 is the D7.2 cap) |
| Cache | — | `l3Slices` +1 L3 level | `edramL3` +2 L3 levels |
| Queue | — | — | — (see below) |

The lane ceiling used to stop at 32. That left MHz core levels 9–12 and GHz core levels 5–14 unreachable, although the core curve allows `8 + 2g` levels (spec §12.1). `dualVector` and `matrixTiles` open them. `CEILINGS_MAX.lanesPerCore` (`core/constants.ts`, used by the max-research test fixture) should follow to 112. Lanes past native still lower the core's energy ratio, so the higher ceilings are a choice, not free speed.

CPU-tab nodes per era (fabs excluded):

| Tab | Hz | kHz | MHz | GHz |
|---|---:|---:|---:|---:|
| CPU, before | 14 | 4 | 2 | 3 |
| CPU, after | 14 | 6 | 5 | 6 |

**Not added: effects the runtime does not consume yet.** Each needs a sim change first:

1. **Queue.** No existing effect can grow the scheduler after Hz. Every system strategy is researched in Hz, and scheduler generations come from the fabs. Under `locks.ts` (`Q ≤ 32`) and compile (`K, Q ≤ 32`), generations 1, 2 and 3 all top out at K 16 and Q 32, so the MHz and GHz schedulers add only idle watts. A 16-core SMT CPU already has 32 threads. Proposed: a `schedulerSlots` ceiling replacing the hard 32 in `locks.ts` and `MAX_SCHED_K`/`MAX_SCHED_Q`, granted by MHz per-core run queues (64) and GHz work-stealing deques (128).
2. **Turbo generations.** The `turbo` and `dvfs` rule params are ignored: phys reads `TURBO_CLOCK`, `TURBO_LOAD` and `DVFS_*` constants. Reading the params would let Turbo 2.0 (MHz, clock 1.4) and per-core DVFS (GHz) be data-only nodes.
3. **SMT share and SMT4.** `smt.shareRate` is unread, and `threadsPerCore` stops at 2 (`CEILINGS_MAX`, exec thread placement). A GHz SMT4 node needs both.
4. **Deeper C-states.** `coreIdle` matches its factor against the three fixed `CSTATES`; a C7/C10 node needs a fourth entry.
5. **Prefetcher generations.** `prefetch` has no params, and it maps to RAM.

**Runtime gap found:** `stacked3d` grants L3 generation 4, but the L3 catalog row has only four generations (`build/catalog/chip.ts`), so the node currently unlocks nothing. Spec A.1 lists generation 4 (2^39 bits, gen-3 watts); the catalog needs that fifth entry.

### D31 proposed nodes (power at scale), not yet in §5, §9 or the tree data

The sim agent adds these after the current CPU-content pass. Tiers use the §3 Data and work tables; nothing existing changes tier. With them the tree has 172 nodes.

| id | Name | Tab / part | Level | Era / tier | Requires | Effect | Text |
|---|---|---|---|---|---|---|---|
| `powerCtl` | Power control | `rackPower` / `powerCtl` | Rack | kHz W8 | `s3Sleep`, `meteredPdu` | `gen(powerCtl, 0)`: the fifth rack slot, under the cooler. Lead-acid battery plus a gen-0 start controller (Start with, head-wait trigger, slot or fastest order). | Battery and smart start for a rack |
| `powerCtlLiIon` | Li-ion power control | `rackPower` / `powerCtl` | Rack | MHz W10 | `powerCtl`, `fabMhz` | `gen(powerCtl, 1)`: more capacity per level, adds the busy trigger and batch wake (`ceil(25% × awake)` per second). | Bigger battery, predictive wake |
| `powerCtlLfp` | LFP power control | `rackPower` / `powerCtl` | Rack | GHz W12 | `powerCtlLiIon`, `fabGhz` | `gen(powerCtl, 2)`: the largest battery per level. | Largest rack battery |
| `roomStart` | Room start control | `ups` / `roomStart` | Room | MHz W11 | `powerCtl`, `room` | `gen(roomStart, 0)` on the UPS: racks start in standby (0 W) and power on by trigger in slot or coolest order. | Rooms power racks on as load rises |
| `startPredict` | Predictive start | `ups` / `roomStart` | Room | MHz W11 | `roomStart`, `telemetry` | `gen(roomStart, 1)` and `gen(globalStart, 1)`: busy trigger and batch wake for rooms and the global scheduler. | Wake ahead of the load |
| `globalStart` | Global start control | `globalScheduler` / `globalStart` | Global | GHz W14 | `roomStart`, `regions` | `gen(globalStart, 0)` on the global scheduler: sites and their zones start in standby and come online by trigger in slot, cheapest or nearest order. | Bring data centers online as needed |
| `solarFarm` | Solar farm | `site` / `generation` | Global | GHz W12 | `dataCenter` | `gen(generation, 0)`: site output × region sun factor, no fuel. | Free power from the sun |
| `windFarm` | Wind farm | `site` / `generation` | Global | GHz W13 | `solarFarm`, `regions` | `gen(generation, 1)`: output × region wind factor, no fuel. | Free power from the wind |
| `fuelCell` | Fuel cell | `site` / `generation` | Global | GHz W13 | `solarFarm`, `substation` | `gen(generation, 2)`: constant output; fuel at 0.4 × region price. | Steady on-site power |
| `ownPlant` | Own plant | `site` / `generation` | Global | GHz W14 | `fuelCell`, `hvIntake` | `gen(generation, 3)`: large constant output; fuel at 0.25 × region price. | Your own power station |

Changed by D31 (text only, no new node):
- **`s3Sleep`:** an asleep system is never a split target; routers wake asleep systems by demand.
- **`priceAware`:** ranks sites by marginal price, so a site with generation headroom ranks at its fuel price.

New `PartId`s: `powerCtl`, `roomStart`, `globalStart`, `generation`. New ceiling: none. No new rule IDs; the controllers' behavior comes from their part generation.

### Settled by the decision log (program §15a, D1)

| Question | Decision | Effect on the tree |
|---|---|---|
| Do concurrent tasks share cache and RAM? | Yes (D1.1) | L2, L3, SMT, time slicing and `prefetch` keep their capacity tension. |
| One IO stage per drive? | Yes (D1.2) | `ncq` stands. |
| Separate VRAM track? | No (D1.3) | `gddr6` and `hbm` raise VRAM per level. No VRAM generations. |
| `tensor` and `ecc` on families? | Yes (D1.4) | `tensorCores`, `matrixGpu`, `npu`, `ecc`, `rdimm` stand. |
| Base load balancer | FIFO first-fit (D1.5) | Base table rewritten. `lbRoundRobin` added. `lbHealth` now skips servers in an overload or crash countdown. `lbLeastConn` and `binPacking` redefined against first-fit. |
| Strategy changes | Hot (D1.6) | Rule 4 in §1. |
| Regional prices and outside air | Yes (D1.7) | `priceAware` added; `economizer` uses the site's outside air. |
| Fast boot | One shared boot time (D1.8) | `fastBoot` 10 s → 5 s, `warmBoot` → 2 s. |
| Auto-return timing | About 1 h (D1.9) | `autoReturn` stays at W5; `cronTuning` shortens it. |
| Offline cap | 8 h → 12 h → 24 h → 48 h (D1.10, D19.3) | `offline12` (before Rack), `offline24` (Rack), `offline48` (Room). |
| Cooling generations | Yes (D1.11) | Aligned with spec A.2. Rack: `rackAir2`, `rackWater` (rear-door), `rackWater2` (direct-to-chip). Room: `roomAir2`, `chilledWater`, `chilledWater2`, `closedLoop`, `closedLoop2`. |
| 4-port starter switch | Intended (D1.12) | `portExpansion`, `densePorts` stay cheap and early. |
| Research currency | Data plus compute work (D3) | `data` per node by tier, milestones 3× (§3). |
| Tiers from the market model | D5.6 | §3 re-derived from `scripts/market-model.ts`. 47 nodes changed tier so each tier belongs to one era. Band examples follow `docs/tasks.md`. |
| CPUs and systems | D7 | The CPU level replaces Chip. Cores capped at 32 (`stacked3d` is now stacked L3 cache); Q ≤ 32; `quadSocket` added for 3–4 CPUs; RAM slots 1→4 on general systems; `accelSystem` (2 CPUs, 8 RAM, 8 GPU) replaces `quadGpu` and `gpuBaseboard`; `octaChannel` moves onto it; `lbAffinity` added. |
| Fleet caps | Architecture §1.9 | §4.2 cites them. `spineLeaf` gives 24 room ports, `hallExpansion` the third row, `zoneExpansion` the third zone, `regions` 4 sites, `intercontinental` 8. |

### Open questions

1. **Does first-fit see the server's scheduler queue or only its cores?** I read "can admit" as "a free core with no scheduler, or a free queue slot with one". `binPacking` differs from first-fit only if that is right: it fills running slots (K) before any queue.
2. **Health checks need timers the base load balancer can read.** `lbHealth` has no `telemetry` prerequisite, on the reading that a supply's own overload alarm and a rack's crash alarm are local signals. If the spec wants telemetry first, add it as a prerequisite; the tiers still work.

### Objections to the program

1. **Thermal-aware routing has no rack-scope meaning.** One rack is one thermal lump, so the program's "thermal-aware" only works from the room load balancer up. The tree places it there. First-fit's heat story inside a rack is the board PSU's heat band, which `lbHealth` and `lbPowerAware` answer.
