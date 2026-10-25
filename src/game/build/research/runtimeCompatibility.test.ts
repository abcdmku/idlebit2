import { amount } from '../../amount';
import { allocCompiled } from '../../core/buffers';
import { createInitialState } from '../../core/state';
import type { ResearchDef } from '../../types/catalog';
import { researchId } from '../../types/ids';
import { researchTree } from '../../view/research';
import { compileSystem } from '../compile';
import { systemLock } from '../configModel';
import { maxLevel } from '../locks';
import { deriveUnlocks } from './effects';
import { DEFERRED_HARDWARE_RESEARCH, deferredHardwareResearch } from './runtimeCompatibility';
import { effectText, nodeForCeiling, RESEARCH, researchDef } from './tree';
import { RESEARCH_CREDITS, TREE_ROWS, WORK_TIER_OPS } from './tree.data';
import { EFFECT_TEXT, SHORT_TEXT } from './tree.text';

describe('deferred CPU/RAM research boundary', () => {
  it('keeps the accepted 36-level and registered-capacity reference in generated source', () => {
    expect(TREE_ROWS.find(([id]) => id === 'rdimm')![8]).toEqual([
      { kind: 'rule', id: 'registeredCapacity', params: { factor: 2 } },
    ]);
    expect(EFFECT_TEXT.ddr).toContain('36 levels');
    expect(EFFECT_TEXT.rdimm).toContain('Doubles ECC module capacity');
    expect(EFFECT_TEXT.rdimm).toContain('36 levels');
  });

  it('allows only DDR copy and RDIMM copy/effects to differ at runtime', () => {
    expect(Object.keys(DEFERRED_HARDWARE_RESEARCH)).toEqual(['ddr', 'rdimm']);
    expect(Object.keys(DEFERRED_HARDWARE_RESEARCH.ddr)).toEqual(['effect']);
    expect(Object.keys(DEFERRED_HARDWARE_RESEARCH.rdimm).sort()).toEqual(['effect', 'effects']);
    const differences: string[] = [];
    for (const [id, name, category, requires, level, era, tier, data, effects, answers] of TREE_ROWS) {
      const reference: ResearchDef = {
        id: researchId(id), name, category, requires: requires.map(researchId), level: level === 'cpu' ? 'chip' : level,
        era, tier, data, work: WORK_TIER_OPS[tier], creditCost: amount(RESEARCH_CREDITS[id] ?? '0'),
        effects, effect: EFFECT_TEXT[id] ?? '', summary: SHORT_TEXT[id] ?? '', answers, implemented: true,
      };
      const runtime = researchDef(id)!;
      // Compare all fields, including costs, prerequisites and work, before checking exceptions.
      expect({ ...runtime, effects, effect: reference.effect }).toEqual(reference);
      if (id === 'rdimm') expect(runtime.effects).toEqual([{ kind: 'ceiling', key: 'ramLevelBonus', value: 4 }]);
      else expect(runtime.effects).toEqual(effects);
      if (id === 'ddr' || id === 'rdimm') {
        expect(runtime.effect).not.toBe(reference.effect);
        differences.push(id);
      } else {
        expect(runtime).toEqual(reference);
        expect(deferredHardwareResearch(id)).toBeUndefined();
      }
    }
    expect(differences).toEqual(['ddr', 'rdimm']);
    expect(RESEARCH).toHaveLength(TREE_ROWS.length);
  });

  it('publishes actual runtime copy through definitions, effectText and research views', () => {
    const view = researchTree(createInitialState(42));
    for (const id of ['ddr', 'rdimm'] as const) {
      const actual = DEFERRED_HARDWARE_RESEARCH[id].effect;
      expect(researchDef(id)!.effect).toBe(actual);
      expect(effectText(id)).toBe(actual);
      expect(view.nodes.find((node) => node.id === id)!.effect).toBe(actual);
      expect(actual).not.toMatch(/36|L18|L22|capacity ×2/);
    }
    expect(effectText('unknown')).toBe('');
  });

  it('keeps the RDIMM unlock functional for ECC purchase and configuration limits', () => {
    const before = deriveUnlocks(RESEARCH.filter((node) => node.id !== 'rdimm').map((node) => node.id));
    const after = deriveUnlocks(RESEARCH.map((node) => node.id));
    const system = createInitialState(42).build.systems[0]!;
    expect(after.ceilings.ramLevelBonus).toBe(4);
    expect(after.rules).not.toContain('registeredCapacity');
    expect(nodeForCeiling('ramLevelBonus', 4)?.id).toBe('rdimm');
    for (let gen = 0; gen < 6; gen += 1) {
      const previousTop = maxLevel(before, 'ram', gen, true);
      expect(maxLevel(after, 'ram', gen, true)).toBe(previousTop + 4);
      expect(maxLevel(after, 'ram', gen, false)).toBe(maxLevel(before, 'ram', gen, false));
      const spec = { ...system.spec, ram: [{ gen, level: previousTop + 1, ecc: true }] };
      expect(systemLock(before, spec)).toMatchObject({ code: 'research', node: 'rdimm' });
      expect(systemLock(after, spec)).toBeNull();
      expect(systemLock(after, { ...spec, ram: [{ gen, level: previousTop + 4, ecc: true }] })).toBeNull();
      expect(systemLock(after, { ...spec, ram: [{ gen, level: previousTop + 5, ecc: true }] })).not.toBeNull();
    }
  });

  it('does not apply the pending capacity multiplier to installed modules', () => {
    const before = deriveUnlocks(RESEARCH.filter((node) => node.id !== 'rdimm').map((node) => node.id));
    const after = deriveUnlocks(RESEARCH.map((node) => node.id));
    const system = createInitialState(42).build.systems[0]!;
    for (let gen = 0; gen < 6; gen += 1) {
      const build = { ...system, spec: { ...system.spec, ram: [{ gen, level: 1, ecc: true }] } };
      const old = allocCompiled({ systems: 1, racks: 0, rooms: 0, sites: 0, links: 0 });
      const current = allocCompiled({ systems: 1, racks: 0, rooms: 0, sites: 0, links: 0 });
      compileSystem(old, build, before);
      compileSystem(current, build, after);
      expect(current.sys.memCap[0]).toBe(old.sys.memCap[0]);
      expect(current.sys.ramBw[0]).toBe(old.sys.ramBw[0]);
      expect(current.sys.idleW).toEqual(old.sys.idleW);
      expect(current.sys.loadW).toEqual(old.sys.loadW);
    }
  });
});
