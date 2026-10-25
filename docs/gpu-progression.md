# GPU progression

Accepted by the lead, 24 October 2026, with the Credit fees and boundaries below. These catalog, upgrade, energy and core-floor formulas are binding. Local arithmetic checks do not establish campaign balance. This file covers the latest GPU request only. The CPU remains cores, clock, cache and queue. No CPU rule, view or implementation changes belong to this work.

## Superseded baseline

Reviewed `AGENTS.md`, `decisions.md`, `v2-program.md` sections 1, 2 and 7, and the current v3 build, research, market, execution and power code. Relevant sources are `src/game/build/catalog/board.ts`, `catalog/curves.ts`, `pricing.ts`, `compile.ts`, `research/tree.data.ts`, `market/families.ts`, `market/fleet.ts`, `exec/est.ts`, `exec/research.ts` and `phys/draw.ts`.

The current GPU generations have rates 32 / 64,000 / 128,000,000 / 256,000,000,000 ops/s, VRAM 64 / 524,288 / 1,073,741,824 / 549,755,813,888 bits, and install prices 4,000,000 / 10,000,000 / 60,000,000,000 / 100,000,000,000,000 Credits. They have no core count or clock. Flow levels double both rate and VRAM.

The superseded implementation required 4 or 8 GPU devices for five families. `gpuLink` collapses the compiled GPU device count to 1, so it can break those gates. Compilation also takes maximum GPU rate, maximum tensor rate and maximum VRAM independently, including NPU VRAM. That can invent a device which does not exist. The accepted pool and core-floor contracts below replace both behaviors.

Keep 1 Credit per completed op or bit, authored family Data ratios, whole currency wallets, existing round deadlines, and research paid in Data plus machine work. GPU generation research also charges the exact Credit fee below. No payout multiplier or research timer enters this design.

## Models and native specs

Use four digits `GSMT`. `G` is generation 1 through 9, `S` is series 3, 5, 7 or 9, and the last two digits are a tier from 30, 50, 60, 70, 80, 90. Store a validated model ID and a separate hot-upgrade count. `3350` is generation 3, core-heavy series, tier 50. Its clock class is 100 kHz.

Generation bases are:

```text
H(g) = 10^(g + 2) Hz
C(g) = 2^(g - 1) cores
V(g) = 2^(13 + 4*(g - 1)) bits
B(g) = 4000000 * 10^(g - 1) Credits
```

Clock class names describe `H`, not a task gate or a ceiling on a card's actual clock. Native clock varies with series and tier. All cards compute one ordinary GPU op per core per cycle.

| Series | Core multiplier c | VRAM multiplier v | Clock multiplier h | Price multiplier s | Watt coefficient multiplier z |
|---|---:|---:|---:|---:|---:|
| 3, core-heavy | 4 | 1 | 1 | 1 | 1 |
| 5, VRAM-heavy | 1 | 4 | 1 | 1 | 1 |
| 7, clock-heavy | 1 | 1 | 2 | 1 | 0.8 |
| 9, premium | 4 | 4 | 2 | 4 | 0.5 |

| Tier | Index k | Core and VRAM multiplier a | Clock multiplier q | Price multiplier p |
|---|---:|---:|---:|---:|
| 30 | 0 | 1 | 1.0 | 1 |
| 50 | 1 | 2 | 1.1 | 3 |
| 60 | 2 | 4 | 1.2 | 7 |
| 70 | 3 | 8 | 1.3 | 16 |
| 80 | 4 | 16 | 1.4 | 36 |
| 90 | 5 | 32 | 1.5 | 80 |

```text
nativeCores = C(g) * c * a
nativeVramBits = V(g) * v * a
nativeClockHz = H(g) * h * q
nativeOpsPerS = nativeCores * nativeClockHz
P = B(g) * s * p
```

Every higher tier improves all three specs. At a given generation and tier, series 3 has four times series 7's cores but half its clock, so it delivers twice its ordinary ops/s. Series 7 trades that capacity for 20% fewer joules per op and 25% better perf/W. Its full-load draw is 40% of series 3's. Series 5 buys four times their VRAM. No task gets a hidden serial GPU stage or clock gate to force clock-heavy purchases. Clock-heavy efficiency is an explicit coefficient in the catalog, rather than an effect the current parallel work model can derive from clock alone.

