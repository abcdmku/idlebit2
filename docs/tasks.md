# Tasks and market

D53, 27 October 2026. This is the current task model. Recipe definitions in `src/game/market/recipes/` own operation counts; `families.ts` owns hardware gates and market calibration. Earlier coefficient tables are superseded.

## 1. Work and payment

There are 100 market families, ten in each workload tier. Every family is a reusable recipe of named subtasks and integer repetitions. Subtasks can contain more subtasks. The seven leaves are Read bit, Write bit, NOT, XOR, AND, OR and Shift bit. Each leaf is one base CPU operation. These are the game's simplified bit algorithms, rather than claims about a host CPU instruction set.

One Credit pays for one required CPU-equivalent operation. GPU kernels retain the same operation count when their arithmetic moves to an accelerator. Required reads and writes remain work when RAM or disk bandwidth owns their execution rate. The initial logical working-set load adds one Read bit operation per bit, rounded up.

```text
recipeOps(f) = sum(part.count × recipeOps(part))
loadOps(f,s) = ceil(wsFixed + wsPerRecipe × s)
Credits(f,s) = recipeOps(f) × s + loadOps(f,s)
payloadBits  = recipeOps(f) × s
Data         = Credits / this round's family dataRatio
```

Recipe and reward arithmetic uses exact whole-number strings and bigint operations. Ledger completion tallies retain family, original whole recipe units and count; the ledger reconstructs the exact reward. Float work totals serve clocks, estimates and reports, never wallet crediting.

One logical task pays once, when its final shard completes. Child subtotals and non-final shards are contributions, not extra payouts. Retries, placement copies of fixed shard data and unified-memory spill overhead do not create another logical task or enlarge its promised reward. RAM/disk traffic and network transfer retain their own units and rates.

### 1.1 Round rewards and Data dividends, D56

The first reward needs 50 completed logical tasks in one round. The endless count ladder repeats `1, 1.5, 2, 3, 5, 7.5` per decade, starting at 50, 75, 100, 150, 200, 300, 500 and 750. Each threshold earns once per save, on first-ever reach, and requires a manual claim.

Freeze 100% of the base task Credits and Data earned since the preceding reward threshold in that round, with floors of `20 × count` Credits and `2 × count` Data. The first 50 includes tasks 1 through 50. Bonuses never enter the match. Pending grants and exact claimed receipts persist across rounds and saves. Claims add wallet currency without entering operating income, dividends or later grant calculations.

Claiming 75 grants 10% extra Data from completed market tasks; claiming 1,500 adds another 10%, capped at 20% total. Fractional dividends carry forward. Grants receive no dividend. Other capped perks and research blueprints are listed in D56 and game-spec §4.8.

## 2. Execution and hardware

The recipe compiler totals read bits, CPU arithmetic, GPU arithmetic and write bits without expanding repetitions. It executes those batched phases in that order. A GPU recipe promotes compatible arithmetic to GPU work; a parent containing CPU and GPU subtasks retains both volumes. Initial placement still loads cache, RAM and disk before those phases under D46. Cache reads/loading use the CPU clock; RAM and disk use their bandwidth and IO clocks. No new fixed processing timers exist.

A size unit is one whole recipe. Hardware gates retain fixed working sets, size-dependent memory and VRAM, GPU core floors, tensor/ECC, minimum systems, zones and region restrictions. Existing memory/VRAM densities and grain classes are converted to recipe units. Grain is at least one recipe. A task may split into at most 256 shards, preserving whole units and the full task's one payment.

Queue preparation starts with one target and one loader. D56 claims raise targets to 2 at 50 and 4 at 300; research opens 2 then 4 loaders at 50 and 500. Each loader needs a separate idle physical core and one CPU op per loaded cache bit. Installed queue space and cache remain binding. Resident workspace research at 150 retains one family's fixed cache across unlike tasks with batching enabled, never private inputs. These rewards change no frequencies or generations.

## 3. Market quantities and progression

