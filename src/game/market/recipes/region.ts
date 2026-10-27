import type { WorkRecipe } from '../../types/tasks';

export const recipes: readonly WorkRecipe[] = [
  {
    key: "euResidency", label: "EU Residency", band: "region",
    note: "Run local zone copies and build their regional indexes.", icon: "euResidency",
    parts: [{ key: "activeActive", count: 2 }, { key: "indexBuild", count: 64 }], primitive: null,
  },
  {
    key: "llmTrain", label: "LLM Training", band: "region",
    note: "Run sixteen multi-hall passes, evaluate attention and save checkpoints.", icon: "llmTrain",
    parts: [{ key: "hallTrain", count: 16 }, { key: "attention", count: 256 }, { key: "zoneCheckpoint", count: 8 }], primitive: null,
  },
  {
    key: "apacPayments", label: "APAC Payments", band: "region",
    note: "Calculate regional batches and commit their payment records.", icon: "apacPayments",
    parts: [{ key: "payroll", count: 32 }, { key: "quorumWrite", count: 128 }], primitive: null,
  },
  {
    key: "exchangeFeed", label: "Exchange Feed", band: "region",
    note: "Join market updates, compare orders and commit matched results.", icon: "exchangeFeed",
    parts: [{ key: "sqlJoin", count: 64 }, { key: "compare", count: 4096 }, { key: "quorumWrite", count: 64 }], primitive: null,
  },
  {
    key: "regionalSearch", label: "Regional Search", band: "region",
    note: "Join sixteen regional indexes and serve 1,024 lookups.", icon: "type:region",
    parts: [{ key: "distributedJoin", count: 16 }, { key: "kvGet", count: 1024 }], primitive: null,
  },
  {
    key: "globalCdn", label: "Global CDN Refresh", band: "region",
    note: "Fill and verify 128 regional edge objects.", icon: "type:region",
    parts: [{ key: "cdnFill", count: 128 }, { key: "fileChecksum", count: 128 }], primitive: null,
  },
  {
    key: "globalBackup", label: "Global Backup", band: "region",
    note: "Create eight disaster-recovery sets and verify each region.", icon: "type:region",
    parts: [{ key: "drBackup", count: 8 }, { key: "multiZoneVerify", count: 8 }], primitive: null,
  },
  {
    key: "crossRegionJoin", label: "Cross-region Join", band: "region",
    note: "Join sixteen regional partitions and replicate gathered results.", icon: "type:region",
    parts: [{ key: "distributedJoin", count: 16 }, { key: "replWrite", count: 64 }], primitive: null,
  },
  {
    key: "federatedTrain", label: "Federated Train", band: "region",
    note: "Run eight regional training passes and combine model updates.", icon: "type:region",
    parts: [{ key: "hallTrain", count: 8 }, { key: "vectorAdd", count: 4096 }], primitive: null,
  },
  {
    key: "globalModelRelease", label: "Global Model Release", band: "region",
    note: "Validate 256 inference batches, back up and verify the release.", icon: "type:region",
    parts: [{ key: "inference", count: 256 }, { key: "drBackup", count: 8 }, { key: "multiZoneVerify", count: 8 }], primitive: null,
  },
];
