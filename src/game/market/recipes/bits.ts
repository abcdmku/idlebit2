import type { WorkRecipe } from '../../types/tasks';

export const recipes: readonly WorkRecipe[] = [
  {
    key: "bitFlip", label: "Bit Flip", band: "bits",
    note: "Read, invert and write one bit.", icon: "bitFlip",
    parts: [{ key: "op:read", count: 1 }, { key: "op:not", count: 1 }, { key: "op:write", count: 1 }], primitive: null,
  },
  {
    key: "parity", label: "Parity Check", band: "bits",
    note: "Read eight bits, XOR-fold them and write one parity bit.", icon: "parity",
    parts: [{ key: "op:read", count: 8 }, { key: "op:xor", count: 8 }, { key: "op:write", count: 1 }], primitive: null,
  },
  {
    key: "andMask", label: "AND Mask", band: "bits",
    note: "Read two 8-bit words and write their masked result.", icon: "andMask",
    parts: [{ key: "op:read", count: 16 }, { key: "op:and", count: 8 }, { key: "op:write", count: 8 }], primitive: null,
  },
  {
    key: "compare", label: "Compare", band: "bits",
    note: "Compare two 8-bit words with fixed bit-logic work.", icon: "compare",
    parts: [{ key: "op:read", count: 16 }, { key: "op:xor", count: 8 }, { key: "op:and", count: 8 }, { key: "op:or", count: 8 }, { key: "op:write", count: 1 }], primitive: null,
  },
  {
    key: "intAdd", label: "Integer Add", band: "bits",
    note: "Read two words, run eight full-adder cells and store the sum.", icon: "intAdd",
    parts: [{ key: "op:read", count: 16 }, { key: "fullAdder", count: 8 }, { key: "op:write", count: 8 }], primitive: null,
  },
  {
    key: "orMerge", label: "OR Merge", band: "bits",
    note: "Combine two 8-bit flags words.", icon: "type:compute",
    parts: [{ key: "op:read", count: 16 }, { key: "op:or", count: 8 }, { key: "op:write", count: 8 }], primitive: null,
  },
  {
    key: "xorMix", label: "XOR Mix", band: "bits",
    note: "Mix two 8-bit words.", icon: "type:compute",
    parts: [{ key: "op:read", count: 16 }, { key: "op:xor", count: 8 }, { key: "op:write", count: 8 }], primitive: null,
  },
  {
    key: "bitShift", label: "Bit Shift", band: "bits",
    note: "Shift an 8-bit word by one position.", icon: "type:compute",
    parts: [{ key: "op:read", count: 8 }, { key: "op:shift", count: 8 }, { key: "op:write", count: 8 }], primitive: null,
  },
  {
    key: "bitCopy", label: "Bit Copy", band: "bits",
    note: "Copy one 8-bit word.", icon: "type:compute",
    parts: [{ key: "op:read", count: 8 }, { key: "op:write", count: 8 }], primitive: null,
  },
  {
    key: "bitSwap", label: "Bit Swap", band: "bits",
    note: "Exchange two 8-bit words.", icon: "type:compute",
    parts: [{ key: "op:read", count: 16 }, { key: "op:write", count: 16 }], primitive: null,
  },
];
