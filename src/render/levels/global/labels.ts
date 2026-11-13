// World labels: every region's name, outside air and power price; each built site's state (its
// hottest hall and grid use while it serves the market, else its mode and timer) and its link
// speeds; the scheduler's routes per second and the start controller's sites on.
// Values are snapshot fields, formatted. A line that would not fit its cell takes a shorter form.
import { REGIONS, REGION_IDS, formatHertz, regionName } from '../../../game';
import type { GlobalSnapshot, LinkView, SiteView } from '../../../game';
import { PHONE_TYPE, labelTextWidth, secondsText, typeForScale, whole } from '../../core';
import type { LabelTone, LabelWriter, Typography, WorldFrame } from '../../core';
import { plan } from './layout';
import type { Plan } from './layout';
import { LOCK_TAB } from './plan';
import { GEN_BOX } from './power';

const BASE_PRICE = REGIONS[0].energyPrice;
const NAMES = REGION_IDS.map(regionName), LINK_LABELS = REGION_IDS.map((_, i) => `links${i}`), CLIMATE_LABELS = REGION_IDS.map((_, i) => `climate${i}`);
const PRICE = REGIONS.map(r => `×${(r.energyPrice / BASE_PRICE).toFixed(1)}`);
/** Climate line per region (A28): outside air and the energy price against the first region's. */
export const CLIMATE_SIGNS = REGIONS.map((r, i) => `${r.outsideF}°F · power ${PRICE[i]}`);
const CLIMATE_SHORT = REGIONS.map((r, i) => `${r.outsideF}°F · ${PRICE[i]}`);

const HOT_F = 95, GRID_HIGH = 0.9;
/** What a site that is not serving the market is doing, with its timer where it has one. */
function modeText(site: SiteView): string | null {
  const t = site.timerS != null && site.timerS > 0 ? ` ${secondsText(site.timerS)}` : '';
  if (site.wakeMs != null && site.wakeMs > 0) return `Waking ${secondsText(site.wakeMs / 1000)}`;
  if (site.powered === false) return 'Standby';
  switch (site.online) {
    case 'boot': return `Boot${t}`;
    case 'goingOffline': return `Going offline${t}`;
    case 'draining': return 'Draining';
    case 'cold': return `Cold change${t}`;
    case 'offline': return 'Offline';
    case 'asleep': return 'Asleep';
    case 'standby': return 'Standby';
    default: return null;
  }
}
const fits = (text: string, type: Typography, px: number, bold = false): boolean => labelTextWidth(text, type, bold) <= px;

/** Art px a payout pop's block takes across at scale `n` (its icon and a six-character amount, body size). */
export const popWidth = (type: Typography, n: number): number => Math.ceil((type === PHONE_TYPE ? 72 : 88) / n);
/** A cell's header: which climate line it shows, and the free lane east of its text (cell x, width; -1: none a pop fits). */
interface Sign {
  plan: Plan | null; n: number; type: Typography | null; built: boolean; gen: boolean; short: boolean; laneX: number; laneW: number;
  /** The free lane east of the footer's link lines (three-line footers), set each frame by the labels. */
  footX: number; footW: number;
}
const signs: Sign[] = REGION_IDS.map(() => ({ plan: null, n: 0, type: null, built: false, gen: false, short: false, laneX: -1, laneW: 0, footX: -1, footW: 0 }));
let restN = 2, restType: Typography = PHONE_TYPE;
/**
 * The header of cell i. A built site keeps a lane east of its name and climate, west of its generation
 * box, for its payout pop; a header too narrow for it with the full climate line takes the short one.
 */
export function signOf(p: Plan, i: number, site: SiteView, n = restN, type = restType): Sign {
  const c = signs[i]!, built = site.siteId !== null, gen = built && !!site.generation;
  if (c.plan === p && c.n === n && c.type === type && c.built === built && c.gen === gen) return c;
  const b = p.cells[i]!, east = b.w - (gen ? 1 - GEN_BOX.dx : 1), name = labelTextWidth(NAMES[i]!, type, true);
  const end = (text: string): number => 8 + Math.ceil(Math.max(name, labelTextWidth(text, type)) / n);
  const full = end(CLIMATE_SIGNS[i]!), short = end(CLIMATE_SHORT[i]!), lane = (x: number): number => east - 1 - (x + 2);
  const need = popWidth(type, n);
  c.plan = p; c.n = n; c.type = type; c.built = built; c.gen = gen;
  // (a three-line footer has its own lane, so its header keeps the full line)
  c.short = full > east || (built && p.lines < 3 && lane(full) < need && lane(short) >= need);
  const x = c.short ? short : full;
  c.laneX = built && lane(x) >= need ? x + 2 : -1; c.laneW = lane(x);
  return c;
}

