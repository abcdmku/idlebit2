import Decimal from 'decimal.js';
import { researchId as r } from '../../types/ids';
import type { LadderDef } from './types';

/**
 * D18.5 link power. Full-use watts grow with speed as speed^0.3: a faster link moves each bit for
 * far less energy, so a link stays a small share of the servers it feeds even where the re-based
 * catalog's speeds run ahead of real server traffic. At 1 kHz a link draws wPerUnit W per bit/s
 * (0.01, so the boot pipe draws 10 W at full use, 1% of a 1 kHz server). Idle is LINK_IDLE_SHARE
 * of full use: a 10 GHz rack uplink idles at 126 W, a 5e19 bit/s data-plane port at about 1e5 W
 * (the old rate-part rule idled it at 5e17 W).
 */
export const LINK_SPEED_EXP = 0.3;
export const LINK_IDLE_SHARE = 0.1;
export function linkWatts(wPerUnit: number, speed: number): { readonly idle: number; readonly load: number } {
  if (!(speed > 0)) return { idle: 0, load: 0 };
  const load = wPerUnit * 1e3 * (speed / 1e3) ** LINK_SPEED_EXP;
  return { idle: LINK_IDLE_SHARE * load, load };
}

/** D14 replaces the legacy LadderDef.portStep array with stream-scaled clock pricing. */
export interface NetworkLadderDef extends Omit<LadderDef, 'portStep'> {
  readonly streams: number;
  readonly uplinkStreams?: number;
}

// Decimal arithmetic keeps whole-Credit ceilings reliable above Number.MAX_SAFE_INTEGER.
const PriceDecimal = Decimal.clone({ precision: 80 });
const ALPHA = new PriceDecimal('1.7').ln().div(new PriceDecimal('1.5').ln());
const CLOCK_BASE = ['1', '1e3', '1e6', '1e9'] as const;
const CLOCK_UPGRADE = ['3', '1.5e4', '9e7', '2.4e11'] as const;

/** Spec §12.5: choose the clock generation by the destination speed per stream. */
export function portSpeedPrice(fromHz: number | string, toHz: number | string, streams: number): bigint {
  const from = new PriceDecimal(fromHz), to = new PriceDecimal(toHz);
  if (!from.isFinite() || !to.isFinite() || !from.gt(0) || to.lt(from) || !Number.isSafeInteger(streams) || streams < 1) {
    throw new RangeError('Port pricing needs positive ordered speeds and a positive whole stream count');
  }
  const x = to.div(streams), y = from.div(streams);
  let c = 0;
  while (c < 3 && x.gte(CLOCK_BASE[c + 1]!)) c += 1;
  const b = CLOCK_BASE[c]!;
  const price = x.div(b).pow(ALPHA).minus(y.div(b).pow(ALPHA))
    .times(CLOCK_UPGRADE[c]!).times(streams).div('0.7');
  // Discard transcendental-operation noise before ceil, retaining 64 significant digits.
  return BigInt(price.toSignificantDigits(64).ceil().toFixed(0));
}

/**
 * D25.7 router-queue streams and price era per router scope (spec §12.7): the rack LB carries 12
 * streams priced in the kHz era, the room LB 288 in MHz, the data plane 864 and the global
 * scheduler 6,912 in GHz.
 */
export const ROUTER_QUEUE_PRICE = { rack: { m: 12, era: 1 }, room: { m: 288, era: 2 }, site: { m: 864, era: 3 }, global: { m: 6912, era: 3 } } as const;
export type RouterScope = keyof typeof ROUTER_QUEUE_PRICE;

/** lbQueueStep(L → L + 1) = ceil(m × u / 0.7 × ((L + 1)^α − L^α)), exact decimal (spec §12.7). */
export function lbQueueStep(scope: RouterScope, level: number): bigint {
  if (!Number.isSafeInteger(level) || level < 1) throw new RangeError('Expected a router queue level of at least 1');
  const { m, era } = ROUTER_QUEUE_PRICE[scope];
  const price = new PriceDecimal(level + 1).pow(ALPHA).minus(new PriceDecimal(level).pow(ALPHA))
    .times(CLOCK_UPGRADE[era]!).times(m).div('0.7');
  return BigInt(price.toSignificantDigits(64).ceil().toFixed(0));
}

/** Σ lbQueueStep from level 1 to `level`: what a configuration with that queue level adds (spec §13.3). */
export function lbQueueStepsTo(scope: RouterScope, level: number): bigint {
  let total = 0n;
  for (let l = 1; l < level; l += 1) total += lbQueueStep(scope, l);
  return total;
}

/** Exact 1-2-5 speed, avoiding binary rounding of the largest catalog rungs. */
const priceSpeed = (k: number): string => {
  if (!Number.isSafeInteger(k) || k < 0) throw new RangeError('Expected a nonnegative whole ladder index');
  return `${[1, 2, 5][k % 3]}e${3 + Math.floor(k / 3)}`;
};

