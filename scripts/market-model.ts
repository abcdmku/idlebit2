/** v3 market design model for docs/tasks.md. Standalone: no src/ imports; NOT the game sim.
 * D10 pull market: an endless ordered queue, only the head has a 10 s clock, every machine pulls
 * over an inbound pipe (transfer bits = task work), throughput = min(compute, pipe), SLA is
 * work-weighted. A coarse homogeneous fleet per ladder rung, then a 24 h model campaign that
 * reinvests Credits. Rung prices are proxies, not legal purchases or research fees. GPU profiles use
 * assumed premium cards. This model cannot establish campaign balance.
 * Run: npx tsx scripts/market-model.ts [--start=zero|offset] [--catalog] [--trace] [--opening]
 *        [--seed=N] [--round=r,L] [--tune] [--horizon=days]
 * --horizon=D (program D19) plays day 1 active, then an engaged idle player: several check-ins a
 * day (SESSIONS), auto-return between them, and offline progress up to the researched offline cap.
 * It prints the D19 long-horizon table. With --tune it fits rungs to the D19 `at` hours.
 * --start=offset (default) is program D12: a round opens at the previous peak minus startBack.
 * --start=zero is the superseded D10 rule: every round restarts the curve at I = 0.
 * D25 (default): tasks are divisible. A take splits the head into equal whole-unit shards over the
 * systems that have room (lockstep for a homogeneous fleet), at most 256 and never below the family's
 * grain; size-scaling gates (working set, VRAM, disk) apply per shard. --whole replays the pre-D25
 * rule (one system per member) for comparison. --fleet prints the D25 fleet sweep (section F; PROF=0|1 and
 * SYS=12,24 limit it). --skipA skips the section A ladders (slow for large fleets under D25).
 * D26 (default): memory is a hierarchy. A shard's working set sits in cache, then RAM, then disk (its slot's
 * share of each); the only memory gate is the whole hierarchy. RAM stream and storage IO stages fold into
 * one memory-traffic coefficient: bits touched in cache are free, in RAM they run at RAM bandwidth, on disk
 * at drive IO. Families from rackDist on carry a completion window from take; a task not met in it fails Late.
 * --memory prints section H (spill, splitting, deadlines). --nodl turns completion windows off.
 */