Example `3350` has 32 cores, 4,194,304 bits of VRAM, 110,000 Hz, 3,520,000 ops/s, and costs exactly 1,200,000,000 Credits before extra-card escalation. `3990` has 512 cores, 268,435,456 bits, 300,000 Hz and 153,600,000 ops/s.

## Exact prices and hot upgrades

Purchases choose a complete native model. Upgrades never turn a 3350 into a 3390 or a 3950. Replacing any model, including another model in the same generation, is a cold change under the existing boot and lost-work rules. No refund applies. Between rounds the existing cold-change policy applies without market downtime.

Let `u` be hot upgrades already applied, from 0 to 5. All three specs scale together:

```text
cores(u) = nativeCores * 2^u
vramBits(u) = nativeVramBits * 2^u * memoryTechnologyMultiplier
clockHz(u) = nativeClockHz * (5/4)^u
R(u) = nativeOpsPerS * (5/2)^u
upgradePrice(u -> u+1) = ceil(P * 3^u / 10), u < 5
```

Five upgrades are a hard limit. Each adds 2.5 times the throughput; price grows 3 times per upgrade, equivalent to about 2.296 times per throughput doubling. This follows D5's roughly 2.3 price growth per doubling without fractional currency powers. The first upgrade costs 10% of native price. All five cost 12.1 times native price. Upgrades apply at an action boundary, retain remaining work and reservations, and use new rates from the next simulation tick. No uptime timer or RNG draw applies.

Calculate `P`, upgrade prices and generation research Credit fees with bigint integer arithmetic, then call `amount(result.toString())`. Never pass these prices through `Number`, `scalePrice` or `ceilCredits`. For positive integers, `ceilDiv(n,d) = (n+d-1)/d`. Existing numeric Data literals may remain numbers where they represent these whole values exactly; debit through the exact Data wallet. Scientific notation in work quantities is explanatory only.

Retain current GPU install escalation. With `n` other GPUs already installed, install cost is `ceilDiv(P * 5^e, 4^e)`, where `e = max(0,n-1)`. NPU count does not enter this GPU-only exponent. Replacement counts the other GPUs after removing the target. Hot upgrades have no extra-card multiplier. A configuration costs its escalated native purchase plus every hot upgrade; copying a pushed card does not get those upgrades free.

For comparable series at equal generation, tier, upgrade count and install position, premium costs `4Pspecialist > 3Pspecialist`. It also exceeds buying three specialists into successive positions. Their maximum escalation sum is `1 + 1.25 + 1.5625 = 3.8125` times the first position's factor; premium is 4 times. Whole-Credit rounding cannot erase the gap at the minimum base price of 4,000,000.

| Gen 3 tier | 3-series + 5-series + 7-series Credits, equal position | 9-series Credits | Premium margin |
|---|---:|---:|---:|
| 30 | 1,200,000,000 | 1,600,000,000 | 400,000,000 |
| 50 | 3,600,000,000 | 4,800,000,000 | 1,200,000,000 |
| 60 | 8,400,000,000 | 11,200,000,000 | 2,800,000,000 |
| 70 | 19,200,000,000 | 25,600,000,000 | 6,400,000,000 |
| 80 | 43,200,000,000 | 57,600,000,000 | 14,400,000,000 |
| 90 | 96,000,000,000 | 128,000,000,000 | 32,000,000,000 |

At equal tier and push, premium matches the core-heavy card's cores, the VRAM-heavy card's VRAM and the clock-heavy card's clock. It delivers twice the core-heavy card's ops/s, four times the clock-heavy card's and eight times the VRAM-heavy card's. `G990` is the generation's strongest native card. A heavily pushed specialist may outrun a smaller native premium; the comparison must show push levels.

## Watts and efficiency

Keep D6's superlinear push cost and the existing regional energy price. Define the model's coefficient `w`, in watts per ordinary op/s, and push `x`:

