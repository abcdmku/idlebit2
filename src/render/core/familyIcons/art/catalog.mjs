// Task family catalog data for the icon generator: band names and accents, family names and bands
// (catalog order is the RNG draw order, docs/tasks.md §5), and the requirement pips.

export const BAND = {
  bits: { name: 'Bits', a: '#a6f6ff', d: '#3f8fa6', l: '#e2fcff' },
  ints: { name: 'Integers', a: '#e6dcff', d: '#8a7fb8', l: '#ffffff' },
  threads: { name: 'Threads', a: '#a99be6', d: '#5d5296', l: '#d6ceff' },
  ram: { name: 'Memory', a: '#ffa94d', d: '#a8602a', l: '#ffd9a8' },
  gpu: { name: 'GPU', a: '#ff7ad9', d: '#a8418e', l: '#ffc4ee' },
  storage: { name: 'Storage', a: '#e0b07a', d: '#8f6a45', l: '#f5dcbc' },
  rackDist: { name: 'Rack-scale', a: '#7be38f', d: '#3f8f54', l: '#c6f7cf' },
  roomDist: { name: 'Room-scale', a: '#c9cce0', d: '#6f7390', l: '#f2f3fa' },
  multiAz: { name: 'Multi-AZ', a: '#5ab0ff', d: '#2a5c9e', l: '#bfe3ff' },
  region: { name: 'Regional', a: '#f5b878', d: '#9a6232', l: '#ffe2c2' },
};
export const BAND_ORDER = Object.keys(BAND);

export const FAMILY = {
  bitFlip: ['Bit Flip', 'bits'], parity: ['Parity Check', 'bits'], andMask: ['AND Mask', 'bits'],
  compare: ['Compare', 'bits'], intAdd: ['Integer Add', 'bits'],
  popcount: ['Bit Count', 'ints'], crc8: ['CRC-8', 'ints'], multiply: ['Multiply', 'ints'],
  fnvHash: ['FNV Hash', 'ints'], crc32: ['CRC-32', 'ints'], binSearch: ['Binary Search', 'ints'],
  regex: ['Regex Match', 'ints'], intSort: ['Integer Sort', 'ints'],
  hashBatch: ['Hash Batch', 'threads'], lzCompress: ['LZ Compress', 'threads'], monteCarlo: ['Monte Carlo', 'threads'],
  jsonParse: ['JSON Parse', 'ram'], mergeSort: ['Merge Sort', 'ram'], kvGet: ['KV Cache Get', 'ram'],
  sqlJoin: ['SQL Join', 'ram'], graphBfs: ['Graph BFS', 'ram'], matmul: ['Matrix Multiply', 'ram'],
  imageBlur: ['Image Blur', 'gpu'], thumbnail: ['Thumbnail', 'gpu'], transcode: ['Video Transcode', 'gpu'],
  inference: ['ML Inference', 'gpu'], rayTrace: ['Ray Trace Tile', 'gpu'],
  logIngest: ['Log Ingest', 'storage'], backup: ['Backup', 'storage'], indexBuild: ['Index Build', 'storage'],
  compaction: ['LSM Compaction', 'storage'], sqlScan: ['SQL Scan', 'storage'],
  replWrite: ['Replicated Write', 'rackDist'], cdnFill: ['CDN Fill', 'rackDist'], apiFanout: ['API Fan-out', 'rackDist'],
  payroll: ['Payroll Run', 'rackDist'], mapReduce: ['MapReduce', 'rackDist'], trainShard: ['Training Shard', 'rackDist'],
  teraSort: ['TeraSort', 'roomDist'], renderFarm: ['Render Farm', 'roomDist'], pageRank: ['PageRank', 'roomDist'],
  bigTrain: ['Large Training', 'roomDist'],
  activeActive: ['Active-Active DB', 'multiAz'], quorumWrite: ['Quorum Write', 'multiAz'], drBackup: ['DR Backup', 'multiAz'],
  hallTrain: ['Multi-hall Train', 'multiAz'],
  euResidency: ['EU Residency', 'region'], llmTrain: ['LLM Training', 'region'], apacPayments: ['APAC Payments', 'region'],
  exchangeFeed: ['Exchange Feed', 'region'],
};

// Requirement pips: 5x5 (px) for plates and larger carts, 3x3 (mini) for the
// mockup's 18 px cart strip, where colour carries most of the meaning.
export const PIPS = {
  cpu: { name: 'CPU', c: '#e6dcff', px: ['.w.w.', 'wwwww', '.w.w.', 'wwwww', '.w.w.'], mini: ['www', 'w.w', 'www'] },
  ram: { name: 'RAM', c: '#ffa94d', px: ['wwwww', 'w.w.w', 'w.w.w', 'wwwww', 'w.w.w'], mini: ['w.w', 'w.w', 'www'] },
  gpu: { name: 'GPU', c: '#ff7ad9', px: ['wwwww', 'w.w.w', 'wwwww', 'w.w.w', 'wwwww'], mini: ['www', 'www', 'w.w'] },
  stor: { name: 'Storage', c: '#e0b07a', px: ['.www.', 'w...w', '.www.', 'w...w', '.www.'], mini: ['www', '...', 'www'] },
  net: { name: 'Network', c: '#7be38f', px: ['..w..', '.www.', '..w..', 'wwwww', 'w.w.w'], mini: ['.w.', 'www', '.w.'] },
  members: { name: 'Systems', c: '#a6f6ff', px: ['ww.ww', 'ww.ww', '.....', 'ww.ww', 'ww.ww'], mini: ['w.w', '...', 'w.w'] },
  zone: { name: 'Zones', c: '#5ab0ff', px: ['ww...', 'ww...', '..w..', '...ww', '...ww'], mini: ['ww.', '...', '.ww'] },
  region: { name: 'Region', c: '#bfe3ff', px: ['.www.', 'w.w.w', 'wwwww', 'w.w.w', '.www.'], mini: ['.w.', 'w.w', '.w.'] },
};
