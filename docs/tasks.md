# Tasks and market

Task and market designer, 24 October 2026; revised for program D10 on 25 October 2026. This file owns the task families, the round-age intensity curve `I`, endless-queue generation and its RNG draws, and the payout and Data formulas (`docs/game-spec.md` §2, §5). Binding inputs: `docs/decisions.md` (§3–§6, §14, decision log through D10), `docs/game-spec.md` §5 (task instance and queue), `docs/architecture.md` §1.9 (market constraints), and `docs/research.md` §2 and §8.

Every number marked **(s)** is a starting value for the balance owner. D10 replaces the fixed 2 s cadence, the five scheduled arrivals and count-weighted SLA. `scripts/market-model.ts` implements the D10 pull market and printed the tables in §9:

```sh
export PATH="/c/nvm4w/nodejs:$PATH"; npx tsx scripts/market-model.ts   # report, program rule (every round from I = 0)
npx tsx scripts/market-model.ts --start=offset   # the §12 proposal
npx tsx scripts/market-model.ts --catalog        # the §5 tables
npx tsx scripts/market-model.ts --trace          # every round and purchase of the 24 h campaign
npx tsx scripts/market-model.ts --opening        # round 1, every 30 s
npx tsx scripts/market-model.ts --round=r,L      # one round of ladder rung r at level L, every 10 s
npx tsx scripts/market-model.ts --tune           # re-fit the ladder's rung costs to their target hours
```

## 1. Summary

- The market is an **endless, ordered queue** per round (D10). The player sees the next five, head first.
- **Nothing throttles it.** Hardware takes the head as soon as it has room. There is no arrival rate, warm-up, burst or cap.
- **Only the head has a clock.** It must be taken within 10 s of becoming the head, or it fails and the next task becomes the head.
- **Every machine pulls over a pipe.** The inbound pipe starts at 1 kHz. A task's transfer size is its work, so a 1,000-op task takes 1 s to land.
- **Throughput = min(compute, pipe).** Before Rack the pipe is fixed at 1 kHz (D15), so after round 1 income is capped at 1,000 ops/s. Tasks above 10,000 ops can't be taken in time and fail. That wall, at `I` ≈ 13–14, is the push to the Rack, where ports can step at clock-parity prices (D14).
- **Difficulty grows only through task size and requirements**, which rise with round age through `I`. A round ends when the hardware can't take each next head inside 10 s, or can't run it.
- **SLA is work-weighted.** Large late tasks decide the round. Tiny early ones can't hold it up.
- There are 50 families in 10 bands, using the research tree's codes. Each structural step (RAM, GPU, storage, rack, room, AZs, regions) is a band. Its families block the line as unrunnable heads until the player owns the structure. That gives every round end a readable reason.
- Under D7, 14 families are **accelerator class** for workload-affinity routing. The GPU ruling's fixed core floors and VRAM are the GPU gates.
- Payout is exactly 1 Credit per unit of stage work (D2). Data is `payout / dataRatio`, with ratios from 10 to 100 (D3).

## 2. From family to task instance

A family is a template. Its stage coefficients, working set and gates are **per unit of size**. Each queue draw produces one logical task with one frozen family and size (§3.4). New tasks use count 1. The cohort pool remains for execution and distributed members.

Let `U(I) = 2^(0.85 × I)` be the size scale **(s)** and `j` the task's frozen size jitter (§3.5). For a family with `m` members:

```text
s            = max(1, round(U(I) × j / m))            per-member size, whole units
stage work   = coefficient × s                         per member, whole ops or bits
workingSet   = wsFixed + wsPerUnit × s                 bits, per member
vramBits     = vramPerUnit × s                         per member
storageBits  = diskPerUnit × s                         per member
payout       = m × Σ stage work                        Credits (D2: 1 Credit per op or bit; no multipliers)
payloadBits  = payout                                  D10: each member's transfer is its Σ stage work
Data         = payout / dataRatio(round)               into the Data meter (D3); whole Data is credited
```

`threads`, `ecc`, `tensor`, `gpuCoresMin`, `affinity`, `members`, `minZones` and `region` copy straight from the family. `gpuCoresMin` is a fixed nonnegative integer per member, never a size term. GPU work requires a compatible accelerator; its only hardware gates are GPU cores and VRAM. `affinity` is `accelerator` for GPU-heavy families (GPU work at least half the stage work), tensor families and big-memory families (`wsPerUnit >= 4`), and `general` otherwise. Stage resources stay `compute`, `ram`, `gpu` and `storage`.

Without GPU link, one actual GPU must meet both gates. Linked GPUs sum cores, VRAM and each card's own rate. NPU is a separate tensor-only placement for zero-core-minimum tasks. See `gpu-runtime.md`.

**Fixed versus scaling working sets.** Streaming families keep a fixed working set. A bit flip needs 1 bit and a CRC-32 needs 48, however long the stream. Families that hold their data scale `wsPerUnit × s`, and those outgrow cache and force RAM.

**Payload.** The authored `payloadPerUnit` column is retired. Transfer size is work (D10.4), the same for every family, at every hop.

## 3. The intensity curve

### 3.1 Ramp

`I` rises with round age only (program §3). A round opens at the intensity the last one earned (D12.1): start `I` = max(0, previous peak − 6), and round 1 starts at 0.

```text
dI/dt = 1 / T(I)        T(I) = min(250, 7 × 2^(I / 5)) seconds per unit of I      (s)
```

| I | 0 | 5 | 10 | 15 | 20 | 24.8 and up |
|---|---:|---:|---:|---:|---:|---:|
| T(I), seconds per unit | 7 | 14 | 28 | 56 | 112 | 250 |

D20 sets the steep opening. With no purchases, a 1 Hz core with 1 bit of cache meets 2-bit AND Mask at `I` 1.6 and tasks longer than 10 s near `I` 4. Round 1 then ends at about 60 s (55–67 s over 8 seeds in the real sim), on `Can't run · cache` and `Timed out`. A player who buys cache, clock and the queue as they come reaches the 1 kHz pipe wall at `I` ≈ 14, at 4:23–5:08. From `I` ≈ 25 the cap of 250 s per unit keeps Rack-era and later rounds at 20–50 min. Superseded: the D12.1 ramp `min(250, 25 × 2^(I/12))` and the pre-D12 piecewise ramp (40, 25, 25, 80 s per unit).

### 3.2 Round-age difficulty

Hardware, idle time, utilization, failures, SLA and queue occupancy never change `I` or the draws. No warm-up, offered load, burst state or can-run check controls demand. `I` is saved; the market step advances it once per running tick.

### 3.3 What ends a round

A task costs one system:

| System | Time per take |
|---|---|
| No scheduler | `transfer + compute`: the core waits for the pipe |
| With a scheduler | `max(transfer, compute / Keff)`: the pipe prefetches into queue slots |

Here `transfer = work / first-link speed` and `compute = Σ stage work / rate`. With `N` systems taking in turn, the head waits about `time per take / N`.

- **Too big.** When that wait passes 10 s, heads time out one after another. Task size grows ×1.8 per unit of `I`, so each doubling of fleet throughput moves this wall up by 1.18 units.
- **Can't run.** A head no online hardware can run blocks the line for its 10 s, then fails as `cantRun`. With a structural band at 15–30% of the mix, the line is blocked most of the time and work-weighted SLA settles near `1 − share`. The round then ends on that band's detail.
- **Dismissal.** An attentive player can dismiss blocked heads for free and keep the line moving (§11 item 3).

### 3.4 Queue generation and RNG

