import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // Simulation fixtures are CPU-heavy; keep concurrency consistent across machines.
    maxWorkers: 2,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/dist/**", "**/node_modules/**"],
  },
});
