import { G, G_SIZE, LOC } from '../core/buffers';
import { DEADLINE_BUCKETS, MAX_SITES, QUEUE_VISIBLE, TICK_MS } from '../core/constants';
import { ARRAY_CTORS, type Layout } from '../core/table';
import type { GameState } from '../types/state';
import type { SaveLoadResult } from '../types/save';
import { FAIL_CAUSES, FAIL_DETAILS } from '../types/events';
import { COMPILED_TABLES, HOT_TABLES, SAVE_SCHEMA } from './schema';
import { FAMILIES } from '../market/families';
import { validateAccelBuilds, validateAccelRuntime } from './accelerators';
import { validatePreload } from './preload';
import { validateRoundRewards } from './roundRewards';
import { WALLET_HISTORY_LIMIT } from '../core/walletHistory';
import { validateMemoryBuilds } from './memory';

type Obj = Record<string, unknown>;
class SaveError extends Error {}

const fail = (path: string, what: string): never => { throw new SaveError(`${path}: ${what}`); };
const obj = (v: unknown, path: string): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v) ? (v as Obj) : fail(path, 'expected an object'));
const arr = (v: unknown, path: string): unknown[] => (Array.isArray(v) ? v : fail(path, 'expected an array'));
const int = (v: unknown, path: string, min = 0): number => (Number.isSafeInteger(v) && (v as number) >= min ? (v as number) : fail(path, `expected an integer >= ${min}`));
const finite = (v: unknown, path: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(path, 'expected a finite number'));
const meter = (v: unknown, path: string): number => { const n = finite(v, path); return n >= 0 && n < 1 ? n : fail(path, 'expected a meter in [0, 1)'); };
const whole = (v: unknown, path: string, signed = false): string =>
  (typeof v === 'string' && (signed ? /^(0|-?[1-9]\d*)$/ : /^(0|[1-9]\d*)$/).test(v) ? v : fail(path, 'expected a whole-number Amount'));
const oneOf = <T extends string>(v: unknown, path: string, options: readonly T[]): T => (options.includes(v as T) ? (v as T) : fail(path, `expected one of ${options.join(', ')}`));

function typed(v: unknown, path: string, kind: keyof typeof ARRAY_CTORS, length?: number): void {
  if (!(v instanceof ARRAY_CTORS[kind])) fail(path, `expected ${kind} array`);
  if (length !== undefined && (v as { length: number }).length !== length) fail(path, `expected length ${length}`);
}

function table(v: unknown, path: string, layout: Layout): { len: number } {
  const t = obj(v, path);
  const cap = int(t.cap, `${path}.cap`);
  const len = int(t.len, `${path}.len`);
  if (len > cap) fail(path, 'len exceeds cap');
  for (const [key, spec] of Object.entries(layout)) typed(t[key], `${path}.${key}`, spec.t, cap * (spec.stride ?? 1));
  return { len };
}