- The window holds five tasks. When one leaves (taken, failed or dismissed), the rest shift up and one task is drawn at the back at the current `I`.
- A draw is two `rng.ts` calls in order: a family by seeded weight, then a size jitter. The family weight is `w_f(I) = w × jitter_f × min(1, (I − i0) / 1, (i1 − I) / 1)` inside `(i0, i1)` and zero outside, in catalog order. The size jitter is `j = 1 + 0.2 × (2u − 1)`.
- At the zero-weight boundary `I = 0`, choose Bit Flip explicitly. Past the last window (`I > 58.9`), keep the mix of `I = 58.9` while sizes keep growing, so a round can't run empty.
- Logical IDs are reserved when a task enters the window, never at take. Pool reuse can't change identity.
- Round end prepares the next round once: its seed, its jitters and its first five tasks at the next round's start `I`. Return and auto-return start that queue without drawing again.
- Saving, loading, snapshots and opening a panel never draw. Faster hardware draws more tasks at low `I`, which is deterministic for a given state.

### 3.5 Per-round variation

At initialization or round end, prepare the target round once and draw its round seed (spec §14.3). A private `rng.ts` generator seeded by the round seed then makes two draws per family, in catalog order:

- **Weight jitter:** `w × (1 + 0.3 × (2u − 1))`, so ±30% **(s)**.
- **Data ratio jitter:** `dataRatio × (1 + 0.1 × (2u − 1))`, so ±10% **(s)**.

Per-task **size jitter** is ±20% **(s)**, frozen at the draw. Windows, the curve and the bands never move, so every round has the same shape while individual tasks differ.

### 3.6 Market constraints check

D10 has no arrival rate to bound. The model samples `I = 0 … 60` every 0.05 units and checks active families and members against architecture §1.9. It also runs the historical reach check, which compares each family's per-member needs at +20% size with the best assumed box of its era:

```text
Market check (zero): max 12 active families (I 17.2); max members 256; PASS
Assumed-capacity reach check: PASS. This is not a legal campaign or a hardware-economy acceptance check.
```

The reach check predates the accepted GPU catalog. Re-prove reach with actual GPU domains and legal research.

Per-tick work is bounded by hardware, not by the market. Each slot takes at most one task per tick (spec §6.4), and routers spend their tasks/s budget (spec §7.6). Under the program rule, a large fleet at the start of a round is limited by these caps, not by its compute (§9, "Low-load").

## 4. Bands

The codes are the research tree's (§2). Each band starts with the families that need the structure in the "Needs" column. Until the player owns it, those heads block the line and fail as `cantRun`, and that is the round's readable end.

| Code | Name | I from | First wall (`cantRun` detail) | Hardware that sustains the band | Research it implies |
|---|---|---:|---|---|---|
| `bits` | Bits | 0 | cache 2–3 bits | 1 core, clock 1–16 Hz, L1 1–4 bits | none needed; `fifoSched`, `pipelining` help |
| `ints` | Integers | 4 | cache 8–128 bits | clock 64–1024 Hz, L1 levels, FIFO queue | `fifoSched`, `pipelining`, `l2Cache` |
| `threads` | Threads | 10 | cache 512–768 bits (L2); 4–8 threads | 2–4 cores, scheduler K; the 1 kHz pipe caps them until Rack | `dualCore`, `quadCore`, `l2Cache` |
| `ram` | Memory | 12.5 | RAM (working set grows with size) | System board, RAM modules | `systemBoard`, `memController`, then `ddr`, `dualChannel` |
| `gpu` | GPU | 15 | GPU cores, VRAM | a compatible GPU model; optional tensor technology | `gpuGen1` through `gpuGen9`; `tensorCores`, `gddr6` |
| `storage` | Storage | 16.5 | storage | a drive; kHz fab for scale | `storageCtl`, `ssd`, `fabKhz` |
| `rackDist` | Rack-scale | 26 | members 2–8, gang, ECC | rack, 4–12 servers, faster ports | `rack`, `lbCapability`, `gangRack`, `ecc`, `portExpansion`, `densePorts`, switch generations |
| `roomDist` | Room-scale | 32 | members 16–48 | room, 4–8 racks | `room`, `gangRoom`, `fabMhz`, `rdimm` |
| `multiAz` | Multi-AZ | 41 | zones 2–3 | data center with 2–3 AZs | `dataCenter`, `zoneAware`, `zoneExpansion`, `fabGhz`, `hbm` |
| `region` | Regional | 46.5 | region | sites in `eu-west`, `ap-southeast`, then `ap-northeast` | `regions`, `intercontinental` |

Peak `I` per phase is in §9 C. A maxed Hz chip holds to about `I = 14`, so the `ram`, `gpu` and `storage` bands become walls before `fabKhz`.

## 5. Family catalog

Fifty families. Stage coefficients, working set, VRAM and storage are per unit of per-member size `s`. "Pay/unit" is `Σ coefficients`, the Credits earned per unit of `s` per member; it is also the payload per unit (D10). Windows and weights are **(s)**. Generated by `--catalog`.

