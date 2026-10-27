import type { WorkRecipe } from '../../types/tasks';

export const recipes: readonly WorkRecipe[] = [
  {
    key: "jsonParse", label: "JSON Parse", band: "ram",
    note: "Classify tokens, find keys and copy values into a tree.", icon: "jsonParse",
    parts: [{ key: "regex", count: 64 }, { key: "binSearch", count: 64 }, { key: "bitCopy", count: 256 }], primitive: null,
  },
  {
    key: "mergeSort", label: "Merge Sort", band: "ram",
    note: "Sort 64 runs, then move their merge buffers.", icon: "mergeSort",
    parts: [{ key: "intSort", count: 64 }, { key: "bitCopy", count: 512 }], primitive: null,
  },
  {
    key: "kvGet", label: "KV Cache Get", band: "ram",
    note: "Hash and compare 64 keys, then read their values.", icon: "kvGet",
    parts: [{ key: "fnvHash", count: 64 }, { key: "compare", count: 64 }, { key: "op:read", count: 512 }], primitive: null,
  },
  {
    key: "sqlJoin", label: "SQL Join", band: "ram",
    note: "Build and probe a 256-key hash join.", icon: "sqlJoin",
    parts: [{ key: "fnvHash", count: 256 }, { key: "binSearch", count: 256 }, { key: "bitCopy", count: 512 }], primitive: null,
  },
  {
    key: "graphBfs", label: "Graph BFS", band: "ram",
    note: "Read the frontier, mask visited nodes and update distances.", icon: "graphBfs",
    parts: [{ key: "kvGet", count: 256 }, { key: "andMask", count: 256 }, { key: "intAdd", count: 256 }], primitive: null,
  },
  {
    key: "matmul", label: "Matrix Multiply", band: "ram",
    note: "A 2 by 2 matrix block: eight products and accumulations.", icon: "matmul",
    parts: [{ key: "multiply", count: 8 }, { key: "intAdd", count: 8 }, { key: "bitCopy", count: 16 }], primitive: null,
  },
  {
    key: "histogram", label: "Histogram", band: "ram",
    note: "Classify and count 256 input records.", icon: "type:memory",
    parts: [{ key: "popcount", count: 256 }, { key: "intAdd", count: 256 }], primitive: null,
  },
  {
    key: "bloomFilter", label: "Bloom Filter", band: "ram",
    note: "Hash 256 keys, then mask and set their filter bits.", icon: "type:memory",
    parts: [{ key: "fnvHash", count: 256 }, { key: "andMask", count: 256 }, { key: "orMerge", count: 256 }], primitive: null,
  },
  {
    key: "sparseMatmul", label: "Sparse Matrix Step", band: "ram",
    note: "Find nonzero blocks and multiply sixteen of them.", icon: "type:memory",
    parts: [{ key: "binSearch", count: 64 }, { key: "matmul", count: 16 }], primitive: null,
  },
  {
    key: "memAggregate", label: "In-memory Aggregate", band: "ram",
    note: "Read 1,024 values, accumulate them and compare buckets.", icon: "type:memory",
    parts: [{ key: "op:read", count: 8192 }, { key: "intAdd", count: 1024 }, { key: "compare", count: 256 }], primitive: null,
  },
];
