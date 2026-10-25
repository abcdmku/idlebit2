import type { CaseResult, CaseStatus } from './report';

/** Architecture §6.1: the gate at which each budget becomes binding. */
export type Gate = 'G1' | 'G2' | 'G3' | 'G4';
const ORDER: readonly Gate[] = ['G1', 'G2', 'G3', 'G4'];

export interface Budget {
  readonly id: string;
  readonly label: string;
  readonly limit: number;
  readonly unit: 'ms' | 's';
  readonly gate: Gate;
}

/** Program §13 and architecture §7.3. */
export const BUDGETS = {
  boot: { id: 'boot', label: 'Boot frame p95', limit: 0.5, unit: 'ms', gate: 'G1' },
  rackFull: { id: 'rackFull', label: 'rackFull frame p95 (worst scope)', limit: 1, unit: 'ms', gate: 'G2' },
  fleetMax: { id: 'fleetMax', label: 'Largest fleet frame p95 (worst scope)', limit: 4, unit: 'ms', gate: 'G3' },
  offline: { id: 'offline', label: '2 h round offline in the worker', limit: 10, unit: 's', gate: 'G3' },
  campaign: { id: 'campaign', label: '24 h campaign wall time', limit: 300, unit: 's', gate: 'G4' },
} as const satisfies Record<string, Budget>;

export function parseGate(value: string | undefined): Gate {
  if (value === undefined) return 'G4';
  if ((ORDER as readonly string[]).includes(value)) return value as Gate;
  throw new Error(`Unknown gate ${value}; expected ${ORDER.join(', ')}`);
}

/** Budgets past the requested gate are reported but cannot fail the run. */
export function judge(budget: Budget, gate: Gate, value: number, valid = true, note = '', detail: Record<string, unknown> = {}): CaseResult {
  const binding = ORDER.indexOf(budget.gate) <= ORDER.indexOf(gate);
  const within = valid && value <= budget.limit;
  const status: CaseStatus = within ? 'pass' : binding ? 'fail' : 'advisory';
  const gateNote = binding ? '' : `binding at ${budget.gate}`;
  return { id: budget.id, budget: budget.label, status, value, limit: budget.limit, unit: budget.unit,
    note: [note, gateNote].filter(Boolean).join('; '), detail };
}