| id | Band | Window I | w | Stages per unit | thr | Working set | Gates and tags | Members | AZ / region | Pay/unit |
|---|---|---|---:|---|---:|---|---|---:|---|---:|
| `bitFlip` | bits | 0-5 | 10 | compute 1 | 1 | 1 b | - | 1 | - | 1 |
| `parity` | bits | 0.8-6.5 | 8 | compute 1 | 1 | 1 b | - | 1 | - | 1 |
| `andMask` | bits | 1.6-7 | 6 | compute 1 | 1 | 2 b | - | 1 | - | 1 |
| `compare` | bits | 2.4-8 | 7 | compute 2 | 1 | 2 b | - | 1 | - | 2 |
| `intAdd` | bits | 3.2-9 | 8 | compute 2 | 1 | 3 b | - | 1 | - | 2 |
| `popcount` | ints | 4-9.5 | 6 | compute 2 | 1 | 4 b | - | 1 | - | 2 |
| `crc8` | ints | 4.4-10 | 7 | compute 3 | 1 | 8 b | - | 1 | - | 3 |
| `multiply` | ints | 5-11 | 6 | compute 4 | 1 | 16 b | - | 1 | - | 4 |
| `fnvHash` | ints | 5.6-12 | 6 | compute 3 | 1 | 32 b | - | 1 | - | 3 |
| `crc32` | ints | 6.4-14 | 7 | compute 3 | 1 | 48 b | - | 1 | - | 3 |
| `binSearch` | ints | 7.2-14 | 5 | compute 2 | 1 | 64 b | - | 1 | - | 2 |
| `regex` | ints | 8-16 | 6 | compute 5 | 1 | 128 b | - | 1 | - | 5 |
| `intSort` | ints | 8.8-16 | 6 | compute 4 | 1 | 64 b + 0.25 b/u | - | 1 | - | 4 |
| `hashBatch` | threads | 10-18 | 6 | compute 6 | 4 | 768 b | - | 1 | - | 6 |
| `lzCompress` | threads | 10.8-18.5 | 6 | compute 5 | 4 | 512 b | - | 1 | - | 5 |
| `monteCarlo` | threads | 11.6-18 | 5 | compute 6 | 8 | 64 b | - | 1 | - | 6 |
| `jsonParse` | ram | 12.5-20 | 7 | compute 5 | 1 | 256 b + 1 b/u | - | 1 | - | 5 |
| `mergeSort` | ram | 13.1-21 | 8 | compute 2, ram 3 | 1 | 2 b/u | - | 1 | - | 5 |
| `kvGet` | ram | 13.7-22 | 7 | compute 1, ram 4 | 1 | 4 b/u | **accel** | 1 | - | 5 |
| `sqlJoin` | ram | 14.5-23 | 7 | compute 2, ram 4 | 2 | 4 b/u | **accel** | 1 | - | 6 |
| `graphBfs` | ram | 18-26 | 5 | compute 1, ram 5 | 4 | 8 b/u | **accel** | 1 | - | 6 |
| `matmul` | ram | 20-28 | 6 | compute 4, ram 2 | 4 | 2 b/u | - | 1 | - | 6 |
| `imageBlur` | gpu | 15-24 | 7 | ram 1, gpu 10 | 1 | 1 b/u | 1 GPU core, VRAM 1 b/u, **accel** | 1 | - | 11 |
| `thumbnail` | gpu | 15.6-23 | 6 | compute 1, ram 1, gpu 6 | 1 | 1 b/u | 1 GPU core, VRAM 1 b/u, **accel** | 1 | - | 8 |
| `transcode` | gpu | 19.5-28 | 7 | compute 1, ram 2, gpu 10 | 2 | 1 b/u | 4 GPU cores, VRAM 2 b/u, **accel** | 1 | - | 13 |
| `inference` | gpu | 17-29 | 8 | ram 1, gpu 12 | 1 | 1 b/u | VRAM 4 b/u, *tensor*, **accel** | 1 | - | 13 |
| `rayTrace` | gpu | 22-30 | 5 | gpu 14 | 1 | 0 | 16 GPU cores, VRAM 2 b/u, **accel** | 1 | - | 14 |
| `logIngest` | storage | 16.5-26 | 7 | compute 1, storage 4 | 1 | 0 | disk 8 b/u | 1 | - | 5 |
| `backup` | storage | 17.2-27 | 6 | storage 6 | 1 | 0 | disk 16 b/u | 1 | - | 6 |
| `indexBuild` | storage | 18.5-29 | 6 | compute 2, ram 2, storage 3 | 1 | 2 b/u | disk 4 b/u | 1 | - | 7 |
| `compaction` | storage | 21-31 | 5 | compute 1, ram 2, storage 4 | 1 | 1 b/u | disk 8 b/u | 1 | - | 7 |
| `sqlScan` | storage | 23-33 | 6 | compute 2, ram 3, storage 3 | 4 | 2 b/u | disk 2 b/u | 1 | - | 8 |
| `replWrite` | rackDist | 26-35 | 7 | compute 2, storage 5 | 1 | 0 | disk 4 b/u, ECC, gang | 3 | - | 7 |
| `cdnFill` | rackDist | 26.6-35 | 6 | storage 5 | 1 | 0 | disk 4 b/u | 1 | - | 5 |
| `apiFanout` | rackDist | 27.4-36 | 6 | compute 3, ram 3 | 1 | 1 b/u | gang | 4 | - | 6 |
| `payroll` | rackDist | 28.2-38 | 5 | compute 3, ram 2, storage 3 | 1 | 2 b/u | disk 2 b/u, ECC | 1 | - | 8 |
| `mapReduce` | rackDist | 29-39 | 7 | compute 3, ram 3, storage 3 | 1 | 2 b/u | disk 2 b/u, gang | 8 | - | 9 |
| `trainShard` | rackDist | 29.8-40 | 6 | ram 2, gpu 18 | 1 | 1 b/u | 256 GPU cores, VRAM 8 b/u, gang, *tensor*, **accel** | 8 | - | 20 |
| `teraSort` | roomDist | 32-42 | 6 | compute 2, ram 3, storage 4 | 1 | 2 b/u | disk 4 b/u, gang | 32 | - | 9 |
| `renderFarm` | roomDist | 32.8-43 | 6 | gpu 18 | 1 | 0 | 128 GPU cores, VRAM 4 b/u, gang, **accel** | 24 | - | 18 |
| `pageRank` | roomDist | 33.6-43 | 5 | compute 3, ram 5 | 1 | 4 b/u | gang, **accel** | 16 | - | 8 |
| `bigTrain` | roomDist | 34.6-44 | 5 | ram 2, gpu 20 | 1 | 2 b/u | 1024 GPU cores, VRAM 64 b/u, ECC, gang, *tensor*, **accel** | 48 | - | 22 |
| `activeActive` | multiAz | 41-51 | 7 | compute 3, ram 3, storage 3 | 1 | 2 b/u | disk 2 b/u, ECC, gang | 4 | 2 AZ | 9 |
| `quorumWrite` | multiAz | 41.8-51 | 6 | compute 2, storage 5 | 1 | 0 | disk 4 b/u, ECC, gang | 3 | 3 AZ | 7 |
| `drBackup` | multiAz | 42.6-51 | 5 | storage 8 | 1 | 0 | disk 16 b/u, gang | 2 | 2 AZ | 8 |
| `hallTrain` | multiAz | 43.6-53 | 5 | ram 3, gpu 22 | 1 | 2 b/u | 4096 GPU cores, VRAM 128 b/u, ECC, gang, *tensor*, **accel** | 96 | 2 AZ | 25 |
| `euResidency` | region | 46.5-57 | 7 | compute 3, ram 3, storage 3 | 1 | 1 b/u | disk 2 b/u, ECC, gang | 4 | eu-west | 9 |
| `llmTrain` | region | 48.5-59 | 5 | ram 4, gpu 26 | 1 | 2 b/u | 8192 GPU cores, VRAM 256 b/u, ECC, gang, *tensor*, **accel** | 256 | 2 AZ | 30 |
| `apacPayments` | region | 47.5-57 | 6 | compute 4, ram 3, storage 3 | 1 | 1 b/u | disk 2 b/u, ECC, gang | 4 | ap-southeast | 10 |
| `exchangeFeed` | region | 50-59 | 6 | compute 4, ram 2 | 1 | 0.5 b/u | ECC, gang | 2 | ap-northeast | 6 |

The table order is the catalog order, which is the RNG draw order.

