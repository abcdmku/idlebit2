import type { WorkRecipe } from '../../types/tasks';

export const recipes: readonly WorkRecipe[] = [
  {
    key: "hashBatch", label: "Hash Batch", band: "threads",
    note: "Hash two independent short keys.", icon: "hashBatch",
    parts: [{ key: "fnvHash", count: 2 }], primitive: null,
  },
  {
    key: "lzCompress", label: "LZ Compress", band: "threads",
    note: "Search four window positions, compare eight matches and copy sixteen tokens.", icon: "lzCompress",
    parts: [{ key: "binSearch", count: 4 }, { key: "compare", count: 8 }, { key: "bitCopy", count: 16 }], primitive: null,
  },
  {
    key: "monteCarlo", label: "Monte Carlo", band: "threads",
    note: "Evaluate and classify eight independent samples.", icon: "monteCarlo",
    parts: [{ key: "multiply", count: 8 }, { key: "intAdd", count: 8 }, { key: "compare", count: 8 }], primitive: null,
  },
  {
    key: "checksumBatch", label: "Checksum Batch", band: "threads",
    note: "Verify four records independently.", icon: "type:parallel",
    parts: [{ key: "crc32", count: 4 }, { key: "compare", count: 4 }], primitive: null,
  },
  {
    key: "searchBatch", label: "Search Batch", band: "threads",
    note: "Run eight independent bounded searches.", icon: "type:parallel",
    parts: [{ key: "binSearch", count: 8 }], primitive: null,
  },
  {
    key: "sortBatch", label: "Sort Batch", band: "threads",
    note: "Sort two independent small arrays.", icon: "type:parallel",
    parts: [{ key: "intSort", count: 2 }], primitive: null,
  },
  {
    key: "multiplyBatch", label: "Multiply Batch", band: "threads",
    note: "Run eight independent word products.", icon: "type:parallel",
    parts: [{ key: "multiply", count: 8 }], primitive: null,
  },
  {
    key: "maskBatch", label: "Mask Batch", band: "threads",
    note: "Apply 256 independent bit masks.", icon: "type:parallel",
    parts: [{ key: "andMask", count: 256 }], primitive: null,
  },
  {
    key: "dedupeBatch", label: "Deduplicate Batch", band: "threads",
    note: "Hash two records, then compare eight matching keys.", icon: "type:parallel",
    parts: [{ key: "fnvHash", count: 2 }, { key: "compare", count: 8 }], primitive: null,
  },
  {
    key: "verifyBatch", label: "Verify Batch", band: "threads",
    note: "Run eight parity checks and four block checksums.", icon: "type:parallel",
    parts: [{ key: "parity", count: 8 }, { key: "crc32", count: 4 }], primitive: null,
  },
];