type Res = "cpu" | "ram" | "gpu" | "io";
type Fam = { id: string; name: string; band: number; i0: number; i1: number; w: number;
  st: [Res, number][]; th: number; wsF: number; wsP: number; vram: number; disk: number;
  m: number; z: number; reg: string; tensor: boolean; ecc: boolean; dataRatio: number; pay: number; note: string;
  gpuCoresMin: number; accel: boolean; g: number;   // fixed per-member core gate; accel: workload affinity; g: grain (D25)
  mem: number; wsT: number; dl: number };          // D26: memory traffic bits/unit (old ram + storage stages), working set/unit incl. old disk, window s

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}`));
const MODE = (arg("start")?.split("=")[1] ?? "offset") as "zero" | "offset"; // D12: offset is the rule
let SPLIT = !arg("whole");          // D25: divisible tasks (default); --whole = pre-D25 whole tasks
const MAX_SHARDS = 256;             // D25.8: shards per task (the architecture's members cap)
// D25.1 grain classes, in size units: a shard is never smaller than one grain.
const GRAIN = { serial: 65536, coarse: 4096, medium: 256, fine: 64, tile: 16 } as const;
const BAND_GRAIN = [GRAIN.coarse, GRAIN.coarse, GRAIN.fine, GRAIN.medium, GRAIN.fine, GRAIN.coarse, GRAIN.fine, GRAIN.fine, GRAIN.fine, GRAIN.fine];

// ---- Curve constants (starting values; docs/tasks.md §3) ----
export const C = {
  dt: 0.1,                         // fixed tick, s
  // start=zero: seconds per unit of I, piecewise linear in I (docs/tasks.md §3.1).
  rampZero: [[0, 40], [11, 25], [46, 25], [50, 80], [60, 80]] as [number, number][],
  // start=offset (proposal, docs/tasks.md §12): min(T0 * 2^(I/H), Tmax), entered at previous peak - startBack.
  T0: 7, H: 5, Tmax: 250, startBack: 6,  // D20: an un-upgraded round 1 ends near 60 s
  sizeJit: 0.2, wJit: 0.3, dataJit: 0.1, ramp: 1, // task size +-20%, round weight +-30%, round Data ratio +-10%
  headS: 10, grace: 10, slaEnd: 0.8,  // head clock, grace prior (x the largest opening task), SLA floor
  pipe0: 1e3,                       // boot inbound pipe, bit/s
  fluidTasks: 30,                   // above this many takes per tick the tick resolves in aggregate
  energy: 0.2, returnS: 5, lvlG: 2.3, levelShare: 0.25, // model-only economy assumptions
  // Frozen historical price scale (pre-D10 arrival income) so rung Credit costs stay comparable.
  price: { lambda0: 0.25, a: 0.15, lambdaMax: 5 },
};
const unit = (I: number) => 2 ** (0.85 * I); // size scale U(I)
export const BANDS = ["bits", "ints", "threads", "ram", "gpu", "storage", "rackDist", "roomDist", "multiAz", "region"];
const RES: Record<string, Res> = { c: "cpu", r: "ram", g: "gpu", d: "io" };
const REGION_MIN: Record<string, number> = { "": 1, "eu-west": 4, "ap-southeast": 4, "ap-northeast": 8 }; // open regions needed (spec 3.3)
const sig2 = (x: number) => Number(x.toPrecision(2));

// D26.5: completion window (s, from take) by band: rackDist 120, roomDist 180, multiAz 240, region 120; none before.
// WINX scales them for tuning. Measured from take (pickup), router-queue time included.
const BAND_WINDOW = [0, 0, 0, 0, 0, 0, 120, 180, 240, 120].map(x => x * Number(process.env.WINX ?? 1));
function fam(id: string, name: string, band: number, i0: number, i1: number, w: number, stages: string,
  o: Partial<Fam>, note: string): Fam {
  const st = stages.split(" ").map(s => [RES[s[0]!]!, Number(s.slice(1))] as [Res, number]);
  const g = st.find(s => s[0] === "gpu")?.[1] ?? 0, pay = st.reduce((s, [, k]) => s + k, 0); // D2: 1 Credit per unit of work
  const base = { th: 1, wsF: 0, wsP: 0, vram: 0, disk: 0, m: 1, z: 1, reg: "", tensor: false, ecc: false, dataRatio: 100, gpuCoresMin: 0, g: BAND_GRAIN[band]!, ...o };
  const accel = base.tensor || base.gpuCoresMin > 0 || 2 * g >= pay || base.wsP >= 4; // GPU-heavy, tensor or big-memory
  const mem = st.reduce((a, [r, k]) => a + (r === "ram" || r === "io" ? k : 0), 0); // D26.3: RAM stream + storage IO = bits touched
  return { id, name, band, i0, i1, w, st, ...base, pay, note, accel, mem, wsT: base.wsP + base.disk, dl: o.dl ?? BAND_WINDOW[band]! };
}
// ---- Catalog: windows in I; stage coefficients per unit of size are task totals (members split them) ----
export const FAMS: Fam[] = [
  fam("bitFlip", "Bit Flip", 0, 0, 5, 10, "c1", { wsF: 1, dataRatio: 12 }, "Toggle a stream of bits, one per op."),
  fam("parity", "Parity Check", 0, 0.8, 6.5, 8, "c1", { wsF: 1, dataRatio: 15 }, "XOR-fold a stream into one parity bit."),
  fam("andMask", "AND Mask", 0, 0.6, 7, 14, "c1", { wsF: 2, dataRatio: 25 }, "Clear bits with a mask, bit by bit."),
  fam("compare", "Compare", 0, 1.6, 8, 10, "c2", { wsF: 2, dataRatio: 25 }, "Which of two numbers is larger, MSB first?"),
  fam("intAdd", "Integer Add", 0, 3.2, 9, 8, "c2", { wsF: 3, dataRatio: 25 }, "Ripple-carry add: a, b and the carry."),
  fam("popcount", "Bit Count", 1, 4, 9.5, 6, "c2", { wsF: 4, dataRatio: 30 }, "Count set bits into a 4-bit counter."),
  fam("crc8", "CRC-8", 1, 4.4, 10, 7, "c3", { wsF: 8, dataRatio: 30 }, "8-bit polynomial check over a stream."),
  fam("multiply", "Multiply", 1, 5, 11, 6, "c4", { wsF: 16, dataRatio: 60 }, "Shift-and-add integer multiply."),
  fam("fnvHash", "FNV Hash", 1, 5.6, 12, 6, "c3", { wsF: 32, dataRatio: 50 }, "Hash short keys with FNV-1a."),
  fam("crc32", "CRC-32", 1, 6.4, 14, 7, "c3", { wsF: 48, dataRatio: 40 }, "The checksum on every zip file."),
  fam("binSearch", "Binary Search", 1, 7.2, 14, 5, "c2", { wsF: 64, dataRatio: 60 }, "Find a key in a sorted table."),
  fam("regex", "Regex Match", 1, 8, 16, 6, "c5", { wsF: 128, dataRatio: 50 }, "Run a compiled DFA over text."),
  fam("intSort", "Integer Sort", 1, 8.8, 16, 6, "c4", { wsF: 64, wsP: 0.25, dataRatio: 60 }, "Sort a small array in place."),
  fam("hashBatch", "Hash Batch", 2, 10, 18, 6, "c6", { wsF: 768, th: 4, dataRatio: 80 }, "SHA-256 over a batch, one block per thread."),
  fam("lzCompress", "LZ Compress", 2, 10.8, 18.5, 6, "c5", { wsF: 512, th: 4, dataRatio: 40 }, "Deflate logs, one window per thread."),
  fam("monteCarlo", "Monte Carlo", 2, 11.6, 18, 5, "c6", { wsF: 64, th: 8, g: GRAIN.tile, dataRatio: 100 }, "Estimate pi with independent samples."),
  fam("jsonParse", "JSON Parse", 3, 11.5, 20, 7, "c5", { wsF: 256, wsP: 4, g: GRAIN.serial, dataRatio: 40 }, "Parse a big API response into a tree."),
  fam("mergeSort", "Merge Sort", 3, 12, 21, 8, "c2 r3", { wsP: 8, dataRatio: 60 }, "Sort an array too big for cache."),
  fam("kvGet", "KV Cache Get", 3, 12.5, 22, 7, "c1 r4", { wsP: 12, g: GRAIN.fine, dataRatio: 50 }, "Serve hot keys from an in-RAM map."),
  fam("sqlJoin", "SQL Join", 3, 13, 23, 7, "c2 r4", { th: 2, wsP: 12, dataRatio: 15 }, "Hash-join two tables in RAM."),
  fam("graphBfs", "Graph BFS", 3, 18, 26, 5, "c1 r5", { th: 4, wsP: 8, dataRatio: 20 }, "Walk a social graph level by level."),
  fam("matmul", "Matrix Multiply", 3, 20, 28, 6, "c4 r2", { th: 4, wsP: 2, g: GRAIN.fine, dataRatio: 70 }, "Dense float matrix product."),
  fam("imageBlur", "Image Blur", 4, 12.5, 24, 7, "r1 g4", { wsP: 1, gpuCoresMin: 1, vram: 1, dataRatio: 60 }, "Gaussian blur on a photo."),
  fam("thumbnail", "Thumbnail", 4, 13, 23, 6, "c1 r1 g3", { wsP: 1, gpuCoresMin: 1, vram: 1, g: GRAIN.tile, dataRatio: 70 }, "Resize uploads for a feed."),
  fam("transcode", "Video Transcode", 4, 19.5, 28, 7, "c1 r2 g10", { th: 2, wsP: 1, gpuCoresMin: 4, vram: 2, g: GRAIN.coarse, dataRatio: 60 }, "H.264 to AV1, one segment."),
  fam("inference", "ML Inference", 4, 17, 29, 8, "r1 g12", { wsP: 1, gpuCoresMin: 0, vram: 4, tensor: true, dataRatio: 12 }, "Run a trained model on a batch."),
  fam("rayTrace", "Ray Trace Tile", 4, 22, 30, 5, "g14", { gpuCoresMin: 16, vram: 2, g: GRAIN.tile, dataRatio: 80 }, "Render one 64x64 tile."),
  fam("logIngest", "Log Ingest", 5, 12.5, 26, 7, "c1 d4", { disk: 16, g: GRAIN.medium, dataRatio: 10 }, "Append and index server logs."),
  fam("backup", "Backup", 5, 13.2, 27, 6, "d6", { disk: 24, g: GRAIN.serial, dataRatio: 40 }, "Snapshot a volume to disk."),
  fam("indexBuild", "Index Build", 5, 18.5, 29, 6, "c2 r2 d3", { wsP: 2, disk: 4, dataRatio: 12 }, "Build a B-tree over a table."),
  fam("compaction", "LSM Compaction", 5, 21, 31, 5, "c1 r2 d4", { wsP: 1, disk: 8, dataRatio: 30 }, "Merge sorted runs into one."),
  fam("sqlScan", "SQL Scan", 5, 23, 33, 6, "c2 r3 d3", { th: 4, wsP: 2, disk: 2, g: GRAIN.medium, dataRatio: 12 }, "Full table scan with filters."),
  fam("replWrite", "Replicated Write", 6, 26, 35, 7, "c2 d5", { disk: 4, m: 3, ecc: true, dataRatio: 40 }, "Commit one write to three replicas."),
  fam("cdnFill", "CDN Fill", 6, 26.6, 35, 6, "d5", { disk: 4, g: GRAIN.coarse, dataRatio: 60 }, "Pull an object into an edge cache."),
  fam("apiFanout", "API Fan-out", 6, 27.4, 36, 6, "c3 r3", { wsP: 1, m: 4, dataRatio: 70 }, "One request, four backend calls."),
  fam("payroll", "Payroll Run", 6, 28.2, 38, 5, "c3 r2 d3", { wsP: 2, disk: 2, ecc: true, g: GRAIN.serial, dataRatio: 40 }, "Nightly batch where a flipped bit costs money."),
  fam("mapReduce", "MapReduce", 6, 29, 39, 7, "c3 r3 d3", { wsP: 2, disk: 2, m: 8, dataRatio: 12 }, "Map, shuffle, reduce on 8 nodes."),
  fam("trainShard", "Training Shard", 6, 29.8, 40, 6, "r2 g18", { wsP: 1, gpuCoresMin: 256, vram: 8, m: 8, tensor: true, dataRatio: 10 }, "One data-parallel step across 8 systems."),
  fam("teraSort", "TeraSort", 7, 32, 42, 6, "c2 r3 d4", { wsP: 2, disk: 4, m: 32, dataRatio: 25 }, "Sort a huge file across 32 nodes."),
  fam("renderFarm", "Render Farm", 7, 32.8, 43, 6, "g18", { gpuCoresMin: 128, vram: 4, m: 24, dataRatio: 80 }, "Film frames across the farm."),
  fam("pageRank", "PageRank", 7, 33.6, 43, 5, "c3 r5", { wsP: 4, m: 16, dataRatio: 12 }, "Iterate link scores over a web graph."),
  fam("bigTrain", "Large Training", 7, 34.6, 44, 5, "r2 g20", { wsP: 2, gpuCoresMin: 1024, vram: 64, m: 48, tensor: true, ecc: true, dataRatio: 10 }, "A model too big for one rack."),
  fam("activeActive", "Active-Active DB", 8, 41, 51, 7, "c3 r3 d3", { wsP: 2, disk: 2, m: 4, z: 2, ecc: true, dataRatio: 30 }, "Accept writes in two zones at once."),
  fam("quorumWrite", "Quorum Write", 8, 41.8, 51, 6, "c2 d5", { disk: 4, m: 3, z: 3, ecc: true, dataRatio: 40 }, "Raft commit across three zones."),
  fam("drBackup", "DR Backup", 8, 42.6, 51, 5, "d8", { disk: 16, m: 2, z: 2, g: GRAIN.coarse, dataRatio: 30 }, "Copy a snapshot to another zone."),
  fam("hallTrain", "Multi-hall Train", 8, 43.6, 53, 5, "r3 g22", { wsP: 2, gpuCoresMin: 4096, vram: 128, m: 96, z: 2, tensor: true, ecc: true, dataRatio: 10 }, "Training that spans two halls."),
  fam("euResidency", "EU Residency", 9, 46.5, 57, 7, "c3 r3 d3", { wsP: 1, disk: 2, m: 4, reg: "eu-west", ecc: true, dataRatio: 20 }, "EU personal data stays in the EU."),
  fam("llmTrain", "LLM Training", 9, 48.5, 59, 5, "r4 g26", { wsP: 2, gpuCoresMin: 8192, vram: 256, m: 256, z: 2, tensor: true, ecc: true, dataRatio: 10 }, "Pretrain on 256 systems; any region."),
  fam("apacPayments", "APAC Payments", 9, 47.5, 57, 6, "c4 r3 d3", { wsP: 1, disk: 2, m: 4, reg: "ap-southeast", ecc: true, dataRatio: 40 }, "Card payments settled in-region."),
  fam("exchangeFeed", "Exchange Feed", 9, 50, 59, 6, "c4 r2", { wsP: 0.5, m: 2, reg: "ap-northeast", ecc: true, dl: 60 * Number(process.env.WINX ?? 1), dataRatio: 15 }, "Match orders next to the Tokyo exchange."),
];

// ---- Capacity ladder (model assumption; spec owner owns real parts/prices) ----
// pipe: per-system inbound link cap in bit/s. The player keeps the pipe at the 1-2-5 rung at or above
// the system's compute once research allows it. Infinity from Rack on assumes the switch catalog is
// re-based so ports keep up (docs/game-spec.md A.3 note). route: fleet takes per second (router budgets).
type Rung = { name: string; ms: string; hot?: boolean; at: number; need: number; payMin: number; lvlMin: number; rs: number; reset: boolean; maxL: number;
  sys: number; cores: number; K: number; Q: number; cpu: number; cache: number; ram: number; ramBw: number;
  gpuGeneration: number; disk: number; io: number; pipe: number; uplink: number; route: number; gang: number; zones: number;
  regions: number; tensor: number; ecc: boolean; gpuSlots: number; gpuLinked: boolean };
const R: Rung[] = [];
const add = (d: Partial<Rung>) => R.push({ ...(R.at(-1) ?? {} as Rung), ms: "", reset: false, hot: false, ...d } as Rung);
add({ name: "Boot chip", at: 0, need: 0, payMin: 0, lvlMin: 0.1, rs: 0, maxL: 10, sys: 1, cores: 1, K: 1, Q: 0, cpu: 1, cache: 1, ram: 0,
  ramBw: 0, gpuGeneration: 0, disk: 0, io: 0, pipe: C.pipe0, uplink: Infinity, route: Infinity, gang: 1, zones: 1, regions: 1, tensor: 1, ecc: false, gpuSlots: 0, gpuLinked: false });
add({ name: "FIFO scheduler", at: 0.08, need: 9, payMin: 1.3, rs: 20, Q: 2 });
add({ name: "Dual core", at: 0.13, need: 11, payMin: 1.3, cores: 2, K: 2, Q: 4 });
add({ name: "L2 + quad core", at: 0.2, need: 12, payMin: 0.48, cores: 4, K: 4, Q: 8, cache: 8, cpu: 4 }); // + pipelining/superscalar lanes
add({ name: "System + RAM", ms: "System", at: 0.85, need: 14.5, payMin: 1.3, rs: 60, ram: 64, ramBw: 16 });
add({ name: "kHz fab", at: 3.5, need: 15, payMin: 3.5, lvlMin: 0.5, rs: 90, reset: true, cpu: 8000, cache: 2 ** 14, ram: 2 ** 20, ramBw: 32000 }); // D15: GPU and drives come after Rack
add({ name: "Rack, 4 servers", ms: "Rack", at: 6.8, need: 25, payMin: 0.002, lvlMin: 1.5, rs: 120, sys: 4, pipe: -1, uplink: 1e10, route: 16, gang: 4, ecc: true }); // D15: ports upgradable; uplink fixed at the room default until Room
add({ name: "GPU", at: 7.5, need: 14.5, payMin: 45, rs: 90, gpuGeneration: 3, gpuSlots: 1 });
add({ name: "Storage", at: 8, need: 14.5, payMin: 130, rs: 90, disk: 2 ** 24, io: 2000 }); // D26.2: SSD IO = 1/16 of DDR2 bandwidth
add({ name: "Rack, 12 servers", at: 14, need: 27, payMin: 110, rs: 60, sys: 12, route: 160, gang: 12 });
add({ name: "Accelerators", at: 30, need: 29, payMin: 350, rs: 120, gpuSlots: 8, gpuLinked: true }); // Assumed link research and eight premium cards.
add({ name: "MHz fab", at: 45, need: 29, payMin: 400, lvlMin: 3, rs: 150, reset: true, cpu: 1.6e7, cache: 2 ** 24, ram: 2 ** 30, ramBw: 6.4e7,
  gpuGeneration: 6, disk: 2 ** 34, io: 1.6e7, tensor: 4 }); // D26.2: NVMe IO = 1/4 of DDR3
add({ name: "Room, 4 racks", ms: "Room", at: 72, need: 33.5, payMin: 99, lvlMin: 5, rs: 180, sys: 48, gang: 48, route: 256, uplink: Infinity }); // D15: rack uplinks upgradable on the network rack
add({ name: "Room, 8 racks", at: 120, need: 40.5, payMin: 570, rs: 60, sys: 96, gang: 96, route: 1280 });
add({ name: "GHz fab", at: 170, need: 41.5, payMin: 2700, lvlMin: 8, rs: 180, reset: true, cpu: 3.2e10, cache: 2 ** 30, ram: 2 ** 38, ramBw: 1.28e11,
  gpuGeneration: 9, disk: 2 ** 44, io: 6.4e10, tensor: 8, // D26.2: SCM IO = 1/2 of DDR5
  route: 12800 });
add({ name: "Data center, 2 AZ", ms: "Data center", at: 260, need: 42, payMin: 7200, lvlMin: 12, rs: 240, sys: 192, gang: 192, zones: 2, route: 25600 });
add({ name: "3 AZ", at: 340, need: 43, payMin: 12000, rs: 120, sys: 288, gang: 288, zones: 3, route: 38400 });
add({ name: "Regions", ms: "Regions", at: 504, need: 48.5, payMin: 32000, lvlMin: 16, rs: 300, sys: 384, gang: 384, regions: 4, route: 32768 });
add({ name: "Intercontinental", at: 1100, need: 50, payMin: 380000, rs: 120, sys: 576, gang: 576, regions: 8, route: 65536 });
add({ name: "Max fleet", ms: "All data centers", at: 2200, need: 52, payMin: 4300000, // D25: was 1.3e6 before divisible tasks
  rs: 120, sys: 6912, gang: 6912, zones: 3, regions: 8 }); // D19: every site, 3 zones, 24 racks, 12 servers
for (const r of R) r.route = 1e12; // D12.5: load balancers have no routing budget; transfer speed is the only throttle

type Prof = Rung & { L: number; gpu: number; vram: number; gpuCores: number };
type State = { r: number; L: number; cr: number; data: number; pk: number }; // pk: the lone system's port index
const SCALED = ["cpu", "cache", "ram", "ramBw", "disk", "io"] as const;
// D14 price parity: a port step Y -> X costs the native clock work from Y to X (spec §12.5), x m streams.
const CLOCK_U = [3, 1.5e4, 9e7, 2.4e11], ALPHA = Math.log(1.7) / Math.log(1.5);
const speedK = (k: number) => [1, 2, 5][k % 3]! * 10 ** (3 + Math.floor(k / 3));
export function portStepCost(Y: number, X: number, m = 1): number {
  const x = X / m, y = Y / m, c = Math.max(0, Math.min(3, Math.floor(Math.log10(x) / 3 + 1e-9))), b = 10 ** (3 * c);
  return Math.ceil(m * CLOCK_U[c]! / 0.7 * ((x / b) ** ALPHA - (y / b) ** ALPHA));
}
let FLEET: Partial<Rung> | null = null; // section F: override fleet shape (sys, gang, zones, uplink) on a rung's hardware
let MEMX: { ram?: number; disk?: number; io?: number } | null = null; // section H: per-system memory after level scaling
let DEADLINES = !arg("nodl");
const SPLIT_FLOOR = !arg("nofloor");
const GATHER = !arg("nogather"); // model player has splitGather from Rack; --nogather = base first-fit spread // D25.11; --nofloor replays D25 as first written
function prof(r: number, L: number, pk = 0): Prof {
  const p = { ...R[r]!, ...(FLEET ?? {}), L } as Prof;
  for (const k of SCALED) p[k] = R[r]![k] * 2 ** L;
  const g = p.gpuGeneration, u = Math.min(5, L), pool = p.gpuLinked ? p.gpuSlots : 1;
  p.gpuCores = g ? 2 ** (g - 1) * 4 * 32 * 2 ** u * pool : 0;
  p.vram = g ? 2 ** (13 + 4 * (g - 1)) * 4 * 32 * 2 ** u * pool : 0;
  p.gpu = p.gpuCores * (g ? 10 ** (g + 2) * 2 * 1.5 * 1.25 ** u : 0);
  if (MEMX) Object.assign(p, MEMX);
  p.pipe = R[r]!.pipe === C.pipe0 ? C.pipe0 : Math.min(speedK(pk), p.uplink / p.sys); // D15: fixed 1 kHz before Rack
  return p;
}
const capOps = (p: Prof) => p.sys * p.cores * p.cpu;
// Frozen price scale: the pre-D10 market's income at intensity I. It only sizes rung and level costs.
export function priceScale(I: number): number {
  let w = 0, pay = 0;
  for (const f of FAMS) { const x = wt(f, I); w += x; pay += x * f.pay; }
  return w ? Math.min(C.price.lambdaMax, C.price.lambda0 * 2 ** (C.price.a * I)) * 2 ** (0.85 * I) * (pay / w) * (1 - C.energy) : 0;
}
const rungCost = (r: number) => r === 0 ? 0 : sig2(R[r]!.payMin * 60 * priceScale(R[r]!.need));
const lvlCost = (s: State) => sig2(R[s.r]!.lvlMin * 60 * 0.5 * capOps(prof(s.r, 0)) * C.lvlG ** s.L);
// Before Rack, after Network speed: buy port steps while the pipe is slower than the CPU.
const PIPE = { firstAt: -1, paysAt: -1 };
function buyPipe(s: State, t: number): boolean { // D15: ports upgrade on the rack switch, all ports together
  let b = false; const rr = R[s.r]!;
  if (rr.pipe >= 0) return false;
  for (;;) { const P = prof(s.r, s.L, s.pk), want = Math.min(P.cores * P.cpu, rr.uplink / P.sys), X = speedK(s.pk + 1);
    if (speedK(s.pk) >= want) break;
    const cost = P.sys * portStepCost(speedK(s.pk), X); if (s.cr < cost) break;
    s.cr -= cost; s.pk++; b = true;
    if (PIPE.firstAt < 0) { PIPE.firstAt = t; const gain = P.sys * (Math.min(want, X) - Math.min(want, speedK(s.pk - 1))) * (1 - C.energy); PIPE.paysAt = t + cost / gain; }
  }
  return b;
}
// While ports lag the CPU, compute levels are wasted; a sensible player buys ports first.
const pipeLags = (s: State) => { const rr = R[s.r]!; if (rr.pipe >= 0) return false; const P = prof(s.r, s.L, s.pk); return speedK(s.pk) < Math.min(P.cores * P.cpu, rr.uplink / P.sys); };
const matchPk = (r: number, L: number) => { let k = 0; const P = prof(r, L, 0); if (R[r]!.pipe >= 0) return 0;
  while (speedK(k) < Math.min(P.cores * P.cpu, P.uplink / P.sys)) k++; return k; };
function buyLevels(s: State): boolean {
  let b = false;
  const cap = s.r + 1 < R.length ? C.levelShare * rungCost(s.r + 1) : Infinity;
  while (s.L < R[s.r]!.maxL && s.cr >= lvlCost(s) && lvlCost(s) <= cap) { s.cr -= lvlCost(s); s.L++; b = true; }
  return b;
}

// ---- Deterministic RNG (model stand-in for src/game/core/rng.ts) ----
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- One task against the fleet: gates in report order, then per-shard transfer and compute time ----
type Task = { w: number; m: number; t: number; c: number; data: number; nMin: number; nMax: number; disk: number };
// D26.1: the hierarchy is the only memory gate; its detail names the deepest tier the system has.
const hier = (P: Prof) => P.cache + P.ram + P.disk;
const memFail = (P: Prof) => P.disk ? "Can't run: disk" : P.ram ? "Can't run: RAM" : "Can't run: cache";
// D26.2: place a shard's working set fastest tier first in its running slot's share (capacity / K); the last
// tier present takes the rest. Bits touched follow the placement: cache free, RAM at bandwidth, disk at drive IO.
function memTime(f: Fam, per: number, P: Prof): { t: number; disk: number } {
  const M = f.mem * per, ws = f.wsF + f.wsT * per;
  if (M <= 0 || ws <= 0) return { t: 0, disk: 0 };
  const K = P.K, c = Math.min(ws, P.cache / K);
  const r = P.disk ? Math.min(ws - c, P.ram / K) : ws - c, d = Math.max(0, ws - c - r);
  return { t: (r > 0 ? M * (r / ws) / (P.ramBw / K) : 0) + (d > 0 ? M * (d / ws) / (P.io / K) : 0), disk: d / ws };
}
function plan(f: Fam, size: number, P: Prof, ratio: number, nAt?: number): Task | string {
  const has = (r: Res) => f.st.some(s => s[0] === r), H = hier(P);
  if (f.wsF > H) return memFail(P);
  if (f.ecc && !P.ecc) return "Can't run: ECC";
  if (has("gpu") && !P.gpu) return "Can't run: GPU";
  if (f.gpuCoresMin > P.gpuCores) return "Can't run: GPU cores";
  if (f.m > P.sys) return "Can't run: members";
  if (!SPLIT && f.m > P.gang) return "Can't run: gang";
  if (f.z > P.zones) return "Can't run: zones";
  if (P.regions < REGION_MIN[f.reg]!) return "Can't run: region";
  const need = (perUnit: number, fixed: number, cap: number) => perUnit <= 0 ? 1 : cap <= fixed ? Infinity : Math.ceil(perUnit * size / (cap - fixed));
  let n: number, nMin: number, nMax: number, th: number;
  if (SPLIT) {
    const eg = Math.max(f.g, Math.ceil(size / MAX_SHARDS));
    // D25.11 split floor: every shard carries at least 1 s of work at its target's nominal rate (GPU rate for GPU families).
    const rTarget = has("gpu") ? P.gpu : P.cores * P.cpu, nFloor = SPLIT_FLOOR ? Math.floor(f.pay * size / (rTarget * 1)) : Infinity;
    const nCap = Math.max(f.m, Math.min(P.sys, Math.floor(size / eg)));
    const nWs = need(f.wsT, f.wsF, H), nV = need(f.vram, 0, P.vram);
    if (nWs > nCap) return memFail(P);
    if (nV > nCap) return "Can't run: VRAM";
    nMin = Math.max(f.m, nWs, nV); // the floor never cuts below the minimum split or the shards needed to fit
    // D25.11 item 2: the floor never cuts below the split that keeps each shard out of disk (cache + RAM per running slot).
    const fast = (P.cache + P.ram) / P.K, nNoDisk = f.mem > 0 && fast > f.wsF ? Math.ceil(f.wsT * size / (fast - f.wsF)) : 1;
    nMin = Math.max(nMin, Math.min(nCap, nNoDisk)); // a capability-aware split waits rather than spill (model player)
    nMax = Math.max(nMin, Math.min(nCap, Math.max(nFloor, nNoDisk))); n = Math.min(nMax, Math.max(nMin, nAt ?? nMax));
    th = Math.max(1, Math.floor(size / n / f.g)); // D25.3: threads = min(free threads, floor(units / grain))
  } else {
    n = nMin = nMax = f.m; th = f.th;
    if (f.wsF + f.wsT * size / n > H) return memFail(P);
    if (f.vram * size / n > P.vram) return "Can't run: VRAM";
  }
  const per = size / n, rate = { cpu: P.cpu * Math.max(1, Math.min(th, P.cores / P.K)), gpu: P.gpu * (f.tensor ? P.tensor : 1) / P.K };
  const mt = memTime(f, per, P), work = f.pay * size;
  const c = f.st.reduce((a, [r, k]) => a + (r === "cpu" ? k * per / rate.cpu : r === "gpu" ? k * per / rate.gpu : 0), 0) + mt.t;
  return { w: work, m: n, t: (work / n) / P.pipe, c, data: work / ratio, nMin, nMax, disk: mt.disk };
}
const I_LAST = 58.9; // past the last window the mix stays as it was at I_LAST; sizes keep growing
const wt = (f: Fam, I0: number) => { const I = Math.min(I0, I_LAST);
  return I <= f.i0 || I >= f.i1 ? 0 : f.w * Math.min(1, (I - f.i0) / C.ramp, (f.i1 - I) / C.ramp); };
const bandAt = (I: number) => BANDS[FAMS.reduce((b, f) => (f.i0 <= I ? Math.max(b, f.band) : b), 0)]!;
const secPerUnit = (I: number) => {
  if (MODE === "offset") return Math.min(C.T0 * 2 ** (I / C.H), C.Tmax);
  const p = C.rampZero; if (I >= p.at(-1)![0]) return p.at(-1)![1];
  let i = 0; while (p[i + 1]![0] <= I) i++;
  const [a, ta] = p[i]!, [b, tb] = p[i + 1]!; return ta + (tb - ta) * (I - a) / (b - a);
};

// ---- Small binary min-heap of [key, value] ----
class Heap { k: number[] = []; v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i) { const p = (i - 1) >> 1; if (k[p]! <= key) break; k[i] = k[p]!; v[i] = v[p]!; i = p; } k[i] = key; v[i] = val; }
  pop(): [number, number] { const k = this.k, v = this.v, top: [number, number] = [k[0]!, v[0]!], lk = k.pop()!, lv = v.pop()!;
    if (k.length) { let i = 0; const n = k.length;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1]! < k[c]!) c++; if (k[c]! >= lk) break; k[i] = k[c]!; v[i] = v[c]!; i = c; }
      k[i] = lk; v[i] = lv; }
    return top; }
  peek() { return this.k[0]!; }
}

let TRACE_ROUND = false;
type Out = { len: number; warm: number; met: number; fail: number; causes: Map<string, number>; earned: number; data: number;
  peakI: number; startI: number; data1: number; pipeS: number; delivered: number; failedWork: number; shards: number; ticks: number;
  diskShare: number; late: number };
function playRound(s: State, seed: number, startI: number, shop?: (t: number) => boolean): Out {
  const rnd = rng(seed), jit = FAMS.map(() => 1 + C.wJit * (2 * rnd() - 1));
  const ratio = FAMS.map(f => f.dataRatio * (1 + C.dataJit * (2 * rnd() - 1)));
  const causes = new Map<string, number>(), wts = new Float64Array(FAMS.length), done = new Heap(), doneW: number[] = [], doneD: number[] = [], doneLate: boolean[] = [];
  let diskW = 0, takenW = 0, late = 0;
  let P = prof(s.r, s.L, s.pk), I = startI, tick = 0, hs = 0, head: { f: number; size: number; win: number } | null = null, carry = 0;
  let met = 0, fail = 0, earned = 0, data = 0, data1 = -1, delivered = 0, failedWork = 0, warm = 0, pipeS = 0, shards = 0;
  // Systems: inbound link free time, K run-slot free times, sorted finish times of admitted tasks, per-tick take count.
  let N = 0, cap = 1, K = 1, linkFree = new Float64Array(0), runFree = new Float64Array(0), fin: number[][] = [];
  let tickOf = new Int32Array(0), takes = new Int32Array(0), ready = new Heap();
  const accept = (j: number, now: number) => { const f = fin[j]!; while (f.length && f[0]! <= now) f.shift();
    return Math.max(linkFree[j]!, f.length >= cap ? f[f.length - cap]! : 0); };
  const reset = (now: number) => { N = P.sys; K = P.K; cap = P.K + P.Q; linkFree = new Float64Array(N).fill(now);
    runFree = new Float64Array(N * K).fill(now); fin = Array.from({ length: N }, () => []); tickOf = new Int32Array(N).fill(-1);
    takes = new Int32Array(N); ready = new Heap(); for (let j = 0; j < N; j++) ready.push(now, j); };
  reset(0);
  const failWith = (c: string, w: number) => { if (TRACE_ROUND) console.log(`  fail ${c} I ${I.toFixed(2)} w ${eng(w)} fam ${head ? FAMS[head.f]!.id : "?"}`); fail++; failedWork += w; causes.set(c, (causes.get(c) ?? 0) + 1); };
  const draw = () => { // the next queue task at the current intensity: one family draw, one size draw
    let tot = 0; for (let i = 0; i < FAMS.length; i++) { wts[i] = wt(FAMS[i]!, I) * jit[i]!; tot += wts[i]!; }
    let u = rnd() * tot, f = 0; if (tot > 0) { while (u >= wts[f]!) { u -= wts[f]!; f++; } }
    const j = 1 + C.sizeJit * (2 * rnd() - 1); // D26.5: window = family seconds × size jitter, frozen at the draw
    return { f, size: Math.max(1, Math.round(unit(I) * j)), win: DEADLINES ? FAMS[f]!.dl * j : 0 };
  };
  // Mix statistics at the mean size: gated count share, mean work, fleet takes/s with and without take caps.
  const mix = () => { let wsum = 0, gated = 0, wbar = 0, wmax = 1, sys = 0, mbar = 0, dbar = 0, pipeW = 0;
    for (let i = 0; i < FAMS.length; i++) { const x = wt(FAMS[i]!, I) * jit[i]!; if (!x) continue; wsum += x;
      const t = plan(FAMS[i]!, Math.max(1, Math.round(unit(I))), P, ratio[i]!);
      if (typeof t === "string") { gated += x; wmax = Math.max(wmax, FAMS[i]!.pay * unit(I) * (1 + C.sizeJit)); continue; }
      const iv = cap === 1 ? t.t + t.c : Math.max(t.t, t.c / K);
      wbar += x * t.w; wmax = Math.max(wmax, t.w * (1 + C.sizeJit)); sys += x * iv * t.m; mbar += x * t.m; dbar += x * t.data; if (t.t > (cap === 1 ? 0.5 * iv : t.c / K)) pipeW += x; }
    if (!wsum) { const t = plan(FAMS[0]!, Math.max(1, Math.round(unit(I))), P, ratio[0]!) as Task; return { gated: 0, wbar: t.w, dbar: t.data, hw: N / (t.t + t.c), cappedL: Math.min(N / (t.t + t.c), P.route, 10 * N * cap), pipe: false, nbar: 1 }; }
    const ok = wsum - gated; if (!ok) return { gated: 1, wbar: 0, dbar: 0, hw: 0, cappedL: 0, pipe: false, nbar: 1 };
    const hw = N * ok / sys, cappedL = Math.min(hw, P.route, 10 * N * cap * ok / mbar);
    return { gated: gated / wsum, wmax, wbar: wbar / ok, dbar: dbar / ok, hw, cappedL, pipe: pipeW > ok / 2, nbar: mbar / ok };
  };
  const G = C.grace * (mix().wmax ?? 1); // grace prior: 10 times the largest opening task
  for (;;) {
    const t0 = tick * C.dt, t1 = t0 + C.dt;
    I += C.dt / secPerUnit(I);
    const mx = mix();
    if (mx.hw > 0 && mx.cappedL / mx.hw < 0.5) warm += C.dt;
    if (mx.pipe) pipeS += C.dt;
    let budget = Math.min(1, carry) + P.route * C.dt;
    if (mx.gated === 0 && mx.cappedL * C.dt > C.fluidTasks) { // aggregate tick: no head can wait 10 s here
      const n = mx.cappedL * C.dt; met += n; shards += n * mx.nbar; delivered += n * mx.wbar; const g = n * mx.wbar * (1 - C.energy);
      earned += g; s.cr += g; data += n * mx.dbar; if (s.data < 1 && s.data + n * mx.dbar >= 1) data1 = t1; s.data += n * mx.dbar;
      head = null; hs = t1; reset(t1); budget = 0;
    } else for (;;) { // discrete: take the head while some system has room before its 10 s run out
      head ??= draw();
      const f = FAMS[head.f]!, D = hs + C.headS, task = plan(f, head.size, P, ratio[head.f]!);
      if (typeof task === "string") { if (D < t1) { failWith(task, f.pay * head.size); hs = D; head = null; continue; } break; }
      if (task.nMin > N) { if (D < t1) { failWith("Can't run: members", task.w); hs = D; head = null; continue; } break; }
      const picked: number[] = []; let a = 0;
      const rt = (j: number) => Math.max(accept(j, t0), tickOf[j] === tick && takes[j]! >= cap ? t1 : 0);
      if (SPLIT) { // D25.2: every system with room at the take time takes a shard (≤ nMax); wait for nMin to fit
        const [, j0] = ready.pop(); picked.push(j0); a = rt(j0); const tau0 = Math.max(hs, a);
        while (picked.length < task.nMax && ready.size && ready.peek() <= tau0) { const [, j] = ready.pop(); picked.push(j); a = Math.max(a, rt(j)); }
        // splitGather (kHz W8, which the model player owns from Rack): wait for half the legal split
        const want = GATHER ? Math.max(task.nMin, Math.ceil(task.nMax / 2)) : task.nMin;
        while (picked.length < want && ready.size) { const [, j] = ready.pop(); picked.push(j); a = Math.max(a, rt(j)); }
      } else while (picked.length < task.m) { const [, j] = ready.pop(); picked.push(j); a = Math.max(a, rt(j)); }
      const tau = Math.max(hs, a);
      const tk = SPLIT ? plan(f, head.size, P, ratio[head.f]!, picked.length) as Task : task;
      if (tau > D || budget < 1 || tau >= t1) { for (const j of picked) ready.push(Math.max(accept(j, t0), tickOf[j] === tick && takes[j]! >= cap ? t1 : 0), j);
        if (D < t1 && tau > D) { failWith("Timed out", task.w); hs = D; head = null; continue; } break; }
      let F = 0;
      for (const j of picked) {
        const land = tau + tk.t; linkFree[j] = land;
        let si = j * K; for (let q = j * K + 1; q < (j + 1) * K; q++) if (runFree[q]! < runFree[si]!) si = q;
        const S = Math.max(land, runFree[si]!), fj = S + tk.c; runFree[si] = fj; F = Math.max(F, fj);
        const fl = fin[j]!; let p = fl.length; fl.push(fj); while (p && fl[p - 1]! > fj) { fl[p] = fl[p - 1]!; p--; } fl[p] = fj;
        if (tickOf[j] !== tick) { tickOf[j] = tick; takes[j] = 0; } takes[j]!++;
        ready.push(Math.max(accept(j, t0), takes[j]! >= cap ? t1 : 0), j);
      }
      // D25.5 (revised): the task pays its full W once, when its last shard completes (F = the latest shard finish).
      // D26.5: a task whose last shard lands after take + window fails Late at that moment, with its full W.
      const from = tau; // D26.5: the window runs from take
      const isLate = head.win > 0 && F - from > head.win; diskW += tk.w * tk.disk; takenW += tk.w;
      done.push(isLate ? from + head.win : F, doneW.length); doneW.push(tk.w); doneD.push(tk.data); doneLate.push(isLate);
      budget -= 1; hs = tau; head = null; shards += picked.length;
    }
    carry = budget - Math.floor(budget);
    while (done.size && done.peek() < t1) { const [, i] = done.pop(); if (doneLate[i]) { late++; failWith("Late", doneW[i]!); continue; } met++; delivered += doneW[i]!; const g = doneW[i]! * (1 - C.energy);
      earned += g; s.cr += g; data += doneD[i]!; if (s.data < 1 && s.data + doneD[i]! >= 1) data1 = t1; s.data += doneD[i]!; }
    if (TRACE_ROUND && tick % 100 === 0) console.log(`${ms(t1)} I ${I.toFixed(2)} ops ${eng(mx.wbar)} takes/s ${eng(mx.cappedL)} (hw ${eng(mx.hw)}) pipe ${mx.pipe ? "yes" : "no"} met ${eng(met)} fail ${fail} SLA ${(100 * (delivered + G) / (delivered + failedWork + G)).toFixed(1)}`);
    if (shop && tick % 10 === 0 && shop(t1)) { const nP = prof(s.r, s.L, s.pk); if (nP.sys !== P.sys || nP.K !== P.K || nP.Q !== P.Q) { P = nP; reset(t1); } else P = nP; }
    tick++;
    if ((delivered + G) / (delivered + failedWork + G) < C.slaEnd || tick * C.dt > 3 * 3600) break;
  }
  return { len: tick * C.dt, warm, met, fail, causes, earned, data, peakI: I, startI, data1, pipeS, delivered, failedWork, shards, ticks: tick,
    diskShare: takenW ? diskW / takenW : 0, late };
}

// ---- Reporting ----
const hms = (t: number) => `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const ms = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const eng = (x: number) => x < 1e4 ? x.toFixed(x < 10 ? 1 : 0) : x.toExponential(1).replace("e+", "e");
const top = (c: Map<string, number>, n = 2) => [...c].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(", ");
const SEED = Number(arg("seed")?.split("=")[1] ?? 0xb17);

