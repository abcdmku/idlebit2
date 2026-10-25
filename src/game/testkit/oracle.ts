import { DT_S } from '../core/constants';


/**
 * The naive clock oracle (architecture §1.5, §7.4): every task's remaining work is stepped each
 * tick with the same completion predicate exec uses. S3's cohort bookkeeping must match it on
 * randomized fixtures. Skeleton: compute and pooled resources, no in-tick carry yet.
 * TODO(S3, G1): in-tick carry from the queue, time slicing, research share, IO holds.
 * Resources are clocks: a mem stage resident in RAM runs on 'ram', on disk on 'io' (D26.2).
 */
export type Resource = 'compute' | 'ram' | 'gpu' | 'io';
export interface OracleStage { readonly resource: Resource; readonly work: number }
export interface OracleTask {
  readonly id: number;
  readonly stages: readonly OracleStage[];
  readonly threads: number;
  stage: number;
  remaining: number;
  doneTick: number | null;
}
export interface OracleSystem {
  /** ops/s per hardware thread at e = 1. */
  readonly perThreadRate: number;
  readonly hardwareThreads: number;
  readonly ramBw: number;
  readonly gpuOps: number;
  readonly ioRate: number;
  eff: number;
  readonly tasks: OracleTask[];
}

export function oracleTask(id: number, stages: readonly OracleStage[], threads = 1): OracleTask {
  return { id, stages, threads, stage: 0, remaining: stages[0]?.work ?? 0, doneTick: null };
}

/** Steps one tick. Rates are fixed from the tick's start; pools split equally by stage count. */
export function oracleTick(sys: OracleSystem, tick: number): number[] {
  const live = sys.tasks.filter((t) => t.doneTick === null);
  const inStage = (r: Resource) => Math.max(1, live.filter((t) => t.stages[t.stage]!.resource === r).length);
  const share: Record<Resource, number> = {
    compute: sys.perThreadRate * sys.eff,
    ram: sys.ramBw / inStage('ram'),
    gpu: (sys.gpuOps * sys.eff) / inStage('gpu'),
    io: sys.ioRate / inStage('io'),
  };
  const done: number[] = [];
  for (const task of live) {
    const resource = task.stages[task.stage]!.resource;
    const rate = resource === 'compute' ? share.compute * Math.min(task.threads, sys.hardwareThreads) : share[resource];
    task.remaining -= rate * DT_S;
    if (task.remaining > 0) continue;
    task.stage += 1;
    if (task.stage >= task.stages.length) { task.doneTick = tick; done.push(task.id); continue; }
    task.remaining = task.stages[task.stage]!.work;
  }
  return done;
}
