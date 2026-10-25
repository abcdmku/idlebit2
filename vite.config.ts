import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const host = "127.0.0.1";
// GitHub Pages serves the game from /idlebit2/; everywhere else relative assets work.
const base = process.env.GITHUB_PAGES === "true" ? "/idlebit2/" : "./";

/** This build's identity: the commit and the build time, so every deploy differs. */
function buildId(): string {
  const time = Date.now().toString(36);
  try {
    return `${execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()}-${time}`;
  } catch {
    return time;
  }
}
const BUILD_ID = buildId();

/** Emits version.json next to index.html; the running game polls it to offer a reload (src/ui/shell/version.ts). */
const versionFile = (): Plugin => ({
  name: "idlebit2-version",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: `${JSON.stringify({ id: BUILD_ID })}\n` });
  },
});

export default defineConfig(({ command }) => ({
  base,
  plugins: [react(), versionFile()],
  // Dev and tests run as "dev": they never poll.
  define: { __BUILD_ID__: JSON.stringify(command === "build" ? BUILD_ID : "dev") },
  server: {
    host,
    port: 6174,
    strictPort: true,
  },
  preview: {
    host,
    port: 4174,
    strictPort: true,
  },
}));