```text
w = 0.5 * (9/10)^(g - 1) * z * 10/(10+k)
x = R(u) / nativeOpsPerS = 2.5^u
loadW = w * R(u) * x^0.3
idleCoreW = 0.05 * w * nativeOpsPerS * x^0.25
idleVramW = 0.05 * w * nativeOpsPerS * x^0.25 * hbmIdleFactor
actualW = idleCoreW + idleVramW + loadW * utilization
```

`hbmIdleFactor` is 1 before HBM and 0.5 after it. Preserve GDDR6's total VRAM multiplier 4 and HBM's total multiplier 16. They are technology effects on every installed GPU, with no separate VRAM purchase track. HBM replaces the multiplier with 16; it must not accidentally leave it at 4 as the current rule lookup can. These memory effects do not multiply load watts. The idle split makes the existing research promise, half VRAM watts, explicit. NPU watts are separate.

Generation, series and tier affect joules per op, not payout. Every next-generation native model has 20 times its predecessor's rate, 16 times its VRAM, twice its cores, ten times its clock, ten times its price, and 10% lower coefficient at the same series and tier. Tier 90 is 1.5 times as efficient as tier 30. Every native premium has better full-load efficiency than every native specialist of its generation: premium tier 30 beats the most efficient specialist, series 7 tier 90, by 16/15. It beats series 3 or 5 tier 90 by 4/3. Match memory technology and environment for these comparisons.

The table uses a native `G990` at full utilization, memory multiplier 1, no HBM, thermal and configuration efficiency 1, and excludes PSU loss, other board parts and cooling. Efficiency includes GPU idle watts. Approximate values do not enter currency arithmetic.

| G | Clock class H | Base C | Base V bits | Base B Credits | G990 Credits | G990 ops/s | G990 ops/J |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | 1 kHz | 1 | 8,192 | 1,000,000 | 1,280,000,000 | 384,000 | 5.455 |
| 2 | 10 kHz | 2 | 131,072 | 40,000,000 | 12,800,000,000 | 7,680,000 | 6.061 |
| 3 | 100 kHz | 4 | 2,097,152 | 400,000,000 | 128,000,000,000 | 153,600,000 | 6.734 |
| 4 | 1 MHz | 8 | 33,554,432 | 4,000,000,000 | 1,280,000,000,000 | 3,072,000,000 | 7.482 |
| 5 | 10 MHz | 16 | 536,870,912 | 40,000,000,000 | 12,800,000,000,000 | 61,440,000,000 | 8.314 |
| 6 | 100 MHz | 32 | 8,589,934,592 | 400,000,000,000 | 128,000,000,000,000 | 1,228,800,000,000 | 9.237 |
| 7 | 1 GHz | 64 | 137,438,953,472 | 4,000,000,000,000 | 1,280,000,000,000,000 | 24,576,000,000,000 | 10.264 |
| 8 | 10 GHz | 128 | 2,199,023,255,552 | 40,000,000,000,000 | 12,800,000,000,000,000 | 491,520,000,000,000 | 11.404 |
| 9 | 100 GHz | 256 | 35,184,372,088,832 | 400,000,000,000,000 | 128,000,000,000,000,000 | 9,830,400,000,000,000 | 12.671 |

Apply the existing `eta_cfg * e(T)` once to effective GPU throughput and existing heat policy once to heat. Never change gates when throttling changes clock. Before Rack, `e(T)=1`. Idle and utilization must be per device: an unused card draws its idle watts, not full load because another GPU is busy. Research draws real GPU load watts too; current `phys/draw.ts` only checks GPU task activity and needs that integration fix.

At the home price 0.01 Credits/J, native 1330 uses 2,200 W at 4,000 ops/s, spending 0.55% of its GPU work payout on GPU energy. Native 1530 uses 550 W at 1,000 ops/s. Neither fits the 256 W starter PSU by itself. An 80 Plus supply at native 1,024 W fits the latter, with 474 W left for other parts; level 3 gives 4,096 W for the former, with 1,896 W left. Quotes must include the whole system load and supply losses, not promise these headrooms for the complete system.

