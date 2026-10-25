import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = "127.0.0.1";
// GitHub Pages serves the game from /idlebit2/; everywhere else relative assets work.
const base = process.env.GITHUB_PAGES === "true" ? "/idlebit2/" : "./";

export default defineConfig({
  base,
  plugins: [react()],
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
});