function check(raw: unknown): GameState {
  const s = obj(raw, 'state');
  oneOf(s.schema, 'schema', [SAVE_SCHEMA]);
  int(s.epoch, 'epoch');
  int(s.seed, 'seed');
  const clock = obj(s.clock, 'clock');
  int(clock.tick, 'clock.tick');
  if (int(clock.carryMs, 'clock.carryMs') >= TICK_MS) fail('clock.carryMs', `expected < ${TICK_MS}`);
  const wallet = obj(s.wallet, 'wallet');
  whole(wallet.credits, 'wallet.credits', true);
  whole(wallet.data, 'wallet.data');
  meter(wallet.energyMeter, 'wallet.energyMeter');
  meter(wallet.dataMeter, 'wallet.dataMeter');
  const ledger = obj(s.ledger, 'ledger');
  for (const k of ['gross', 'energy', 'dataEarned', 'creditsSpent', 'dataSpent']) whole(ledger[k], `ledger.${k}`);
  arr(ledger.netRing, 'ledger.netRing');
  const history = arr(ledger.walletHistory, 'ledger.walletHistory');
  if (history.length === 0 || history.length > WALLET_HISTORY_LIMIT) fail('ledger.walletHistory', 'invalid history length');
  let previousTick = 0;
  history.forEach((raw, i) => {
    const path = `ledger.walletHistory[${i}]`, sample = obj(raw, path);
    const tick = int(sample.tick, `${path}.tick`);
    if (tick < previousTick || tick > (clock.tick as number)) fail(path, 'history ticks must be ordered and no later than the clock');
    previousTick = tick;
    whole(sample.credits, `${path}.credits`, true);
    whole(sample.data, `${path}.data`);
    if (typeof sample.checkpoint !== 'boolean') fail(path, 'expected a checkpoint flag');
  });
  const round = obj(s.round, 'round');
  oneOf(round.phase, 'round.phase', ['running', 'ended', 'between']);
  int(round.index, 'round.index', 1);
  arr(round.reports, 'round.reports');
  for (const k of ['gross', 'data', 'energy']) whole(round[k], `round.${k}`);
  if (finite(round.grace, 'round.grace') < 0) fail('round.grace', 'expected a non-negative grace');
  const frontier = obj(round.frontier, 'round.frontier');
  if (finite(frontier.bestI, 'round.frontier.bestI') < 0) fail('round.frontier.bestI', 'expected a non-negative intensity');
  int(frontier.bestRound, 'round.frontier.bestRound');
  int(frontier.bestMet, 'round.frontier.bestMet');
  int(frontier.bestMetRound, 'round.frontier.bestMetRound');
  const taken = arr(frontier.taken, 'round.frontier.taken');
  taken.forEach((f, i) => { if (!FAMILIES[int(f, `round.frontier.taken[${i}]`)]) fail('round.frontier.taken', 'unknown family'); });
  if (int(frontier.takenAtStart, 'round.frontier.takenAtStart') > taken.length) fail('round.frontier.takenAtStart', 'exceeds taken');
  if (round.runwayStart !== null) obj(round.runwayStart, 'round.runwayStart');
  const build = obj(s.build, 'build');
  const lengths = ['systems', 'racks', 'rooms', 'sites'].map((k) => arr(build[k], `build.${k}`).length);
  obj(build.global, 'build.global');
  int(build.revision, 'build.revision');
  const investments = obj(build.investments, 'build.investments');
  for (const [key, raw] of Object.entries(investments)) {
    const history = arr(raw, `build.investments.${key}`);
    if (!history.length) fail(`build.investments.${key}`, 'empty payment history');
    for (const payment of history) {
      const p = obj(payment, `build.investments.${key}`);
      if (typeof p.version !== 'string') fail(`build.investments.${key}`, 'missing component version');
      whole(p.credits, `build.investments.${key}.credits`);
    }
  }
  const research = obj(s.research, 'research');
  arr(research.completed, 'research.completed');
  arr(research.queue, 'research.queue');
  obj(research.unlocks, 'research.unlocks');
  const configs = obj(s.configs, 'configs');
  for (const k of ['system', 'rack', 'room', 'site']) arr(configs[k], `configs.${k}`);

  const compiled = obj(s.compiled, 'compiled');
  const compiledLens: Record<string, number> = {};
  for (const [key, layout] of Object.entries(COMPILED_TABLES)) compiledLens[key] = table(compiled[key], `compiled.${key}`, layout).len;
  ['sys', 'rack', 'room', 'site'].forEach((key, i) => { if (compiledLens[key] !== lengths[i]) fail(`compiled.${key}.len`, 'does not match build'); });
  const hot = obj(s.hot, 'hot');
  for (const [key, layout] of Object.entries(HOT_TABLES)) {
    const { len } = table(hot[key], `hot.${key}`, layout);
    if (key in compiledLens && len < compiledLens[key]!) fail(`hot.${key}.len`, 'smaller than compiled');
  }
  typed(hot.g, 'hot.g', 'f64', G_SIZE);
  typed(hot.rng, 'hot.rng', 'u32', 4);
  typed(hot.bill, 'hot.bill', 'f64', MAX_SITES);
  typed(hot.detailRound, 'hot.detailRound', 'f64', FAIL_CAUSES.length * FAIL_DETAILS.length);
  typed(hot.globalWrr, 'hot.globalWrr', 'f64', MAX_SITES);
  typed(hot.dlHead, 'hot.dlHead', 'i32', DEADLINE_BUCKETS);
  const events = obj(s.events, 'events');
  int(events.nextSeq, 'events.nextSeq');
  arr(events.entries, 'events.entries');
  validateQueue(raw as GameState);
  validateAccelBuilds(raw as GameState, fail);
  validateMemoryBuilds(raw as GameState, fail);
  validateAccelRuntime(raw as GameState, fail);
  validatePreload(raw as GameState, fail);
  validateRoundRewards(raw as GameState, fail);
  return raw as GameState;
}

