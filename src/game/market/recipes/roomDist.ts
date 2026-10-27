import type { WorkRecipe } from '../../types/tasks';

export const recipes: readonly WorkRecipe[] = [
  {
    key: "teraSort", label: "TeraSort", band: "roomDist",
    note: "Reduce 32 partitions, then merge their output runs.", icon: "teraSort",
    parts: [{ key: "mapReduce", count: 32 }, { key: "mergeSort", count: 32 }], primitive: null,
  },
  {
    key: "renderFarm", label: "Render Farm", band: "roomDist",
    note: "Render 24 sets of 64 tiles and verify the frames.", icon: "renderFarm",
    parts: [{ key: "rayTrace", count: 1536 }, { key: "fileChecksum", count: 24 }], primitive: null,
  },
  {
    key: "pageRank", label: "PageRank", band: "roomDist",
    note: "Walk sixteen graph partitions and apply matrix updates.", icon: "pageRank",
    parts: [{ key: "graphBfs", count: 16 }, { key: "matmul", count: 256 }], primitive: null,
  },
  {
    key: "bigTrain", label: "Large Training", band: "roomDist",
    note: "Combine 48 training shards and six checkpoint sets.", icon: "bigTrain",
    parts: [{ key: "trainShard", count: 48 }, { key: "checkpointSet", count: 6 }], primitive: null,
  },
  {
    key: "distributedJoin", label: "Distributed Join", band: "roomDist",
    note: "Join 32 partitions, then gather eight reductions.", icon: "type:cluster",
    parts: [{ key: "sqlJoin", count: 32 }, { key: "mapReduce", count: 8 }], primitive: null,
  },
  {
    key: "featureBuild", label: "Feature Build", band: "roomDist",
    note: "Parse and summarize 32 partitions, then reduce features.", icon: "type:cluster",
    parts: [{ key: "jsonParse", count: 32 }, { key: "histogram", count: 32 }, { key: "mapReduce", count: 8 }], primitive: null,
  },
  {
    key: "embeddingBuild", label: "Embedding Build", band: "roomDist",
    note: "Run 64 inference batches and store eight index partitions.", icon: "type:cluster",
    parts: [{ key: "inference", count: 64 }, { key: "indexBuild", count: 8 }], primitive: null,
  },
  {
    key: "vectorIndex", label: "Vector Index Build", band: "roomDist",
    note: "Build sixteen embedding partitions and their indexes.", icon: "type:cluster",
    parts: [{ key: "embeddingBuild", count: 16 }, { key: "indexBuild", count: 16 }], primitive: null,
  },
  {
    key: "multiRackBackup", label: "Multi-rack Backup", band: "roomDist",
    note: "Rebalance and back up 32 rack partitions.", icon: "type:cluster",
    parts: [{ key: "shardRebalance", count: 32 }, { key: "backup", count: 32 }], primitive: null,
  },
  {
    key: "simulationSweep", label: "Simulation Sweep", band: "roomDist",
    note: "Evaluate 128 simulation batches and aggregate 32 outputs.", icon: "type:cluster",
    parts: [{ key: "monteCarlo", count: 128 }, { key: "memAggregate", count: 32 }], primitive: null,
  },
];