Each round starts at intensity I = 0. Hardware never changes the draws or intensity. One draw advances I by 1 / k(I). Intensity introduces hardware requirements and raises the upper quantity range. It does not force every task to be larger than the previous one.

```text
k(I) = 7 + 0.25 I + 0.025 I² + 0.25 max(0,I−14)³
U(I) = 2^(0.85 I)
workPerRecipe = recipeOps + wsPerRecipe
sizeI = min(I, family.to) for a family retiring at or before I54; otherwise I
targetUnits = U(sizeI) × marketWork / workPerRecipe
minimum = members × grain for a minimum-split task; otherwise 1
maximum = max(2 × minimum, floor(8 × targetUnits))
s = clamp(floor(exp(log(minimum) + u × (log(maximum + 1) − log(minimum)))), minimum, maximum)
```

The seeded uniform draw `u` samples whole recipe quantities across a logarithmic range. Each doubling has comparable probability. Small jobs remain possible beside large jobs, and even a newly introduced recipe has multiple quantities. The first offer is always one Bit Flip recipe, four operations including input loading. `marketWork` controls offered quantities, never the one-Credit price of an operation.

Bit Copy, Parity Check and Bit Shift enter at I1.2, I2 and I2.6. The remaining bit recipes introduce larger fixed cache requirements from I3.8 onward. Larger tiers retain their recipe-budget delay and hardware requirements. Family weight ramps in over one intensity unit, then tapers toward 3% of its authored weight at retirement. Older families stay in the mix with their quantity ceiling frozen at retirement. Their weight remains shared across the template's variants.

The market holds a fixed head plus 50 frozen incoming offers under D54. Hardware waiting queues are separate and capped at eight under D57. Each task draw consumes two seeded RNG draws, family then quantity. Each round prepares one weight jitter and one Data-ratio jitter per family in catalog order. Weight jitter is ±30% and Data-ratio jitter ±10%. Completion windows retain ±20% variation using the same quantity draw; the broad quantity range does not multiply their deadlines. Saving, selectors, library navigation and snapshots draw no randomness. Existing family IDs stay in their old order; the 50 additions follow them.

The late family mix holds at I54, where all final-tier families have entered. Final-tier quantity ceilings continue growing while retired work remains smaller. Recipes are shared, so increasing repeat counts does not expand an operation list or add a designed final task size. Execution units and hardware clocks retain their finite floating-point representation; arbitrary-precision rewards do not make the simulator mathematically unbounded.

The 10-second pickup deadline, count-based rolling SLA, 120-second no-completion deadline and late task completion windows remain. There is no auto-skip. Data uses the existing 10–100 family ratios with per-round jitter. A failed task pays neither currency.

## 4. Work tree

The task popup shows immediate children with their cumulative counts and CPU-operation subtotals. Clicking a child opens that recipe; Back and ancestors return to its parents. Leaves show their exact counts. Initial input loading is a visible branch. The task library exposes all 100 families grouped by tier. Library previews show one recipe, not a second offer.

Existing families retain their game icons; additions use the corresponding game type silhouette. Mixed recipes retain their children's icons. Tree and library icons use native 16-pixel art, an explicit exception to the shell's larger art scale requested by the user. Tight padding and inline counts reduce height; targets remain at least 44 pixels.

## 5. Library

The following child counts are per recipe, before market repetition. Input loading is added from the family's memory requirement. Totals and rows below come from the implemented recipe data.

### bits

| Task | Immediate subtasks | Base CPU ops |
|---|---|---:|
| Bit Flip | 1 × Read bit; 1 × NOT; 1 × Write bit | 3 |
| Parity Check | 8 × Read bit; 8 × XOR; 1 × Write bit | 17 |
| AND Mask | 16 × Read bit; 8 × AND; 8 × Write bit | 32 |
| Compare | 16 × Read bit; 8 × XOR; 8 × AND; 8 × OR; 1 × Write bit | 41 |
| Integer Add | 16 × Read bit; 8 × Full-adder cell; 8 × Write bit | 64 |
| OR Merge | 16 × Read bit; 8 × OR; 8 × Write bit | 32 |
| XOR Mix | 16 × Read bit; 8 × XOR; 8 × Write bit | 32 |
| Bit Shift | 8 × Read bit; 8 × Shift bit; 8 × Write bit | 24 |
| Bit Copy | 8 × Read bit; 8 × Write bit | 16 |
| Bit Swap | 16 × Read bit; 16 × Write bit | 32 |

