// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const GAME_DIR = join(__dirname);

const collect = (dir: string, out: string[] = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
};

const FORBIDDEN_IMPORTS = [/from\s+["']react/, /from\s+["']phaser/, /from\s+["']react-dom/];
const FORBIDDEN_GLOBALS = [
  /\bwindow\./,
  /\bdocument\./,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bDate\.now\(/,
  /\bperformance\.now\(/,
  /\bMath\.random\(/,
  /\bsetTimeout\(/,
  /\bsetInterval\(/,
  /\brequestAnimationFrame\(/,
];

it("keeps src/game free of framework imports and browser/time/random globals", () => {
  const files = collect(GAME_DIR);

  expect(files.length).toBeGreaterThan(10);

  for (const file of files) {
    const source = readFileSync(file, "utf8"), name = file.slice(GAME_DIR.length + 1);
    for (const pattern of [...FORBIDDEN_IMPORTS, ...FORBIDDEN_GLOBALS]) expect(source, name).not.toMatch(pattern);
  }
});