if (arg("catalog")) {
  console.log("| id | Band | Window I | w | Work per unit | Grain (units) | Working set | Gates and tags | Min split | AZ / region | Done in | Pay/unit |");
  console.log("|---|---|---|---:|---|---:|---|---|---:|---|---:|---:|");
  for (const f of FAMS) {
    const ws = [f.wsF ? `${f.wsF} b` : "", f.wsT ? `${f.wsT} b/u` : ""].filter(Boolean).join(" + ") || "0";
    const g = [f.gpuCoresMin > 0 ? `${f.gpuCoresMin} GPU ${f.gpuCoresMin === 1 ? 'core' : 'cores'}` : "", f.vram ? `VRAM ${f.vram} b/u` : "", f.ecc ? "ECC" : "",
      f.m > 1 ? "min split" : "", f.tensor ? "*tensor*" : "", f.accel ? "**accel**" : ""].filter(Boolean).join(", ") || "-";
    const zr = [f.z > 1 ? `${f.z} AZ` : "", f.reg].filter(Boolean).join(", ") || "-";
    console.log(`| \`${f.id}\` | ${BANDS[f.band]} | ${f.i0}-${f.i1} | ${f.w} | ${[...f.st.filter(([r]) => r === "cpu").map(([, k]) => `compute ${k}`), f.mem ? `memory ${f.mem}` : "", ...f.st.filter(([r]) => r === "gpu").map(([, k]) => `gpu ${k}`)].filter(Boolean).join(", ")} | ${f.g.toLocaleString("en-US")} | ${ws} | ${g} | ${f.m} | ${zr} | ${f.dl ? `${f.dl} s` : "-"} | ${f.pay} |`);
  }
  console.log("\n| id | Name | Band | Credits per Data | Flavor |\n|---|---|---|---:|---|");
  for (const f of FAMS) console.log(`| \`${f.id}\` | ${f.name} | ${BANDS[f.band]} | ${f.dataRatio} | ${f.note} |`);
  process.exit(0);
}

