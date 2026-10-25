import { expect, it } from 'vitest';
import { advanceGame } from '../core/advance';
import { G } from '../core/buffers';
import { FLEETS } from '../testkit/fleets';

it.each(['rackFull', 'fleetMax'] as const)('%s stays delta-invariant after a minute of warm-up', name => {
  const warm = advanceGame(FLEETS[name](), 60_000).state;
  const whole = advanceGame(warm, 60_000);
  const first = advanceGame(warm, 30_000);
  const second = advanceGame(first.state, 30_000);

  expect(whole.report.ticks).toBe(600);
  expect(whole.state.clock.tick).toBe(warm.clock.tick + 600);
  expect(whole.report.activeTicks).toBeGreaterThan(0);
  expect(whole.state.hot.g[G.rngDraws]).toBeGreaterThan(warm.hot.g[G.rngDraws]);
  expect(second.state).toEqual(whole.state);
  expect(first.report.met + second.report.met).toBe(whole.report.met);
  for (const cause of Object.keys(whole.report.failedByCause) as (keyof typeof whole.report.failedByCause)[]) {
    expect(first.report.failedByCause[cause] + second.report.failedByCause[cause]).toBe(whole.report.failedByCause[cause]);
  }
}, 120_000);