### ints

| Task | Immediate subtasks | Base CPU ops |
|---|---|---:|
| Bit Count | 8 × Read bit; 8 × Integer Add | 520 |
| CRC-8 | 8 × Bit Shift; 8 × XOR Mix | 448 |
| Multiply | 8 × AND Mask; 8 × Bit Shift; 8 × Integer Add | 960 |
| FNV Hash | 4 × XOR Mix; 4 × Multiply | 3,968 |
| CRC-32 | 4 × CRC-8; 4 × XOR Mix | 1,920 |
| Binary Search | 8 × Compare; 8 × Bit Shift | 520 |
| Regex Match | 64 × Compare; 64 × Bit Shift | 4,160 |
| Integer Sort | 28 × Compare; 28 × Bit Swap | 2,044 |
| Integer Divide | 8 × Compare; 8 × Integer Add; 8 × Bit Flip; 8 × Bit Shift | 1,056 |
| Bit Rotate | 2 × Bit Shift; 1 × OR Merge | 80 |

### threads

| Task | Immediate subtasks | Base CPU ops |
|---|---|---:|
| Hash Batch | 2 × FNV Hash | 7,936 |
| LZ Compress | 4 × Binary Search; 8 × Compare; 16 × Bit Copy | 2,664 |
| Monte Carlo | 8 × Multiply; 8 × Integer Add; 8 × Compare | 8,520 |
| Checksum Batch | 4 × CRC-32; 4 × Compare | 7,844 |
| Search Batch | 8 × Binary Search | 4,160 |
| Sort Batch | 2 × Integer Sort | 4,088 |
| Multiply Batch | 8 × Multiply | 7,680 |
| Mask Batch | 256 × AND Mask | 8,192 |
| Deduplicate Batch | 2 × FNV Hash; 8 × Compare | 8,264 |
| Verify Batch | 8 × Parity Check; 4 × CRC-32 | 7,816 |

### ram

| Task | Immediate subtasks | Base CPU ops |
|---|---|---:|
| JSON Parse | 64 × Regex Match; 64 × Binary Search; 256 × Bit Copy | 303,616 |
| Merge Sort | 64 × Integer Sort; 512 × Bit Copy | 139,008 |
| KV Cache Get | 64 × FNV Hash; 64 × Compare; 512 × Read bit | 257,088 |
| SQL Join | 256 × FNV Hash; 256 × Binary Search; 512 × Bit Copy | 1,157,120 |
| Graph BFS | 256 × KV Cache Get; 256 × AND Mask; 256 × Integer Add | 65,839,104 |
| Matrix Multiply | 8 × Multiply; 8 × Integer Add; 16 × Bit Copy | 8,448 |
| Histogram | 256 × Bit Count; 256 × Integer Add | 149,504 |
| Bloom Filter | 256 × FNV Hash; 256 × AND Mask; 256 × OR Merge | 1,032,192 |
| Sparse Matrix Step | 64 × Binary Search; 16 × Matrix Multiply | 168,448 |
| In-memory Aggregate | 8,192 × Read bit; 1,024 × Integer Add; 256 × Compare | 84,224 |

### gpu

