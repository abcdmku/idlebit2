// One restrained palette for every level. Names, not hex, in level code.
// See STYLE.md "Palette" for roles. Add a colour here only if no role fits.
export const P = {
  // structure
  ink: '#0e0b1c',        // 1px outlines, deepest shadow
  void: '#15122a',       // frame background around worlds
  substrate: '#1f1a3a',  // chip package, chassis floor
  substrateHi: '#29234b',
  mask: '#33296b',       // PCB solder mask
  maskHi: '#41368a',
  maskLo: '#271f55',
  silk: '#a99be6',       // silkscreen, ghost outlines
  silkLo: '#5d5296',
  wafer: '#363250',      // bare silicon
  waferHi: '#433e61',
  waferLo: '#2c2844',
  logic: '#4a3a8e',      // active logic blocks
  logicHi: '#6853b6',
  logicLo: '#332767',
  steel: '#8c90ad',      // metal lids, rails, screws
  steelHi: '#c9cce0',
  steelLo: '#5b5f7c',

  // currencies (only these mean money)
  gold: '#ffcc3d', goldHi: '#fff1a6', goldLo: '#c4861c', goldInk: '#3a2200',
  data: '#27d9a0', dataHi: '#b8ffe6', dataLo: '#128a68',

  // work and lanes (kind of work = colour)
  bit: '#a6f6ff', bitLo: '#3fb6d6',      // job packets, cache reads
  op: '#e6dcff',                          // compute ops
  cacheOn: '#8ef5ff', sram: '#25506e', sramLo: '#1b3a52',
  preload: '#77a7ff',                    // queued cache preparation, distinct from running work
  ram: '#ffa94d', gpu: '#ff7ad9', net: '#7be38f', stor: '#e0b07a',

  // metals
  copper: '#d9883a', copperHi: '#f5b878', copperLo: '#8c4f1f',
  pad: '#e8ae45', padHi: '#ffe08a', padLo: '#7d5a24',

  // state
  rnd: '#ff6bd6', rndLo: '#7a2a6e',      // research
  heat: '#ff5a36', heatHi: '#ffb36b',
  cool: '#5ab0ff', coolHi: '#bfe3ff', coolLo: '#2a5c9e',
  led: '#7dff9a', ledOff: '#1f3a2c', amber: '#ffb03b',
  fault: '#ff3b3b',

  // world map (global level): sea from deep to foam, land from lowland to ice
  seaDeep: '#1a2758', sea: '#1f3066', seaShelf: '#253c78', seaShallow: '#2d4c8c', foam: '#4876b8', coast: '#111838',
  land: '#46845a', landHi: '#5a9c66', landLo: '#386d4a', forest: '#356c48', sand: '#a08a58', rock: '#6f8268',
  ice: '#b9bed8', iceHi: '#d6d9ec', cliff: '#2b2a3e', night: '#0a0920',

  // UI text
  paper: '#efeaff', mute: '#a99be6', dim: '#6e6698',

  // v3 shared world pieces (mockup v3ui.js, market.js, view.js)
  veil: '#06040e',       // paused-world veil
  lampOff: '#2a2440',    // unit lamp: offline
  lampWell: '#3a2a10',   // unit lamp: drained part of a 10 s switch
  well: '#110d22', wellHi: '#1b1437', // empty feed slot
  faultLo: '#3a1420',    // failed cartridge face
  binLo: '#2a1020',      // fail bin face
};

// Background colour each level fills behind its world.
export const BG: Readonly<Record<'chip' | 'system' | 'rack' | 'room' | 'global', string>> = {
  chip: '#33296b',   // the CPU's board (P.mask): its world fades in over the System as one board
  system: '#1a1631',
  rack: '#141226',
  room: '#121022',
  global: '#0f0d1e',
};

// Stage-kind colours used by lanes, pads and packets.
export const KIND = {
  cache: P.cacheOn, compute: P.op, ram: P.ram, gpu: P.gpu, net: P.net, stor: P.stor, rnd: P.rnd,
};

const mixes = new Map<string, Map<string, Map<number, string>>>();
/** Cache material ramps. Repeated drawing does no parsing or string construction. */
export function mix(a: string, b: string, t: number): string {
  let byB = mixes.get(a);
  if (!byB) { byB = new Map(); mixes.set(a, byB); }
  let byT = byB.get(b);
  if (!byT) { byT = new Map(); byB.set(b, byT); }
  const found = byT.get(t);
  if (found) return found;
  let result = '#';
  for (let i = 1; i <= 5; i += 2) {
    const av = Number.parseInt(a.slice(i, i + 2), 16), bv = Number.parseInt(b.slice(i, i + 2), 16);
    result += Math.round(av + (bv - av) * t).toString(16).padStart(2, '0');
  }
  byT.set(t, result);
  return result;
}


