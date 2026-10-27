import type { WorkRecipe } from '../../types/tasks';

export const recipes: readonly WorkRecipe[] = [
  {
    key: "popcount", label: "Bit Count", band: "ints",
    note: "Accumulate the set bits of one word.", icon: "popcount",
    parts: [{ key: "op:read", count: 8 }, { key: "intAdd", count: 8 }], primitive: null,
  },
  {
    key: "crc8", label: "CRC-8", band: "ints",
    note: "Eight checksum shift-and-XOR rounds.", icon: "crc8",
    parts: [{ key: "bitShift", count: 8 }, { key: "xorMix", count: 8 }], primitive: null,
  },
  {
    key: "multiply", label: "Multiply", band: "ints",
    note: "Eight masked shift-and-add rounds.", icon: "multiply",
    parts: [{ key: "andMask", count: 8 }, { key: "bitShift", count: 8 }, { key: "intAdd", count: 8 }], primitive: null,
  },
  {
    key: "fnvHash", label: "FNV Hash", band: "ints",
    note: "Four short-key mix-and-multiply rounds.", icon: "fnvHash",
    parts: [{ key: "xorMix", count: 4 }, { key: "multiply", count: 4 }], primitive: null,
  },
  {
    key: "crc32", label: "CRC-32", band: "ints",
    note: "Four checksum lanes followed by mixing.", icon: "crc32",
    parts: [{ key: "crc8", count: 4 }, { key: "xorMix", count: 4 }], primitive: null,
  },
  {
    key: "binSearch", label: "Binary Search", band: "ints",
    note: "Eight bounded search probes.", icon: "binSearch",
    parts: [{ key: "compare", count: 8 }, { key: "bitShift", count: 8 }], primitive: null,
  },
  {
    key: "regex", label: "Regex Match", band: "ints",
    note: "Scan a fixed 64-symbol input with compare-and-advance steps.", icon: "regex",
    parts: [{ key: "compare", count: 64 }, { key: "bitShift", count: 64 }], primitive: null,
  },
  {
    key: "intSort", label: "Integer Sort", band: "ints",
    note: "A fixed compare-and-exchange pass over eight values.", icon: "intSort",
    parts: [{ key: "compare", count: 28 }, { key: "bitSwap", count: 28 }], primitive: null,
  },
  {
    key: "intDivide", label: "Integer Divide", band: "ints",
    note: "Eight compare, subtract-via-adder and shift rounds.", icon: "type:compute",
    parts: [{ key: "compare", count: 8 }, { key: "intAdd", count: 8 }, { key: "bitFlip", count: 8 }, { key: "bitShift", count: 8 }], primitive: null,
  },
  {
    key: "bitRotate", label: "Bit Rotate", band: "ints",
    note: "Shift both halves and merge the word.", icon: "type:compute",
    parts: [{ key: "bitShift", count: 2 }, { key: "orMerge", count: 1 }], primitive: null,
  },
];