| id | Name | Band | Credits per Data | Flavor |
|---|---|---|---:|---|
| `bitFlip` | Bit Flip | bits | 12 | Toggle a stream of bits, one per op. |
| `parity` | Parity Check | bits | 15 | XOR-fold a stream into one parity bit. |
| `andMask` | AND Mask | bits | 25 | Clear bits with a mask, bit by bit. |
| `compare` | Compare | bits | 25 | Which of two numbers is larger, MSB first? |
| `intAdd` | Integer Add | bits | 25 | Ripple-carry add: a, b and the carry. |
| `popcount` | Bit Count | ints | 30 | Count set bits into a 4-bit counter. |
| `crc8` | CRC-8 | ints | 30 | 8-bit polynomial check over a stream. |
| `multiply` | Multiply | ints | 60 | Shift-and-add integer multiply. |
| `fnvHash` | FNV Hash | ints | 50 | Hash short keys with FNV-1a. |
| `crc32` | CRC-32 | ints | 40 | The checksum on every zip file. |
| `binSearch` | Binary Search | ints | 60 | Find a key in a sorted table. |
| `regex` | Regex Match | ints | 50 | Run a compiled DFA over text. |
| `intSort` | Integer Sort | ints | 60 | Sort a small array in place. |
| `hashBatch` | Hash Batch | threads | 80 | SHA-256 over a batch, one block per thread. |
| `lzCompress` | LZ Compress | threads | 40 | Deflate logs, one window per thread. |
| `monteCarlo` | Monte Carlo | threads | 100 | Estimate pi with independent samples. |
| `jsonParse` | JSON Parse | ram | 40 | Parse a big API response into a tree. |
| `mergeSort` | Merge Sort | ram | 60 | Sort an array too big for cache. |
| `kvGet` | KV Cache Get | ram | 50 | Serve hot keys from an in-RAM map. |
| `sqlJoin` | SQL Join | ram | 15 | Hash-join two tables in RAM. |
| `graphBfs` | Graph BFS | ram | 20 | Walk a social graph level by level. |
| `matmul` | Matrix Multiply | ram | 70 | Dense float matrix product. |
| `imageBlur` | Image Blur | gpu | 60 | Gaussian blur on a photo. |
| `thumbnail` | Thumbnail | gpu | 70 | Resize uploads for a feed. |
| `transcode` | Video Transcode | gpu | 60 | H.264 to AV1, one segment. |
| `inference` | ML Inference | gpu | 12 | Run a trained model on a batch. |
| `rayTrace` | Ray Trace Tile | gpu | 80 | Render one 64x64 tile. |
| `logIngest` | Log Ingest | storage | 10 | Append and index server logs. |
| `backup` | Backup | storage | 40 | Snapshot a volume to disk. |
| `indexBuild` | Index Build | storage | 12 | Build a B-tree over a table. |
| `compaction` | LSM Compaction | storage | 30 | Merge sorted runs into one. |
| `sqlScan` | SQL Scan | storage | 12 | Full table scan with filters. |
| `replWrite` | Replicated Write | rackDist | 40 | Commit one write to three replicas. |
| `cdnFill` | CDN Fill | rackDist | 60 | Pull an object into an edge cache. |
| `apiFanout` | API Fan-out | rackDist | 70 | One request, four backend calls. |
| `payroll` | Payroll Run | rackDist | 40 | Nightly batch where a flipped bit costs money. |
| `mapReduce` | MapReduce | rackDist | 12 | Map, shuffle, reduce on 8 nodes. |
| `trainShard` | Training Shard | rackDist | 10 | One data-parallel step across 8 systems. |
| `teraSort` | TeraSort | roomDist | 25 | Sort a huge file across 32 nodes. |
| `renderFarm` | Render Farm | roomDist | 80 | Film frames across the farm. |
| `pageRank` | PageRank | roomDist | 12 | Iterate link scores over a web graph. |
| `bigTrain` | Large Training | roomDist | 10 | A model too big for one rack. |
| `activeActive` | Active-Active DB | multiAz | 30 | Accept writes in two zones at once. |
| `quorumWrite` | Quorum Write | multiAz | 40 | Raft commit across three zones. |
| `drBackup` | DR Backup | multiAz | 30 | Copy a snapshot to another zone. |
| `hallTrain` | Multi-hall Train | multiAz | 10 | Training that spans two halls. |
| `euResidency` | EU Residency | region | 20 | EU personal data stays in the EU. |
| `llmTrain` | LLM Training | region | 10 | Pretrain on 256 systems; any region. |
| `apacPayments` | APAC Payments | region | 40 | Card payments settled in-region. |
| `exchangeFeed` | Exchange Feed | region | 15 | Match orders next to the Tokyo exchange. |

Family count per band: `bits` 5, `ints` 8, `threads` 3, `ram` 6, `gpu` 5, `storage` 5, `rackDist` 6, `roomDist` 4, `multiAz` 4, `region` 4.

Notes on the catalog:
- **Tags.** `tensor` is on the 5 inference and training families (D1.4); `tensorCores`, `matrixGpu` and `npu` speed only these. `ecc` is on 10 families, all at Rack or later, because the `ecc` node needs `rack`. That is why no pre-Rack `storage` family carries it; `payroll` is the single-system storage-heavy ECC family at Rack.
- **Shared working sets** (D1.1). Running tasks' working sets add up. The fixed-set `ints` and `threads` families (128–768 bits) fill L1 fast when K grows, which is the `l2Cache` and `l3Cache` pressure. The scaling families fill RAM.
- **Payload.** Under D10 every task carries its own work as payload (§2). Network-heavy families no longer exist as a separate idea: big tasks are network-heavy because they are big. Port, uplink and pipe speeds must keep pace with compute.
- **Per-member GPU floors.** `imageBlur` 1, `thumbnail` 1, `transcode` 4, `inference` 0, `rayTrace` 16, `trainShard` 256, `renderFarm` 128, `bigTrain` 1,024, `hallTrain` 4,096 and `llmTrain` 8,192. All other families use zero. These are fixed integers, not size coefficients. Inference's zero allows a fitting tensor-only NPU. Positive-core training gates exclude NPU-only placement.
- A task's cores and VRAM must fit the same actual GPU domain. Core gates do not reserve exclusive cores or cap rate; active stages share the domain. A task reserves VRAM from start through completion or loss, including its CPU/RAM/IO stages. GPU link can meet a gate by summing actual GPU cores and memory; multiple unlinked cards cannot.
- The existing VRAM coefficients, windows, members, zones, RAM, ECC, work and Data ratios remain. A native 3390 can satisfy Training Shard's 256 cores and its `I=30`, +20% VRAM example alone. That removes the old forced eight-device wall without removing its eight-system gang or other requirements.
- **Affinity pays both ways.**
  - Accelerator-class families can use up to eight GPUs, with linked rates and VRAM summed from the actual models, and eight DIMMs with no DIMM penalty.
  - General families want cores. A general box has up to 128 cores against the accelerator's 64. On an accelerator their pickup takes one of its 32 slots while 8 GPUs sit idle, and that slot is then missing for a GPU task.
  - Round robin mixes them. Workload affinity separates them.
- **Historical reach check.** The earlier model fit each family to a general or accelerator box under its old GPU catalog. That claim needs fresh evidence under the accepted GPU core/VRAM rules. The largest thread count is 8, well under 128 cores. To pass, `euResidency` and `apacPayments` were cut from 2 to 1 RAM bit per unit and `exchangeFeed` from 1 to 0.5, so a 4-DIMM GHz box still holds them at the endgame.
- **GPU work payout.** D2 still pays one Credit per op. Rate and energy depend on the chosen model and push. The old estimate of twice the earnings per busy slot-second is unproved under the new catalog; do not add a payout premium to preserve it.

## 6. Failure names

The six causes and their labels are fixed by D4.1. The feed and the round report add one short detail, at most 8 characters, after the label so the player can answer "why did SLA drop?" at a glance.

| Cause | Label | Detail shown | When |
|---|---|---|---|
| `timeout` | Timed out | none, or `link` | The head was not taken within its 100 ticks while some online hardware could run it. `link`: a capable system had a free slot, but its first link was busy for the whole window. |
| `cantRun` | Can't run | `cache`, `RAM`, `GPU`, `gpuCores`, `VRAM`, `storage`, `ECC`, `members`, `gang`, `zones`, `region` | The head was not taken within its 100 ticks and no online hardware could run it: the first failing gate in this order (spec §6.3 and placement). |
| `misroute` | Misrouted | the gate the target lacked | Routed by a capability-blind load balancer to a system that can't run it. |
| `power` | Power | supply name: `PSU`, `PDU`, `UPS`, `grid` | Lost to a supply failure. |
| `heat` | Heat | `rack` or `room` | Lost to a thermal crash. |
| `swap` | Swap | `cold` or `offline` | Lost to a cold change or an offline toggle. |

A slow link is never `cantRun` under D10; it only delays the next take. The round report lists causes by count and failed work, and shows the top `cantRun` detail. That detail names the next purchase or research ("Can't run · RAM 61").

## 7. Regions

