import { allocCompiled, allocHot, RACK_HOT, SYS_COMPILED, SYS_HOT } from '../core/buffers';
import { DT_S, MAX_ACCELS } from '../core/constants';
import { resetRow } from '../core/table';
import { openWorld } from '../core/world';
import { DRAW_FULL, systemDraw } from '../phys/draw';
import { deriveSettings, type PhysSettings } from '../phys/settings';
import { supplyLossW } from '../phys/supplies';
import type { SystemSpec } from '../types/build';
import { rackId, systemId } from '../types/ids';
import type { GpuPowerPoint, GpuPowerPreview } from '../types/quotes';
import type { GameState, Unlocks } from '../types/state';
import { compileSystem } from './compile';

/**
 * One-system scratch buffers, reset row by row on every call: a quote allocates no tables and
 * copies nothing fleet-sized. Nothing keeps a reference to them past one `fullLoadPoint`.
 */
const SIZE = { systems: 1, racks: 1, rooms: 0, sites: 0, links: 0 };
const scratchCompiled = allocCompiled(SIZE);
const scratchHot = allocHot(SIZE, 0);

/**
 * The full draw reads only the unlock-wide switches of the settings (packageIdle, psuLive), so
 * one derivation per unlocks object serves every preview.
 */
const settingsMemo = new WeakMap<Unlocks, PhysSettings>();
function previewSettings(state: GameState): PhysSettings {
  const unlocks = state.research.unlocks;
  let s = settingsMemo.get(unlocks);
  if (!s) {
    s = deriveSettings({ ...state.build, systems: [], racks: [], rooms: [] }, unlocks, 1, 1, 0);
    settingsMemo.set(unlocks, s);
  }
  return s;
}

/** Full system demand at full utilization, retaining the current environment and power states. */
function fullLoadPoint(state: GameState, sys: number, spec: SystemSpec): GpuPowerPoint {
  const compiled = scratchCompiled, hot = scratchHot, h = hot.sys, actual = state.hot.sys;
  resetRow(SYS_COMPILED, compiled.sys, 0);
  resetRow(SYS_HOT, h, 0);
  resetRow(RACK_HOT, hot.rack, 0);
  const system = { ...state.build.systems[sys]!, id: systemId(0), rack: rackId(0), spec };
  compileSystem(compiled, system, state.research.unlocks);
  const rack = state.compiled.sys.rack[sys]!;
  h.busy[0] = compiled.sys.cores[0]!;
  h.active[1] = 1;
  h.active[3] = compiled.sys.ioConc[0]!;
  h.dvfsOn[0] = actual.dvfsOn[sys]!;
  h.turboOn[0] = actual.turboOn[sys]!;
  h.capFactor[0] = actual.capFactor[sys]!;
  hot.rack.throttled[0] = state.hot.rack.throttled[rack]!;
  hot.rack.capFactor[0] = state.hot.rack.capFactor[rack]!;
  for (let slot = 0; slot < MAX_ACCELS; slot += 1) {
    if (compiled.sys.accelKind[slot] !== 0) h.accelTaskS[slot] = DT_S;
  }
  const preview = openWorld({ ...state, compiled, hot }, true);
  const settings = previewSettings(state);
  const deliveredW = systemDraw(preview, 0, DRAW_FULL, settings).deliveredW;
  const capacityW = settings.psuLive ? compiled.sys.psuCapW[0]! : 0;
  const lossW = capacityW > 0 ? supplyLossW(deliveredW, capacityW, compiled.sys.psuLoss[0]!) : 0;
  return { deliveredW, capacityW, lossW, inputW: deliveredW + lossW, headroomW: capacityW - deliveredW };
}

/** Separate from measured card-duty/payback previews: these figures expose whole-system supply fit. */
export function gpuPowerPreview(state: GameState, sys: number, after: SystemSpec): GpuPowerPreview {
  return { before: fullLoadPoint(state, sys, state.build.systems[sys]!.spec), after: fullLoadPoint(state, sys, after) };
}
