import { amount } from '../amount';
import { createInitialState, deserializeSave, quote, serializeSave, systemId, type Quote } from '../index';
import { buyable, candidateRequests } from './bot';
import { evaluateGpu } from '../build/catalog/gpuModels';
import { buildState } from '../testkit/builders';
import { runCampaign } from './campaign';
import { pacingReport } from './pacing';

const q = (over: Partial<Quote>): Quote => ({
  action: { type: 'returnToMarket' }, label: 'x', cost: amount(5), currency: 'credits', affordable: true,
  locked: null, cold: false, downtimeMs: 0, effect: null, workOps: null, ...over,
});

describe('balance bot', () => {
  it('buys only affordable, unlocked Credit quotes, and cold ones only between rounds', () => {
    const running = createInitialState(1);
    const quotes = [
      q({ label: 'ok' }), q({ label: 'poor', affordable: false }), q({ label: 'data', currency: 'data' }),
      q({ label: 'locked', locked: { code: 'research', node: null, text: 'Needs X' } }), q({ label: 'cold', cold: true }),
      q({ label: 'free', cost: amount(0) }),
    ];
    expect(buyable(running, quotes).map((x) => x.label)).toEqual(['ok']);
    const between = { ...running, round: { ...running.round, phase: 'between' as const } };
    expect(buyable(between, quotes).map((x) => x.label)).toEqual(['ok', 'cold']);
  });

  it('plays a deterministic campaign of exactly the requested ticks and returns to market after each round', () => {
    const a = runCampaign({ ticks: 6_000, seed: 7 });
    const b = runCampaign({ ticks: 6_000, seed: 7 });
    expect(a.ticks).toBe(6_000);
    expect({ ...a, state: null }).toEqual({ ...b, state: null });
    const returns = a.events.filter((e) => e.kind === 'return').length;
    expect(returns).toBeGreaterThanOrEqual(a.rounds.length - 1);
    expect(pacingReport(a).map((r) => r.target)).toContain('First round ends');
  });

  it('replays a long run exactly when it is chained through a save (D21 stages)', () => {
    const whole = runCampaign({ ticks: 24_000, seed: 7 });
    const first = runCampaign({ ticks: 9_000, seed: 7 });
    const loaded = deserializeSave(serializeSave(first.state));
    if (!loaded.ok) throw new Error(loaded.error);
    const second = runCampaign({ ticks: 24_000, seed: 7, from: { state: loaded.state, carry: first.carry } });
    expect(serializeSave(second.state)).toBe(serializeSave(whole.state));
    expect(second.milestones).toEqual(whole.milestones);
  });

  it('asks for the newest unlocked GPU generation only once its cheapest model is affordable', () => {
    const at = (credits: string) => candidateRequests(buildState({ sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1, unlocks: 'max', credits }))
      .filter((r) => r.kind === 'gpuModels').map((r) => r.generation);
    expect(at('0')).toEqual([]);
    expect(at('1000000000000000000')).toEqual([9]);
  });

  it('does not scrap a GPU for an identical or weaker model', () => {
    const state = createInitialState(1), before = evaluateGpu('1990', 0);
    const same = q({ gpu: { before, after: before } });
    const weaker = q({ gpu: { before, after: evaluateGpu('1330', 0) } });
    const stronger = q({ gpu: { before, after: evaluateGpu('1990', 1) } });
    expect(buyable(state, [same, weaker, stronger])).toEqual([stronger]);
  });

  it('prepares supply purchases for GPUs that exceed the starter PSU', () => {
    const state = buildState({ sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1,
      unlocks: 'max', round: 'between', credits: '1000000000' });
    const models = quote(state, { kind: 'gpuModels', system: systemId(0), index: null, generation: 1 }).quotes
      .filter((q) => q.gpuPower && q.gpuPower.after.headroomW < 0);
    expect(buyable(state, models)).toHaveLength(0);
    expect(candidateRequests(state).some((r) => r.kind === 'part' && r.part.slot.kind === 'psu')).toBe(true);
  });

  it('keeps PSU replacements monotonic in a legal seed-42 campaign', () => {
    const campaign = runCampaign({ seed: 42, ticks: 288_000 });
    expect(campaign.events.filter(({ psu }) => psu?.replacement
      && (psu.capacityAfterW < psu.capacityBeforeW || psu.lossAfter > psu.lossBefore))).toEqual([]);
  }, 400_000);
});