Region IDs, outside air temperature and energy prices are the spec's (§3.3). Region-locked families make the choice of where to build a real trade:

| Family | Region | Opens with | Why it matters |
|---|---|---|---|
| `euResidency` | `eu-west` | `regions` | Mild air (60 °F) but expensive power (0.014). The family is RAM- and storage-heavy and low-watt, so the high price hurts less. |
| `apacPayments` | `ap-southeast` | `regions` | Cheaper power (0.011) but hot air (88 °F). Cooling costs, and water cooling, decide its margin. |
| `exchangeFeed` | `ap-northeast` | `intercontinental` | The most expensive power (0.016). It is small and latency-bound; you build there because you must. |
| `llmTrain` | none (2 AZ) | — | The biggest energy draw in the game. It is free to run anywhere, so it rewards a site in `eu-north` (45 °F, 0.009) or `af-south` (cheapest power at 0.007, but 90 °F air). This is the price-aware backbone's job (D1.7). |

The market enters at the gateway site (D4.6), so remote sites pay backbone transfer on every task. That keeps "build in the cheap region" from being free.

## 8. The opening

The boot machine is one 1 Hz core, 1 bit of L1, no scheduler and a 1 kHz pipe. These times come from the real sim (`scripts/balance/opening.ts`, 8 seeds; D20 ramp `T(I) = min(250, 7 × 2^(I/5))`): the passive bot buys nothing, the active bot buys the cheap upgrades as they come.

| Time | Market | What the player sees and does |
|---|---|---|
| 0:00 | `I = 0`. The head is Bit Flip: 1 op, 1 bit. | It lands over the pipe in 1 ms, runs 1 s on the 1 Hz core and pays 1 Credit. The next head is taken the moment the core frees. The core LED blinks once per op. |
| 0:04 | | **First purchase**: a clock or L1 level for 3 Credits (every seed). Tasks now take 0.5 s. |
| 0:10 | `I` ≈ 1.6 | **First whole Data** (Bit Flip 12:1). It buys a 1-Data root: `pipelining`, `fifoSched` or `cstateC1`. AND Mask joins with **2 bits**: without an L1 level the head blocks, then fails "Can't run · cache". |
| 0:55–1:07 | `I` 5.3–6.1 | **Round 1 ends here without upgrades** (D20; median 1:00 over 8 seeds): two or three "Can't run · cache" and tasks past 10 s on the 1 Hz core ("Timed out"). |
| 1:00–4:00 | `I` 5–12; tasks 10–1,000 ops | The upgrading player buys clock and cache levels every 10–30 s, then the queue (`fifoSched`, 1 Data) and its levels. The pipe becomes visible from about 100 ops (0.1 s at 1 kHz). |
| 4:23–5:08 | `I` 13.2–14.1 | Tasks near 10,000 ops take 10 s on the 1 kHz pipe, so heads time out. **Round 1 ends** for the upgrading player at the pipe wall, on "Timed out". |
| round 2 to Rack (5 min – 6:48) | `I` peaks at 14–15 | Rounds of 3–4 min against the same wall. Nothing before Rack raises the cap (D15). The player saves Data: **System** at 0:53 (`systemBoard`, 36,000 Data), `memController` and `psu80`, `fabKhz` at 3:33 (150,000), then **Rack** at 6:40–6:48 (150,000). |

Why the start is readable:
- one task at a time, 1 op per second, and the LED shows every op;
- the first gate (2 bits) arrives in the first 10 s, right after the first purchase, and names its cause;
- an idle player's round 1 ends inside a minute for reasons they watched happen: cache, then tasks longer than 10 s. The first purchases answer both;
- the upgrading player's round 1 ends at the pipe wall, the push to the Rack.

The pipe is visible from about 100 ops (0.1 s at 1 kHz). Shorter transfers last under one frame; the renderer shows them as a one-frame pulse, never as a slowed travel (§11 item 4).

## 9. Model results

### Current run: D19 months-long pacing, D20 opening, D21 fast bot

Two proofs (program D19.2):

- **The real sim** plays the campaign bot (`src/game/probes/bot.ts`, active policy) in chained stages. Each stage is one process that continues the previous stage's exact save (`scripts/balance/chain.ts`, `run.ts --from --out`). A chained run replays an unchained one exactly (`campaign.test.ts`).
- **The design model** (`npx tsx scripts/market-model.ts --horizon=100`) plays day 1 active, then an engaged idle player: check-ins at 7:30–8:00, 12:30–13:00, 18:00–20:00 and 22:30–23:00, auto-return in between, and offline progress up to the researched cap (8, 12, 24, 48 h). Its rung `payMin` values are re-fitted with `--horizon=120 --tune` to the D19 hours. The model has no routing budget (D12.5).

#### A. Milestones (seed 42)

| Milestone | D19 / D20 target | Real sim | Model |
|---|---|---|---|
| First purchase | under 0:00:30 | 0:00:04 | 0:00:04 |
| Round 1 ends, no purchases (D20) | about 1:00 (0:45–1:15) | 0:55 / 1:00 / 1:07 over 8 seeds | — |
| Round 1 ends, active player | 4–8 min | 4:23 / 4:58 / 5:08 over 8 seeds | — |
| System | 30–60 min | 0:53 (0:47:55 / 0:51:26 / 0:53:03 over 6 seeds) | 0:51 |
| Rack | 5–8 h | 6:48 (6:37:23 / 6:47:11 / 6:48:14 over 6 seeds) | 6:48 |
| First data center (Room) | 2–4 days | 2 d 12:15 | 2 d 19:23 |
| Zones (`dataCenter`) | about 1–2 weeks | 13 d 13:33 | 10 d 18:19 |
| Second site (`regions`) | 2–4 weeks | 27 d 07:01 | 20 d 18:15 |
| Every data center (max fleet) | 2–4 months | not run | 92 d 07:37 |

Round 1 without purchases fails on `Can't run · cache` (2-bit AND Mask) and on tasks past 10 s; the active player's round 1 ends on `Timed out` at the 1 kHz pipe wall.

#### B. Real-sim stage chain (D21)

Every stage stays well under the 3-minute limit; a full 28-day chain takes about 12 minutes of wall time in 9 processes.

| Stage | Game span | Wall | Speedup |
|---:|---|---:|---:|
| 1 | 0 d 0:00 → 1 d 0:00 | 35.0 s | 2,472× |
| 2 | 1 d 0:00 → 3 d 13:47 | 79.3 s | 2,805× |
| 3 | 3 d 13:47 → 6 d 11:54 | 74.3 s | 3,399× |
| 4 | 6 d 11:54 → 10 d 0:53 | 88.0 s | 3,476× |
| 5 | 10 d 0:53 → 13 d 15:46 | 86.4 s | 3,622× |
| 6 | 13 d 15:46 → 17 d 10:19 | 87.6 s | 3,719× |
| 7 | 17 d 10:19 → 21 d 7:19 | 100.6 s | 3,328× |
| 8 | 21 d 7:19 → 24 d 18:30 | 80.2 s | 3,736× |
| 9 | 24 d 18:30 → 28 d 15:54 | 93.3 s | 3,606× |

Boot to Rack runs at about 17,000× when timed alone (1.4 s of wall for 6.7 h). Six 24 h seeds run in parallel worker threads in 42 s (`scripts/balance/seeds.ts`).

#### C. Model, D19 rungs (check-in player)

