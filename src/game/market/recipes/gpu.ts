import type { WorkRecipe } from '../../types/tasks';

export const recipes: readonly WorkRecipe[] = [
  {
    key: "imageBlur", label: "Image Blur", band: "gpu",
    note: "Convolve one matrix block and write sixteen output bits.", icon: "imageBlur",
    parts: [{ key: "matmul", count: 1 }, { key: "op:write", count: 16 }], primitive: null,
  },
  {
    key: "thumbnail", label: "Thumbnail", band: "gpu",
    note: "Filter one image block and copy its reduced output.", icon: "thumbnail",
    parts: [{ key: "imageBlur", count: 1 }, { key: "bitCopy", count: 16 }], primitive: null,
  },
  {
    key: "transcode", label: "Video Transcode", band: "gpu",
    note: "Process eight image blocks, compress and verify four segments.", icon: "transcode",
    parts: [{ key: "imageBlur", count: 8 }, { key: "lzCompress", count: 4 }, { key: "crc32", count: 4 }], primitive: null,
  },
  {
    key: "inference", label: "ML Inference", band: "gpu",
    note: "Evaluate eight matrix blocks and select outputs.", icon: "inference",
    parts: [{ key: "matmul", count: 8 }, { key: "compare", count: 64 }], primitive: null,
  },
  {
    key: "rayTrace", label: "Ray Trace Tile", band: "gpu",
    note: "Evaluate 64 ray products and accumulations, then compare sixteen hits.", icon: "rayTrace",
    parts: [{ key: "multiply", count: 64 }, { key: "intAdd", count: 64 }, { key: "compare", count: 16 }], primitive: null,
  },
  {
    key: "vectorAdd", label: "Vector Add", band: "gpu",
    note: "Add 64 vector elements.", icon: "type:accel",
    parts: [{ key: "intAdd", count: 64 }], primitive: null,
  },
  {
    key: "vectorMultiply", label: "Vector Multiply", band: "gpu",
    note: "Multiply 64 vector elements.", icon: "type:accel",
    parts: [{ key: "multiply", count: 64 }], primitive: null,
  },
  {
    key: "convolution", label: "Image Convolution", band: "gpu",
    note: "Multiply sixteen kernel blocks and accumulate the output.", icon: "type:accel",
    parts: [{ key: "matmul", count: 16 }, { key: "vectorAdd", count: 1 }], primitive: null,
  },
  {
    key: "attention", label: "Attention Block", band: "gpu",
    note: "Evaluate 32 attention blocks, compare scores and add residuals.", icon: "type:accel",
    parts: [{ key: "matmul", count: 32 }, { key: "compare", count: 64 }, { key: "vectorAdd", count: 2 }], primitive: null,
  },
  {
    key: "backprop", label: "Backprop Batch", band: "gpu",
    note: "Evaluate 64 gradient blocks and combine element products and updates.", icon: "type:accel",
    parts: [{ key: "matmul", count: 64 }, { key: "vectorMultiply", count: 2 }, { key: "vectorAdd", count: 2 }], primitive: null,
  },
];
