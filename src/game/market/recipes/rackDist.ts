import type { WorkRecipe } from '../../types/tasks';

export const recipes: readonly WorkRecipe[] = [
  {
    key: "replWrite", label: "Replicated Write", band: "rackDist",
    note: "Create and verify three replicas.", icon: "replWrite",
    parts: [{ key: "backup", count: 3 }, { key: "crc32", count: 3 }], primitive: null,
  },
  {
    key: "cdnFill", label: "CDN Fill", band: "rackDist",
    note: "Copy and verify an edge object.", icon: "cdnFill",
    parts: [{ key: "backup", count: 1 }, { key: "fileChecksum", count: 1 }], primitive: null,
  },
  {
    key: "apiFanout", label: "API Fan-out", band: "rackDist",
    note: "Parse four requests, look up their data and gather replies.", icon: "apiFanout",
    parts: [{ key: "jsonParse", count: 4 }, { key: "kvGet", count: 4 }, { key: "bitCopy", count: 128 }], primitive: null,
  },
  {
    key: "payroll", label: "Payroll Run", band: "rackDist",
    note: "Calculate 4,096 records and checksum the output.", icon: "payroll",
    parts: [{ key: "intAdd", count: 4096 }, { key: "multiply", count: 4096 }, { key: "fileChecksum", count: 1 }], primitive: null,
  },
  {
    key: "mapReduce", label: "MapReduce", band: "rackDist",
    note: "Parse, sort and reduce eight partitions, then gather output.", icon: "mapReduce",
    parts: [{ key: "jsonParse", count: 8 }, { key: "sortBatch", count: 8 }, { key: "memAggregate", count: 8 }, { key: "bitCopy", count: 4096 }], primitive: null,
  },
  {
    key: "trainShard", label: "Training Shard", band: "rackDist",
    note: "Run 64 gradient batches, combine updates and verify them.", icon: "trainShard",
    parts: [{ key: "backprop", count: 64 }, { key: "vectorAdd", count: 64 }, { key: "crc32", count: 128 }], primitive: null,
  },
  {
    key: "distributedCache", label: "Distributed Cache", band: "rackDist",
    note: "Serve and replicate eight cache partitions.", icon: "type:cluster",
    parts: [{ key: "kvGet", count: 8 }, { key: "replWrite", count: 8 }], primitive: null,
  },
  {
    key: "shardRebalance", label: "Shard Rebalance", band: "rackDist",
    note: "Copy and verify eight data partitions.", icon: "type:cluster",
    parts: [{ key: "backup", count: 8 }, { key: "fileChecksum", count: 8 }], primitive: null,
  },
  {
    key: "checkpointSet", label: "Checkpoint Set", band: "rackDist",
    note: "Save eight worker states and checksum their manifests.", icon: "type:cluster",
    parts: [{ key: "backup", count: 8 }, { key: "fileChecksum", count: 8 }, { key: "crc32", count: 8 }], primitive: null,
  },
  {
    key: "clusterVerify", label: "Cluster Verify", band: "rackDist",
    note: "Verify 64 batches and eight stored partitions.", icon: "type:cluster",
    parts: [{ key: "verifyBatch", count: 64 }, { key: "fileChecksum", count: 8 }], primitive: null,
  },
];