| Rung | Cost (Credits, proxy) | Bought at |
|---|---:|---|
| System + RAM | 1.8e6 | 0 d 00:51 |
| kHz fab | 7.1e6 | 0 d 03:33 |
| Rack, 4 servers | 7.0e6 | 0 d 06:48 |
| Rack, 12 servers | 1.6e12 | 0 d 13:54 |
| MHz fab | 1.9e13 | 1 d 19:44 |
| Room, 4 racks | 8.8e13 | 2 d 19:23 |
| Room, 8 racks | 4.5e16 | 4 d 18:08 |
| GHz fab | 3.8e17 | 6 d 22:51 |
| Data center, 2 AZ | 1.3e18 | 10 d 18:19 |
| 3 AZ | 3.3e18 | 13 d 18:12 |
| Regions | 2.2e20 | 20 d 18:15 |
| Intercontinental | 7.5e21 | 45 d 18:01 |
| Max fleet (8 sites × 3 zones × 24 racks × 12) | 9.4e22 | 92 d 07:37 |

The model's rung prices are proxies on its frozen price scale, not catalog prices. Its economy grows far faster than the real sim's: at Rack with 12 servers the model earns about 5e11 Credits per round, the real bot about 3e7. The two agree on milestone times because the real game gates milestones on research Data and work, which D19 re-tiers to the real bot's income (research doc §3).

#### D. What the real bot shows after Rack

- From Rack to Regions the real bot holds one full rack of 12 kHz servers. Rounds end at `I` 18–21 on GPU, VRAM, storage and RAM gates (`cantRun` and `misroute`). Gross stays near 3e7 Credits and Data near 6e5 per 7–9 min round.
- Energy is about a third of gross. Coolers run at full duty until fan control, so the bot rarely affords a copied rack for the room.
- Milestones still land in their bands, because Data accumulates steadily and the W9–W13 tiers are sized to that flat income. A stronger post-Rack economy (filling rooms, MHz parts, port climbs) would pull Room, Data center and Regions earlier. The W11–W15 tiers would then need raising. This is the main open balance item.

### Historical: D12 offset start, D14 price parity, D15 link timing

Superseded by the D19 run above. In this run:
- the pipe is fixed at 1 kHz until Rack;
- from Rack on, the bot buys rack-switch port steps for every server at parity prices before any compute level. Compute beyond the port is wasted;
- the rack uplink stays at the room network-rack default (10 GHz) until Room;
- GPU and Storage come after Rack, because their bands start above the pipe wall;
- rung prices from System to Rack are re-fitted to the capped income. Prices after Rack were re-fitted with `--tune=9`.

Ladders (from `I = 0`, ports matched from Rack on):

| Ladder | Round | Low-load | Pipe-bound | Met | Failed | Top causes | Credits | Peak I | Band at end |
|---|---:|---:|---:|---:|---:|---|---:|---:|---|
| Fresh boot | 1:51 | 0:00 | 0:00 | 40 | 3.3 | Can't run: cache 3 | 72 | 4.0 | bits |
| Boot, 16 Hz | 4:14 | 0:00 | 0:00 | 626 | 7.0 | Timed out 4, Can't run: cache 3 | 2875 | 8.0 | ints |
| Boot maxed | 8:36 | 2:15 | 8:36 | 2197 | 22 | Timed out 21, Can't run: RAM 0 | 1.6e5 | 13.6 | ram |
| Dual core | 9:32 | 1:29 | 9:32 | 9697 | 16 | Timed out 12, Can't run: RAM 3 | 3.6e5 | 14.6 | ram |
| Early chip (4 cores, L2) | 9:43 | 1:08 | 9:43 | 1.6e4 | 12 | Timed out 10, Can't run: RAM 2 | 4.1e5 | 14.8 | ram |
| kHz system (pre-Rack) | 9:50 | 1:08 | 9:50 | 1.6e4 | 12 | Timed out 12 | 4.2e5 | 14.9 | ram |
| Rack (4 sys, ports matched) | 16:20 | 16:20 | 0:00 | 1.0e4 | 98 | Can't run: GPU 89, Can't run: storage 9 | 8.2e7 | 20.5 | storage |
| Rack (12 sys, ports matched) | 49:36 | 16:34 | 0:00 | 2.4e5 | 48 | Can't run: members 26, Timed out 17 | 1.2e12 | 35.7 | roomDist |
| Room (96 sys) | 99:41 | 35:23 | 25:33 | 3.3e6 | 175 | Can't run: zones 140, Can't run: RAM 21 | 2.9e15 | 48.2 | region |
| Zones (288 sys) | 158:22 | 84:08 | 65:54 | 7.3e7 | 380 | Can't run: region 249, Can't run: RAM 125 | 9.5e18 | 62.3 | region |
| Regions (576 sys) | 168:16 | 84:08 | 41:13 | 1.4e8 | 203 | Can't run: RAM 201, Timed out 2 | 6.1e19 | 64.7 | region |

#### B. 24 h active player: milestones (offset)

| Milestone | Target | Model |
|---|---|---|
| First purchase | under 0:00:30 | 0:00:04 |
| First whole Data | 0:00:20-0:00:40 | 0:00:09 |
| First round ends | 0:04-0:08 | 0:05:51 (Timed out 7, Can't run: cache 2, Can't run: RAM 1) |
| Pipe first binds (1 kHz cap) | before Rack (D15) | 0:06:36 (round 2) |
| Pipe-bound time before Rack | the push to Rack | 94:10 |
| First port step / pays back | at Rack | 1:47:30 / 1:48:10 |
| System | 0:20-0:40 | 0:23:52 |
| Rack | 1:30-3:00 | 1:45:24 |
| Room | 5:00-8:00 | 5:39:37 |
| Data center | 10:00-14:00 | 11:28:59 |
| Regions | 18:00-25:00 | 19:20:46 |

#### B2. The opening across 10 seeds (min / median / max)

| Measure | Target | Model |
|---|---|---|
| First purchase | under 0:00:30 | 0:00:04 / 0:00:04 / 0:00:04 |
| First whole Data | 0:00:20-0:00:40 | 0:00:08 / 0:00:09 / 0:00:09 |
| First round ends | 0:04-0:08 | 0:05:35 / 0:06:00 / 0:06:06 |

#### C. Round length by phase

| Phase | Target | Rounds | Round mean (min-max) | Low-load mean (max) | I start-peak | Credits/round (last) | Data/round (last) |
|---|---|---:|---|---|---|---:|---:|
| Early, 0-1 h | 4-10 min | 12 | 5:06 (4:25-7:08) | 0:01 (0:17) | 0-10 … 8-14 | 2.2e5 | 5044 |
| Mid, 1-8 h | 10-25 min | 28 | 14:13 (4:25-29:58) | 0:00 (0:00) | 8-14 … 37-44 | 1.8e14 | 1.7e13 |
| Late, 8-24 h | 20-45 min | 37 | 26:06 (1:20-52:52) | 0:00 (0:00) | 38-45 … 43-55 | 1.2e17 | 1.1e16 |

#### D. Rungs: cost (payMin minutes of the frozen price scale at I = need) and purchase time

