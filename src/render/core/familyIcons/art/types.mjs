// Player-facing task types (D23): the band → type grouping, one colour ramp per type, and the
// type frame every icon of that type sits in. Frames are 14×14: '.' outside, 'k' the dark plate
// the glyph sits on, 'l'/'a'/'d' the type ramp (light from the top-left). `box` is where the
// 10×10 glyph goes; every glyph pixel must land on plate.
export const TYPE_ORDER = ['compute', 'parallel', 'memory', 'accel', 'storage', 'cluster', 'zones', 'region'];

/** a: base (the type colour), d: shade, l: light. */
export const TYPES = {
  compute: { name: 'Compute', bands: ['bits', 'ints'], a: '#7fe3ff', d: '#3a8fb8', l: '#d4f8ff' },
  parallel: { name: 'Parallel', bands: ['threads'], a: '#b18cff', d: '#6447b8', l: '#e3d6ff' },
  memory: { name: 'Memory', bands: ['ram'], a: '#ff8c42', d: '#a8521f', l: '#ffd2a8' },
  accel: { name: 'Accelerated', bands: ['gpu'], a: '#c2e05a', d: '#6c8a26', l: '#effabf' },
  storage: { name: 'Storage', bands: ['storage'], a: '#d6ab78', d: '#86643f', l: '#f5e0c4' },
  cluster: { name: 'Distributed', bands: ['rackDist', 'roomDist'], a: '#aab3d4', d: '#5c6388', l: '#eceef8' },
  zones: { name: 'Multi-zone', bands: ['multiAz'], a: '#4f9dff', d: '#2856a6', l: '#bcdcff' },
  region: { name: 'Regional', bands: ['region'], a: '#ff8fb3', d: '#a84870', l: '#ffd6e4' },
};

const C = (s) => s.split(/\s+/).filter(Boolean);

export const FRAMES = {
  // a chip: pins on all four sides
  compute: { box: { x: 2, y: 2 }, rows: C(`
    ...a.a..a.a...
    .llllllllllla.
    .lkkkkkkkkkkd.
    alkkkkkkkkkkda
    .lkkkkkkkkkkd.
    alkkkkkkkkkkda
    .lkkkkkkkkkkd.
    .lkkkkkkkkkkd.
    alkkkkkkkkkkda
    .lkkkkkkkkkkd.
    alkkkkkkkkkkda
    .lkkkkkkkkkkd.
    .addddddddddd.
    ...a.a..a.a...`) },
  // stacked plates: a second job behind the first (leaning up-left, so it never reads as the cube)
  parallel: { box: { x: 3, y: 3 }, rows: C(`
    aaaaaaaaaaaa..
    a..........d..
    a.llllllllllla
    a.lkkkkkkkkkkd
    a.lkkkkkkkkkkd
    a.lkkkkkkkkkkd
    a.lkkkkkkkkkkd
    a.lkkkkkkkkkkd
    a.lkkkkkkkkkkd
    a.lkkkkkkkkkkd
    a.lkkkkkkkkkkd
    ddlkkkkkkkkkkd
    ..lkkkkkkkkkkd
    ..addddddddddd`) },
  // a RAM stick: side latches, contact teeth with an off-centre key notch
  memory: { box: { x: 2, y: 1 }, rows: C(`
    llllllllllllla
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    .lkkkkkkkkkkd.
    .lkkkkkkkkkkd.
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    addddddddddddd
    .a.a.a.a..a.a.
    .a.a.a.a..a.a.`) },
  // a tensor block: solid top and side faces
  accel: { box: { x: 1, y: 3 }, rows: C(`
    ..llllllllllla
    .aaaaaaaaaaaad
    llllllllllladd
    lkkkkkkkkkkadd
    lkkkkkkkkkkadd
    lkkkkkkkkkkadd
    lkkkkkkkkkkadd
    lkkkkkkkkkkadd
    lkkkkkkkkkkadd
    lkkkkkkkkkkadd
    lkkkkkkkkkkadd
    lkkkkkkkkkkadd
    lkkkkkkkkkkad.
    addddddddddd..`) },
  // a disk: a cylinder with an elliptical lid (glyph row 9 falls on the base, so storage glyphs are 10×9)
  storage: { box: { x: 2, y: 4 }, rows: C(`
    ..llllllllll..
    .laaaaaaaaaad.
    lddaaaaaaaaddd
    lkkddddddddkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    .akkkkkkkkkkd.
    ..dddddddddd..`) },
  // linked nodes: four servers wired in a ring
  cluster: { box: { x: 2, y: 2 }, rows: C(`
    lll........lll
    lwdaaaaaaaalwd
    lddkkkkkkkkldd
    .akkkkkkkkkka.
    .akkkkkkkkkka.
    .akkkkkkkkkka.
    .akkkkkkkkkka.
    .akkkkkkkkkka.
    .akkkkkkkkkka.
    .akkkkkkkkkka.
    .akkkkkkkkkka.
    lllkkkkkkkklll
    lwdaaaaaaaalwd
    ldd........ldd`) },
  // two zone halls under twin gables
  zones: { box: { x: 2, y: 3 }, rows: C(`
    ...ll....ll...
    ..lkka..lkkd..
    .lkkkkalkkkkd.
    .lkkkkkkkkkkd.
    .lkkkkkkkkkkd.
    .lkkkkkkkkkkd.
    .lkkkkkkkkkkd.
    .lkkkkkkkkkkd.
    .lkkkkkkkkkkd.
    .lkkkkkkkkkkd.
    .lkkkkkkkkkkd.
    .lkkkkkkkkkkd.
    .lkkkkkkkkkkd.
    .addddddddddd.`) },
  // a globe
  region: { box: { x: 2, y: 2 }, rows: C(`
    ....llllll....
    ..llkkkkkkaa..
    .lkkkkkkkkkka.
    .lkkkkkkkkkka.
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    lkkkkkkkkkkkkd
    .akkkkkkkkkkd.
    .akkkkkkkkkkd.
    ..aakkkkkkdd..
    ....dddddd....`) },
};
