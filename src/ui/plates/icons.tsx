import { P } from '../../render/core/palette';

/**
 * Pixel glyphs as inline SVG: crisp at any scale and drawn without a canvas, so jsdom sees them.
 * Maps are ported from the mockup (core/px.js COIN8, GEM8, LOCK).
 */
type PixelMap = readonly string[];
const COIN8: PixelMap = ['..kkkk..', '.kwyyyk.', 'kwyyyyok', 'kwyyyyok', 'kyyyyyok', 'kyyyyook', '.kooook.', '..kkkk..'];
const GEM8: PixelMap = ['...kk...', '..kwtk..', '.kwttdk.', 'kwtttddk', 'kttttddk', '.kttddk.', '..kddk..', '...kk...'];
const LOCK: PixelMap = ['..ggg..', '.g...g.', '.g...g.', 'kkkkkkk', 'kgggggk', 'kggkggk', 'kgggggk', 'kkkkkkk'];
const COIN_COLORS = { k: P.goldInk, w: P.goldHi, y: P.gold, o: P.goldLo };
const GEM_COLORS = { k: '#06372a', w: P.dataHi, t: P.data, d: P.dataLo };
const LOCK_COLORS = { k: P.ink, g: P.silk };

function Pixels({ map, colors, className, label }: { map: PixelMap; colors: Readonly<Record<string, string>>; className: string; label?: string }) {
  const w = map[0].length, h = map.length, rects = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = colors[map[y][x]];
    if (c) rects.push(<rect key={y * w + x} x={x} y={y} width={1} height={1} fill={c} />);
  }
  return <svg className={className} viewBox={`0 0 ${w} ${h}`} width={w} height={h} shapeRendering="crispEdges"
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>{rects}</svg>;
}

export const CoinIcon = () => <Pixels map={COIN8} colors={COIN_COLORS} className="px-ic coin" label="Credits" />;
export const GemIcon = () => <Pixels map={GEM8} colors={GEM_COLORS} className="px-ic gem" label="Data" />;
/** The locked mark (never "×", which reads as close). */
export const LockIcon = () => <Pixels map={LOCK} colors={LOCK_COLORS} className="px-ic lock" />;