export function globalLabels(s: GlobalSnapshot, frame: WorldFrame, out: LabelWriter): void {
  const p = plan(), n = frame.scale ?? 2, type = frame.form === 'phone' ? PHONE_TYPE : typeForScale(n);
  restN = n; restType = type;
  const gw = Math.max(0, REGION_IDS.indexOf(s.gateway));
  for (let i = 0; i < p.cells.length && i < s.sites.length; i++) {
    const site = s.sites[i]!, b = p.cells[i]!, built = site.siteId !== null;
    // a site held in standby or sitting out is dimmed with its cell (world.ts)
    const dark = built && (site.online === 'standby' || site.powered === false || (frame.paused && site.online === 'offline'));
    const tone: LabelTone = built && !dark ? 'name' : site.open ? 'mute' : 'dim';
    // a closed region on the list's plate: one line, its name and then its climate
    if (!built && !site.open && p.lock) {
      out.label(`region${i}`, b.x + 8, b.y).text(NAMES[i]!, 'dim', true);
      out.label(CLIMATE_LABELS[i]!, b.x + LOCK_TAB, b.y).text(fits(CLIMATE_SIGNS[i]!, type, (b.w - LOCK_TAB - 2) * n) ? CLIMATE_SIGNS[i]! : CLIMATE_SHORT[i]!, 'dim');
      continue;
    }
    out.label(`region${i}`, b.x + 8, b.y + 2).text(NAMES[i]!, tone, true).br()
      .text(signOf(p, i, site, n, type).short ? CLIMATE_SHORT[i]! : CLIMATE_SIGNS[i]!, built && !dark ? 'value' : site.open ? 'mute' : 'dim');
    const sign = signOf(p, i, site, n, type);
    sign.footX = -1;
    if (!built) continue;
    const wide = (b.w - 8) * n, mode = modeText(site);
    out.label(`site${i}`, b.x + 4, b.y + p.footY);
    if (mode) out.text(mode, 'mute');
    else {
      const hot = `${whole(Math.round(site.hottestF))}°F`, grid = site.grid ? `${whole(Math.round(site.grid.usage * 100))}%` : null;
      const long = fits(`Hot ${hot} · Grid ${grid ?? ''}`, type, wide);
      out.text(long ? 'Hot' : '', 'mute').text(hot, site.hottestF >= HOT_F ? 'warn' : 'value');
      if (grid) out.text(long ? '· Grid' : '·', 'mute').text(grid, site.grid!.usage > GRID_HIGH ? 'warn' : 'value');
    }
    if (p.lines < 2 && !p.list) continue;
    // the site's links: its data plane, and the backbone link that reaches it
    let link: LinkView | null = null;
    for (const L of s.backbone.links) if (L.siteId === site.siteId && i !== gw) link = L;
    const plane = site.dataPlane ? `Plane ${formatHertz(site.dataPlane.bitsPerSec)}` : '', bb = link ? `Link ${formatHertz(link.speedHz)}` : '';
    const both = plane && bb ? `${plane} · ${bb}` : plane || bb;
    if (p.list) {
      // the list's footer: the links at the state line's east end where they fit beside it, else on a second line
      const state = mode ?? `Hot ${whole(Math.round(site.hottestF))}°F · Grid ${site.grid ? whole(Math.round(site.grid.usage * 100)) : ''}%`;
      const room = wide - labelTextWidth(state, type) - 16, text = fits(both, type, room) ? both : fits(bb || plane, type, room) ? bb || plane : '';
      if (text) out.label(LINK_LABELS[i]!, b.x + b.w - 4, b.y + p.footY, 'right').text(text, 'net');
      else if (p.lines >= 2) out.br().text(fits(both, type, wide) ? both : bb || plane, 'net');
      continue;
    }
    if (p.lines < 3) { out.br().text(fits(both, type, wide) ? both : bb || plane, 'net'); continue; }
    // three lines: the data plane, then the backbone link; the gateway has no link of its own
    const second = plane && bb ? bb : i === gw ? 'Gateway' : '';
    out.br().text(plane || bb, 'net');
    if (second) out.br().text(second, plane && bb ? 'net' : 'mute');
    sign.footX = 4 + Math.ceil(Math.max(labelTextWidth(plane || bb, type), labelTextWidth(second, type)) / n) + 2;
    sign.footW = b.w - 2 - sign.footX;
  }
  // the scheduler: routes per second, and (D31) the start controller's sites on
  const st = s.start ?? null, h = p.hub;
  if (!s.scheduler && !st) return;
  out.label('hub', h.x + h.w + 9, h.y);
  if (s.scheduler) out.text('Scheduler', 'name', true).text(`${whole(s.scheduler.routedPerSec)}/s`, 'value');
  if (st) out.text(s.scheduler ? '·' : '', 'mute').text(`${whole(st.awake)}/${whole(st.total)} sites on`, 'value');
}
