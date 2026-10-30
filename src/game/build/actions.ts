import type { HandlerMap } from '../core/actions';
import { isLadder } from './catalog';
import { deleteConfig, planApplyConfig, saveConfig } from './configs';
import { readPart } from './partAccess';
import { planAdd, planRemove, planReplace, planReplaceCpu, planUpgrade, planUpgradeAll, planUpgradeTo } from './partPlans';
import { commitPlan } from './plan';
import { planAddPort, planAddUplink, planReplaceLadder, planSameSpeed, planUpgradePort, planUpgradeUplink } from './ports';
import { researchHandlers } from './research/actions';
import {
  planCStateLimit, planFilter, planPowerCap, planQueueLoaderLimit, planQueueSetting, planRouterQueue, planSetpoint, planStrategy, planSystemSetting,
} from './settings';
import { planAddRow, planAddUnit, planRemoveUnit } from './units';
import { planInstallGpu } from './gpuPlans';
import { planStartConfig } from './startCtl';
import { planRamEcc } from './eccPlans';
import { planDowngrade } from './maintenance';

/** Part, unit, configuration, port, setting and research actions (architecture §4). Every handler re-plans and re-prices. */
export const buildHandlers: HandlerMap = {
  setQueueLoaderLimit: (s, a) => commitPlan(s, planQueueLoaderLimit(s, a.system, a.limit), a),
  convertRamToEcc: (s, a) => commitPlan(s, planRamEcc(s, a.system), a),
  installGpu: (s, a) => commitPlan(s, planInstallGpu(s, a.system, a.model, a.index), a),
  upgradePart: (s, a) => commitPlan(s, planUpgrade(s, a.part, a.axis), a),
  downgradePart: (s, a) => commitPlan(s, planDowngrade(s, a.part, a.axis), a),
  upgradePartTo: (s, a) => commitPlan(s, planUpgradeTo(s, a.part, a.level, a.axis), a),
  upgradeAll: (s, a) => commitPlan(s, planUpgradeAll(s, a.system, a.kind, a.gen, a.axis), a),
  replacePart: (s, a) => {
    const part = readPart(s.build, a.part);
    return commitPlan(s, part && isLadder(part.id) ? planReplaceLadder(s, a.part, a.generation) : planReplace(s, a.part, a.generation, a.preserveCapacity, a.minimumCapacity), a);
  },
  replaceCpu: (s,a)=>commitPlan(s,planReplaceCpu(s,a.system), a),
  addPart: (s, a) => commitPlan(s, planAdd(s, a.system, a.kind, a.generation, a.ecc ?? false), a),
  removePart: (s, a) => commitPlan(s, planRemove(s, a.part), a),
  addUnit: (s, a) => commitPlan(s, planAddUnit(s, a.parent, a.slot, a.source), a),
  removeUnit: (s, a) => commitPlan(s, planRemoveUnit(s, a.unit), a),
  addRow: (s, a) => commitPlan(s, planAddRow(s, a.room), a),
  applyConfig: (s, a) => commitPlan(s, planApplyConfig(s, a.unit, a.name), a),
  saveConfig: (s, a) => saveConfig(s, a.unit, a.name),
  deleteConfig: (s, a) => deleteConfig(s, a.kind, a.name),
  upgradePort: (s, a) => commitPlan(s, planUpgradePort(s, a.sw, a.port), a),
  upgradeUplink: (s, a) => commitPlan(s, planUpgradeUplink(s, a.sw, a.uplink), a),
  setSameSpeed: (s, a) => commitPlan(s, planSameSpeed(s, a.sw, a.on), a),
  addPorts: (s, a) => commitPlan(s, planAddPort(s, a.sw), a),
  addUplink: (s, a) => commitPlan(s, planAddUplink(s, a.sw), a),
  setStrategy: (s, a) => commitPlan(s, planStrategy(s, a.unit, a.strategy), a),
  setQueueOptimization: (s, a) => commitPlan(s, planQueueSetting(s, a.system, 'optimization', a.optimization), a),
  setQueueBatching: (s, a) => commitPlan(s, planQueueSetting(s, a.system, 'batching', a.on), a),
  setFilter: (s, a) => commitPlan(s, planFilter(s, a.unit, a.filter, a.on), a),
  setStartConfig: (s, a) => commitPlan(s, planStartConfig(s, a.unit, a.startWith, a.headWaitS, a.busyPct, a.order), a),
  upgradeRouterQueue: (s, a) => commitPlan(s, planRouterQueue(s, a.unit), a),
  setSetpoint: (s, a) => commitPlan(s, planSetpoint(s, a.unit, a.setpointF), a),
  setPowerCap: (s, a) => commitPlan(s, planPowerCap(s, a.part, a.on), a),
  setSystemSetting: (s, a) => commitPlan(s, planSystemSetting(s, a.system, a.setting, a.on), a),
  setCStateLimit: (s, a) => commitPlan(s, planCStateLimit(s, a.system, a.limit), a),
  ...researchHandlers,
};
