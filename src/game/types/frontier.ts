import type { Amount } from '../amount';
import type { FamilyId, ResearchId } from './ids';

/**
 * How far the player has ever got (D40). Every round restarts at I 0 (D30), so totals alone can't
 * say "farther". Saved; updated at each round end and at each first take of a family.
 */
export interface FrontierState {
  /** Best peak I of any ended round, 0 before the first end, and the round it happened in (0 = none). */
  readonly bestI: number;
  readonly bestRound: number;
  /** Most tasks completed in one round, and that round (0 = none): the report's tier ladder. */
  readonly bestMet: number;
  readonly bestMetRound: number;
  /** Every family ever taken, in first-taken order. */
  readonly taken: readonly FamilyId[];
  /** How many of `taken` were taken before the running round started. */
  readonly takenAtStart: number;
}

/** Progress toward the next milestone node: funds while saving, work once its project is paid. */
export interface RunwayMark {
  readonly node: ResearchId;
  readonly phase: 'saving' | 'research';
  /** 0–1: the binding currency's share of its cost while saving, else the project's work share. */
  readonly progress: number;
}

/** Frozen into each report (D40): the frontier before the round and the runway at its start and end. */
export interface ReportFrontier {
  /** Best peak I before this round (0 on the first). */
  readonly priorBest: number;
  readonly priorBestRound: number;
  /** Most tasks completed in one round before this one (0 on the first). */
  readonly priorBestMet: number;
  /** Families taken for the first time in this round. */
  readonly firstTaken: readonly FamilyId[];
  readonly runwayStart: RunwayMark | null;
  readonly runwayEnd: RunwayMark | null;
}

/** The report's reach history, memoized on the reports. */
export interface FrontierView {
  readonly bestI: number;
  readonly bestRound: number;
  /** Peak I of each kept report, oldest first, with its round index. */
  readonly reaches: readonly { readonly round: number; readonly peak: number }[];
}

/** The next milestone and what it costs, against the wallet and the last three reports (D40). */
export interface RunwayView {
  /** CPU frequency tiers inside the Research era ribbon. */
  readonly cpuTiers: readonly { readonly tier: number; readonly name: string; readonly done: boolean }[];
  /** The research tree's milestone nodes in era order (`MILESTONE_IDS`), with their tree name and short effect line. */
  readonly eras: readonly { readonly node: ResearchId; readonly name: string; readonly summary: string; readonly done: boolean }[];
  /** The next milestone not done, or null after the last. */
  readonly next: {
    readonly node: ResearchId;
    readonly name: string;
    readonly data: number;
    readonly credits: Amount;
    readonly work: number;
    /** Prerequisites still missing. */
    readonly needs: readonly { readonly node: ResearchId; readonly name: string }[];
    readonly mark: RunwayMark;
    /** Paid and queued or running: the work done so far. */
    readonly paid: boolean;
    readonly progressOps: number;
  } | null;
  /** The pace at the average of the last three reports; null before the first report or after the last milestone. */
  readonly pace: RunwayPace | null;
}

export interface RunwayPace {
  /** Reports averaged (1–3), their mean Data earned, net Credits and duration. */
  readonly samples: number;
  readonly data: number;
  readonly net: number;
  readonly ms: number;
  /** The currency that takes longer to cover; null when both are covered. */
  readonly binding: 'data' | 'credits' | null;
  /** Whole rounds until both are covered at that pace, 0 when covered, null when the binding one isn't growing. */
  readonly rounds: number | null;
  /** The last report's progress gain toward this node while saving, or null. */
  readonly lastGain: number | null;
}
