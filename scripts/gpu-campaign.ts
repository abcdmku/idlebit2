import { mkdirSync, writeFileSync } from 'node:fs';
import { advanceGame, applyAction, createInitialState, quote, selectResearchTree, TICK_MS, type GameState } from '../src/game';
import { decide, candidateRequests, buyable, type BotEvent } from '../src/game/probes/bot';
import { POLICIES } from '../src/game/probes/policies';
import { FAIL_CAUSES } from '../src/game/types/events';
import { RESEARCH } from '../src/game/build/research/tree';

// Observes the existing policy. No wallet, unlock, hardware or rate edits.
const dir = 'artifacts/gpu/balance/campaign';
mkdirSync(dir, { recursive: true });
const started = performance.now();
const deadline = started + 180_000;
const save = (name: string, value: unknown) => writeFileSync(`${dir}/${name}.json`, JSON.stringify(value, null, 2));
const max = (a: ArrayLike<number>) => Array.from(a).reduce((x, y) => Math.max(x, y), 0);
const min = (a: ArrayLike<number>) => Array.from(a).reduce((x, y) => Math.min(x, y), Infinity);
const variants = (s: GameState) => s.build.systems.filter((x) => x !== null).map((x) => ({ id: x.id, spec: x.spec }));
function blocked(s: GameState) {
  const qs = candidateRequests(s).flatMap((r) => quote(s, r).quotes);
  return { activeResearch: s.research.active, progress: s.research.activeProgress, stoppedInsolvent: s.research.stoppedInsolvent,
    availableResearch: selectResearchTree(s).nodes.filter((n) => n.state === 'available').map((n) => ({ id: n.id,
      quote: quote(s, { kind: 'research', project: n.id }).quotes[0] })),
    buyable: buyable(s, qs).map((q) => ({ label: q.label, cost: q.cost })),
    gpuQuotes: qs.filter((q) => q.gpu).map((q) => ({ label: q.label, cost: q.cost, affordable: q.affordable,
      locked: q.locked, cold: q.cold, fitsBotFilter: buyable(s, [q]).length === 1 })),
  };
}
const diagnostic = process.argv.includes('--diagnostics-only');
const seed42Only = process.argv.includes('--seed-42');
const campaignTicks = diagnostic ? 144_000 : 288_000;
for (const seed of diagnostic || seed42Only ? [42] : [42, 7]) {
  let s = createInitialState(seed);
  const events: BotEvent[] = [], rounds: unknown[] = [], research: unknown[] = [], gpuChanges: unknown[] = [];
  const marks: Record<string, number | null> = { firstGpuS: null, gpuGen2StartedS: null, gpuGen2CompletedS: null };
  let researchWindowEnergy = 0n, activeTicks = 0, checks = 0, feeErrors = 0, negativeWalletDecisions = 0;
  const failures = Object.fromEntries(FAIL_CAUSES.map((c) => [c, 0]));
  const peaks = { psuUsage: 0, pduUsage: 0, rackTempF: 70, roomTempF: 70, drawW: 0, minCredits: '0' };
  let previousGpu = '[]';
  let reachable = false;
  const pausedDecisions: unknown[] = [];
  const wallStart = performance.now();
  let hourly = 36_000, checkpoint = 144_000;
  while (s.clock.tick < campaignTicks && performance.now() < deadline) {
    const old = s, first = events.length;
    if (diagnostic && s.round.phase !== 'running' && s.research.completed.some((id) => id === 'gpuGen1')) {
      const qs = candidateRequests(s).flatMap((r) => quote(s, r).quotes);
      const gpu = buyable(s, qs).filter((q) => q.gpu).sort((a, b) => Number(a.cost) - Number(b.cost))[0];
      let branch = s, option = gpu;
      const preparation: unknown[] = [];
      if (!reachable && !option) {
        const psu = qs.find((q) => q.action.type === 'replacePart' && q.action.part.slot.kind === 'psu'
          && q.action.generation === 1 && q.affordable && !q.locked);
        if (psu) {
          const r = applyAction(branch, psu.action);
          if (r.ok) { branch = r.state; preparation.push({ label: psu.label, cost: psu.cost, action: psu.action }); }
        }
        for (let i = 0; i < 12; i++) {
          const options = candidateRequests(branch).flatMap((r) => quote(branch, r).quotes);
          option = buyable(branch, options).filter((q) => q.gpu).sort((a, b) => Number(a.cost) - Number(b.cost))[0];
          if (option) break;
          const up = options.find((q) => q.action.type === 'upgradePart' && q.action.part.slot.kind === 'psu' && q.affordable && !q.locked);
          if (!up) break;
          const result = applyAction(branch, up.action); if (!result.ok) break;
          branch = result.state; preparation.push({ label: up.label, cost: up.cost, action: up.action });
        }
      }
      if (option && !reachable) {
        const purchased = applyAction(branch, option.action);
        if (!purchased.ok) throw new Error('Reachable quote rejected');
        const returned = applyAction(purchased.state, { type: 'returnToMarket' });
        if (!returned.ok) throw new Error('Counterfactual round rejected');
        const advanced = advanceGame(returned.state, 60_000);
        const c = purchased.state.compiled.sys;
        save('legal-gpu-counterfactual', { evidence: 'Legal existing-bot prefix followed by quoted PSU preparation, GPU purchase and return, then 60 seconds of real work. Original bot continues unchanged.',
          seed, timeS: s.clock.tick / 10, creditsBefore: s.wallet.credits, preparation, quote: option, creditsAfter: purchased.state.wallet.credits,
          system: purchased.state.build.systems[0], psuCapW: c.psuCapW[0],
          fullSystemW: c.coreIdleW[0]! + c.coreLoadW[0]! + c.clockIdleW[0]! + [0, 1, 2, 3].reduce((n, r) => n + c.idleW[r]! + c.loadW[r]!, 0),
          minuteReport: advanced.report, minuteWallet: advanced.state.wallet, minutePsuUsage: advanced.state.hot.sys.psuUsage[0],
          minuteRound: advanced.state.round, minuteGpuTaskSecondsLastTick: advanced.state.hot.sys.accelTaskS[0],
        });
        reachable = true;
      }
      pausedDecisions.push({ timeS: s.clock.tick / 10, credits: s.wallet.credits,
        beforePsu: s.build.systems[0]!.spec.psu, firstAffordableFitGpu: gpu?.label ?? null });
    }
    s = decide(s, POLICIES.active, events);
    const fresh = events.slice(first);
    if (diagnostic && old.round.phase !== 'running' && old.research.completed.some((id) => id === 'gpuGen1')) {
      Object.assign(pausedDecisions.at(-1) as object, { afterPsu: s.build.systems[0]!.spec.psu, actions: fresh });
    }
    for (const e of fresh.filter((e) => e.kind === 'research')) {
      const expectedFee = /^gpuGen[2-9]$/.test(e.label) ? (64_000_000n * 10n ** BigInt(Number(e.label.slice(-1)) - 1)).toString() : '0';
      if ((e.creditCost ?? '0') !== expectedFee) feeErrors++;
      checks++;
      research.push({ ...e, timeS: e.tick / 10, expectedFee, creditsBeforeDecision: old.wallet.credits,
        creditsAfterDecision: s.wallet.credits, dataBeforeDecision: old.wallet.data, dataAfterDecision: s.wallet.data });
      if (e.label === 'gpuGen2' && marks.gpuGen2StartedS === null) marks.gpuGen2StartedS = e.tick / 10;
    }
    const cards = s.build.systems.flatMap((sys) => sys?.spec.accels.map((a, slot) => ({ system: sys.id, slot, ...a })) ?? []);
    const fingerprint = JSON.stringify(cards);
    if (fingerprint !== previousGpu) {
      gpuChanges.push({ timeS: s.clock.tick / 10, cards,
        systems: cards.map((a) => ({ id: a.system, psu: s.build.systems[a.system]!.spec.psu, psuCapW: s.compiled.sys.psuCapW[a.system] })) });
      previousGpu = fingerprint;
      if (marks.firstGpuS === null && cards.some((a) => a.kind === 'gpu')) marks.firstGpuS = s.clock.tick / 10;
    }
    const active = s.research.active;
    const next = advanceGame(s, 20 * TICK_MS);
    if (active) researchWindowEnergy += BigInt(next.report.energy);
    activeTicks += next.report.activeTicks;
    for (const c of FAIL_CAUSES) failures[c] += next.report.failedByCause[c];
    for (const r of next.report.roundsEnded) {
      const failed = Object.values(r.failedByCause).reduce((a, b) => a + b, 0);
      rounds.push({ ...r, sla: (r.met + 10) / (r.met + failed + 10), startS: r.startTick / 10, durationS: r.durationTicks / 10 });
    }
    for (const id of next.report.researchCompleted) {
      research.push({ completed: id, observedS: next.state.clock.tick / 10 });
      if (id === 'gpuGen2' && marks.gpuGen2CompletedS === null) marks.gpuGen2CompletedS = next.state.clock.tick / 10;
    }
    s = next.state;
    if (BigInt(s.wallet.credits) < 0n) negativeWalletDecisions++;
    if (BigInt(s.wallet.credits) < BigInt(peaks.minCredits)) peaks.minCredits = s.wallet.credits;
    peaks.psuUsage = Math.max(peaks.psuUsage, max(s.hot.sys.psuUsage));
    peaks.pduUsage = Math.max(peaks.pduUsage, max(s.hot.rack.pduUsage));
    peaks.rackTempF = Math.max(peaks.rackTempF, max(s.hot.rack.tempF));
    peaks.roomTempF = Math.max(peaks.roomTempF, max(s.hot.room.tempF));
    peaks.drawW = Math.max(peaks.drawW, max(s.hot.sys.drawW));
    if (s.clock.tick >= hourly) {
      console.log(JSON.stringify({ seed, hours: s.clock.tick / 36_000, wallS: (performance.now() - wallStart) / 1000,
        credits: s.wallet.credits, data: s.wallet.data, completed: s.research.completed.length, round: s.round.index, ...marks }));
      hourly += 36_000;
    }
    if (s.clock.tick >= checkpoint || s.clock.tick === campaignTicks) {
      record(`${seed}-${s.clock.tick / 36_000}h`); checkpoint += 144_000;
    }
  }
  if (diagnostic) save('paused-policy-diagnostic', { reachable, pausedDecisions });
  else if (s.clock.tick < campaignTicks) record(`${seed}-partial`);
  console.log(JSON.stringify({ seed, simulatedS: s.clock.tick / 10, wallS: (performance.now() - wallStart) / 1000,
    budgetExceeded: performance.now() >= deadline, ...marks,
    psuPurchases: events.filter((e) => e.psu).map((e) => ({ timeS: e.tick / 10, label: e.label, cost: e.cost, ...e.psu })),
  }));
  function record(name: string) {
    const actionTicks = [...new Set(events.map((e) => e.tick))];
    const gaps = actionTicks.slice(1).map((tick, i) => ({ fromS: actionTicks[i]! / 10, toS: tick / 10,
      seconds: (tick - actionTicks[i]!) / 10 })).sort((a, b) => b.seconds - a.seconds);
    save(name, { evidence: 'Legal createInitialState campaign, existing active bot, current GPU runtime with legacy CPU/RAM mechanics.',
      seed, hours: s.clock.tick / 36_000, wallS: (performance.now() - wallStart) / 1000, budgetExceeded: performance.now() >= deadline,
      decisionCadenceS: 2, marks, wallet: s.wallet, ledger: s.ledger, researchWindowEnergy: researchWindowEnergy.toString(),
      researchWindowEnergyMeaning: 'Whole-site energy billed during advances that began with active research; includes tasks and infrastructure, not research-only attribution.',
      activeTicks, failures, checks, feeErrors, negativeWalletDecisions, peaks,
      sampling: 'Physical peaks are final-tick samples every 2 seconds; report failures and ledger sum every tick.',
      round: s.round, completed: s.research.completed, research, events, gpuChanges, rounds, systems: variants(s),
      gaps: gaps.slice(0, 20), trailingActionGapS: (s.clock.tick - (actionTicks.at(-1) ?? 0)) / 10,
      blockers: blocked(s), minCurrentClockFactor: min(s.hot.sys.clockFactor),
      feeCatalog: RESEARCH.filter((r) => /^gpuGen/.test(r.id)).map((r) => ({ id: r.id, data: r.data, credits: r.creditCost ?? '0', work: r.work })),
    });
  }
  if (performance.now() >= deadline) break;
}
console.log(`Campaign wall seconds ${(performance.now() - started) / 1000}`);
