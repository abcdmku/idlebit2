import type { CampaignResult, Milestones, RoundSummary } from './campaign';

/**
 * Program §14 and D19 pacing targets checked against a campaign. Every row is either a pass, a fail, or
 * "not reached" (a fail as well). Times are sim seconds.
 */
export interface PacingRow {
  readonly target: string;
  readonly expected: string;
  readonly value: string;
  readonly pass: boolean;
}

const H = 3600, M = 60, D = 24 * H;
const hms = (s: number | null) => {
  if (s === null) return 'not reached';
  const t = Math.round(s);
  return `${Math.floor(t / H)}:${String(Math.floor(t / M) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

const MILESTONE_TARGETS: readonly [string, keyof Milestones, number, number][] = [
  ['First purchase', 'firstPurchaseS', 0, 30],
  ['First round ends', 'firstRoundEndS', 4 * M, 8 * M],
  // Program D19 from System on.
  ['System unlocked', 'systemS', 30 * M, 60 * M],
  ['Rack unlocked', 'rackS', 5 * H, 8 * H],
  ['Room unlocked', 'roomS', 2 * D, 4 * D],
  ['Data center (zones)', 'dataCenterS', 7 * D, 14 * D],
  ['Regions', 'regionsS', 14 * D, 28 * D],
];

const PHASES: readonly [string, number, number, number, number][] = [
  ['Round length, early (0–1 h)', 0, 1 * H, 4 * M, 10 * M],
  ['Round length, mid (1–8 h)', 1 * H, 8 * H, 10 * M, 25 * M],
  ['Round length, late (8–24 h)', 8 * H, 24 * H, 20 * M, 45 * M],
];

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Longest stretch without a decision (purchase or research start) inside [from, to). */
function maxGap(result: CampaignResult, from: number, to: number): number | null {
  const end = Math.min(to, result.ticks / 10);
  if (end <= from) return null;
  const times = result.events.filter((e) => e.kind !== 'return').map((e) => e.tick / 10).filter((t) => t >= from && t < end);
  let last = from, gap = 0;
  for (const t of times) { gap = Math.max(gap, t - last); last = t; }
  return Math.max(gap, end - last);
}

export function pacingReport(result: CampaignResult): PacingRow[] {
  const rows: PacingRow[] = [];
  for (const [target, key, lo, hi] of MILESTONE_TARGETS) {
    const v = result.milestones[key];
    rows.push({ target, expected: `${hms(lo)}–${hms(hi)}`, value: hms(v), pass: v !== null && v >= lo && v <= hi });
  }
  for (const [target, from, to, lo, hi] of PHASES) {
    const rs: RoundSummary[] = result.rounds.filter((r) => r.startS >= from && r.startS < to);
    const m = rs.length ? mean(rs.map((r) => r.lengthS)) : null;
    rows.push({ target, expected: `${lo / M}–${hi / M} min mean`, value: m === null ? 'no rounds' : `${(m / M).toFixed(1)} min over ${rs.length}`, pass: m !== null && m >= lo && m <= hi });
  }

  const early = maxGap(result, 0, H), late = maxGap(result, H, 24 * H);
  rows.push({ target: 'Choice gap, first hour', expected: '≤ 2 min', value: early === null ? 'n/a' : `${(early / M).toFixed(1)} min`, pass: early !== null && early <= 2 * M });
  rows.push({ target: 'Choice gap, after 1 h', expected: '≤ 5 min', value: late === null ? 'n/a' : `${(late / M).toFixed(1)} min`, pass: late !== null && late <= 5 * M });
  return rows;
}

export function pacingMarkdown(result: CampaignResult, rows: readonly PacingRow[]): string {
  const lines = [
    `# Balance campaign: ${result.policy}, seed ${result.seed}, ${hms(result.ticks / 10)} of sim`, '',
    '| Target | Expected | Bot | Pass |', '|---|---|---|---|',
    ...rows.map((r) => `| ${r.target} | ${r.expected} | ${r.value} | ${r.pass ? 'yes' : 'no'} |`), '',
    `Rounds: ${result.rounds.length}. Purchases: ${result.events.filter((e) => e.kind === 'buy').length}. Research started: ${result.events.filter((e) => e.kind === 'research').length}.`,
    `Final: ${result.final.credits} Credits, ${result.final.data} Data, ${result.final.completed} research done, ${result.final.systems} systems.`, '',
    `GPU route: first card ${hms(result.milestones.firstGpuS)}, gen-2 research started ${hms(result.milestones.gpuGen2StartedS)}, completed ${hms(result.milestones.gpuGen2CompletedS)}.`, '',
    '| Round | Start | Length | Met | Failed | Top cause | Peak I |', '|---:|---|---|---:|---:|---|---:|',
    ...result.rounds.slice(0, 200).map((r) => `| ${r.index} | ${hms(r.startS)} | ${hms(r.lengthS)} | ${r.met} | ${r.failed} | ${r.topCause ?? '-'}${r.topDetail ? ' · ' + r.topDetail : ''} | ${r.peakIntensity.toFixed(1)} |`),
  ];
  return lines.join('\n') + '\n';
}
