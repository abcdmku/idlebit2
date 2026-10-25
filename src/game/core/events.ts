import { FAIL_CAUSES, FAIL_DETAILS, NO_DETAIL, type FailCause, type FailDetail, type GameEventBody } from '../types/events';
import type { RoundReport } from '../types/report';
import { familyId, rackId, roomId, siteId, systemId } from '../types/ids';
import { G } from './buffers';
import { EVENT_RING_SIZE, MAX_FAMILIES } from './constants';
import type { World } from './world';

const CAUSES = FAIL_CAUSES.length;

/** Appends a cosmetic event stamped with the current tick. The ring is trimmed in eventPhase. */
export function pushEvent(w: World, body: GameEventBody): void {
  w.events.entries.push({ ...body, seq: w.events.nextSeq, tick: w.tick });
  w.events.nextSeq += 1;
}

const fold = (column: Int32Array, family: number, unit: number) => {
  const at = column[family]!;
  column[family] = at === -1 || at === unit ? unit : -2;
};
const located = (at: number) => (at >= 0 ? at : null);

/** Records `count` met tasks of `family` (`work` ops in total) completed on `system` this tick (exec calls this on completion). */
export function tallyMet(w: World, family: number, count: number, system: number, work: number): void {
  const fam = w.hot.fam;
  const c = w.compiled.sys;
  fam.metTick[family] = fam.metTick[family]! + count;
  fam.metWorkRound[family] = fam.metWorkRound[family]! + work;
  w.hot.g[G.metWorkTick] = w.hot.g[G.metWorkTick]! + work;
  fold(fam.metSys, family, system);
  fold(fam.metRack, family, c.rack[system]!);
  fold(fam.metRoom, family, c.room[system]!);
  fold(fam.metSite, family, c.site[system]!);
}

/**
 * Records `count` failed tasks of `family` (`work` ops: their full work, never the unfinished rest)
 * with cause index `cause` and detail index `detail` (FAIL_DETAILS, NO_DETAIL for none) this tick.
 * The last detail written in a tick wins the event.
 */
export function tallyFailed(w: World, family: number, cause: number, count: number, work: number, detail: number = NO_DETAIL): void {
  const fam = w.hot.fam;
  const i = family * CAUSES + cause;
  fam.failTick[i] = fam.failTick[i]! + count;
  fam.failedWorkRound[family] = fam.failedWorkRound[family]! + work;
  w.hot.g[G.failWorkTick] = w.hot.g[G.failWorkTick]! + work;
  if (detail === NO_DETAIL) return;
  fam.failDetail[i] = detail;
  const d = cause * FAIL_DETAILS.length + detail;
  w.hot.detailRound[d] = w.hot.detailRound[d]! + count;
}

/** The round report's detail fields from hot.detailRound (R6, R18): top 6 pairs and the top word per cause. */
export function roundDetails(detailRound: Float64Array): Pick<RoundReport, 'failDetail' | 'details'> {
  const pairs: { cause: FailCause; detail: FailDetail; count: number }[] = [];
  const failDetail = Object.fromEntries(FAIL_CAUSES.map((c) => [c, null])) as Record<FailCause, FailDetail | null>;
  FAIL_CAUSES.forEach((cause, c) => {
    let best = 0;
    FAIL_DETAILS.forEach((detail, d) => {
      const count = detailRound[c * FAIL_DETAILS.length + d]!;
      if (count <= 0) return;
      pairs.push({ cause, detail, count });
      if (count > best) { best = count; failDetail[cause] = detail; }
    });
  });
  pairs.sort((a, b) => b.count - a.count);
  return { failDetail, details: pairs.slice(0, 6) };
}

/**
 * Events phase (tick step 13): turns this tick's per-family met/failed tallies into one event per
 * (family, outcome), adds them to the advance report, clears the tallies and trims the ring.
 * SLA counters (G.met, G.failed) are the market's: it counts at the moment of the outcome.
 */
export function eventPhase(w: World): void {
  const { metTick, metSys, metRack, metRoom, metSite, failTick, failDetail } = w.hot.fam;
  const report = w.report;
  for (let f = 0; f < MAX_FAMILIES; f += 1) {
    const met = metTick[f]!;
    if (met !== 0) {
      const sys = located(metSys[f]!), rack = located(metRack[f]!), room = located(metRoom[f]!), site = located(metSite[f]!);
      pushEvent(w, {
        kind: 'met', family: familyId(f), count: met,
        system: sys === null ? null : systemId(sys), rack: rack === null ? null : rackId(rack),
        room: room === null ? null : roomId(room), site: site === null ? null : siteId(site),
      });
      report.met += met;
      metTick[f] = 0;
      metSys[f] = -1; metRack[f] = -1; metRoom[f] = -1; metSite[f] = -1;
    }
    for (let c = 0; c < CAUSES; c += 1) {
      const i = f * CAUSES + c;
      const failed = failTick[i]!;
      if (failed === 0) continue;
      const detail = failDetail[i]!;
      pushEvent(w, { kind: 'failed', family: familyId(f), count: failed, cause: FAIL_CAUSES[c]!, detail: FAIL_DETAILS[detail] ?? null });
      report.failed[c] = report.failed[c]! + failed;
      failTick[i] = 0;
      failDetail[i] = NO_DETAIL;
    }
  }
  const entries = w.events.entries;
  if (entries.length > EVENT_RING_SIZE) entries.splice(0, entries.length - EVENT_RING_SIZE);
}