## Upgrade or replace, with numbers

Start with an owned native 3990. Costs below are additional Credits, without extra-card escalation. The original 128,000,000,000 purchase is sunk. Rates and watts are ordinary GPU work at the table's environment. VRAM technology multiplier remains 1.

| Choice | Additional Credits | Cores | VRAM bits | Ops/s | Full GPU W | Ops/J |
|---|---:|---:|---:|---:|---:|---:|
| Keep 3990 | 0 | 512 | 268,435,456 | 153,600,000 | 22,809,600 | 6.734 |
| 3990, u1 | 12,800,000,000 | 1,024 | 536,870,912 | 384,000,000 | 70,848,667 | 5.420 |
| 3990, u2 | 51,200,000,000 | 2,048 | 1,073,741,824 | 960,000,000 | 227,857,579 | 4.213 |
| 3990, u3 | 166,400,000,000 | 4,096 | 2,147,483,648 | 2,400,000,000 | 743,201,948 | 3.229 |
| 3990, u4 | 512,000,000,000 | 8,192 | 4,294,967,296 | 6,000,000,000 | 2,437,460,979 | 2.462 |
| 3990, u5, capped | 1,548,800,000,000 | 16,384 | 8,589,934,592 | 15,000,000,000 | 8,011,033,862 | 1.872 |
| Replace with native 4960 | 112,000,000,000 | 128 | 536,870,912 | 307,200,000 | 51,321,600 | 5.986 |
| Replace with native 4990 | 1,280,000,000,000 | 1,024 | 4,294,967,296 | 3,072,000,000 | 410,572,800 | 7.482 |

u1 buys a 2.5 times speed increase for 10% of the current flagship's price and preserves work. Native 4960 is cheaper than buying 3990 from scratch and twice as fast, but loses three quarters of its cores. It cannot replace a 512-core gate. A capacity-preserving quote must preserve both cores and VRAM and explicitly show clock and rate changes.

Native 4990 doubles u3's VRAM and delivers 28% more rate for about 55% of its full-load draw, but has only one quarter of u3's cores. It costs 7.69 times the u3 hot-upgrade bundle, before generation research. Keep u3 for an immediate core gate or a Credit shortage. Replace for VRAM, supply headroom or longer-term throughput after research. At u5 no more hot growth exists; newer models or additional linked GPUs are the remaining capacity paths.

Do not sell energy savings as an immediate payback. At an offered load of 2.4 billion ordinary GPU ops/s, u3 draws 743.20 MW. Native 4990 draws 328.92 MW at the corresponding utilization. The saving is about 4.143 million Credits/s at home, so its purchase alone takes about 308,972 seconds, or 85.8 hours, to recover from GPU energy. That excludes research, supply losses, cooling and additional paid work. The useful immediate benefits are the gates, capacity and power budget.

## Generation research

The IDs are `gpuGen1` through `gpuGen9`. The generic generation adapter uses internal index `g - 1`; model IDs keep displayed generations 1 through 9. Each node opens all 24 native models of that generation. Higher tiers require more Credits, not another research node. Do not require owning an expensive 9-series card to research a generation. Existing structural and CPU fab prerequisites remain as read-only dependencies.

Generation 1 has no Credit fee. For `g = 2..9`, `creditFee(g) = 16 * B(g)`. Charge it exactly once when the project actually starts, including a queued start. Queuing reserves and debits neither currency. Wait until both balances suffice, then debit both atomically. Switching or resuming a paid project charges nothing again. Cancellation refunds neither the fee nor Data, under the existing cancel policy. Energy remains an additional running cost.

| Node | Exact whole-Credit fee |
|---|---:|
| gpuGen1 | 0 |
| gpuGen2 | 640,000,000 |
| gpuGen3 | 6,400,000,000 |
| gpuGen4 | 64,000,000,000 |
| gpuGen5 | 640,000,000,000 |
| gpuGen6 | 6,400,000,000,000 |
| gpuGen7 | 64,000,000,000,000 |
| gpuGen8 | 640,000,000,000,000 |
| gpuGen9 | 6,400,000,000,000,000 |