if (arg("round")) { // --round=r,L traces one round of rung r at level L every 10 s
  const [r, L] = arg("round")!.split("=")[1]!.split(",").map(Number);
  TRACE_ROUND = true; const o = playRound({ r: r!, L: L!, cr: 0, data: 0, pk: matchPk(r!, L!) }, SEED, 0); console.log(top(o.causes, 5)); process.exit(0);
}
// Market constraints (docs/architecture.md 1.9): sample the whole curve. D10 has no arrival rate to check.
function marketCheck(): string[] {
  let maxActive = 0, atA = 0;
  for (let I = 0; I <= 60; I += 0.05) { const act = FAMS.filter(f => wt(f, I) > 0).length; if (act > maxActive) { maxActive = act; atA = I; } }
  const bad = [maxActive > 12 && "active families > 12", FAMS.some(f => f.m > 256) && "members > 256"].filter(Boolean) as string[];
  console.log(`\nMarket check (${MODE}): max ${maxActive} active families (I ${atA.toFixed(1)}); max members ${Math.max(...FAMS.map(f => f.m))}; ${bad.length ? "FAIL: " + bad.join(", ") : "PASS"}`);
  return bad;
}
if (marketCheck().length) process.exitCode = 1;
// Historical coarse reach check, using the original RAM/disk assumptions and premium GPU u5.
// Eras by I: Hz < 15, kHz < 29, MHz < 41.5, GHz. General box: 4 RAM, 2 GPU, 4 drives. Accelerator (from I 29): 8 RAM, 8 GPU.
function reachCheck(): string[] {
  const ERA = [15, 29, 41.5, Infinity], RAM = [4.19e6, 1.07e9, 2.75e11, 4.4e12], VRAM = [1, 3, 6, 9].map(g => 2 ** (13 + 4 * (g - 1)) * 4 * 32 * 32);
  const GPU_CORES = [1, 3, 6, 9].map(g => 2 ** (g - 1) * 4 * 32 * 32);
  const DRIVE = [4.19e6, 8.4e9, 1.68e13, 3.36e16], bad: string[] = [];
  for (const f of FAMS) for (let I = f.i0; I <= Math.min(f.i1, 53); I += 0.25) {
    const e = ERA.findIndex(x => I < x), acc = f.accel && I >= 29, n = acc ? 8 : 2, s = unit(I) * 1.2 / f.m;
    const need = [f.wsF + f.wsP * s > Math.max(74752, (acc ? 8 : 4) * RAM[e]!) && "RAM", f.vram * s > n * VRAM[e]! && "VRAM",
      f.disk * s > 4 * DRIVE[e]! && "storage", f.gpuCoresMin > n * GPU_CORES[e]! && "GPU cores"].filter(Boolean);
    if (need.length) { bad.push(`${f.id} at I ${I}: ${need.join(", ")}`); break; }
  }
  console.log(`Assumed-capacity reach check: ${bad.length ? "FAIL: " + bad.join("; ") : "PASS"}. This is not a legal campaign or a hardware-economy acceptance check.`);
  return bad;
}
if (reachCheck().length) process.exitCode = 1;

