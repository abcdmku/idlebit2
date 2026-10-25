import { describe, expect, it } from 'vitest';
import { FAMILIES, familyId } from '../../../game';
import { recordingContext } from '../testCanvas';
import {
  BAND, BAND_TYPE, FAMILY_CELL, TASK_TYPES, TYPE, bandColor, drawFamilyIcon, drawTypeIcon, familyName, hasFamilyIcon, typeColor, typeOf,
} from '.';
import { ICONS as ACCEL } from './icons-accel';
import { ICONS as CLUSTER } from './icons-cluster';
import { ICONS as COMPUTE } from './icons-compute';
import { ICONS as MEMORY } from './icons-memory';
import { ICONS as PARALLEL } from './icons-parallel';
import { ICONS as REGION } from './icons-region';
import { ICONS as STORAGE } from './icons-storage';
import { ICONS as ZONES } from './icons-zones';
import { TYPE_ICONS } from './types';

const BY_TYPE = { compute: COMPUTE, parallel: PARALLEL, memory: MEMORY, accel: ACCEL, storage: STORAGE, cluster: CLUSTER, zones: ZONES, region: REGION };
const silhouette = (rows: readonly string[]) => rows.map((r) => r.replace(/[^.]/g, '#')).join('\n');

describe('task types', () => {
  it('maps every catalog band to one type, and every type has a band', () => {
    const bands = [...new Set(FAMILIES.map((f) => f.band))];
    expect(bands.filter((b) => !TASK_TYPES.includes(BAND_TYPE[b]))).toEqual([]);
    for (const t of TASK_TYPES) expect(TYPE[t].bands.length).toBeGreaterThan(0);
    for (const t of TASK_TYPES) for (const b of TYPE[t].bands) expect(BAND_TYPE[b]).toBe(t);
    expect(typeOf('bitFlip')).toBe('compute'); expect(typeOf('popcount')).toBe('compute');
    expect(typeOf('kvGet')).toBe('memory'); expect(typeOf('pageRank')).toBe('cluster'); expect(typeOf('llmTrain')).toBe('region');
  });
  it('gives each type its own colour, clear of the UI semantic colours', () => {
    const colours = TASK_TYPES.map(typeColor);
    expect(new Set(colours).size).toBe(TASK_TYPES.length);
    // pipe green, ok green, gold, warn, data teal, fault, fault text, research magenta
    for (const c of ['#7be38f', '#7dff9a', '#ffcc3d', '#ffb03b', '#27d9a0', '#ff3b3b', '#ff6a5a', '#ff6bd6']) expect(colours).not.toContain(c);
  });
  it('gives each type its own silhouette', () => {
    const shapes = TASK_TYPES.map((t) => silhouette(TYPE_ICONS[t]));
    expect(new Set(shapes).size).toBe(TASK_TYPES.length);
  });
});

describe('family icons', () => {
  it('has an icon for every family in the catalog, filed under its type', () => {
    expect(FAMILIES.filter((f) => !hasFamilyIcon(f.id)).map((f) => f.key)).toEqual([]);
    for (const f of FAMILIES) expect(Object.keys(BY_TYPE[BAND_TYPE[f.band]])).toContain(f.key);
    expect(Object.values(BY_TYPE).reduce((n, icons) => n + Object.keys(icons).length, 0)).toBe(FAMILIES.length);
    expect(familyName('popcount')).toBe('Bit Count'); expect(familyName(familyId(0))).toBe(FAMILIES[0]!.name);
  });
  it('shares its type frame: every family icon has its type icon silhouette', () => {
    for (const t of TASK_TYPES) for (const [key, rows] of Object.entries(BY_TYPE[t])) {
      expect(silhouette(rows), key).toBe(silhouette(TYPE_ICONS[t]));
    }
  });
  it('is 16 × 16 art in the icon alphabet, with no two icons alike', () => {
    const all = [...Object.values(TYPE_ICONS), ...Object.values(BY_TYPE).flatMap((icons) => Object.values(icons))];
    for (const rows of all) {
      expect(rows.length).toBe(FAMILY_CELL);
      for (const r of rows) expect(r).toMatch(/^[.okladw]{16}$/);
    }
    expect(new Set(all.map((r) => r.join(''))).size).toBe(all.length);
  });
  it('paints in its type colour; bandColor is the type colour', () => {
    expect(bandColor('bitFlip')).toBe(TYPE.compute.a); expect(bandColor('mergeSort')).toBe('#ff8c42');
    expect(BAND.rackDist.a).toBe(TYPE.cluster.a);
    const r = recordingContext();
    drawFamilyIcon(r.g, 'transcode', 0, 0, 1);
    expect(new Set(r.fills.map((f) => f.c))).toContain(TYPE.accel.a);
    const fail = recordingContext();
    drawFamilyIcon(fail.g, 'transcode', 0, 0, 1, 'fail');
    expect(fail.fills.map((f) => f.c)).not.toContain(TYPE.accel.a);
  });
  it('draws pixel-exact on the 16 × 16 grid at N', () => {
    const lit = (rows: readonly string[]) => rows.join('').replaceAll('.', '').length;
    for (const n of [1, 2, 3]) for (const [draw, rows] of [
      [(g: CanvasRenderingContext2D) => drawFamilyIcon(g, 'popcount', 10, 20, n), COMPUTE.popcount!],
      [(g: CanvasRenderingContext2D) => drawTypeIcon(g, 'region', 10, 20, n), TYPE_ICONS.region],
    ] as const) {
      const r = recordingContext();
      draw(r.g);
      expect(r.fills.length).toBeGreaterThan(20);
      let area = 0;
      for (const f of r.fills) {
        expect(f.h).toBe(n); expect(f.w % n).toBe(0);
        expect((f.x - 10) % n).toBe(0); expect((f.y - 20) % n).toBe(0);
        expect(f.x).toBeGreaterThanOrEqual(10); expect(f.x + f.w).toBeLessThanOrEqual(10 + FAMILY_CELL * n);
        expect(f.y).toBeGreaterThanOrEqual(20); expect(f.y + f.h).toBeLessThanOrEqual(20 + FAMILY_CELL * n);
        area += f.w * f.h;
      }
      expect(area).toBe(lit(rows) * n * n);
    }
  });
});

describe('sled LCD minis', () => {
  it('are 5 × 5 per type and draw in the type colour', async () => {
    const { TYPE_MINI, drawTypeMini } = await import('.');
    for (const ty of TASK_TYPES) { expect(TYPE_MINI[ty].length).toBe(5); for (const r of TYPE_MINI[ty]) expect(r).toMatch(/^[.ladkw]{5}$/); }
    const rec = recordingContext(); drawTypeMini(rec.g, 'storage', 0, 0, 1);
    expect(rec.fills.map((f) => f.c)).toContain(TYPE.storage.a);
  });
});