| Rung | need I | payMin | Cost (Credits) | Bought at |
|---|---:|---:|---:|---|
| FIFO scheduler | 9 | 0.071 | 1400 | 0:05:56 |
| Dual core | 11 | 0.1 | 9600 | 0:05:56 |
| L2 + quad core | 12 | 0.89 | 1.9e5 | 0:13:50 |
| System + RAM | 14.5 | 0.35 | 5.0e5 | 0:23:52 |
| kHz fab | 15 | 1 | 2.0e6 | 1:09:19 |
| Rack, 4 servers | 25 | 0.00043 | 1.5e6 | 1:45:24 |
| GPU | 14.5 | 6.5 | 9.2e6 | 2:03:46 |
| Storage | 14.5 | 3.8 | 5.4e6 | 2:03:46 |
| Rack, 12 servers | 27 | 0.27 | 4.0e9 | 2:51:02 |
| Accelerators | 29 | 0.92 | 4.5e10 | 3:22:30 |
| MHz fab | 29 | 2.3 | 1.1e11 | 3:54:54 |
| Room, 4 racks | 33.5 | 3.2 | 2.8e12 | 5:39:37 |
| Room, 8 racks | 40.5 | 0.61 | 4.8e13 | 7:29:56 |
| GHz fab | 41.5 | 3.2 | 4.5e14 | 8:52:21 |
| Data center, 2 AZ | 42 | 7.1 | 1.3e15 | 11:28:59 |
| 3 AZ | 43 | 37 | 1.0e16 | 15:37:16 |
| Regions | 48.5 | 7.9 | 5.3e16 | 19:20:46 |
| Intercontinental | 50 | 7.1 | 1.4e17 | 23:30:40 |

What must give for these targets to hold under D15 (the smallest change):

| Item | Today | Needed | Why |
|---|---|---|---|
| `rack` research Data | 1.8e8 (W7 × 3) | about 30,000 (W6 tier × 3, move `rack` to W6) | Pre-Rack Data income is about 60,000 per hour. |
| Data tiers W4, W5, W6 | 20,000; 30,000; 50,000 | about 4,000; 6,000; 10,000 (milestones × 3: `systemBoard` 12,000, `fabKhz` 30,000) | Same capped income. The path to Rack must fit about 120,000 Data in 1:45. |
| Hz/kHz Credit prices to Rack | SDRAM module 2e6; kHz fab parts about 3e6 per CPU; barebones kHz system about 2.3e6 | SDRAM about 3e5; kHz fab parts about 2e6 in total; barebones kHz server about 5e5 | The model's System + RAM is 5e5, kHz fab 2e6 and first 4-server Rack 1.5e6. Pre-Rack income is about 700 Credits/s. |
| GPU and storage timing | `gpuGen1`, `storageCtl` at Hz W5 | unchanged nodes; their purchase pays only after Rack | Their bands start at `I` 15 and 16.5, above the pipe wall. |
| Post-Rack rungs | old `payMin` | the model's re-fitted `payMin` (§D) | Every server's port now costs clock-parity Credits (×12 per rack), so post-Rack growth is slower. |

The opening and the Hz-era ramp need no change: round 1 still ends at 5:51 for the same reasons. Mid-phase rounds include about 20 short pre-Rack rounds (4–7 min), which pull the mean down. It still lands in the band.

### Historical: D10 run (every round from `I = 0`, pipe matched after `netSpeed`)

### A. Fixed ladders from `I = 0`, no purchases during the round (mean of 3 seeds)

| Ladder | Round | Low-load | Pipe-bound | Met | Failed | Top causes | Credits | Peak I | Band at end |
|---|---:|---:|---:|---:|---:|---|---:|---:|---|
| Fresh boot | 2:22 | 0:00 | 0:00 | 55 | 5.3 | Can't run: cache 5 | 87 | 3.8 | bits |
| Boot, 16 Hz | 4:52 | 0:00 | 0:00 | 870 | 7.3 | Timed out 5, Can't run: cache 3 | 3299 | 8.6 | ints |
| Boot maxed | 7:17 | 2:53 | 7:17 | 2585 | 22 | Timed out 21, Can't run: RAM 1 | 1.2e5 | 14.2 | ram |
| Dual core, 1 kHz pipe | 7:46 | 2:02 | 7:46 | 1.2e4 | 14 | Timed out 12, Can't run: RAM 2 | 2.7e5 | 15.4 | gpu |
| Early chip (4 cores, L2) | 9:04 | 3:30 | 0:00 | 3.4e4 | 31 | Timed out 20, Can't run: RAM 10 | 3.4e6 | 18.5 | storage |
| Full system (kHz+GPU+disk) | 14:08 | 7:35 | 0:00 | 6.3e4 | 50 | Timed out 46, Can't run: ECC 2 | 2.9e9 | 30.6 | rackDist |
| Rack (12 sys) | 16:57 | 9:58 | 0:00 | 1.2e5 | 10 | Can't run: members 6, Timed out 2 | 4.3e11 | 37.4 | roomDist |
| Room (96 sys) | 21:44 | 14:11 | 2:36 | 1.2e6 | 19 | Can't run: zones 16, Can't run: RAM 2 | 3.7e14 | 47.9 | region |
| Zones (288 sys) | 39:39 | 19:54 | 16:41 | 2.9e7 | 110 | Can't run: region 71, Can't run: RAM 38 | 1.6e18 | 61.7 | region |
| Regions (576 sys) | 43:22 | 19:54 | 9:34 | 5.5e7 | 64 | Can't run: RAM 63, Timed out 1 | 1.6e19 | 64.5 | region |

Each ladder ends at the wall its structure can't pass. "Boot maxed" and "Dual core, 1 kHz pipe" are pipe-bound for the whole round: under D15 that wall holds until Rack.

### B. 24 h active player: milestones (program rule, every round from `I = 0`)

| Milestone | Target | Model |
|---|---|---|
| First purchase | under 0:00:30 | 0:00:04 |
| First whole Data | 0:00:20-0:00:40 | 0:00:09 |
| First round ends | 0:04-0:08 | 0:05:47 (Timed out 9, Can't run: RAM 1, Can't run: cache 1) |
| Network speed bought | before the pipe binds | 0:13:34, end of round 2; the pipe never binds before it |
| System | 0:20-0:40 | 0:40:48 |
| Rack | 1:30-3:00 | 2:42:21 |
| Room | 5:00-8:00 | 6:45:29 |
| Data center | 10:00-14:00 | **18:39:09** (late) |
| Regions | 18:00-25:00 | **not reached in 24 h** |

### B2. The opening across 10 seeds (min / median / max)

| Measure | Target | Model |
|---|---|---|
| First purchase | under 0:00:30 | 0:00:04 / 0:00:04 / 0:00:04 |
| First whole Data | 0:00:20-0:00:40 | 0:00:08 / 0:00:09 / 0:00:09 |
| First round ends | 0:04-0:08 | 0:05:41 / 0:05:53 / 0:06:10 |

First whole Data now comes at about 9 s, not 20–40 s. Pull doubles the opening's income (1 Credit/s instead of 0.5) and Bit Flip pays 12:1. That is a §14-neutral change; raise Bit Flip's ratio to 25 if the lead wants the old timing.

### C. Round length by phase (program rule)

| Phase | Target | Rounds | Round mean (min-max) | Low-load mean (max) | I start-peak | Credits/round (last) | Data/round (last) |
|---|---|---:|---|---|---|---:|---:|
| Early, 0-1 h | 4-10 min | 7 | 8:16 (5:47-9:27) | 2:36 (3:32) | 0-11 … 0-19 | 4.6e6 | 1.4e5 |
| Mid, 1-8 h | 10-25 min | 25 | 16:39 (9:20-21:43) | **10:32 (15:19)** | 0-20 … 0-48 | 2.8e14 | 2.2e13 |
| Late, 8-24 h | 20-45 min | 39 | 24:38 (21:37-32:34) | **16:00 (17:44)** | 0-48 … 0-56 | 7.1e16 | 5.1e15 |

Round lengths meet every band. Warm-up (program §14: under 3 min) fails from the mid game on, and the late milestones slip because of it (§12).