// F. D25 fleet sweep: one hardware profile, fleets of 1, 2, 4, 8 racks, then 1, 2, 3 rooms. Each round opens at the
// previous peak - startBack (D12) until the round shape settles; whole (pre-D25) against split (D25).
if (arg("fleet")) {
  const FLEETS: [string, number, number][] = [["1 rack", 12, 1], ["2 racks", 24, 1], ["4 racks", 48, 1], ["8 racks", 96, 1],
    ["1 room (24 racks)", 288, 1], ["2 rooms (2 AZ)", 576, 2], ["3 rooms (3 AZ)", 864, 3]];
  const PROFILES: [string, number, number][] = [["kHz server L8 (GPU, disk, RAM)", RI0("Storage"), 8], ["MHz server L6", RI0("MHz fab"), 6]];
  for (const [pname, r, L] of PROFILES.filter((_, i) => !process.env.PROF || process.env.PROF === String(i))) {
    console.log(`
F. D25 fleet sweep, ${pname}: settled round (start = previous peak - ${C.startBack}), mean of 3 seeds
`);
    console.log("| Fleet | Systems | Rule | Peak I | Round | First round after the step | Credits/round | Credits/hour | Shards/tick | Top causes |");
    console.log("|---|---:|---|---:|---:|---:|---:|---:|---:|---|");
    const prevStart: Record<string, number[]> = {};
    for (const [fname, sys, zones] of FLEETS.filter(x => !process.env.SYS || process.env.SYS.split(",").includes(String(x[1])))) for (const split of [false, true]) {
      SPLIT = split; FLEET = { sys, gang: sys, zones, uplink: Infinity }; TRACE_ROUND = !!process.env.TR && split;
      const st: State = { r, L, cr: 0, data: 0, pk: matchPk(r, L) };
      const key = String(split), firsts: number[] = [], starts: number[] = [];
      const outs = [0, 1, 2].map(k => { let start = 0, o: Out | null = null;
        // The first round after buying the step opens where the smaller fleet's settled rounds open.
        if (prevStart[key]) firsts.push(playRound({ ...st }, SEED * 13 + k, prevStart[key]![k]!).len);
        for (let i = 0; i < 4; i++) { o = playRound({ ...st }, SEED * 11 + k * 101 + i, start); starts[k] = start; start = Math.max(0, o.peakI - C.startBack); } return o!; });
      prevStart[key] = starts;
      const first = firsts.length ? ms(firsts.reduce((a, b) => a + b, 0) / firsts.length) : "-";
      const avg = (fn: (o: Out) => number) => outs.reduce((a, o) => a + fn(o), 0) / outs.length;
      const causes = new Map<string, number>(); outs.forEach(o => o.causes.forEach((v, k) => causes.set(k, (causes.get(k) ?? 0) + v / 3)));
      causes.forEach((v, k) => causes.set(k, Math.round(v)));
      console.log(`| ${fname} | ${sys} | ${split ? "split (D25)" : "whole"} | ${avg(o => o.peakI).toFixed(1)} | ${ms(avg(o => o.len))} | ${first} | ${eng(avg(o => o.earned))} | ${eng(avg(o => o.earned / o.len * 3600))} | ${avg(o => o.shards / o.ticks).toFixed(1)} | ${top(causes)} |${process.env.DBG ? ` n/take ${avg(o => o.shards / Math.max(1, o.met + o.fail)).toFixed(1)}` : ""}`);
    }
  }
  FLEET = null; SPLIT = !arg("whole");
  process.exit(0);
}

