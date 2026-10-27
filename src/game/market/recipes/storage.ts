import type { WorkRecipe } from '../../types/tasks';

export const recipes: readonly WorkRecipe[] = [
  {
    key: "logIngest", label: "Log Ingest", band: "storage",
    note: "Parse and hash 64 records, then append their data.", icon: "logIngest",
    parts: [{ key: "jsonParse", count: 64 }, { key: "fnvHash", count: 64 }, { key: "op:write", count: 4096 }], primitive: null,
  },
  {
    key: "backup", label: "Backup", band: "storage",
    note: "Copy 8,192 words and checksum the result.", icon: "backup",
    parts: [{ key: "bitCopy", count: 8192 }, { key: "crc32", count: 16 }], primitive: null,
  },
  {
    key: "indexBuild", label: "Index Build", band: "storage",
    note: "Sort and hash index runs, then store the index pages.", icon: "indexBuild",
    parts: [{ key: "intSort", count: 256 }, { key: "fnvHash", count: 256 }, { key: "op:write", count: 4096 }], primitive: null,
  },
  {
    key: "compaction", label: "LSM Compaction", band: "storage",
    note: "Merge sorted runs, compare keys and write new pages.", icon: "compaction",
    parts: [{ key: "mergeSort", count: 64 }, { key: "compare", count: 4096 }, { key: "op:write", count: 8192 }], primitive: null,
  },
  {
    key: "sqlScan", label: "SQL Scan", band: "storage",
    note: "Read and filter 4,096 stored values.", icon: "sqlScan",
    parts: [{ key: "op:read", count: 32768 }, { key: "compare", count: 4096 }, { key: "andMask", count: 4096 }], primitive: null,
  },
  {
    key: "fileChecksum", label: "File Checksum", band: "storage",
    note: "Read a file and verify 1,024 checksum blocks.", icon: "type:storage",
    parts: [{ key: "op:read", count: 32768 }, { key: "crc32", count: 1024 }], primitive: null,
  },
  {
    key: "archive", label: "Archive", band: "storage",
    note: "Compress 256 windows and back up the archive.", icon: "type:storage",
    parts: [{ key: "lzCompress", count: 256 }, { key: "backup", count: 1 }], primitive: null,
  },
  {
    key: "restore", label: "Restore", band: "storage",
    note: "Copy one stored snapshot and verify its blocks.", icon: "type:storage",
    parts: [{ key: "backup", count: 1 }, { key: "verifyBatch", count: 8 }], primitive: null,
  },
  {
    key: "dedupeBackup", label: "Deduplicated Backup", band: "storage",
    note: "Hash and compare existing chunks before copying the result.", icon: "type:storage",
    parts: [{ key: "hashBatch", count: 64 }, { key: "compare", count: 4096 }, { key: "backup", count: 1 }], primitive: null,
  },
  {
    key: "incrementalBackup", label: "Incremental Backup", band: "storage",
    note: "Verify the source, mask changed blocks and copy the delta.", icon: "type:storage",
    parts: [{ key: "fileChecksum", count: 1 }, { key: "andMask", count: 4096 }, { key: "backup", count: 1 }], primitive: null,
  },
];
