// Glyphs for Compute, Parallel, Memory and Accelerated: 10×10, '_' leaves the plate.
// l: light (the main stroke), a: base, d: shade, w: white highlight.
import { line, put, rect } from './compose.mjs';

const R = (s) => s.split(/\s+/).filter(Boolean).map((r) => r.replace(/_/g, '.'));
const disc = (G, cx, cy, r, f) => { for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) { const d = Math.hypot(x - cx, y - cy); if (d <= r) put(G, x, y, f(d, x, y)); } };
const node = (G, x, y, c) => rect(G, x, y, 2, 2, c);

export const TYPE_GLYPHS = {
  // a die with its core
  compute: R(`
    __________
    __________
    __llllla__
    __laaaad__
    __lawwad__
    __lawwad__
    __laaaad__
    __dddddd__
    __________
    __________`),
  // three jobs running side by side
  parallel: R(`
    __________
    _llllllw__
    _aaaaaaw__
    __________
    _llllllw__
    _aaaaaaw__
    __________
    _llllllw__
    _aaaaaaw__
    __________`),
  // DRAM packages on the stick
  memory: R(`
    __________
    __________
    _ll_ll_ll_
    _la_la_la_
    _la_la_la_
    _la_la_la_
    _aa_aa_aa_
    __________
    __________
    __________`),
  // a grid of shader / tensor cores
  accel: R(`
    __________
    _ll_ll_ll_
    _la_la_la_
    __________
    _ll_ww_ll_
    _la_ww_la_
    __________
    _ll_ll_ll_
    _la_la_la_
    __________`),
};

