import { advanceGameOwned, createInitialState, researchId, TICK_MS, type FailCause, type GameState, type RoundReport } from '../index';
import { decide, type BotEvent } from './bot';
import { POLICIES, type PolicyId } from './policies';

/**
 * The balance campaign (architecture §6, §7.3; program §14, D19, D21). The bot plays from a fresh
 * game, or from a saved stage, and the runner records milestones and every round. Pure and
 * deterministic: the caller (scripts/balance, the perf bench) owns wall-clock timing and saves.
 */

export const CAMPAIGN_TICKS = 864_000;
const DATA_CENTER = researchId('dataCenter');
const REGIONS_NODE = researchId('regions');

/** Seconds of sim time; null = not reached. */
export interface Milestones {
  readonly firstPurchaseS: number | null;
  readonly firstDataS: number | null;
  readonly firstRoundEndS: number | null;
  readonly systemS: number | null;
  readonly rackS: number | null;
  readonly roomS: number | null;
  readonly dataCenterS: number | null;
  readonly regionsS: number | null;
  readonly firstGpuS: number | null;
  readonly gpuGen2StartedS: number | null;
  readonly gpuGen2CompletedS: number | null;
}
type MutableMilestones = { -readonly [K in keyof Milestones]: number | null };

export const NO_MILESTONES: Milestones = {
  firstPurchaseS: null, firstDataS: null, firstRoundEndS: null, systemS: null, rackS: null, roomS: null, dataCenterS: null, regionsS: null,
  firstGpuS: null, gpuGen2StartedS: null, gpuGen2CompletedS: null,
};

/** What a stage hands the next one besides the saved game (D21 chaining). Small and bounded. */
export interface CampaignCarry {
  readonly milestones: Milestones;
  /** The bot's memory: research started since the last milestone (its off-path budget). */
  readonly research: readonly BotEvent[];
  readonly wait: number;
  /** Ticks left before the next decision, so a chained run replays the unchained one exactly. */
  readonly left: number;
  readonly decisions: number;
}

export interface CampaignOptions {
  /** Absolute tick to stop at. Defaults to 24 h after the start. */
  readonly ticks?: number;
  readonly seed?: number;
  readonly policy?: PolicyId;
  /** Continue a saved stage instead of booting a fresh game. */
  readonly from?: { readonly state: GameState; readonly carry: CampaignCarry };
  /** Wall clock in ms, for the speed report. The campaign itself stays pure without it. */
  readonly clock?: () => number;
  /** Stop early once this holds after a step (probes that inspect a game at a milestone). */
  readonly until?: (state: GameState) => boolean;
}

/**
 * D21 decision cadence. A decision that acts brings the next one back to the policy cadence; an idle
 * one doubles the wait, up to a cap that grows with game time (seconds early, minutes late).
 * While a round runs, the sim advances in pieces of at most RUNNING_PIECE_TICKS, so the bot sees a
 * round end and returns to market as promptly as a player would.
 */
const capTicks = (tick: number, base: number) => Math.max(base, Math.min(3_000, Math.floor(tick / 200)));
const RUNNING_PIECE_TICKS = 300;

export interface RoundSummary {
  readonly index: number;
  readonly startS: number;
  readonly lengthS: number;
  readonly met: number;
  readonly failed: number;
  readonly topCause: FailCause | null;
  readonly topDetail: string | null;
  readonly peakIntensity: number;
  readonly gross: string;
  readonly energy: string;
  readonly data: string;
  /** Systems and racks owned when the round ended; tasks failed late; share of delivered work spilled to disk. */
  readonly systems: number;
  readonly racks: number;
  readonly late: number;
  readonly diskShare: number;
}

export interface CampaignResult {
  /** Tick at the end, and at the start of this stage. */
  readonly ticks: number;
  readonly startTick: number;
  readonly seed: number;
  readonly policy: PolicyId;
  readonly milestones: Milestones;
  /** Rounds and bot events of this stage only. */
  readonly rounds: readonly RoundSummary[];
  readonly events: readonly BotEvent[];
  readonly final: { readonly credits: string; readonly data: string; readonly completed: number; readonly systems: number };
  /** Wall ms from the stage start to each milestone reached in it (only with options.clock). */
  readonly wallMs: Partial<Record<keyof Milestones | 'end', number>>;
  readonly decisions: number;
  readonly carry: CampaignCarry;
  /** The final state, for probes and the next stage. */
  readonly state: GameState;
}

const seconds = (tick: number) => (tick * TICK_MS) / 1000;
const MILESTONE_RESEARCH = new Set(['systemBoard', 'fabKhz', 'rack', 'fabMhz', 'room', 'fabGhz', 'dataCenter', 'regions', 'intercontinental']);

