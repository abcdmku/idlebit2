# Tasks and market

D50, 27 October 2026. This is the current task model. Recipe definitions in `src/game/market/recipes/` own operation counts; `families.ts` owns hardware gates and market calibration. Earlier coefficient tables are superseded.

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

## 2. Execution and hardware

The recipe compiler totals read bits, CPU arithmetic, GPU arithmetic and write bits without expanding repetitions. It executes those batched phases in that order. A GPU recipe promotes compatible arithmetic to GPU work; a parent containing CPU and GPU subtasks retains both volumes. Initial placement still loads cache, RAM and disk before those phases under D46. Cache reads/loading use the CPU clock; RAM and disk use their bandwidth and IO clocks. No new fixed processing timers exist.

A size unit is one whole recipe. Hardware gates retain fixed working sets, size-dependent memory and VRAM, GPU core floors, tensor/ECC, minimum systems, zones and region restrictions. Existing memory/VRAM densities and grain classes are converted to recipe units. Grain is at least one recipe. A task may split into at most 256 shards, preserving whole units and the full task's one payment.

## 3. Market quantities and progression

Each round starts at intensity I = 0. Hardware never changes the draws or intensity. One draw advances I by 1 / k(I). The quick recipe-market rebalance uses:

```text
k(I) = 7 + 0.25 I + 0.025 I² + 0.25 max(0,I−14)³
U(I) = 2^(0.85 I)
s = max(minimum split × grain, round(U(I) × jitter × marketWork / workPerRecipe))
workPerRecipe = recipeOps + wsPerRecipe
```

For a task without a minimum split, the size floor is one. `marketWork` is an offered-work budget. It affects quantities, never the one-Credit price of an operation. A recipe's window shifts later when its smallest complete instance exceeds the initial budget. The existing family's weight is shared among its added variants so adding names does not multiply that hardware band's total demand.

The queue contains five tasks. Each task draw consumes two seeded RNG draws, family then size jitter. Each round prepares one weight jitter and one Data-ratio jitter per family in catalog order. Size jitter is ±20%, weight jitter ±30%, Data-ratio jitter ±10%. Saving, selectors, library navigation and snapshots draw no randomness. Existing family IDs stay in their old order; the 50 additions follow them.

The late mix holds at I = 58.9 while quantities continue growing. Recipes are shared, so increasing repeat counts does not expand an operation list or add a designed final task size. Execution units and hardware clocks retain their finite floating-point representation; arbitrary-precision rewards do not make the simulator mathematically unbounded.

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

Save version 29 resets older saves without migrations because family count, completion tally layout and in-flight work meanings changed. Use the existing five invariant test files, typecheck/build, a public-barrel simulation proving exact payment and recipe sums, campaign samples and four-size QA. No new test files are required.

Quick balance evidence after the whole core-price reduction: seeds 42 and 7 reach System at 21:43 and 23:18; their first rounds end at 8:33 and 7:25. The user accepts this System timing. The six-hour seed-42 sample reaches a GPU at 30:45 and starts generation-two GPU research at 5:35:56, completing it at 5:57:12, but does not reach Rack and temporarily goes insolvent. The older round-length, choice-gap and Rack campaign targets remain unmet; this short pass does not establish long-run campaign balance.