// H. D26: memory hierarchy, spill and completion windows. Settled rounds (start = previous peak - startBack), mean of
// 3 seeds, one homogeneous fleet per row. MEMX overrides per-system RAM, disk and drive IO after level scaling.
if (arg("memory")) {
  type Row = { label: string; r: number; L: number; sys: number; zones: number; mem?: { ram?: number; disk?: number; io?: number }; dl: boolean; split: boolean };
  const run = (x: Row) => {
    SPLIT = x.split; DEADLINES = x.dl; FLEET = { sys: x.sys, gang: x.sys, zones: x.zones, uplink: Infinity }; MEMX = x.mem ?? null;
    const st: State = { r: x.r, L: x.L, cr: 0, data: 0, pk: matchPk(x.r, x.L) };
    const outs = [0, 1, 2].map(k => { let start = 0, o: Out | null = null;
      for (let i = 0; i < 4; i++) { o = playRound({ ...st }, SEED * 17 + k * 101 + i, start); start = Math.max(0, o.peakI - C.startBack); } return o!; });
    const avg = (fn: (o: Out) => number) => outs.reduce((a, o) => a + fn(o), 0) / outs.length;
    const causes = new Map<string, number>(); outs.forEach(o => o.causes.forEach((v, k) => causes.set(k, (causes.get(k) ?? 0) + v / 3)));
    causes.forEach((v, k) => causes.set(k, Math.round(v)));
    console.log(`| ${x.label} | ${x.sys} | ${x.split ? "split" : "whole"} | ${x.dl ? "on" : "off"} | ${avg(o => o.peakI).toFixed(1)} | ${ms(avg(o => o.len))} | ${eng(avg(o => o.earned))} | ${(100 * avg(o => o.diskShare)).toFixed(0)}% | ${avg(o => o.late).toFixed(1)} | ${top(causes)} |`);
  };
  const head = () => { console.log("| Build | Systems | Rule | Windows | Peak I | Round | Credits/round | Work spilled to disk | Late | Top causes |"); console.log("|---|---:|---|---|---:|---:|---:|---:|---:|---|"); };
  const kr = RI0("Storage"), mr = RI0("MHz fab"), kL = 8;
  const kP = (() => { FLEET = null; MEMX = null; return prof(kr, kL); })();
  const SMALL = { ram: R[kr]!.ram * 2, disk: kP.disk, io: kP.io }; // RAM left at L1: a small-memory box with a drive
  const sel = (i: number) => !process.env.HSEC || process.env.HSEC.split(",").includes(String(i));
  if (sel(1)) {
    console.log(`\nH1. Spill: one rack of kHz servers at L${kL}; only the memory differs\n`); head();
    run({ label: "Fast memory (RAM L8, drive L8)", r: kr, L: kL, sys: 12, zones: 1, dl: true, split: true });
    run({ label: "Small RAM (L1) + drive L8", r: kr, L: kL, sys: 12, zones: 1, mem: SMALL, dl: true, split: true });
    run({ label: "Small RAM (L1) + HDD-speed drive", r: kr, L: kL, sys: 12, zones: 1, mem: { ...SMALL, io: kP.io / 16 }, dl: true, split: true });
    run({ label: "Small RAM (L1), no drive", r: kr, L: kL, sys: 12, zones: 1, mem: { ram: SMALL.ram, disk: 0, io: 0 }, dl: true, split: true });
  }
  if (sel(2)) {
    console.log("\nH2. Splitting reduces spill: the small-RAM build with a drive, whole tasks against D25 splits\n"); head();
    for (const sys of [12, 48, 288]) for (const split of [false, true])
      run({ label: "Small RAM (L1) + drive L8", r: kr, L: kL, sys, zones: 1, mem: SMALL, dl: true, split });
  }
  if (sel(3)) {
    console.log("\nH3. Completion windows force upgrades: 2 rooms of MHz servers, windows off and on\n"); head();
    const mP = (() => { FLEET = null; MEMX = null; return prof(mr, 6); })();
    for (const [label, L, mem] of [["MHz L6, RAM L6", 6, undefined], ["MHz L6, RAM L1 + NVMe", 6, { ram: R[mr]!.ram * 2, disk: mP.disk, io: mP.io }], ["MHz L3 (under-leveled)", 3, undefined]] as const)
      for (const dl of [false, true]) run({ label, r: mr, L, sys: 576, zones: 2, mem, dl, split: true });
  }
  if (sel(4)) {
    console.log("\nH4. Completion windows at the Rack-to-Room transition: one room of kHz servers, windows off and on\n"); head();
    for (const [label, L, mem] of [["kHz L8, RAM L8", 8, undefined], ["kHz L8, RAM L1 + SSD", 8, SMALL], ["kHz L4 (under-levelled)", 4, undefined]] as const)
      for (const dl of [false, true]) run({ label, r: kr, L, sys: 288, zones: 1, mem, dl, split: true });
  }
  FLEET = null; MEMX = null; SPLIT = !arg("whole"); DEADLINES = !arg("nodl");
  process.exit(0);
}

