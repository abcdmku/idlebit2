import type { WorkRecipe } from '../../types/tasks';

export const recipes: readonly WorkRecipe[] = [
  {
    key: "activeActive", label: "Active-Active DB", band: "multiAz",
    note: "Replicate and index both zone copies, then verify commits.", icon: "activeActive",
    parts: [{ key: "replWrite", count: 2 }, { key: "indexBuild", count: 2 }, { key: "crc32", count: 64 }], primitive: null,
  },
  {
    key: "quorumWrite", label: "Quorum Write", band: "multiAz",
    note: "Write three replica groups and compare acknowledgments.", icon: "quorumWrite",
    parts: [{ key: "replWrite", count: 3 }, { key: "compare", count: 3 }], primitive: null,
  },
  {
    key: "drBackup", label: "DR Backup", band: "multiAz",
    note: "Make two multi-rack copies and verify their manifests.", icon: "drBackup",
    parts: [{ key: "multiRackBackup", count: 2 }, { key: "fileChecksum", count: 64 }], primitive: null,
  },
  {
    key: "hallTrain", label: "Multi-hall Train", band: "multiAz",
    note: "Run two large training passes and synchronize checkpoints.", icon: "hallTrain",
    parts: [{ key: "bigTrain", count: 2 }, { key: "checkpointSet", count: 12 }], primitive: null,
  },
  {
    key: "zoneRepair", label: "Zone Repair", band: "multiAz",
    note: "Rebuild 32 missing partitions and verify the replacement.", icon: "type:zones",
    parts: [{ key: "shardRebalance", count: 32 }, { key: "clusterVerify", count: 32 }], primitive: null,
  },
  {
    key: "crossZoneCache", label: "Cross-zone Cache", band: "multiAz",
    note: "Serve both zone caches and verify their shared state.", icon: "type:zones",
    parts: [{ key: "distributedCache", count: 2 }, { key: "crc32", count: 64 }], primitive: null,
  },
  {
    key: "readQuorum", label: "Read Quorum", band: "multiAz",
    note: "Read three copies and compare their returned values.", icon: "type:zones",
    parts: [{ key: "kvGet", count: 3 }, { key: "compare", count: 3 }], primitive: null,
  },
  {
    key: "failoverReplay", label: "Failover Replay", band: "multiAz",
    note: "Replay 64 log partitions and verify eight recovered groups.", icon: "type:zones",
    parts: [{ key: "logIngest", count: 64 }, { key: "clusterVerify", count: 8 }], primitive: null,
  },
  {
    key: "zoneCheckpoint", label: "Zone Checkpoint", band: "multiAz",
    note: "Save and replicate sixteen checkpoint groups.", icon: "type:zones",
    parts: [{ key: "checkpointSet", count: 16 }, { key: "replWrite", count: 16 }], primitive: null,
  },
  {
    key: "multiZoneVerify", label: "Multi-zone Verify", band: "multiAz",
    note: "Cross-check 32 clusters and 128 result batches.", icon: "type:zones",
    parts: [{ key: "clusterVerify", count: 32 }, { key: "verifyBatch", count: 128 }], primitive: null,
  },
];