Costs reuse the current research work tiers and era scale from `docs/research.md` section 3. They are fixed work volumes, never waits of the duration shown. The reference times divide work by that document's fleet capacity, use full research capacity, and exclude new GPU contributions. Changed GPU capacity will shorten them.

| Node | Prerequisites | Data, exact whole units | Work ops | Reference capacity ops/s | Reference seconds |
|---|---|---:|---:|---:|---:|
| gpuGen1 | memController | 30,000 | 1,500,000 | 15,000 | 100 |
| gpuGen2 | gpuGen1, fabKhz | 60,000,000 | 2,000,000,000 | 40,000,000 | 50 |
| gpuGen3 | gpuGen2, rack | 400,000,000 | 10,000,000,000 | 160,000,000 | 62.5 |
| gpuGen4 | gpuGen3, fabMhz | 300,000,000,000 | 5,000,000,000,000 | 14,000,000,000 | 357.1 |
| gpuGen5 | gpuGen4, room | 40,000,000,000,000 | 500,000,000,000,000 | 3,300,000,000,000 | 151.5 |
| gpuGen6 | gpuGen5, fabGhz | 100,000,000,000,000 | 1,500,000,000,000,000 | 3,300,000,000,000 | 454.5 |
| gpuGen7 | gpuGen6, dataCenter | 1,000,000,000,000,000 | 10,000,000,000,000,000 | 6,000,000,000,000 | 1,666.7 |
| gpuGen8 | gpuGen7, regions | 20,000,000,000,000,000 | 200,000,000,000,000,000 | 300,000,000,000,000 | 666.7 |
| gpuGen9 | gpuGen8, intercontinental | 50,000,000,000,000,000 | 500,000,000,000,000,000 | 300,000,000,000,000 | 1,666.7 |

For the 3990 versus generation 4 decision, the latter needs 64,000,000,000 Credits, 300,000,000,000 Data and 5 trillion research ops. Next-generation research costs `160 * B(g-1)` Credits, exactly half the current `G990` native price of `320 * B(g-1)`, before any next-generation model purchase. Choosing a current 3990 for 128,000,000,000 Credits therefore spends twice the gen-4 entry fee. Research plus native 4960 costs 176,000,000,000 Credits; research plus native 4990 costs 1,344,000,000,000 Credits, before energy and extra-card escalation. A lone native 3990 supplies those GPU ops in about 32,552 seconds; u3 supplies them in about 2,083 seconds, before CPU contribution and thermal losses. At the reference fleet, work takes 357 seconds but the Data cost equals 500 seconds at the documented 600,000,000 Data/s. Buying today's flagship or pushing it therefore competes with funding and powering the next generation. This is an analytical example, not a campaign milestone prediction.

At the existing late-game estimate of 22,000,000,000,000,000 Data per round, generation 9's Data costs about 2.27 rounds. Its 128,000,000,000,000,000-Credit flagship costs 0.582 rounds of the Credit income implied by that same Data at the minimum 10:1 ratio. A fleet of 256 such cards costs 148.9 such rounds before escalation and infrastructure, so generation 9 is a fleet replacement decision, not an instant fleet grant.

Rewire `dualGpu`, `gpuLink`, `gddr6` and `npu` to depend on `gpuGen2` where they currently depend on `gpu` or `simtGpu`. Keep their current costs and slot effects. General systems keep the existing one-slot then two-slot research; accelerator systems keep eight slots and the existing workload-affinity route. No new CPU or RAM rule enters this ruling.

Keep `tensorCores` as an optional W10 rule, 300,000,000,000 Data and 5 trillion ops, after gpuGen4. It grants 4 times tensor-stage rate to GPUs of generation 4 or later. Keep `matrixGpu` as an optional W12 rule, 100,000,000,000,000 Data and 1.5 quadrillion ops, after tensorCores and gpuGen6. It grants 8 times tensor-stage rate to generation 6 or later, replacing 4. These nodes no longer unlock GPU generations. `hbm` still requires `gddr6` and `fabMhz`. Their NPU effects are separate and explicit below. Research uses ordinary GPU ops, not the tensor boost.

