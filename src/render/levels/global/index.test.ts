import { expect, it } from 'vitest';
import { createLevelRegistry, rect } from '../../core';
import type { ChildView, HitTarget } from '../../core';
import { createHitTarget } from '../../core';
import { recordingContext } from '../../core/testCanvas';
import { CASES } from './fixtures';
import { createGlobalRenderer } from '.';

// jsdom has no Canvas2D: the cached map falls back to direct drawing (quietly).
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

it('drills each built zone hall into its room', () => {
  const registry = createLevelRegistry(), level = createGlobalRenderer(registry);
  registry.register(level);
  const s = CASES.zones!(0), out: ChildView[] = Array.from({ length: 32 }, () => ({ ref: { level: 'chip', id: 0 } as ChildView['ref'], rect: rect() }));
  const n = level.children(s, out);
  expect(n).toBe(s.sites.reduce((a, site) => a + (site.open ? site.zones.filter(z => z.roomId !== null).length : 0), 0));
  expect(out[0]!.ref.level).toBe('room');
  const targets: HitTarget[] = Array.from({ length: 16 }, createHitTarget);
  expect(level.targets(s, { selectedId: null, picked: null, quotes: null, reducedMotion: false }, targets, 0)).toBeGreaterThan(0);
  const { g, fills } = recordingContext();
  level.draw(g, s, { selectedId: null, picked: null, quotes: null, reducedMotion: false }, { snapshot: null as never, timeMs: 0, paused: false, reducedMotion: false, zoom: null });
  expect(fills.length).toBeGreaterThan(0);
});

it('anchors the pipe on the hub, opens backbone links at their landings, and drills halls into rooms', () => {
  const registry = createLevelRegistry(), level = createGlobalRenderer(registry);
  const s = CASES.regions!(0), targets: HitTarget[] = Array.from({ length: 64 }, createHitTarget);
  const n = level.targets(s, { selectedId: null, picked: null, quotes: null, reducedMotion: false }, targets, 0);
  const byId = new Map(targets.slice(0, n).map(t => [t.id, t]));
  expect(byId.get('entry')?.rect.y).toBe(0);
  expect(byId.get('hub')?.part?.slot).toEqual({ kind: 'globalScheduler' });
  const links = targets.slice(0, n).filter(t => t.kind === 'link' && t.id.startsWith('link'));
  expect(links.length).toBe(s.backbone.links.length);
  expect(links.every(t => t.part?.slot.kind === 'backbone')).toBe(true);
  // closed regions get no target; open unbuilt regions offer a site build slot
  expect(targets.slice(0, n).filter(t => t.kind === 'slot').length).toBe(s.sites.filter(q => q.open && q.siteId === null).length);
});
