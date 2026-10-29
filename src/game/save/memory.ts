import { PARTS } from '../build/catalog';
import { maxLevel } from '../build/locks';
import type { GameState } from '../types/state';

type Reject = (path: string, reason: string) => never;
type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Both independent levels are required on installed, copied and saved RAM/drives. */
export function validateMemoryBuilds(state: GameState, fail: Reject): void {
  const spec = (value: unknown, path: string): void => {
    if (!object(value)) fail(path, 'expected system spec');
    for (const key of ['ram', 'drives'] as const) {
      if (!Array.isArray(value[key])) fail(`${path}.${key}`, 'expected memory array');
      (value[key] as unknown[]).forEach((raw, index) => {
        const at = `${path}.${key}[${index}]`, id = key === 'ram' ? 'ram' : 'storage';
        if (!object(raw)) fail(at, 'expected memory component');
        if (!Number.isSafeInteger(raw.gen) || (raw.gen as number) < 0 || (raw.gen as number) >= PARTS[id].base.length) fail(`${at}.gen`, 'invalid generation');
        const top = maxLevel(state.research.unlocks, id, raw.gen as number, key === 'ram' && raw.ecc === true);
        for (const level of ['level', 'speedLevel']) {
          if (!Number.isSafeInteger(raw[level]) || (raw[level] as number) < 1 || (raw[level] as number) > top) fail(`${at}.${level}`, 'invalid upgrade level');
        }
        if (key === 'ram' && typeof raw.ecc !== 'boolean') fail(`${at}.ecc`, 'expected ECC flag');
      });
    }
  };
  const visit = (value: unknown, path: string, depth = 0): void => {
    if (!object(value) || depth > 3) fail(path, 'invalid hardware configuration');
    if ('spec' in value) { spec(value.spec, `${path}.spec`); return; }
    for (const key of ['servers', 'racks', 'zones']) if (key in value) {
      if (!Array.isArray(value[key])) fail(`${path}.${key}`, 'expected hardware array');
      (value[key] as unknown[]).forEach((child, i) => { if (child !== null) visit(child, `${path}.${key}[${i}]`, depth + 1); });
      return;
    }
    fail(path, 'missing hardware');
  };
  state.build.systems.forEach((system, i) => { if (system) visit(system, `build.systems[${i}]`); });
  for (const kind of ['system', 'rack', 'room', 'site'] as const) state.configs[kind].forEach((saved, i) => {
    visit(saved.config, `configs.${kind}[${i}].config`);
  });
}