// B. 24 h active campaign. Rungs between rounds (cold changes); levels any time (hot).
type Ctx = { st: State; t: number; n: number; peak: number; marks: Map<string, number>; bought: number[]; buys: number[];
  rounds: (Out & { t: number; r: number; L: number })[] };
const fresh = (): Ctx => ({ st: { r: 0, L: 0, cr: 0, data: 0, pk: 0 }, t: 0, n: 0, peak: 0, marks: new Map(), bought: [0], buys: [], rounds: [] });
const clone = (c: Ctx): Ctx => ({ ...c, st: { ...c.st }, marks: new Map(c.marks), bought: [...c.bought], buys: [...c.buys], rounds: [...c.rounds] });
const startOf = (c: Ctx) => MODE === "offset" ? Math.max(0, c.peak - C.startBack) : 0;
function buyRungs(c: Ctx, t: number, inRound: boolean, stopRung: number, log: boolean): boolean {
  let b = false;
  while (c.st.r + 1 < R.length && c.st.r < stopRung && c.st.cr >= rungCost(c.st.r + 1) && !(inRound && !R[c.st.r + 1]!.hot)) {
    c.st.cr -= rungCost(c.st.r + 1); c.st.r++; c.bought[c.st.r] = t; c.buys.push(t); b = true;
    if (R[c.st.r]!.reset) c.st.L = 0;
    if (R[c.st.r]!.ms) c.marks.set(R[c.st.r]!.ms, t);
    if (log) console.log(`${hms(t)} buy ${R[c.st.r]!.name} for ${eng(rungCost(c.st.r))}${inRound ? " (in round)" : ""}`);
    if (!inRound) c.t += R[c.st.r]!.rs; // between rounds the fleet researches at full speed first
  }
  return b;
}
// ---- D19 engaged idle player: day 1 active, then check-ins; offline progress up to the cap ----
const HORIZON_D = Number(arg("horizon")?.split("=")[1] ?? 0);
const SESSIONS: readonly [number, number][] = [[7.5, 8], [12.5, 13], [18, 20], [22.5, 23]]; // local hours, from day 2
const isOnline = (t: number) => { if (!HORIZON_D || t < 86400) return true; const h = (t % 86400) / 3600; return SESSIONS.some(([a, b]) => h >= a && h < b); };
const nextSession = (t: number) => { const d = Math.floor(t / 86400);
  for (const day of [d, d + 1]) for (const [a] of SESSIONS) if (day * 86400 + a * 3600 > t) return day * 86400 + a * 3600; return t; };
// Researched offline cap (program D19.3): 8 h base, 12 h before Rack, 24 h at Rack, 48 h at Room.
const capH = (r: number) => r >= R.findIndex(x => x.name === "Room, 4 racks") ? 48 : r >= R.findIndex(x => x.name === "Rack, 4 servers") ? 24
  : r >= R.findIndex(x => x.name === "kHz fab") ? 12 : 8;
// Rounds without purchases are a function of (rung, levels, port, start I, seed): memoized for long horizons.
const MEMO = new Map<string, Out>();
function idleRound(s: State, seed: number, startI: number): Out {
  const key = `${s.r}|${s.L}|${s.pk}|${Math.round(startI * 4)}|${seed % 3}`, hit = MEMO.get(key);
  if (hit) { s.cr += hit.earned; s.data += hit.data; return hit; }
  const o = playRound(s, seed, startI); MEMO.set(key, o); return o;
}
function RI0(n: string) { return R.findIndex(r => r.name === n); }
function campaign(c: Ctx, tEnd: number, stopRung = Infinity, log = false, seed = SEED): Ctx {
  let lastOnline = c.t;
  while (c.t < tEnd && c.st.r < stopRung) {
    if (!isOnline(c.t)) {
      if (c.t - lastOnline > capH(c.st.r) * 3600) { c.t = nextSession(c.t); continue; } // past the cap nothing runs
      const t0 = c.t, o = idleRound(c.st, seed + c.n++, startOf(c));
      c.peak = o.peakI; c.rounds.push({ ...o, t: t0, r: c.st.r, L: c.st.L }); c.t += o.len + C.returnS;
      continue;
    }
    lastOnline = c.t;
    buyRungs(c, c.t, false, stopRung, log);
    if (c.st.r >= stopRung) return c;
    if (buyPipe(c.st, c.t) || (!pipeLags(c.st) && buyLevels(c.st))) c.buys.push(c.t);
    const t0 = c.t;
    if (HORIZON_D && t0 >= 86400) {
      const o = idleRound(c.st, seed + c.n++, startOf(c));
      c.peak = o.peakI; c.rounds.push({ ...o, t: t0, r: c.st.r, L: c.st.L }); c.t += o.len + C.returnS;
      continue;
    }
    const o = playRound(c.st, seed + c.n++, startOf(c), x => {
      const b = buyRungs(c, t0 + x, true, stopRung, log) || buyPipe(c.st, t0 + x) || (!pipeLags(c.st) && buyLevels(c.st));
      if (b) c.buys.push(t0 + x);
      return b;
    });
    c.peak = o.peakI;
    c.rounds.push({ ...o, t: t0, r: c.st.r, L: c.st.L }); c.t += o.len + C.returnS;
    if (log) console.log(`${hms(t0)} r${c.n} ${R[c.st.r]!.name} L${c.st.L} port ${eng(speedK(c.st.pk))} len ${ms(o.len)} I ${o.startI.toFixed(1)}->${o.peakI.toFixed(1)} low-load ${ms(o.warm)} pipe ${ms(o.pipeS)} met ${eng(o.met)} fail ${o.fail} (${top(o.causes, 3)}) +${eng(o.earned)}`);
  }
  return c;
}
if (arg("tune") && !arg("catalog")) { // bisect each rung's payMin so its purchase lands on its target hour
  const from = Math.max(1, Number(arg("tune")!.split("=")[1] ?? 1)); // --tune=N re-fits rungs N and later
  for (let r = from; r < R.length; r++) R[r]!.payMin = Infinity;
  let c = from > 1 ? campaign(fresh(), 48 * 3600, from - 1) : fresh();
  for (let r = from; r < R.length; r++) {
    const goal = R[r]!.at * 3600; let lo = Math.log(1e-6), hi = Math.log(1e8), best: [number, number, Ctx] | undefined;
    for (let k = 0; k < 20; k++) {
      R[r]!.payMin = sig2(Math.exp((lo + hi) / 2));
      const d = campaign(clone(c), goal * (HORIZON_D ? 1.5 : 1) + 6 * 3600, r), at = d.bought[r] ?? Infinity;
      if (!best || Math.abs(at - goal) < best[0]) best = [Math.abs(at - goal), R[r]!.payMin, d];
      if (at < goal) lo = Math.log(R[r]!.payMin); else hi = Math.log(R[r]!.payMin);
    }
    R[r]!.payMin = best![1]; c = best![2];
    console.log(`${R[r]!.name}: payMin ${R[r]!.payMin} -> ${hms(c.bought[r]!)} (target ${hms(goal)})`);
  }
  process.exit(0);
}

