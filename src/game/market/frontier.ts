import type { World } from '../core/world';
import { runwayMark } from '../build/research/runway';
import type { ReportFrontier } from '../types/frontier';
import { familyId, type FamilyId } from '../types/ids';
import { FAMILIES } from './families';

/**
 * The frontier (D40): how far the player has ever got. Rounds restart at I 0 (D30); the report compares
 * each round's reach with the best before it and lists families taken for the first time. Progress shows
 * only at round end (user, 26 Oct): nothing here reaches the screen during a round.
 */

/** A task of `family` was taken: the first one ever joins the frontier. */
export function noteTaken(w: World, family: number): void {
  const f = w.round.frontier;
  if (f.taken.length >= FAMILIES.length || f.taken.includes(family as FamilyId)) return;
  w.round.frontier = { ...f, taken: [...f.taken, familyId(family)] };
}

const runwayNow = (w: World) => runwayMark(w.research, Number(w.ledger.data), Number(w.ledger.credits), w.roundRewards.claimed);

/** At Return: the baseline this round's report compares against. */
export function openFrontier(w: World): void {
  w.round.frontier = { ...w.round.frontier, takenAtStart: w.round.frontier.taken.length };
  w.round.runwayStart = runwayNow(w);
}

/** At round end: the report's frontier, then a new best if this round set one. */
export function closeFrontier(w: World, met: number): ReportFrontier {
  const r = w.round, f = r.frontier;
  const out: ReportFrontier = {
    priorBest: f.bestI, priorBestRound: f.bestRound, priorBestMet: f.bestMet, firstTaken: f.taken.slice(f.takenAtStart),
    runwayStart: r.runwayStart, runwayEnd: runwayNow(w),
  };
  r.frontier = {
    ...f,
    ...(r.peakIntensity > f.bestI ? { bestI: r.peakIntensity, bestRound: r.index } : {}),
    ...(met > f.bestMet ? { bestMet: met, bestMetRound: r.index } : {}),
  };
  return out;
}