## Task gates and heterogeneous placement

Replace `FamilyDef.gpus` with `gpuCoresMin`, a nonnegative integer per member. Keep the existing VRAM size term. No GPU minimum clock, GPU generation, model, device-count or minimum ops/s gate exists. Positive GPU work requires a compatible accelerator with a positive rate, not a clock threshold. CPU `threads` remains its existing maximum-use field and never enters this GPU gate.

Preserve the present family windows, work coefficients, VRAM coefficients, Data ratios, members, zones and ECC rules. Accepted core floors are:

| Family | GPU cores per member | Existing VRAM bits per member-size unit | Members |
|---|---:|---:|---:|
| imageBlur | 1 | 1 | 1 |
| thumbnail | 1 | 1 | 1 |
| transcode | 4 | 2 | 1 |
| inference | 0 | 4 | 1 |
| rayTrace | 16 | 2 | 1 |
| trainShard | 256 | 8 | 8 |
| renderFarm | 128 | 4 | 24 |
| bigTrain | 1,024 | 64 | 48 |
| hallTrain | 4,096 | 128 | 96 |
| llmTrain | 8,192 | 256 | 256 |

All other current families use zero. Inference's zero permits the existing tensor-only NPU route; a GPU can still run it. Other tensor training families require actual GPU cores under this ruling. The core floor is a hardware capability gate. It does not cap the number of GPU cores used or reserve that many cores as a separate resource. A GPU stage uses its selected domain's own ordinary or tensor rate, subject to the accepted task/research and active-stage shares.

Existing size is `round(2^(0.85*I) * jitter / members)`. At I=15, mean image-blur VRAM is 6,889 bits and its +20% example is 8,266 bits. Native 1330's 8,192 bits misses the latter; 1530's 32,768 bits fits both. At I=17, inference needs 89,524 bits at mean size and 107,428 at +20%; a 1530 after two hot upgrades has 131,072 bits. Its GPU stage has 268,572 ops at mean size and takes 42.97 seconds at 6,250 ops/s, before the RAM stage. Passing a gate never promises pickup throughput or a short completion.

At I=30, Training Shard needs 47,453,136 mean VRAM bits per member, up to 56,943,760 in the +20% example, and 256 cores. Native 3390 has 512 cores and 67,108,864 bits, so one card can satisfy it. This intentionally removes the old forced eight-device wall. At I=49, LLM Training needs 3,450,637,354,496 mean bits per member, up to 4,140,764,825,344 at +20%, plus 8,192 cores. Native 8990 has 16,384 cores and 281,474,976,710,656 bits, so one fits; 256 systems and the existing gang, ECC, RAM and zone gates still apply.

Without GPU link, each GPU is a separate pool. One actual pool must meet both core and VRAM gates. With GPU link researched, all GPUs in that system form one pool, with summed cores, summed VRAM and `sum(cores_i * clockHz_i)` throughput. Do not multiply total cores by maximum clock. Link adds no new bandwidth tax in this scope, preserving its current promised summed-rate effect. It never pools across systems or with NPUs.

Example, native 3390 plus 3590 at memory multiplier 1. The former has 512 cores and 67,108,864 bits; the latter has 128 cores and 268,435,456 bits. A task needing 256 cores and 134,217,728 bits fails without linking, although independent maxima pass. Linked, they have 640 cores, 335,544,320 bits and 96,000,000 ordinary ops/s and pass both gates. Four linked cards running at 1 kHz each may satisfy a core gate even when a faster single card cannot. Clock only changes their duration.

Choose placement deterministically among compatible pools with enough free VRAM, using largest uncontended ordinary or tensor rate for the family, then physical slot order. Static eligibility ignores temporary reservations. The accepted `gpu-runtime.md` supersedes the former predicted-finish choice and engine serialization. Reserve the task's VRAM on its selected pool when it starts, through completion or loss. Concurrent reservations must sum within that pool. Queued tasks reserve no VRAM and recheck placement on start. Active GPU stages share their domain fairly, including ordinary and tensor stages in one contention count. Shares update at exact stage events inside each tick. Separate unlinked cards progress independently. GPU stage exit retains the lifetime VRAM hold; completion or loss releases it. CPU/RAM/IO sharing semantics stay unchanged. No CPU queue or slot limits change.