// A. Fixed ladders, no purchases during the round, each round from I = 0 (mean of 3 seeds).
const RI = (n: string) => R.findIndex(r => r.name === n);
const LADDERS: [string, number, number][] = [["Fresh boot", 0, 0], ["Boot, 16 Hz", 0, 4], ["Boot maxed", 0, 10],
  ["Dual core", RI("Dual core"), 10], ["Early chip (4 cores, L2)", RI("L2 + quad core"), 10], ["kHz system (pre-Rack)", RI("kHz fab"), 8],
  ["Rack (4 sys, ports matched)", RI("Rack, 4 servers"), 10], ["Rack (12 sys, ports matched)", RI("Rack, 12 servers"), 10],
  ["Room (96 sys)", RI("Room, 8 racks"), 8], ["Zones (288 sys)", RI("3 AZ"), 8], ["Regions (576 sys)", RI("Intercontinental"), 8]];
console.log(`\nA. Ladders from I = 0, no purchases in round (mean of 3 seeds)\n`);
console.log("| Ladder | Round | Low-load | Pipe-bound | Met | Failed | Top causes | Credits | Peak I | Band at end |");
console.log("|---|---:|---:|---:|---:|---:|---|---:|---:|---|");
for (const [name, r, L] of arg("skipA") ? [] : LADDERS.slice(0, Number(process.env.LADDERS ?? LADDERS.length))) {
  const outs = [0, 1, 2].map(k => playRound({ r, L, cr: 0, data: 0, pk: matchPk(r, L) }, SEED * 7 + k, 0));
  const avg = (f: (o: Out) => number) => outs.reduce((s, o) => s + f(o), 0) / outs.length;
  const causes = new Map<string, number>(); outs.forEach(o => o.causes.forEach((v, k) => causes.set(k, (causes.get(k) ?? 0) + v / 3)));
  causes.forEach((v, k) => causes.set(k, Math.round(v)));
  console.log(`| ${name} | ${ms(avg(o => o.len))} | ${ms(avg(o => o.warm))} | ${ms(avg(o => o.pipeS))} | ${eng(avg(o => o.met))} | ${eng(avg(o => o.fail))} | ${top(causes)} | ${eng(avg(o => o.earned))} | ${avg(o => o.peakI).toFixed(1)} | ${bandAt(avg(o => o.peakI))} |`);
}

PIPE.firstAt = PIPE.paysAt = -1;
const { rounds, marks, buys, bought } = campaign(fresh(), 24 * 3600, Infinity, !!arg("trace"));
const PIPE_MAIN = { ...PIPE };
console.log(`\nB. 24 h active player: milestones (${MODE})\n`);
console.log("| Milestone | Target | Model |");
console.log("|---|---|---|");
const r1 = rounds[0]!;
const d1 = rounds.find(x => x.data1 >= 0);
const pipeAt = rounds.find(x => x.pipeS > 0);
const rows: [string, string, string][] = [["First purchase", "under 0:00:30", hms(buys[0] ?? NaN)],
  ["First whole Data", "0:00:20-0:00:40", d1 ? hms(d1.t + d1.data1) : "never"],
  ["First round ends", "0:04-0:08", `${hms(r1.len)} (${top(r1.causes, 3)})`],
  ["Pipe first binds (1 kHz cap)", "before Rack (D15)", pipeAt ? `${hms(pipeAt.t)} (round ${rounds.indexOf(pipeAt) + 1})` : "never"],
  ["Pipe-bound time before Rack", "the push to Rack", ms(rounds.filter(x => x.t < (marks.get("Rack") ?? Infinity)).reduce((a, x) => a + x.pipeS, 0))],
  ["First port step / pays back", "at Rack", PIPE_MAIN.firstAt >= 0 ? `${hms(PIPE_MAIN.firstAt)} / ${hms(PIPE_MAIN.paysAt)}` : "-"],
  ["System", "0:30-1:00 (D19)", hms(marks.get("System") ?? NaN)], ["Rack", "5:00-8:00 (D19)", hms(marks.get("Rack") ?? NaN)],
  ["Room", "2-4 days (D19; see E)", hms(marks.get("Room") ?? NaN)], ["Data center", "1-2 weeks (D19; see E)", hms(marks.get("Data center") ?? NaN)],
  ["Regions", "2-4 weeks (D19; see E)", hms(marks.get("Regions") ?? NaN)]];
for (const [a, b, c] of rows) console.log(`| ${a} | ${b} | ${c} |`);
console.log("\nB2. The opening across 10 seeds (min / median / max)\n");
const open = Array.from({ length: 10 }, (_, k) => campaign(fresh(), 900, Infinity, false, 1000 + 7919 * k));
const mmm = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return `${hms(v[0]!)} / ${hms(v[5]!)} / ${hms(v[9]!)}`; };
console.log("| Measure | Target | Model |");
console.log("|---|---|---|");
console.log(`| First purchase | under 0:00:30 | ${mmm(open.map(c => c.buys[0] ?? NaN))} |`);
console.log(`| First whole Data | 0:00:20-0:00:40 | ${mmm(open.map(c => { const r = c.rounds.find(x => x.data1 >= 0); return r ? r.t + r.data1 : NaN; }))} |`);
console.log(`| First round ends | 0:04-0:08 | ${mmm(open.map(c => c.rounds[0]!.len))} |`);
console.log("\nC. Round length by phase\n");
console.log("| Phase | Target | Rounds | Round mean (min-max) | Low-load mean (max) | I start-peak | Credits/round (last) | Data/round (last) |");
console.log("|---|---|---:|---|---|---|---:|---:|");
for (const [name, a, b, tgt] of [["Early, 0-1 h", 0, 1, "4-10 min"], ["Mid, 1-8 h", 1, 8, "10-25 min"], ["Late, 8-24 h", 8, 24, "20-45 min"]] as const) {
  const rs = rounds.filter(x => x.t >= a * 3600 && x.t < b * 3600);
  if (!rs.length) continue;
  const lens = rs.map(x => x.len), warms = rs.map(x => x.warm);
  console.log(`| ${name} | ${tgt} | ${rs.length} | ${ms(lens.reduce((x, y) => x + y) / rs.length)} (${ms(Math.min(...lens))}-${ms(Math.max(...lens))}) | ${ms(warms.reduce((x, y) => x + y) / rs.length)} (${ms(Math.max(...warms))}) | ${rs[0]!.startI.toFixed(0)}-${rs[0]!.peakI.toFixed(0)} … ${rs.at(-1)!.startI.toFixed(0)}-${rs.at(-1)!.peakI.toFixed(0)} | ${eng(rs.at(-1)!.earned)} | ${eng(rs.at(-1)!.data)} |`);
}
console.log("\nD. Rungs: cost (payMin minutes of the frozen price scale at I = need) and purchase time\n");
console.log("| Rung | need I | payMin | Cost (Credits) | Bought at |");
console.log("|---|---:|---:|---:|---|");
for (let r = 1; r < R.length; r++)
  console.log(`| ${R[r]!.name} | ${R[r]!.need} | ${R[r]!.payMin} | ${eng(rungCost(r))} | ${bought[r] !== undefined ? hms(bought[r]!) : "-"} |`);
if (arg("opening")) { // first round of the campaign, every 30 s
  TRACE_ROUND = false; const c = fresh(); const t0 = 0; let last = -30;
  const o = playRound(c.st, SEED, 0, x => { const b = buyLevels(c.st) || buyRungs(c, t0 + x, true, Infinity, false);
    if (x - last >= 30) { last = x; console.log(`${ms(x)} L${c.st.L} rung ${R[c.st.r]!.name} Credits ${eng(c.st.cr)}`); } return b; });
  console.log(`round 1 ends ${ms(o.len)} at I ${o.peakI.toFixed(2)}: ${top(o.causes, 4)}`);
}
if (HORIZON_D) { // E. D19 long horizon: day 1 active, then the engaged idle player
  const dhm = (t: number) => `${Math.floor(t / 86400)}d ${String(Math.floor(t / 3600) % 24).padStart(2, "0")}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}`;
  const L = campaign(fresh(), HORIZON_D * 86400);
  const at = (name: string) => { const r = R.findIndex(x => x.name === name); return L.bought[r] !== undefined ? dhm(L.bought[r]!) : "not reached"; };
  console.log(`\nE. D19 long horizon, ${HORIZON_D} days: day 1 active, then check-ins ${SESSIONS.map(([a, b]) => `${a}-${b} h`).join(", ")}, offline cap 8/12/24/48 h\n`);
  console.log("| Milestone | Target (D19) | Model |");
  console.log("|---|---|---|");
  for (const [m, tgt, rung] of [["System", "30-60 min", "System + RAM"], ["Rack", "5-8 h", "Rack, 4 servers"], ["First data center (Room)", "2-4 days", "Room, 4 racks"],
    ["Zones (Data center)", "about 1-2 weeks", "Data center, 2 AZ"], ["Second site (Regions)", "2-4 weeks", "Regions"],
    ["All data centers (max fleet)", "2-4 months", "Max fleet"]] as const) console.log(`| ${m} | ${tgt} | ${at(rung)} |`);
  console.log("\n| Rung | Cost (Credits) | Bought at |\n|---|---:|---|");
  for (let r = 1; r < R.length; r++) console.log(`| ${R[r]!.name} | ${eng(rungCost(r))} | ${L.bought[r] !== undefined ? dhm(L.bought[r]!) : "-"} |`);
  const days = [1, 3, 7, 14, 28, 56, 90].filter(d => d <= HORIZON_D);
  console.log("\n| Day | Rung | Credits/round | Data/round | Round length |\n|---:|---|---:|---:|---:|");
  for (const d of days) { const rr = L.rounds.filter(x => x.t < d * 86400).at(-1); if (rr) console.log(`| ${d} | ${R[rr.r]!.name} | ${eng(rr.earned)} | ${eng(rr.data)} | ${ms(rr.len)} |`); }
  console.log(`\nRounds played: ${L.rounds.length}; memoized round shapes: ${MEMO.size}.`);
}
