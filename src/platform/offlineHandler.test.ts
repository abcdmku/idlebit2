import { describe, expect, it } from 'vitest';
import { createOfflineMessageHandler, OFFLINE_CHANNEL, type OfflineEngine, type OfflineResponse } from './offlineHandler';

interface FakeState { readonly carry: number; readonly ticks: number; readonly bumps: number }
const fakeEngine: OfflineEngine<FakeState, number, 'bump'> = {
  advance(state, elapsedMs) {
    const carry = state.carry + elapsedMs, ticks = Math.floor(carry / 100);
    return { state: { ...state, carry: carry % 100, ticks: state.ticks + ticks }, report: ticks };
  },
  own: state => ({ ...state }),
  merge: (total, next) => (total ?? 0) + next,
  apply: state => ({ ...state, bumps: state.bumps + 1 }),
};
const start: FakeState = { carry: 30, ticks: 0, bumps: 0 };

function session(sliceMs = 10_000) {
  const handle = createOfflineMessageHandler(fakeEngine, sliceMs);
  let id = 0;
  return (elapsedMs: number, opts: { state?: unknown; actions?: 'bump'[]; returnState?: boolean } = {}) => {
    const out: OfflineResponse<FakeState, number>[] = [];
    handle({ channel: OFFLINE_CHANNEL, kind: 'advance', id: ++id, state: opts.state === undefined ? null : opts.state,
      actions: opts.actions ?? [], elapsedMs, returnState: opts.returnState ?? true }, r => out.push(r));
    return out;
  };
}

describe('offline handler', () => {
  it('advances in slices, posts progress between them and one merged result', () => {
    const out = session()(25_050, { state: { ...start, carry: 0 } });
    expect(out.map(r => r.kind)).toEqual(['progress', 'progress', 'result']);
    expect(out.slice(0, 2).map(r => r.kind === 'progress' && r.simulatedMs)).toEqual([10_000, 20_000]);
    expect(out[2]).toMatchObject({ kind: 'result', state: { carry: 50, ticks: 250, bumps: 0 }, report: 250 });
  });

  it('holds the state across chunks and applies actions at the boundary', () => {
    const run = session();
    expect(run(60_000, { state: start, returnState: false }).at(-1)).toMatchObject({ kind: 'result', state: null, report: 600 });
    expect(run(60_000, { actions: ['bump', 'bump'], returnState: false }).at(-1)).toMatchObject({ state: null, report: 600 });
    expect(run(1_234).at(-1)).toMatchObject({ state: { carry: 64, ticks: 1212, bumps: 2 }, report: 12 });
  });

  it('matches one unsliced advance', () => {
    expect(session(7_000)(61_234, { state: start }).at(-1)).toEqual(session(61_234)(61_234, { state: start }).at(-1));
  });

  it('errors without a session and ignores malformed messages', () => {
    expect(session()(1_000)[0]).toMatchObject({ kind: 'error', message: expect.stringContaining('No offline session') });
    const out: unknown[] = [], handle = createOfflineMessageHandler(fakeEngine);
    handle({ channel: 'other', kind: 'advance', id: 1, state: start, actions: [], elapsedMs: 1, returnState: true }, r => out.push(r));
    handle({ channel: OFFLINE_CHANNEL, kind: 'advance', id: 1, state: start, actions: [], elapsedMs: 1.5, returnState: true }, r => out.push(r));
    expect(out).toEqual([]);
  });
});
