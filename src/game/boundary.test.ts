import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** The sim imports nothing outside src/game except the allowed packages (architecture §5.1). */
const GAME = __dirname;
const ALLOWED_PACKAGES = new Set(['decimal.js', 'node:fs', 'node:path', 'vitest']);

const files = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
};
const SPECIFIER = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

describe('sim import boundary', () => {
  const all = files(GAME);
  it('scans the sim tree', () => expect(all.length).toBeGreaterThan(20));

  it.each(all.map((f) => relative(GAME, f)))('%s imports only src/game or allowed packages', (file) => {
    const source = readFileSync(join(GAME, file), 'utf8');
    for (const match of source.matchAll(SPECIFIER)) {
      const spec = match[1] ?? match[2]!;
      if (!spec.startsWith('.')) {
        expect(ALLOWED_PACKAGES.has(spec), `${file}: package ${spec}`).toBe(true);
        continue;
      }
      const target = resolve(dirname(join(GAME, file)), spec).replace(/\.ts$/, '');
      const inside = target === GAME || target.startsWith(GAME + sep);
      expect(inside, `${file}: ${spec}`).toBe(true);
    }
  });
});
