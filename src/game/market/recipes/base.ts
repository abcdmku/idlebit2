import type { WorkRecipe } from '../../types/tasks';

export const recipes: readonly WorkRecipe[] = [
  {
    key: "op:read", label: "Read bit", band: null,
    note: "Read one bit into the calculation.", icon: "type:memory",
    parts: [], primitive: "mem",
  },
  {
    key: "op:write", label: "Write bit", band: null,
    note: "Write one result bit.", icon: "type:storage",
    parts: [], primitive: "mem",
  },
  {
    key: "op:not", label: "NOT", band: null,
    note: "Invert one bit.", icon: "bitFlip",
    parts: [], primitive: "compute",
  },
  {
    key: "op:xor", label: "XOR", band: null,
    note: "Exclusive OR of two bits.", icon: "parity",
    parts: [], primitive: "compute",
  },
  {
    key: "op:and", label: "AND", band: null,
    note: "AND of two bits.", icon: "andMask",
    parts: [], primitive: "compute",
  },
  {
    key: "op:or", label: "OR", band: null,
    note: "OR of two bits.", icon: "type:compute",
    parts: [], primitive: "compute",
  },
  {
    key: "op:shift", label: "Shift bit", band: null,
    note: "Move one bit by one position.", icon: "type:compute",
    parts: [], primitive: "compute",
  },
  {
    key: "fullAdder", label: "Full-adder cell", band: "bits",
    note: "One carry bit and one sum bit. Two XOR, two AND and one OR.", icon: "intAdd",
    parts: [{ key: "op:xor", count: 2 }, { key: "op:and", count: 2 }, { key: "op:or", count: 1 }], primitive: null,
  },
];
