// Glyphs for Storage, Distributed, Multi-zone and Regional: 10×10, '_' leaves the plate.
// Storage glyphs are 10×9 (row 9 falls on the cylinder's base). The Distributed frame's
// corner nodes take the glyph's four corner pixels.
import { line, put, rect } from './compose.mjs';

const R = (s) => s.split(/\s+/).filter(Boolean).map((r) => r.replace(/_/g, '.'));
const node = (G, x, y, c) => rect(G, x, y, 2, 2, c);

export const TYPE_GLYPHS = {
  // platters and an activity lamp
  storage: R(`
    __________
    a________a
    _aaaaaaaa_
    __________
    a________a
    _aaaaaaaa_
    __________
    _______ww_
    __________
    __________`),
  // servers in the rack
  cluster: R(`
    __________
    _llllllll_
    _aaaaaawa_
    __________
    _llllllll_
    _aaaaaawa_
    __________
    _llllllll_
    _aaaaaawa_
    __________`),
  // a rack in each hall
  zones: R(`
    __________
    _lll__lll_
    _ada__ada_
    _lll__lll_
    _adw__adw_
    _lll__lll_
    _ada__ada_
    _lll__lll_
    __________
    __________`),
  // meridian, equator and a location pin
  region: R(`
    __________
    ___llll___
    __lwllll__
    __llkkll__
    __llkkll__
    __llllll__
    ___llll___
    ____ll____
    __dddddd__
    __________`),
};