export const GLYPHS = {
  // ── Compute: bits ──
  bitFlip: R(`
    ___wwww___
    __w____w__
    __w___www_
    _______w__
    __________
    _aaa___l__
    _a_a__ll__
    _a_a___l__
    _a_a___l__
    _aaa__lll_`),
  parity: R(`
    __________
    _l_d_l_w__
    _l_d_l_w__
    __________
    _______ll_
    ______ll__
    _ll__ll___
    __llll____
    ___ll_____
    __________`),
  andMask: R(`
    __lll_____
    _ll_ll____
    _ll_ll____
    __lll_____
    _llll__ll_
    ll__ll_ll_
    ll___lll__
    ll____ll__
    _lllll_ll_
    __________`),
  compare: R(`
    __________
    _ll_______
    _ll_______
    _ll_w_____
    _ll__w____
    _ll___w_aa
    _ll__w__aa
    _ll_w___aa
    _ll_____aa
    __________`),
  intAdd: R(`
    _______w__
    ______ww__
    _______w__
    ___ll__w__
    ___ll_www_
    _llllll___
    _llllll___
    ___ll_____
    ___ll_____
    __________`),
  // ── Compute: integers ──
  popcount: R(`
    __________
    _llllll_l_
    _ll___l___
    __ll____d_
    ___ll_____
    __ll____l_
    _ll___l___
    _llllll_l_
    __________
    __________`),
  crc8: R(`
    ______w___
    ___lllww__
    __l___w___
    _l________
    _l__aa__l_
    _l__aa__l_
    _l______l_
    __l____l__
    ___llll___
    __________`),
  multiply: R(`
    __________
    _ll____ll_
    _lll__lll_
    __llllll__
    ___llll___
    ___llll___
    __llllll__
    _lll__lll_
    _ll____ll_
    __________`),
  fnvHash: R(`
    __________
    ___l__l___
    ___l__l___
    _llllllll_
    ___l__l___
    ___l__l___
    _llllllll_
    ___l__l___
    ___l__l___
    __________`),
  crc32: R(`
    ______w___
    ___lllww__
    __l___w___
    _l__aa____
    _l_a__a_l_
    _l_a__a_l_
    _l__aa__l_
    __l____l__
    ___llll___
    __________`),
  binSearch: R(`
    __________
    __llll____
    _ld__al___
    ldd___al__
    ldd___al__
    ldd___al__
    _ld__al___
    __lllllw__
    _______ww_
    ________ww`),
  regex: R(`
    __________
    ___l__l__l
    ____l_l_l_
    _____lll__
    ___lllwlll
    _____lll__
    ____l_l_l_
    ___l__l__l
    _ww_______
    _ww_______`),
  intSort: R(`
    __________
    ________l_
    ________l_
    ______l_l_
    ______l_l_
    ____l_l_l_
    ____l_l_l_
    __l_l_l_l_
    l_l_l_l_l_
    __________`),

  // ── Parallel ──
  hashBatch: R(`
    _d_d______
    ddddd_____
    _d_d______
    ddddd_____
    _d_d_l_l__
    ____lllll_
    _____l_l__
    ____lllll_
    _____l_l__
    __________`),
  lzCompress: R(`
    ____ll____
    __llllll__
    ___llll___
    ____ll____
    _wwwwwwww_
    _aaaaaaaa_
    ____ll____
    ___llll___
    __llllll__
    ____ll____`),
  monteCarlo: R(`
    _lllllll__
    llaaaaaad_
    la_aaa_ad_
    laaaaaaad_
    laaa_aaad_
    laaaaaaad_
    la_aaa_ad_
    laaaaaaad_
    _ddddddd__
    __________`),

  // ── Memory ──
  jsonParse: R(`
    _ll____ll_
    _l______l_
    _l______l_
    _l__ww__l_
    l________l
    _l__ww__l_
    _l______l_
    _l______l_
    _ll____ll_
    __________`),
  mergeSort: R(`
    __________
    ________l_
    _______al_
    ______lal_
    _____alal_
    ____lalal_
    ___alalal_
    __lalalal_
    __________
    __________`),
  kvGet: R(`
    __________
    __________
    _lll______
    l___l_____
    l_w_llllll
    l___l__l_l
    _lll___l__
    __________
    __________
    __________`),
  sqlJoin: (G) => {
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const a = Math.hypot(x - 3.2, y - 4.5), b = Math.hypot(x - 6.8, y - 4.5);
      if (a < 3.1 && b < 3.1) put(G, x, y, 'w');
      else if (a >= 2.6 && a < 3.6) put(G, x, y, 'l');
      else if (b >= 2.6 && b < 3.6) put(G, x, y, 'a');
    }
  },
  graphBfs: (G) => {
    line(G, 4, 1, 1, 4, 'd'); line(G, 5, 1, 8, 4, 'd');
    line(G, 1, 5, 0, 8, 'd'); line(G, 2, 5, 3, 8, 'd'); line(G, 8, 5, 9, 8, 'd');
    node(G, 4, 0, 'w'); node(G, 1, 4, 'l'); node(G, 7, 4, 'l');
    node(G, 0, 8, 'a'); node(G, 3, 8, 'a'); node(G, 8, 8, 'a');
  },
  matmul: R(`
    __________
    ll______ll
    l_ll__aa_l
    l_ll__aa_l
    l________l
    l________l
    l_aa__ww_l
    l_aa__ww_l
    ll______ll
    __________`),

  // ── Accelerated ──
  imageBlur: (G) => disc(G, 4.5, 4.5, 4.6, (d, x, y) => (d < 1.6 ? 'w' : d < 2.7 ? 'l' : d < 3.7 ? 'a' : (x + y) % 2 ? 'd' : '.')),
  thumbnail: R(`
    __________
    _aaaaaaaa_
    _a____wwa_
    _a____wwa_
    _a_l____a_
    _alll_l_a_
    _alllllla_
    _aaaaaaaa_
    __________
    __________`),
  transcode: R(`
    __________
    a_a_a_a_a_
    llllllllll
    lddlaalwwl
    lddlaalwwl
    lddlaalwwl
    llllllllll
    _a_a_a_a_a
    __________
    __________`),
  inference: (G) => {
    for (const a of [0, 4, 8]) for (const b of [2, 6]) line(G, 1, a, 4, b, 'd');
    for (const b of [2, 6]) line(G, 5, b, 8, 4, 'd');
    for (const a of [0, 4, 8]) node(G, 0, a, 'a');
    for (const b of [2, 6]) node(G, 4, b, 'l');
    node(G, 8, 4, 'w');
  },
  rayTrace: (G) => {
    disc(G, 5.5, 5.5, 3.9, (d, x, y) => { const l = Math.hypot(x - 4.4, y - 4.4); return l < 1.2 ? 'w' : l < 2.5 ? 'l' : d < 3.1 ? 'a' : 'd'; });
    line(G, 0, 0, 2, 2, 'w'); line(G, 3, 1, 4, 0, 'l');
  },
};
