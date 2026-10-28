import type { Rect } from '../../core';
import { siteCentre, type BoardLayout, type SiteType } from './layout';

type Path = readonly (readonly [number, number])[];
const cache = new WeakMap<BoardLayout, Map<string, Path>>();

/** Shortest orthogonal route through the board's component gutters. Cached for each fixed board site. */
export function boardRoute(b: BoardLayout, type: SiteType, index: number, socket = 0): Path {
  let paths = cache.get(b);
  if (!paths) { paths = new Map(); cache.set(b, paths); }
  const key = `${socket}:${type}:${index}`, previous = paths.get(key);
  if (previous) return previous;
  const start = siteCentre(b, 'cpu', socket, { x: 0, y: 0 }), end = siteCentre(b, type, index, { x: 0, y: 0 });
  const blocks: Rect[] = [];
  for (const kind of ['cpu', 'ram', 'drive', 'gpu'] as const) b.sites[kind].forEach((r, i) => {
    if (kind === 'cpu' && i === socket || kind === type && i === index) return;
    blocks.push(r);
  });
  const xs = [...new Set([start.x, end.x, ...blocks.flatMap(r => [r.x - 1, r.x + r.w + 1])])].sort((a, c) => a - c);
  const ys = [...new Set([start.y, end.y, ...blocks.flatMap(r => [r.y - 1, r.y + r.h + 1])])].sort((a, c) => a - c);
  const w = xs.length, n = w * ys.length, distance = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const from = ys.indexOf(start.y) * w + xs.indexOf(start.x), to = ys.indexOf(end.y) * w + xs.indexOf(end.x);
  const clear = (x: number, y: number, xx: number, yy: number) => !blocks.some(r => x === xx
    ? x >= r.x && x <= r.x + r.w && Math.max(y, yy) >= r.y && Math.min(y, yy) <= r.y + r.h
    : y >= r.y && y <= r.y + r.h && Math.max(x, xx) >= r.x && Math.min(x, xx) <= r.x + r.w);
  distance[from] = 0;
  for (let step = 0; step < n; step++) {
    let at = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && distance[i]! < best) { best = distance[i]!; at = i; }
    if (at < 0 || at === to) break;
    done[at] = 1;
    const col = at % w, row = Math.floor(at / w), x = xs[col]!, y = ys[row]!;
    for (const next of [col > 0 ? at - 1 : -1, col + 1 < w ? at + 1 : -1, row > 0 ? at - w : -1, row + 1 < ys.length ? at + w : -1]) {
      if (next < 0 || done[next]) continue;
      const xx = xs[next % w]!, yy = ys[Math.floor(next / w)]!, cost = best + Math.abs(xx - x) + Math.abs(yy - y);
      if (cost < distance[next]! && clear(x, y, xx, yy)) { distance[next] = cost; prev[next] = at; }
    }
  }
  const path: [number, number][] = [];
  if (Number.isFinite(distance[to])) for (let at = to; at >= 0; at = prev[at]!) path.push([xs[at % w]!, ys[Math.floor(at / w)]!]);
  path.reverse();
  paths.set(key, path);
  return path;
}
