// Each core's own live speed (user): a core may run below the socket clock (C-states and later
// research), so every core shows its Hz: on its tile when a body-size label fits, else in the busy
// tag. A sleeping core dims and shows its C-state instead. Values come from CoreView (`hz`, the live clock, 0 asleep; `sleep`, the
// C-state or 'S3'). Text goes through the shared formatHertz at the body size. A grid tile too small
// for that (32 sites) shows no half value: the busy tag carries the cores' speed instead (labels.ts).
import { formatHertz } from '../../../game';
import type { ChipSnapshot, CoreView } from '../../../game';
import { P, PHONE_TYPE, typeForScale } from '../../core';
import type { Rect, WorldFrame } from '../../core';

/** The core's live clock (Hz), 0 while it sleeps. */
export const coreHz = (c: CoreView): number => c.hz;
/** The core's sleep state ("C1", "S3") while it sleeps, else null. */
export const coreSleep = (c: CoreView): string | null => c.sleep;
/** The text a core tile shows: its C-state asleep, else its Hz. */
export const coreSpeedText = (c: CoreView): string => coreSleep(c) ?? formatHertz(coreHz(c));
/** Small grid cores use the short cache phase names; big cards spell out the operation. */
export function coreActivityText(c: CoreView, compact = false): string {
  if (c.activity === 'cacheLoad') return compact ? 'Load' : 'Cache load';
  if (c.activity === 'cacheAccess') return compact ? 'Cache' : 'Cache read';
  if (c.activity === 'compute') return 'Compute';
  return c.research > 0 ? 'Research' : c.busy > 0 ? 'Waiting' : 'Idle';
}
/** QA-24: between rounds (not live) a core that reports 0 Hz shows the clock it is ready to run at. */
export const readySpeedText = (c: CoreView, chip: ChipSnapshot, live: boolean): string =>
  !live && !coreSleep(c) && coreHz(c) <= 0 ? formatHertz(chip.clock.hz) : coreSpeedText(c);

/** Rough CSS width of `text` at `body` px in Chakra Petch (digits and units average about 0.58 em). */
export const textWidth = (text: string, body: number): number => Math.ceil(text.length * body * 0.58);
/** A grid tile shows its speed as a body-size label when that fits at the world's rest scale (labels.ts), else as a readout. */
export function tileLabelFits(c: CoreView, tile: Rect, frame: WorldFrame): boolean {
  const scale = frame.scale ?? (frame.form === 'phone' ? 2 : 3), t = frame.form === 'phone' ? PHONE_TYPE : typeForScale(scale);
  return labelFits(coreSpeedText(c), tile, scale, t.body, t.line);
}
/** True when a body-size label of `text` fits inside `span` at the world's rest scale. */
export function spanFits(text: string, span: Rect, frame: WorldFrame): boolean {
  const scale = frame.scale ?? (frame.form === 'phone' ? 2 : 3), t = frame.form === 'phone' ? PHONE_TYPE : typeForScale(scale);
  return labelFits(text, span, scale, t.body, t.line);
}
/** True when a body-size label of `text` fits inside the tile with a 2 art px margin each side. */
export function labelFits(text: string, tile: Rect, scale: number, body: number, line: number): boolean {
  return textWidth(text, body) <= (tile.w - 4) * scale && line <= (tile.h - 2) * scale;
}

/** True when the tile can show its own speed: a body-size label fits. */
export const tileShowsSpeed = (c: CoreView, r: Rect, frame: WorldFrame): boolean => tileLabelFits(c, r, frame);
/** Dim a sleeping core's tile (real state: it is in a C-state, not running). */
export function dimIfAsleep(g: CanvasRenderingContext2D, r: Rect, c: CoreView, live: boolean): void {
  if (!live || !coreSleep(c)) return;
  const a = g.globalAlpha; g.globalAlpha = a * 0.45; g.fillStyle = P.ink; g.fillRect(r.x, r.y, r.w, r.h); g.globalAlpha = a;
}
