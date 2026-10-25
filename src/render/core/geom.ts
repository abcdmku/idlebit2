export interface Point { x: number; y: number }
export interface Rect extends Point { w: number; h: number }

export function rect(x = 0, y = 0, w = 0, h = 0): Rect { return { x, y, w, h }; }
export function copyRect(source: Rect, out: Rect): Rect {
  out.x = source.x; out.y = source.y; out.w = source.w; out.h = source.h;
  return out;
}
export function setRect(out: Rect, x: number, y: number, w: number, h: number): Rect {
  out.x = x; out.y = y; out.w = w; out.h = h;
  return out;
}
export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}