export const GLYPHS = {
  // ── Storage ──
  logIngest: R(`
    __________
    __dddd_dd_
    __________
    __aaa_aaaa
    __________
    w_aaaaa_a_
    _w________
    w_llll_ll_
    __________
    __________`),
  backup: R(`
    ____ll____
    ____ll____
    __llllll__
    ___llll___
    ____ll____
    __________
    a________a
    a________a
    aaaaaaaaaa
    __________`),
  indexBuild: R(`
    __________
    ___wwww___
    ___wwww___
    __d_dd_d__
    _d__dd__d_
    _d__dd__d_
    lll_ll_lll
    lll_ll_lll
    __________
    __________`),
  compaction: R(`
    __________
    dd__dd__dd
    dd__dd__dd
    __________
    aaaa__aaaa
    aaaa__aaaa
    __________
    llllllllll
    llllllllll
    __________`),
  sqlScan: R(`
    aaaaaaa___
    __________
    ddd_lll___
    ___l___l__
    dd_l___l__
    ___l___l__
    dd__lll___
    _______ll_
    ________ll
    __________`),

  // ── Distributed: rack-scale ──
  replWrite: R(`
    __________
    ___wwww___
    ___wwww___
    ____aa____
    _aaaaaaaa_
    _a__aa__a_
    _ll_ll_ll_
    _ll_ll_ll_
    _ll_ll_ll_
    __________`),
  cdnFill: R(`
    ___ll_____
    __llll_ll_
    _lllllllll
    _aaaaaaaa_
    __________
    ____ww____
    ____ww____
    __wwwwww__
    ___wwww___
    ____ww____`),
  apiFanout: (G) => {
    for (const y of [1, 3, 6, 8]) line(G, 2, y > 4 ? 5 : 4, 7, y, 'a');
    rect(G, 0, 3, 2, 4, 'w');
    for (const y of [1, 3, 6, 8]) rect(G, 8, y, 2, 1, 'l');
  },
  payroll: R(`
    __________
    ___ll_____
    __lllll___
    _ll_l___aa
    __llll____
    ____l_l_aa
    _lllll____
    ___ll___aa
    __________
    __________`),
  mapReduce: R(`
    __________
    ____aa____
    ___daad___
    __d____d__
    llddaaddww
    ll__aa__ww
    __d____d__
    ___daad___
    ____aa____
    __________`),
  trainShard: R(`
    __________
    _a________
    _a_l______
    _a_ll_____
    _a__ll____
    _a___lll__
    _a_____llw
    _a________
    _aaaaaaaa_
    __________`),
  // ── Distributed: room-scale ──
  teraSort: R(`
    __________
    ________ww
    ______wwll
    ______llll
    ____wwllll
    ____llllll
    __wwllllll
    __llllllll
    wwllllllll
    __________`),
  renderFarm: R(`
    __________
    _wwddwwdd_
    _ddwwddww_
    _l________
    _llllllll_
    _laaaaaal_
    _laaaaaal_
    _laaaaaal_
    _llllllll_
    __________`),
  pageRank: (G) => {
    for (const [x, y] of [[1, 1], [1, 8], [8, 1]]) line(G, x, y, 6, 6, 'd');
    node(G, 1, 1, 'a'); node(G, 0, 7, 'a'); node(G, 7, 1, 'a');
    rect(G, 5, 5, 4, 4, 'l'); rect(G, 6, 6, 2, 2, 'w');
  },
  bigTrain: (G) => {
    for (const a of [1, 4, 7]) for (const b of [1, 4, 7]) { line(G, 1, a, 4, b, 'd'); line(G, 5, b, 8, a, 'd'); }
    for (const y of [1, 4, 7]) { node(G, 0, y, 'a'); node(G, 4, y, 'l'); node(G, 8, y, 'a'); }
  },

  // ── Multi-zone ──
  activeActive: R(`
    __________
    ______l___
    _______l__
    lllllllll_
    _______l__
    ______l___
    ___w______
    __w_______
    _wwwwwwwww
    __w_______`),
  quorumWrite: R(`
    __________
    ________w_
    _______w__
    _w____w___
    __w__w____
    ___ww_____
    __________
    _ll_ll_dd_
    _ll_ll_dd_
    __________`),
  drBackup: (G) => {
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const d = Math.hypot(x - 4.5, y - 4.5);
      if (d < 2.2 || d > 4.9) continue;
      const diag = Math.abs(Math.abs(x - 4.5) - Math.abs(y - 4.5)) < 1.6;
      put(G, x, y, diag ? 'w' : 'l');
    }
  },
  hallTrain: (G) => {
    for (const y of [1, 7]) { line(G, 1, y, 3, 4, 'd'); line(G, 8, y, 6, 4, 'd'); }
    line(G, 3, 4, 6, 4, 'w'); line(G, 3, 5, 6, 5, 'w');
    for (const y of [1, 7]) { node(G, 0, y, 'a'); node(G, 8, y, 'a'); }
    node(G, 2, 4, 'l'); node(G, 6, 4, 'l');
  },

  // ── Regional ──
  euResidency: (G) => {
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; put(G, Math.round(4.5 + Math.cos(a) * 4.4), Math.round(4.5 + Math.sin(a) * 4.4), 'a'); }
    rect(G, 4, 2, 2, 1, 'l'); put(G, 3, 3, 'l'); put(G, 6, 3, 'l');
    rect(G, 3, 4, 4, 3, 'l'); put(G, 4, 5, 'w'); put(G, 5, 5, 'w');
  },
  llmTrain: R(`
    __________
    _llllllll_
    l________l
    l_wwww_w_l
    l________l
    l_aaa_aa_l
    l________l
    _lllllll__
    _ll_______
    _l________`),
  apacPayments: R(`
    __________
    __________
    _llllllll_
    laaaaaaaad
    dddddddddd
    laaaaaaaad
    lwwaaallad
    _dddddddd_
    __________
    __________`),
  exchangeFeed: (G) => {
    line(G, 0, 8, 3, 4, 'l'); line(G, 3, 4, 5, 6, 'l'); line(G, 5, 6, 8, 2, 'l');
    line(G, 0, 9, 9, 9, 'd');
    put(G, 6, 1, 'w'); put(G, 7, 1, 'w'); put(G, 8, 1, 'w'); put(G, 8, 2, 'w'); put(G, 8, 3, 'w');
  },
};