| Task | Immediate subtasks | Base CPU ops |
|---|---|---:|
| Image Blur | 1 × Matrix Multiply; 16 × Write bit | 8,464 |
| Thumbnail | 1 × Image Blur; 16 × Bit Copy | 8,720 |
| Video Transcode | 8 × Image Blur; 4 × LZ Compress; 4 × CRC-32 | 86,048 |
| ML Inference | 8 × Matrix Multiply; 64 × Compare | 70,208 |
| Ray Trace Tile | 64 × Multiply; 64 × Integer Add; 16 × Compare | 66,192 |
| Vector Add | 64 × Integer Add | 4,096 |
| Vector Multiply | 64 × Multiply | 61,440 |
| Image Convolution | 16 × Matrix Multiply; 1 × Vector Add | 139,264 |
| Attention Block | 32 × Matrix Multiply; 64 × Compare; 2 × Vector Add | 281,152 |
| Backprop Batch | 64 × Matrix Multiply; 2 × Vector Multiply; 2 × Vector Add | 671,744 |

### storage

| Task | Immediate subtasks | Base CPU ops |
|---|---|---:|
| Log Ingest | 64 × JSON Parse; 64 × FNV Hash; 4,096 × Write bit | 19,689,472 |
| Backup | 8,192 × Bit Copy; 16 × CRC-32 | 161,792 |
| Index Build | 256 × Integer Sort; 256 × FNV Hash; 4,096 × Write bit | 1,543,168 |
| LSM Compaction | 64 × Merge Sort; 4,096 × Compare; 8,192 × Write bit | 9,072,640 |
| SQL Scan | 32,768 × Read bit; 4,096 × Compare; 4,096 × AND Mask | 331,776 |
| File Checksum | 32,768 × Read bit; 1,024 × CRC-32 | 1,998,848 |
| Archive | 256 × LZ Compress; 1 × Backup | 843,776 |
| Restore | 1 × Backup; 8 × Verify Batch | 224,320 |
| Deduplicated Backup | 64 × Hash Batch; 4,096 × Compare; 1 × Backup | 837,632 |
| Incremental Backup | 1 × File Checksum; 4,096 × AND Mask; 1 × Backup | 2,291,712 |

### rackDist

| Task | Immediate subtasks | Base CPU ops |
|---|---|---:|
| Replicated Write | 3 × Backup; 3 × CRC-32 | 491,136 |
| CDN Fill | 1 × Backup; 1 × File Checksum | 2,160,640 |
| API Fan-out | 4 × JSON Parse; 4 × KV Cache Get; 128 × Bit Copy | 2,244,864 |
| Payroll Run | 4,096 × Integer Add; 4,096 × Multiply; 1 × File Checksum | 6,193,152 |
| MapReduce | 8 × JSON Parse; 8 × Sort Batch; 8 × In-memory Aggregate; 4,096 × Bit Copy | 3,200,960 |
| Training Shard | 64 × Backprop Batch; 64 × Vector Add; 128 × CRC-32 | 43,499,520 |
| Distributed Cache | 8 × KV Cache Get; 8 × Replicated Write | 5,985,792 |
| Shard Rebalance | 8 × Backup; 8 × File Checksum | 17,285,120 |
| Checkpoint Set | 8 × Backup; 8 × File Checksum; 8 × CRC-32 | 17,300,480 |
| Cluster Verify | 64 × Verify Batch; 8 × File Checksum | 16,491,008 |

### roomDist

| Task | Immediate subtasks | Base CPU ops |
|---|---|---:|
| TeraSort | 32 × MapReduce; 32 × Merge Sort | 106,878,976 |
| Render Farm | 1,536 × Ray Trace Tile; 24 × File Checksum | 149,643,264 |
| PageRank | 16 × Graph BFS; 256 × Matrix Multiply | 1,055,588,352 |
| Large Training | 48 × Training Shard; 6 × Checkpoint Set | 2,191,779,840 |
| Distributed Join | 32 × SQL Join; 8 × MapReduce | 62,635,520 |
| Feature Build | 32 × JSON Parse; 32 × Histogram; 8 × MapReduce | 40,107,520 |
| Embedding Build | 64 × ML Inference; 8 × Index Build | 16,838,656 |
| Vector Index Build | 16 × Embedding Build; 16 × Index Build | 294,109,184 |
| Multi-rack Backup | 32 × Shard Rebalance; 32 × Backup | 558,301,184 |
| Simulation Sweep | 128 × Monte Carlo; 32 × In-memory Aggregate | 3,785,728 |

