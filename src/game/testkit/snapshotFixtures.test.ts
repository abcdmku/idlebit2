import { deriveRenderSnapshot } from '../view/snapshot';
import { createInitialState } from '../core/state';
import { advanceGame } from '../core/advance';
import { roomId, systemId } from '../types/ids';
import { LEVEL_FIXTURES } from './snapshotFixtures';
import { FLEETS } from './fleets';

// Top-hardware fixtures do 600 warm-up ticks of real work under D10 (the fleet pulls continuously).
vi.setConfig({ testTimeout: 60_000 });

describe('snapshot contract', () => {
  it('has a fixture for every level, tagged with its level', () => {
    expect(Object.keys(LEVEL_FIXTURES)).toEqual(['chip', 'system', 'rack', 'room', 'global']);
    for (const [level, fixture] of Object.entries(LEVEL_FIXTURES)) expect(fixture.level).toBe(level);
    expect(LEVEL_FIXTURES.rack.servers).toHaveLength(12);
    expect(LEVEL_FIXTURES.global.sites).toHaveLength(8);
  });

  it('derives a skeleton snapshot with HUD and chip from the boot state', () => {
    const state = advanceGame(createInitialState(42), 1_250).state;
    const snap = deriveRenderSnapshot(state, { focus: { level: 'chip', id: systemId(0) }, partner: null });
    expect(snap.tick).toBe(12);
    expect(snap.simTimeMs).toBe(1_250);
    expect(snap.hud).toMatchObject({ credits: '1', data: '0', roundState: 'running', roundIndex: 1, roundElapsedMs: 1_200 });
    expect(snap.hud.sla.percent).toBe(100);
    expect(snap.focus.level).toBe('chip');
    expect(snap.focus.level === 'chip' && snap.focus.cores).toHaveLength(1);
    expect(snap.unlocked.chip).toBe(true);
  });

  it('derives a snapshot for any scope on the largest fleet', () => {
    const snap = deriveRenderSnapshot(FLEETS.fleetMax(), { focus: { level: 'global', id: 0 }, partner: { level: 'room', id: roomId(0) } });
    expect(snap.partner).not.toBeNull();
  });
});
