import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface BenchEnvironment {
  readonly node: string;
  readonly v8: string;
  readonly cpu: string;
  readonly cores: number;
  readonly platform: string;
  readonly sourceHash: string;
  readonly sourceFiles: number;
  readonly gate?: string;
  /** Frame advance path: owned (the platform, D9) or pure (`--pure`). The offline case always runs the platform engine. */
  readonly advance?: 'owned' | 'pure';
}

/** Files that decide sim and platform cost. Tests are excluded so they can change freely. */
export const SOURCE_ROOTS = ['src/game', 'src/platform', 'src/game/amount.ts'];

function listFiles(entry: string, out: string[]): void {
  let info;
  try { info = statSync(entry); } catch { return; }
  if (info.isFile()) {
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(entry);
    return;
  }
  for (const name of readdirSync(entry)) listFiles(path.join(entry, name), out);
}

export function hashSources(root: string, entries: readonly string[] = SOURCE_ROOTS): { hash: string; files: number } {
  const files: string[] = [];
  for (const entry of entries) listFiles(path.join(root, entry), files);
  files.sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(root, file).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(readFileSync(file));
  }
  return { hash: hash.digest('hex').slice(0, 16), files: files.length };
}

export function describeEnvironment(root: string): BenchEnvironment {
  const source = hashSources(root);
  return {
    node: process.version,
    v8: process.versions.v8,
    cpu: os.cpus()[0]?.model.trim() ?? 'unknown',
    cores: os.cpus().length,
    platform: `${process.platform} ${os.release()}`,
    sourceHash: source.hash,
    sourceFiles: source.files,
  };
}