/** One port/uplink step. Data-plane zones are identical ports, each rounded before summing. */
export function networkStepPrice(row: NetworkLadderDef, k: number, uplink = false, zones = 1): bigint {
  if (!Number.isSafeInteger(zones) || zones < 1) throw new RangeError('Expected a positive whole zone count');
  const streams = uplink ? row.uplinkStreams ?? row.streams : row.streams;
  return portSpeedPrice(priceSpeed(k), priceSpeed(k + 1), streams) * BigInt(row.id === 'dataPlane' ? zones : 1);
}

/** Sum the individually rounded steps; same-speed actions sum this for each changed port. */
export function networkStepsBetween(row: NetworkLadderDef, fromK: number, toK: number, uplink = false, zones = 1): bigint {
  let total = 0n;
  for (let k = fromK; k < toK; k += 1) total += networkStepPrice(row, k, uplink, zones);
  return total;
}

/**
 * D12 / spec A.3: payload equals work. Round L36 native server traffic up to a 1-2-5 rung.
 * Native kHz/MHz/GHz servers have 8/16/32 cores, 2/4/8 lanes and clock × 1.5^35.
 * Shared port/uplink tops carry 12 servers at Rack, 288 at Room; later gens add at least 10×.
 * D13 defaults come from the upstream port: room ports carry about 12 rack references;
 * data plane and backbone defaults carry a full room. Their tops are default × 1,000.
 * Rack bases are top / 1,000, except the starter rack stays at 1 kHz. Its widened top also fits
 * uplinks, superseding A.3's proposed 1 GHz starter top. Ports share that headroom for now.
 * D14 prices speed steps at native clock parity. Link power follows linkWatts (D18.5).
 */
const SW_NAMES = ['500 GHz', '5 THz', '2 PHz', '20 PHz', '5 EHz', '50 EHz', '500 EHz'];
const SW_GATES = [r('rack'), r('sw100k'), r('sw1M'), r('sw10M'), r('sw100M'), r('sw1G'), r('sw10G')];

export const SWITCH: NetworkLadderDef = {
  id: 'switch', scope: 'rack', names: SW_NAMES.map((n) => `${n} switch`), gates: SW_GATES,
  baseK: [0, 20, 28, 31, 38, 41, 44], topK: [26, 29, 37, 40, 47, 50, 53], latency: SW_NAMES.map(() => 0),
  minPorts: 4, portCeiling: 'rackPorts', wPerUnit: 0.01,
  price: [2.4e6, 1.2e7, 4.3e11, 4.8e11, 3.7e14, 3.3e15, 9.1e15], streams: 1, uplinkStreams: 12,
  portAdd: [2.4e5, 1.2e6, 4.3e10, 4.8e10, 3.7e13, 3.3e14, 9.1e14], portAddGrowth: 1.25,
};
export const ROOM_SWITCH: NetworkLadderDef = {
  ...SWITCH, id: 'roomSwitch', scope: 'room',
  names: ['50 PHz', '500 PHz', '5 EHz', '50 EHz', '500 EHz', '5 ZHz', '50 ZHz'].map((n) => `${n} room switch`),
  baseK: [21, 24, 32, 35, 42, 45, 48], topK: [41, 44, 47, 50, 53, 56, 59], portCeiling: 'roomPorts',
  price: [9.5e10, 9.5e10, 1.4e11, 4.8e11, 3.7e14, 3.3e15, 9.1e15], streams: 12, uplinkStreams: 288,
  portAdd: [4.8e9, 4.8e9, 4.8e9, 1.4e10, 1.1e13, 1.1e14, 2.7e14], portAddGrowth: 1.1,
};
/** One 288-stream port per zone, all at one k; a step sums the zones' port prices. */
export const DATA_PLANE: NetworkLadderDef = {
  id: 'dataPlane', scope: 'site', names: ['Copper plane', 'Fiber plane', 'DWDM plane'], gates: [r('dataCenter'), r('dpFiber'), r('dpDwdm')],
  baseK: [50, 53, 56], topK: [59, 62, 65], latency: [0.2, 0.1, 0.05], minPorts: 1, wPerUnit: 0.01,
  price: [3.3e14, 1.1e15, 3.3e15], streams: 288,
};
/** Subsea latency between continents × 0.5 (subseaLatency). */
export const BACKBONE: NetworkLadderDef = {
  id: 'backbone', scope: 'global', names: ['Leased line', 'Dark fiber', 'DWDM backbone', 'Subsea cable'],
  gates: [r('regions'), r('bbDarkFiber'), r('bbDwdm'), r('bbSubsea')],
  // One site has up to three zones, each carrying the 288-server room reference.
  baseK: [53, 56, 59, 59], topK: [62, 65, 68, 68], latency: [0.4, 0.2, 0.1, 0.1], minPorts: 1, wPerUnit: 0.01,
  price: [9.1e15, 2.7e16, 9.1e16, 2.7e17], streams: 288,
};
