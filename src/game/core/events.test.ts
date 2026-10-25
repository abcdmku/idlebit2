import { createInitialState } from './state';
import { eventPhase, roundDetails, tallyFailed, tallyMet } from './events';
import { FAIL_DETAILS } from '../types/events';
import { openWorld } from './world';
import { FLEETS } from '../testkit/fleets';

describe('events phase', () => {
  it('emits one event per family and outcome, located when one system earned it', () => {
    const w = openWorld(FLEETS.rackFull());
    tallyMet(w, 2, 3, 5, 3);
    tallyMet(w, 2, 1, 5, 1);
    tallyMet(w, 4, 1, 0, 1);
    tallyMet(w, 4, 2, 1, 2);
    tallyFailed(w, 2, 0, 7, 7);
    eventPhase(w);
    expect(w.events.entries.map(({ seq: _s, tick: _t, ...e }) => e)).toEqual([
      { kind: 'met', family: 2, count: 4, system: 5, rack: 0, room: 0, site: 0 },
      { kind: 'failed', family: 2, count: 7, cause: 'timeout', detail: null },
      { kind: 'met', family: 4, count: 3, system: null, rack: 0, room: 0, site: 0 },
    ]);
    expect(w.report.met).toBe(7);
    expect(w.report.failed[0]).toBe(7);
    expect([w.hot.fam.metTick[2], w.hot.fam.metSys[2], w.hot.fam.failTick[2 * 6]]).toEqual([0, -1, 0]);
  });

  it('keeps at most 256 events with increasing seq', () => {
    const w = openWorld(createInitialState(42));
    for (let i = 0; i < 300; i += 1) { tallyMet(w, 0, 1, 0, 1); eventPhase(w); }
    expect(w.events.entries).toHaveLength(256);
    expect(w.events.entries[0]!.seq).toBe(44);
    expect(w.events.nextSeq).toBe(300);
  });

  it('names the last detail per cause in the event and counts details for the round', () => {
    const w = openWorld(createInitialState(42));
    const ram = FAIL_DETAILS.indexOf('ram'), port = FAIL_DETAILS.indexOf('link'), cache = FAIL_DETAILS.indexOf('cache');
    tallyFailed(w, 1, 1, 2, 2, cache);
    tallyFailed(w, 1, 1, 3, 3, ram);
    tallyFailed(w, 1, 0, 1, 1, port);
    eventPhase(w);
    expect(w.events.entries.map((e) => e.kind === 'failed' && [e.cause, e.detail])).toEqual([['timeout', 'link'], ['cantRun', 'ram']]);
    tallyFailed(w, 3, 1, 4, 4, ram);
    const { failDetail, details } = roundDetails(w.hot.detailRound);
    expect(failDetail).toMatchObject({ timeout: 'link', cantRun: 'ram', heat: null });
    expect(details).toEqual([
      { cause: 'cantRun', detail: 'ram', count: 7 },
      { cause: 'cantRun', detail: 'cache', count: 2 },
      { cause: 'timeout', detail: 'link', count: 1 },
    ]);
  });
});