Generic research uses every GPU card once at ordinary rate and each NPU once at its legacy tensor rate. Linked pooling does not multiply research capacity. It consumes the capacity left by tasks over each event interval. Shared mode splits each busy pool's rate 75% tasks and 25% research; Focus assigns it to research. The domain must never promise full rate independently to multiple tasks or to a task and research. Account per-pool utilization and existing thermal factors in both progress and draw. Admission, offered load, warm-up eligibility, routing filters and SJF estimates must use the same placement rules; aggregate maxima are only display summaries.

## NPU boundary

Do not spread the new GPU catalog into the current NPU row. Its current object spread would silently manufacture new NPU generations, prices and gates. Freeze NPU's existing four-entry catalog explicitly until a separate NPU design is approved: base rates 32 / 64,000 / 128,000,000 / 256,000,000,000; VRAM 64 / 524,288 / 1,073,741,824 / 549,755,813,888 bits; tensor factors 1 / 1 / 4 / 8; install prices 3,000,000 / 7,500,000 / 45,000,000,000 / 75,000,000,000,000 Credits; coefficient 0.125. Retain its current flow levels `L=1..11+g`, upgrade bases 12 / 120,000 / 1,500,000,000 / 7,700,000,000,000 Credits. Gates are AND lists: NPU g0 needs `npu`; g1 needs `npu` plus `gpuGen2`; g2 needs `npu` plus `tensorCores`; g3 needs `npu` plus `matrixGpu`. GPU generation research never manufactures another NPU catalog row. The generic generation-0 prerequisite enforces `npu` for every higher NPU generation.

An NPU remains a tensor-only accelerator in a shared board accelerator slot. It cannot execute image blur, transcode, ray tracing or generic GPU stages. For a tensor family with `gpuCoresMin=0`, it can supply a separate placement using its own VRAM and legacy tensor rate. Retain the memory technology capacity benefit which current compilation also applies to NPUs, explicitly 4 times VRAM with GDDR6 and 16 times with HBM, fixing the same multiplier overwrite. NPU watt coefficients and idle watts do not gain the GPU's new series, tier or HBM idle factors. This gives a legacy generation-0 level-11 NPU 262,144 bits with GDDR6, enough for the I=17 inference example. Do not infer those effects by spreading GPU models.

An NPU contributes zero GPU cores and contributes nothing to a linked GPU pool. Retain its generic research contribution at the legacy tensor rate under the accepted runtime contract, subject to the same task/research sharing and real watts. Positive GPU-core training gates exclude NPU-only placements. This replaces the old promise of matching the newest GPU generation. The four NPU rows are independent of the nine GPU generations.

## Required contracts before implementation