/** The endless queue (spec §5.2): unique reserved IDs, known families, finite sizes, head ordering. */
function validateQueue(state: GameState): void {
  const path = 'market';
  const m = obj(state.market, path);
  const target = int(m.roundIndex, `${path}.roundIndex`, 1);
  const expected = state.round.index + (state.round.phase === 'running' ? 0 : 1);
  if (target !== expected) fail(path, 'queue round does not match round phase');
  if (finite(m.intensity, `${path}.intensity`) < 0) fail(path, 'intensity must be non-negative');
  const headTick = int(m.headTick, `${path}.headTick`);
  if (state.round.phase === 'running' && (headTick < state.round.startTick || headTick > state.clock.tick))
    fail(path, 'head clock must start inside the running round');
  const tasks = arr(m.window, `${path}.window`);
  if (tasks.length !== QUEUE_VISIBLE) fail(path, `expected ${QUEUE_VISIBLE} queued tasks`);
  const nextTaskId = int(state.hot.g[G.nextTaskId], 'hot.g.nextTaskId', 1);
  const ids = new Set<number>();
  for (let i = 0; i < tasks.length; i += 1) {
    const t = obj(tasks[i], `${path}.window[${i}]`);
    const id = int(t.taskId, `${path}.window[${i}].taskId`, 1);
    if (ids.has(id) || id >= nextTaskId) fail(path, 'duplicate or unreserved task identity');
    ids.add(id);
    if (!FAMILIES[int(t.family, `${path}.window[${i}].family`)]) fail(path, 'unknown family');
    const size = finite(t.size, `${path}.window[${i}].size`);
    if (size < 1 || !Number.isInteger(size)) fail(path, 'size must be a positive whole recipe count');
  }
  const rec = state.hot.rec;
  let front = 0;
  for (let r = 0; r < rec.len; r += 1) {
    const loc = rec.loc[r];
    if (loc === LOC.free) continue;
    if (!Number.isFinite(rec.units[r]!) || !Number.isInteger(rec.units[r]!) || rec.units[r]! < 1)
      fail('hot.rec.units', 'expected a positive whole recipe count');
    if (loc === LOC.probe) fail('hot.rec.loc', 'a take probe outlived its tick');
    if (ids.has(rec.taskId[r]!)) fail(path, 'a queued task is already taken');
    if (loc === LOC.front) front += 1;
  }
  if (front !== state.hot.g[G.frontLen]) fail('hot.g.frontLen', 'does not match the front records');
}

/** Structural validation plus GPU model, compatibility, ownership and reservation checks. */
export function validateState(raw: unknown): SaveLoadResult {
  try {
    return { ok: true, state: check(raw) };
  } catch (error) {
    if (error instanceof SaveError) return { ok: false, error: `Invalid save at ${error.message}` };
    throw error;
  }
}
