import { describe, expect, it } from 'vitest';
import { FAMILIES, familyId } from '../../../game';
import { recordingContext } from '../testCanvas';
import {
  BAND, BAND_TYPE, FAMILY_CELL, TASK_TYPES, TYPE, TYPE_ICONS, TYPE_MINI, bandColor, drawFamilyIcon, drawTypeIcon, drawTypeMini, familyName,
  hasFamilyIcon, typeColor, typeOf,
} from '.';
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

describe('family icons (set F)', () => {
  it('shows every catalog family as its type icon', () => {
    expect(FAMILIES.filter((f) => !hasFamilyIcon(f.id)).map((f) => f.key)).toEqual([]);
    expect(familyName('popcount')).toBe('Bit Count'); expect(familyName(familyId(0))).toBe(FAMILIES[0]!.name);
    for (const f of FAMILIES.slice(0, 12)) {
      const a = recordingContext(), b = recordingContext();
      drawFamilyIcon(a.g, f.id, 0, 0, 1); drawTypeIcon(b.g, BAND_TYPE[f.band], 0, 0, 1);
      expect(a.fills).toEqual(b.fills);
    }
  });
  it('is 16 × 16 art in the icon alphabet with a closed ink ring, and 5 × 5 minis', () => {
    for (const t of TASK_TYPES) {
      const rows = TYPE_ICONS[t];
      expect(rows.length).toBe(FAMILY_CELL);
      for (const r of rows) expect(r).toMatch(/^[.okladw]{16}$/);
      // every lit pixel next to clear space has the outline between them (no ramp pixel touches '.')
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (rows[y]![x] === '.' || rows[y]![x] === 'o') continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(rows[y + dy]?.[x + dx] ?? 'o', `${t} ${x},${y}`).not.toBe('.');
      }
      expect(TYPE_MINI[t].length).toBe(5); for (const r of TYPE_MINI[t]) expect(r).toMatch(/^[.ladkw]{5}$/);
    }
  });
  it('paints in its type colour; bandColor is the type colour; fail uses the fault ramp', () => {
    expect(bandColor('bitFlip')).toBe(TYPE.compute.a); expect(bandColor('mergeSort')).toBe('#ff8c42');
    expect(BAND.rackDist.a).toBe(TYPE.cluster.a);
    const r = recordingContext();
    drawFamilyIcon(r.g, 'transcode', 0, 0, 1);
    expect(new Set(r.fills.map((f) => f.c))).toContain(TYPE.accel.a);
    const fail = recordingContext();
    drawFamilyIcon(fail.g, 'transcode', 0, 0, 1, 'fail');
    expect(fail.fills.map((f) => f.c)).not.toContain(TYPE.accel.a);
    const mini = recordingContext(); drawTypeMini(mini.g, 'storage', 0, 0, 1);
    expect(mini.fills.map((f) => f.c)).toContain(TYPE.storage.a);
  });
  it('draws pixel-exact on the 16 × 16 grid at N', () => {
    const lit = (rows: readonly string[]) => rows.join('').replaceAll('.', '').length;
    for (const n of [1, 2, 3]) for (const [draw, rows] of [
      [(g: CanvasRenderingContext2D) => drawFamilyIcon(g, 'popcount', 10, 20, n), TYPE_ICONS.compute],
      [(g: CanvasRenderingContext2D) => drawTypeIcon(g, 'region', 10, 20, n), TYPE_ICONS.region],
    ] as const) {
      const r = recordingContext();
      draw(r.g);
      expect(r.fills.length).toBeGreaterThan(20);
      let area = 0;
      for (const f of r.fills) {
        expect(f.h).toBe(n); expect(f.w % n).toBe(0);
        expect((f.x - 10) % n).toBe(0); expect((f.y - 20) % n).toBe(0);
        expect(f.x + f.w).toBeLessThanOrEqual(10 + FAMILY_CELL * n); expect(f.y + f.h).toBeLessThanOrEqual(20 + FAMILY_CELL * n);
        area += f.w * f.h;
      }
      expect(area).toBe(lit(rows) * n * n);
    }
  });
});