### multiAz

| Task | Immediate subtasks | Base CPU ops |
|---|---|---:|
| Active-Active DB | 2 × Replicated Write; 2 × Index Build; 64 × CRC-32 | 4,191,488 |
| Quorum Write | 3 × Replicated Write; 3 × Compare | 1,473,531 |
| DR Backup | 2 × Multi-rack Backup; 64 × File Checksum | 1,244,528,640 |
| Multi-hall Train | 2 × Large Training; 12 × Checkpoint Set | 4,591,165,440 |
| Zone Repair | 32 × Shard Rebalance; 32 × Cluster Verify | 1,080,836,096 |
| Cross-zone Cache | 2 × Distributed Cache; 64 × CRC-32 | 12,094,464 |
| Read Quorum | 3 × KV Cache Get; 3 × Compare | 771,387 |
| Failover Replay | 64 × Log Ingest; 8 × Cluster Verify | 1,392,054,272 |
| Zone Checkpoint | 16 × Checkpoint Set; 16 × Replicated Write | 284,665,856 |
| Multi-zone Verify | 32 × Cluster Verify; 128 × Verify Batch | 528,712,704 |

### region

| Task | Immediate subtasks | Base CPU ops |
|---|---|---:|
| EU Residency | 2 × Active-Active DB; 64 × Index Build | 107,145,728 |
| LLM Training | 16 × Multi-hall Train; 256 × Attention Block; 8 × Zone Checkpoint | 75,807,948,800 |
| APAC Payments | 32 × Payroll Run; 128 × Quorum Write | 386,792,832 |
| Exchange Feed | 64 × SQL Join; 4,096 × Compare; 64 × Quorum Write | 168,529,600 |
| Regional Search | 16 × Distributed Join; 1,024 × KV Cache Get | 1,265,426,432 |
| Global CDN Refresh | 128 × CDN Fill; 128 × File Checksum | 532,414,464 |
| Global Backup | 8 × DR Backup; 8 × Multi-zone Verify | 14,185,930,752 |
| Cross-region Join | 16 × Distributed Join; 64 × Replicated Write | 1,033,601,024 |
| Federated Train | 8 × Multi-hall Train; 4,096 × Vector Add | 36,746,100,736 |
| Global Model Release | 256 × ML Inference; 8 × DR Backup; 8 × Multi-zone Verify | 14,203,904,000 |

## 6. Saves and verification

Save version 32 resets older saves without migrations. It includes frozen reward grants, exact claim receipts and canonical per-record loader state alongside the current market and queue layout. Use the existing five invariant test files, typecheck/build, a public-barrel simulation proving exact payment and recipe sums, campaign samples and four-size QA. No new test files are required.

D53 changed future draws without changing the save shape at that revision. Existing queued offers stay frozen. The campaign bot does not claim D56 rewards, so its runs do not validate reward-inclusive long-campaign balance.

Offer sampling across seeds 42 and 7 finds 8–9 families and 18–19 distinct operation totals in the first 50 offers, spanning 4–330 operations. The previous seed-42 opening had only Bit Flip and two operation totals in the first 25. At fixed I20, 1,000 draws contain 45 families and 353 totals from 4 to 13,534,011 operations. These are seeded offer samples, not timing forecasts.

One-hour active campaign samples with the final D53 tuning reach System at 24:58 and 24:38, first GPU at 33:18 and 28:54, and end their first rounds at 6:00 and 5:48. First purchases remain at six seconds. Choice-gap targets still fail and both bots enter insolvency after System. This short pass does not establish long-run campaign balance; the older D50 timing measurements are superseded.

Frame benchmarks pass for boot, rack and maximum fleet. The offline worker takes 27.172 seconds for the fleet and 7.001 seconds for the room, within D24's fallback time limits. The fleet sample spends 69,282 of 72,000 ticks active across 18 rounds, below the required 70,000 active ticks, so the offline benchmark remains failed. Its active-work requirement is unchanged.
