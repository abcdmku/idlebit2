// The canonical QA stage set: legal saves played by the balance bot (scripts/balance/run.ts), one per era.
// Stages are git-ignored build outputs, rebuilt whenever SAVE_VERSION changes (older saves reset to a
// fresh game, and capture.mjs refuses them).
//
//   node scripts/qa/fixtures/build.mjs [--out=artifacts/qa/stages] [--only=early,mid] [--seed=42]
//     [--force] [--global-max-days=14]
//
// Writes <out>/{early,mid,rack,room,global}.json and <out>/index.json:
//   early   15 min    the first rounds on one core
//   mid     2 h       System open, research under way
//   rack    Rack researched, plus 1 h
//   room    Room researched, plus 2 h
//   global  Data center researched, plus 2 h. Days of game time: the slow one. It stops at
//           --global-max-days and fails if the bot has not got there.
// Each stage continues the one before it, so the set is one campaign. A stage already built for the
// current SAVE_VERSION is kept unless --force. The chain's intermediate saves stay in <out>/chain,
// so an interrupted build resumes.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const option = (key, fallback) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const out = path.resolve(option('out', 'artifacts/qa/stages')), chain = path.join(out, 'chain');
const only = option('only', '').split(',').filter(Boolean), force = process.argv.includes('--force');
const seed = option('seed', '42'), globalMaxH = Number(option('global-max-days', '14')) * 24;
const SAVE_VERSION = Number(/SAVE_VERSION = (\d+)/.exec(readFileSync('src/game/save/schema.ts', 'utf8'))?.[1]);
if (!Number.isInteger(SAVE_VERSION)) throw new Error('Cannot read SAVE_VERSION from src/game/save/schema.ts');
mkdirSync(chain, { recursive: true });

const read = file => JSON.parse(readFileSync(file, 'utf8'));
const hoursOf = stage => stage.stage.endTick / 36_000;
const current = file => existsSync(file) && JSON.parse(read(file).save).version === SAVE_VERSION && String(read(file).seed) === seed;
/** Plays the bot from `from` (or a fresh game) to `toHours` of game time. Reuses a chain file already built. */
function play(from, toHours) {
  const file = path.join(chain, `h${toHours.toFixed(2)}.json`);
  if (!force && current(file)) return file;
  const startH = from ? hoursOf(read(from)) : 0;
  const args = ['--import', 'tsx', 'scripts/balance/run.ts', `--hours=${(toHours - startH).toFixed(4)}`, `--out=${file}`, '--no-fail', '--quiet', `--seed=${seed}`];
  if (from) args.push(`--from=${from}`);
  const t0 = Date.now();
  execFileSync(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`  played ${startH.toFixed(2)} h → ${toHours.toFixed(2)} h in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return file;
}
/** Plays on in `stepH` steps until the milestone is reached, then `extraH` more. */
function until(from, milestone, stepH, extraH, maxH) {
  let file = from, at = read(from).carry.milestones[milestone];
  while (at === null) {
    const next = Math.floor(hoursOf(read(file)) / stepH + 1) * stepH;
    if (next > maxH) throw new Error(`The bot has not reached ${milestone} by ${maxH} h of game time`);
    file = play(file, next); at = read(file).carry.milestones[milestone];
  }
  const target = Math.ceil((at / 3600 + extraH) * 4) / 4;
  return hoursOf(read(file)) >= target ? file : play(file, target);
}

const STAGES = [
  ['early', () => play(null, 0.25)],
  ['mid', prev => until(play(prev, 2), 'systemS', 1, 0.5, 12)],
  ['rack', prev => until(prev, 'rackS', 2, 1, 48)],
  ['room', prev => until(prev, 'roomS', 6, 2, 96)],
  ['global', prev => until(prev, 'dataCenterS', 24, 2, globalMaxH)],
];
const index = { saveVersion: SAVE_VERSION, seed: Number(seed), stages: {} };
let prev = null;
for (const [name, build] of STAGES) {
  const file = path.join(out, `${name}.json`);
  if (only.length && !only.includes(name) && current(file)) { prev = file; continue; }
  if (only.length && !only.includes(name) && only.every(o => STAGES.findIndex(s => s[0] === o) < STAGES.findIndex(s => s[0] === name))) break;
  if (force || !current(file)) {
    console.log(`${name}:`);
    copyFileSync(build(prev), file);
  }
  prev = file;
}
for (const [name] of STAGES) {
  const file = path.join(out, `${name}.json`);
  if (!current(file)) continue;
  const stage = read(file), state = JSON.parse(stage.save).state, m = stage.carry.milestones;
  index.stages[name] = { file: path.relative(process.cwd(), file).replaceAll('\\', '/'), hours: Number(hoursOf(stage).toFixed(2)), round: state.round.phase,
    reached: Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null).map(([k, v]) => [k, Number((v / 3600).toFixed(2))])) };
  console.log(`${name}: ${index.stages[name].hours} h, ${Object.keys(index.stages[name].reached).join(' ')}`);
}
writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1) + '\n');