### D. Rungs: cost and purchase time (program rule)

| Rung | need I | payMin | Cost (Credits) | Bought at |
|---|---:|---:|---:|---|
| FIFO scheduler | 9 | 0.071 | 1400 | 0:05:52 |
| Dual core | 11 | 0.1 | 9600 | 0:05:52 |
| Network speed | 11 | 0.05 | 4800 | 0:13:34 |
| L2 + quad core | 12 | 0.89 | 1.9e5 | 0:21:58 |
| System + RAM | 14.5 | 3.8 | 5.4e6 | 0:40:48 |
| GPU | 14.5 | 6.5 | 9.2e6 | 1:00:47 |
| Storage | 14.5 | 3.8 | 5.4e6 | 1:11:59 |
| kHz fab | 15 | 5.4 | 1.1e7 | 1:42:03 |
| Rack, 4 servers | 25 | 11 | 3.8e10 | 2:42:21 |
| Rack, 12 servers | 27 | 23 | 3.4e11 | 3:32:41 |
| Accelerators | 29 | 0.89 | 4.3e10 | 3:50:56 |
| MHz fab | 29 | 16 | 7.8e11 | 4:10:07 |
| Room, 4 racks | 33.5 | 67 | 5.9e13 | 6:45:29 |
| Room, 8 racks | 40.5 | 67 | 5.3e15 | 13:23:49 |
| GHz fab | 41.5 | 89 | 1.2e16 | 16:56:45 |
| Data center, 2 AZ | 42 | 67 | 1.2e16 | 18:39:09 |
| 3 AZ | 43 | 280 | 7.8e16 | 22:20:01 |
| Regions | 48.5 | 89 | 6.0e17 | - |
| Intercontinental | 50 | 110 | 2.2e18 | - |

### What the model does not show

- **Choice cadence.** The model buys one bundled level or one rung at a time. The research tree's first-hour nodes and per-part levels, now including pipe steps, carry the 2-minute choice target.
- **Routing, misroutes, power, heat, uplinks.** Not modeled. Real rounds will also end on `misroute` (early Rack), `power` and `heat`, and rack uplinks will bind unless the link catalog is re-based.
- **Dismissal.** The model player never dismisses. An attentive player can dismiss blocked heads and stretch rounds at a wall.
- **Heterogeneous fleets.** Every system is a copy of the current rung.

## 10. Mismatches with the other documents

| # | With | Mismatch | Resolution |
|---|---|---|---|
| 1 | Spec A.3 | Payload = work makes rack, room, data plane and backbone links ×100–×10^4 too slow from Rack on. | Re-base the link catalog (spec A.3 note). The model assumes it is done. |
| 2 | Research §5–§9 | D15 removes `netSpeed`; Hz-era Data tiers and `rack` are too costly for the 1 kHz-capped income. | Done: the tree has 162 nodes (D18.3 deleted `lbL4` and `lbAsic`) and D19 re-tiers W4–W15 (research doc §3). |
| 3 | `src/game/market/families.ts` | The catalog still carries `payloadPerUnit` (`pl`). D10 retires it. | Drop `pl` from `families.ts` and from the model's `fam(...)` rows in one change; `families.test.ts` compares them line by line. |
| 4 | Spec A.2 router `R` | Router budgets in tasks/s cap takes. | Gone (D12.5, D18.4): no routing budget in the spec or the model (rungs use `route` 1e12). |
| 5 | Spec §12.3 | Level prices grow `x^1.2`; income grows ×2 per doubling. | Unchanged from D5.6. |
| 6 | Research §6 | `fifoSched` at W1 lands a queue inside round 1. | Unchanged: round 1 still ends at 5:47 with the queue arriving after it. |
| 7 | Research §8 | ECC "on some storage families"; `ecc` needs `rack`. | ECC starts at Rack (`replWrite`, `payroll`). |
| 8 | Spec §5.1 | One `region` per task. | Kept; `exchangeFeed` (`ap-northeast`) is the `intercontinental` wall. |
| 9 | Spec, research | General boxes keep at most two GPU/NPU slots. | Re-prove reach and accelerator timing with the accepted GPU catalog. |

## 11. Open questions

1. **Round start (§12).** The program rule (every round from `I = 0`) can't meet the warm-up target. Adopt the offset start?
2. **Link catalog re-base.** Who owns it, and is the proposed rule (a native link's top carries its era's native server at L36; gen 0 spans 1 kHz – 1 GHz) acceptable?
3. **Dismissal at walls.** Free dismissal lets an attentive player keep the line moving past unrunnable heads indefinitely. Keep it free, or add a per-round limit or an auto-dismiss research for idle players?
4. **Sub-frame transfers.** At boot a 1-op transfer lasts 1 ms. Is a one-frame pulse on the pipe acceptable as the "real state" drawing, or should the renderer show nothing below one frame?
5. **Router capacity.** Settled by D12.5 and D18.4: there is none.

## 12. Objection and proposal: where a round starts

**Objection.** Program §3 restarts every round at `I = 0`. Under D10 the fleet pulls at full speed, but early tasks are tiny (1–100 ops). Per-tick work must stay bounded: one take per slot per tick, and router budgets in tasks/s. So a large fleet can't fill itself at the start of a round. It runs below half its capacity until tasks grow.

The cost is 10–16 minutes of each mid and late round (§9 C) against the §14 target of under 3 minutes. It also delays Data center by 4.5 h and Regions past 24 h.

No ramp constant fixes this. A faster low-`I` ramp shortens round 1 below 4 min. Removing the take caps makes per-tick cost scale with task count, which breaks the architecture budgets.

**Proposal.** Open each round at `I_start = max(0, previous round's peak I − 6)` **(s)**. Use the ramp `T(I) = min(250, 25 × 2^(I / 12))` seconds per unit **(s)**. Round 1 still starts at 0. Within a round nothing changes: difficulty rises with round age only, the curve's shape is the same, and hardware never moves it. The grace prior already scales with the opening tasks (spec §4.2), so a round opening at `I = 40` can't end on its first failure.

Result (`--start=offset`):

| Milestone | Target | Model |
|---|---|---|
| First purchase | under 0:00:30 | 0:00:04 |
| First round ends | 0:04-0:08 | 0:05:51 (seeds 5:35 / 6:00 / 6:06) |
| Network speed bought | before the pipe binds | 0:11:47 |
| System | 0:20-0:40 | 0:32:01 |
| Rack | 1:30-3:00 | 1:44:24 |
| Room | 5:00-8:00 | 5:42:04 |
| Data center | 10:00-14:00 | 13:34:56 |
| Regions | 18:00-25:00 | 18:36:00 |

| Phase | Target | Rounds | Round mean (min-max) | Low-load mean (max) | I start-peak |
|---|---|---:|---|---|---|
| Early, 0-1 h | 4-10 min | 9 | 6:11 (5:05-7:34) | 0:01 (0:17) | 0-10 … 12-18 |
| Mid, 1-8 h | 10-25 min | 21 | 19:52 (1:40-42:44) | 0:08 (2:12) | 12-18 … 40-47 |
| Late, 8-24 h | 20-45 min | 35 | 26:54 (1:20-60:56) | 0:00 (0:00) | 41-45 … 50-63 |

Every §14 target is met on the mean. The ranges include short rounds that open right at a structural wall and long rounds after a big purchase. Balance (S2) can narrow them by tuning `startBack` (4–8 tested) and the ramp cap. To adopt: change program §3 step 1 and spec §4.1 step 3 ("restarts at the curve's start") to the offset rule, and set the §3.1 ramp above.
