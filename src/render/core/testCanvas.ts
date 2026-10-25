// Test-only recording 2D context: fillRect calls with the fill colour at call time.
export interface Fill { x: number; y: number; w: number; h: number; c: string; a: number }
export interface Text { text: string; x: number; y: number; maxWidth?: number; font: string }
export interface Recording { g: CanvasRenderingContext2D; fills: Fill[]; texts: Text[]; readonly images: number }
export function recordingContext(): Recording {
  const fills: Fill[] = [], texts: Text[] = [];
  const state = { fillStyle: '', font: '', globalAlpha: 1, images: 0 };
  const g = {
    get fillStyle() { return state.fillStyle; }, set fillStyle(v: string) { state.fillStyle = v; },
    get globalAlpha() { return state.globalAlpha; }, set globalAlpha(v: number) { state.globalAlpha = v; },
    imageSmoothingEnabled: false,
    get font() { return state.font; }, set font(v: string) { state.font = v; },
    fillText(text: string, x: number, y: number, maxWidth?: number) { texts.push({ text, x, y, maxWidth, font: state.font }); },
    strokeText() {}, lineWidth: 1, lineJoin: 'miter', strokeStyle: '',
    measureText(text: string) { return { width: text.length * 8 }; },
    textBaseline: 'alphabetic',
    fillRect(x: number, y: number, w: number, h: number) { fills.push({ x, y, w, h, c: state.fillStyle, a: state.globalAlpha }); },
    clearRect() {}, setTransform() {}, translate() {}, scale() {},
    drawImage() { state.images++; },
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
  } as unknown as CanvasRenderingContext2D;
  return { g, fills, texts, get images() { return state.images; } };
}
/** Colour of the last fill covering pixel (x, y). */
export function colorAt(fills: readonly Fill[], x: number, y: number): string | null {
  for (let i = fills.length - 1; i >= 0; i--) {
    const f = fills[i];
    if (x >= f.x && y >= f.y && x < f.x + f.w && y < f.y + f.h) return f.c;
  }
  return null;
}
