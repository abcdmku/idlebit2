// Global snapshot cases for tests and the R3 harness (?level=global&case=…). Built from the
// contract fixture; only the fields the global renderer reads vary.
import { LEVEL_FIXTURES } from '../../../game/fixtures';
import { REGIONS, roomId, siteId } from '../../../game';
import type { GlobalSnapshot, LinkView, SiteView, ZoneView } from '../../../game';

type Mut<T> = { -readonly [K in keyof T]: T[K] };
const BASE = LEVEL_FIXTURES.global;
const ACTIVE_BUILD = ['us-east', 'eu-west', 'us-west', 'ap-southeast'];

function zone(site: number, z: number, load: number, tempF = 72): ZoneView {
  return { roomId: roomId(site * 3 + z), zone: z, state: 'onMarket', tempF, load, upsUsage: 0.4 };
}
function site(i: number, zones: number, o: Partial<Mut<SiteView>> = {}): SiteView {
  const b = BASE.sites[i]!;
  return {
    ...b, siteId: siteId(i), open: true, online: 'onMarket',
    zones: Array.from({ length: zones }, (_, z) => zone(i, z, z === 2 ? 0 : 0.6)),
    grid: { ...(BASE.sites[0]!.grid!), usage: 0.3 + 0.08 * zones, deliveredW: 80_000 * zones },
    dataPlane: { generation: 0, bitsPerSec: 1e6, latencyMs: 200, active: zones > 1 },
    hottestF: 74, ...o,
  };
}
const closed = (i: number): SiteView => ({ ...BASE.sites[i]!, open: false, online: 'empty', siteId: null, zones: [], grid: null, dataPlane: null });
const link = (i: number, active: boolean, generation = 1): LinkView => ({ siteId: siteId(i), speedHz: 1e9, latencyMs: 40, active, generation });
function world(sites: SiteView[], links: LinkView[], regionsOpen: number, scheduler = false): GlobalSnapshot {
  return {
    ...BASE, sites, regionsOpen, backbone: { links },
    scheduler: scheduler ? { generation: 1, level: 2, strategy: 'firstFit', filters: [], placements: [], reserveOnRoute: false,
      routedPerSec: 900, misroutesThisRound: 0, lastTarget: 1 } : null,
  };
}
const idx = (id: string) => REGIONS.findIndex(r => r.id === id);

export const CASES: Readonly<Record<string, (timeMs: number) => GlobalSnapshot>> = {
  /** Data center research: one site, three AZ halls (mockup ?stage=zones). */
  zones: () => world(REGIONS.map((_, i) => (i === 0 ? site(0, 3) : closed(i))), [], 1),
  /** Regions research: four sites, backbone links, two open survey regions. */
  regions: () => {
    const built = new Set(ACTIVE_BUILD.map(idx));
    const sites = REGIONS.map((_, i) => (built.has(i) ? site(i, i === 0 ? 3 : 2) : closed(i)));
    return world(sites, [...built].filter(i => i !== 0).map((i, k) => link(i, k !== 1, 1 + k)), 4, true);
  },
  /** The largest fleet: 8 sites × 3 zones, every link busy. */
  max: () => world(REGIONS.map((_, i) => site(i, 3, { hottestF: 76 })), REGIONS.map((_, i) => link(i, true, 3)).slice(1), 8, true),
  /** A site's grid failed: everything below it is dark. */
  dark: () => world(REGIONS.map((_, i) => (i === 0
    ? site(0, 3, { online: 'dark', grid: { ...BASE.sites[0]!.grid!, failed: true, usage: 0, rebootMs: 6000 } })
    : closed(i))), [], 1),
  /** Zone B crashed on heat; zone A runs hot. */
  crash: () => {
    const s = site(0, 3, { hottestF: 101 });
    const zones = [zone(0, 0, 0.9, 88), { ...zone(0, 1, 0, 104), state: 'crashed' as const }, zone(0, 2, 0.2)];
    return world(REGIONS.map((_, i) => (i === 0 ? { ...s, zones } : closed(i))), [], 1);
  },
};
