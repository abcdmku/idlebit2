import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BenchEnvironment } from './environment';

export type CaseStatus = 'pass' | 'fail' | 'advisory' | 'skip';

/** One budget row. `advisory`: over a budget that is not binding yet at the requested gate. */
export interface CaseResult {
  readonly id: string;
  readonly budget: string;
  readonly status: CaseStatus;
  readonly value: number | null;
  readonly limit: number | null;
  readonly unit: 'ms' | 's';
  readonly note: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface BenchReport {
  readonly startedAt: string;
  readonly environment: BenchEnvironment;
  readonly cases: readonly CaseResult[];
  readonly passed: boolean;
}

export function isPassing(cases: readonly CaseResult[]): boolean {
  return cases.every(c => c.status !== 'fail');
}

const fmt = (value: number | null) => (value === null ? '-' : String(Math.round(value * 1000) / 1000));

export function toMarkdown(report: BenchReport): string {
  const env = report.environment;
  const lines = [
    `# v3 bench ${report.startedAt}`,
    '',
    `Node ${env.node}, V8 ${env.v8}, ${env.cpu} (${env.cores} cores), ${env.platform}. Source ${env.sourceHash} (${env.sourceFiles} files). Gate ${env.gate ?? "-"}. Advance ${env.advance ?? "-"}.`,
    '',
    '| Case | Budget | Value | Limit | Status | Note |',
    '|---|---|---|---|---|---|',
    ...report.cases.map(c => `| ${c.id} | ${c.budget} | ${fmt(c.value)} ${c.unit} | ${fmt(c.limit)} ${c.unit} | ${c.status} | ${c.note} |`),
    '',
    `Overall: ${report.passed ? 'pass' : 'FAIL'}`,
    '',
  ];
  return lines.join('\n');
}

export function writeReport(root: string, report: BenchReport): string {
  const stamp = report.startedAt.replace(/[:.]/g, '-');
  const dir = path.join(root, 'artifacts', 'qa', 'perf', stamp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(dir, 'report.md'), toMarkdown(report));
  return dir;
}