function summarize(r: RoundReport, state: GameState): RoundSummary {
  const causes = Object.entries(r.failedByCause) as [FailCause, number][];
  const failed = causes.reduce((sum, [, n]) => sum + n, 0);
  const top = causes.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0];
  const topCause = top ? top[0] : null;
  return {
    index: r.index, startS: seconds(r.startTick), lengthS: seconds(r.durationTicks),
    met: r.met, failed, topCause, topDetail: topCause ? r.failDetail[topCause] : null,
    peakIntensity: r.peakIntensity, gross: r.gross, energy: r.energy, data: r.data,
    systems: state.build.systems.filter((x) => x !== null).length, racks: state.build.racks.filter((x) => x?.opened).length,
    late: r.failedByCause.late, diskShare: r.deliveredWork > 0 ? r.spill.diskWork / r.deliveredWork : 0,
  };
}

/** Plays the campaign, or one stage of it. */
export function runCampaign(options: CampaignOptions = {}): CampaignResult {
  const seed = options.seed ?? 42;
  const policy = POLICIES[options.policy ?? 'active'];
  let state: GameState = options.from?.state ?? createInitialState(seed);
  const startTick = state.clock.tick;
  const ticks = options.ticks ?? startTick + CAMPAIGN_TICKS;
  const carry = options.from?.carry;
  // The bot reads its log only for research since the last milestone; a stage starts from that memory.
  const memory = carry?.research.length ?? 0;
  const events: BotEvent[] = [...(carry?.research ?? [])];
  const rounds: RoundSummary[] = [];
  const at: MutableMilestones = { ...(carry?.milestones ?? NO_MILESTONES) };
  const wallMs: Partial<Record<keyof Milestones | 'end', number>> = {};
  const t0 = options.clock?.() ?? 0;
  const mark = (key: keyof Milestones, tick: number, reached: boolean) => {
    if (!reached || at[key] !== null) return;
    at[key] = seconds(tick);
    if (options.clock) wallMs[key] = options.clock() - t0;
  };

  let wait = carry?.wait ?? policy.cadenceTicks, left = carry?.left ?? 0, decisions = carry?.decisions ?? 0;
  while (state.clock.tick < ticks) {
    if (left === 0) {
      const before = events.length;
      state = decide(state, policy, events);
      decisions += 1;
      const fresh = events.slice(before);
      if (fresh.some((e) => e.kind === 'buy')) mark('firstPurchaseS', state.clock.tick, true);
      mark('firstGpuS', state.clock.tick, state.build.systems.some((s) => s?.spec.accels.some((a) => a.kind === 'gpu')));
      mark('gpuGen2StartedS', state.clock.tick, fresh.some((e) => e.kind === 'research' && e.label === 'gpuGen2'));
      wait = fresh.length > 0 ? policy.cadenceTicks : Math.min(capTicks(state.clock.tick, policy.cadenceTicks), wait * 2);
      left = wait;
    }
    while (left > 0 && state.clock.tick < ticks) {
      const piece = Math.min(left, ticks - state.clock.tick, state.round.phase === 'running' ? RUNNING_PIECE_TICKS : Infinity);
      const { state: next, report } = advanceGameOwned(state, piece * TICK_MS);
      state = next;
      left -= piece;
      for (const r of report.roundsEnded) {
        rounds.push(summarize(r, state));
        mark('firstRoundEndS', r.startTick + r.durationTicks, true);
      }
      if (report.roundsEnded.length > 0 && state.round.phase !== 'running') { wait = policy.cadenceTicks; left = 0; }
    }
    // Milestones are read at decision points only, so a stage boundary never moves one.
    if (left > 0) break;
    const now = state.clock.tick;
    const levels = state.research.unlocks.levels;
    const done = state.research.completed;
    mark('firstDataS', now, state.wallet.data !== '0');
    mark('systemS', now, levels.system);
    mark('rackS', now, levels.rack);
    mark('roomS', now, levels.room);
    mark('dataCenterS', now, done.includes(DATA_CENTER));
    mark('regionsS', now, done.includes(REGIONS_NODE));
    mark('gpuGen2CompletedS', now, done.includes(researchId('gpuGen2')));
    if (options.until?.(state)) break;
  }
  if (options.clock) wallMs.end = options.clock() - t0;
  const lastMilestone = events.reduce((last, e, i) => (e.kind === 'research' && MILESTONE_RESEARCH.has(e.label) ? i : last), -1);
  return {
    ticks: state.clock.tick, startTick, seed, policy: policy.id, milestones: at, rounds, events: events.slice(memory), wallMs, decisions, state,
    carry: { milestones: at, research: events.slice(lastMilestone + 1).filter((e) => e.kind === 'research'), wait, left, decisions },
    final: {
      credits: state.wallet.credits, data: state.wallet.data, completed: state.research.completed.length,
      systems: state.build.systems.filter((s) => s !== null).length,
    },
  };
}