1. Build/catalog must add a GPU model type independent of `PartLevel.gen`, validated generation 1 through 9, the six exact tiers and `u=0..5`. The build union is `GpuBuild { kind:'gpu', model: GpuModelId, upgrades } | NpuBuild { kind:'npu', gen, level }`. One central evaluator validates the model ID and upgrade count and derives specs. Save a model ID, not a model object or GPU gen/level. Generic adapters may expose `gen=g-1` and `level=upgrades+1`. Never infer a model from ops/s. Quotes return `Amount` and hot/cold status; configuration cost and save validation use the same model catalog. Native-tier replacement never carries hot upgrades free.
2. Compiled hardware must retain bounded per-device data and pool identity, core count, VRAM, ordinary rate, tensor rate, idle watts and load watts. General boards keep one slot, then at most two through `dualGpu`; accelerator boards have eight shared GPU/NPU slots. Remove stale four-GPU board limits and comments. Capability classes include complete ordered pool signatures, not independent maxima. NPU and GPU types remain distinct.
3. A pure placement API must return either a specific feasible pool and rate or a gate reason. Market, filters, estimates, executor and research consume it. Static capability ignores temporary utilization; task startability also checks VRAM reservations, and GPU stages share the chosen domain under the accepted event-sharing contract. Return `gpu`, `gpuCores` or `vram` failure detail under the existing six failure causes; remove `gpus` device-count detail. If no pool meets both gates, never construct a synthetic fit from partial candidates.
4. Runtime records must retain selected pool, reserved VRAM and remaining GPU work. Cohorts split when members choose different pools or cannot reserve together. Hot upgrades change future rate without changing work already completed. Cold changes lose affected in-progress work once under `swap`. Reservations release on every completion, dropped round, swap, offline and fault path. Recompiles preserve stable device slot IDs.
5. Research effects must separate generation unlock, tensor technology, memory technology and slot count. Whole Data costs and decimal-string Credit fees mapped to optional `ResearchDef.creditCost?: Amount` must survive the research definition, quote, debit and queued-project path exactly. Preserve existing numeric Data representations where exact; do not broaden their type just for this change. Track first-start payment so cancellation cannot refund it and switching or resuming cannot charge twice. Sum physical work in float64 under current tick rules; settle currency through the existing whole-unit ledger. GPU research capacity must sum actual available devices, including heterogeneous unlinked cards.
6. Snapshots/plates must show model, upgrades, VRAM bits, core count, actual clock, effective rate and perf/W. GPU task requirements show only VRAM and cores. List both before/after capacities, actual system watts and exact price for replacement. Keep controls fixed while clocks, utilization or lock reasons update. GPU activity is actual device work; saturate above visible clock rates instead of inventing a slow blink. CPU snapshots and views are outside this change.

## Validation and reset

The arithmetic tables were evaluated with Node against these formulas. Assertions covered all 216 native models and 1,296 pushed model states, 2,592 premium price comparisons across install positions, native efficiency ordering, the heterogeneous gate counterexample and the exact five-upgrade total. All passed. A document whitespace check found no whitespace errors. This document does not claim an implemented balance campaign, typecheck or runtime test pass. No runtime files were edited.

Implementation acceptance requires model enumeration across all 216 native models and all six push states; exact premium comparisons at every valid install position; native efficiency ordering; same-pool heterogeneous gate counterexamples; concurrent VRAM and ordinary/tensor time-share conservation; NPU isolation; research energy draw; and save/config round trips. Delta checks must compare one long advance with tick-aligned and nonaligned partitions, including hot upgrades, stage handoffs, research completion and an SLA-ending round. Continue current RNG ordering; model formulas and placement consume no RNG. Offline and foreground execution use the same pool accounting.

Pre-live reset is the default. Bump the v3 save/catalog revision and reset earlier GPU builds, configs, pool reservations and accelerator research IDs together. Do not guess a four-digit model from an old ops/s value or preserve obsolete device-count gates. The reset note must name the GPU economy and research reset. Keep the existing policy for older save versions; the lead owns the release note and any broader reset decision.

## Resolved decisions and remaining evidence

The lead adopted the series-7 energy coefficient, nine-generation catalog, same-pool gates and lifetime VRAM reservations. The final runtime ruling uses eight physical slots plus the linked domain, eighteen ordinary/tensor clocks, largest compatible uncontended-rate selection and event-time fair sharing. It supersedes the earlier one-engine serialization and predicted-finish selection. Accelerator boards are a density option; Training Shard no longer mandates eight physical GPUs. NPU retains four explicit rows and its own tensor factors. HBM uses total VRAM multiplier 16 and halves only GPU VRAM idle watts.

Native 1330 has 125 times the old first GPU's rate and 128 times its VRAM at the same 4,000,000-Credit price. That changes both task and research capacity. Existing milestone targets need fresh legal campaign evidence, including exact research fees, purchases, research energy, supplies and cooling. Require per-card progress, occupancy and draw evidence, plus executor/performance checks at 6,912 systems with eight-device boards. Neither the local arithmetic checks nor the old homogeneous market model proves campaign balance.

The CPU/RAM specialized curves and hardware-ratio power requirements in `hardware-progression.md` remain binding. This GPU wave does not implement CPU/RAM runtime changes or route those parts back through generic flow math.
