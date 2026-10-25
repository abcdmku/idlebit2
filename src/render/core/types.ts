import type {
  GlobalSnapshot, LevelId, ShardDoneView, LevelSnapshot, NodeRef, PartRef, QuoteResult, RackSlotView, RenderSnapshot,
  ServerSlotView, SwitchRef, SystemSnapshot, UnitRef, ZoneView,
} from '../../game';
import type { RestFraming, WorldForm } from './camera';
import type { Point, Rect } from './geom';
import type { LabelWriter } from './labels';
import type { Completion } from './pops';
import type { ZoomState } from './transition';

export type { LevelId, LevelSnapshot, NodeRef, RenderSnapshot } from '../../game';
export type { Point, Rect } from './geom';
export type { RestFraming, WorldForm } from './camera';

/** The level snapshot a level renderer draws. */
export type SnapshotOf<L extends LevelId> = Extract<LevelSnapshot, { readonly level: L }>;
/** What a parent world hands a child level to draw that child's mini. */
export interface MiniSources {
  /** The system board draws its chip from its own snapshot (cpu part, activity). */
  readonly chip: SystemSnapshot;
  /** A rack draws each server from its slot view. */
  readonly system: ServerSlotView;
  /** A room draws each rack from its slot view. */
  readonly rack: RackSlotView;
  /** The global map draws each zone (room) of a site. */
  readonly room: ZoneView;
  /** Top level: only the gallery and rail icon draw it as a mini. */
  readonly global: GlobalSnapshot;
}
/** A drillable child of a world: where its mini sits in the parent's art px. */
export interface ChildView {
  ref: NodeRef;
  /** The tap rect (a 'child' hit target). */
  rect: Rect;
  /** Optional: where the child's world lands for the zoom, when it differs from the tap rect (rack row, sled). Reset each call. */
  world?: Rect | null;
}

export type HitKind = 'part' | 'child' | 'slot' | 'save' | 'unit' | 'port' | 'link';
/** Reused storage. Levels write fields; the UI turns a returned target into a ViewCommand. */
export interface HitTarget {
  /** Stable within the focus world for one layout; the selection key. */
  id: string;
  kind: HitKind;
  /** The focus node the target belongs to. */
  owner: NodeRef;
  /** Tapping zooms here ('child', and zone or site switchers). */
  drill: NodeRef | null;
  /** Opens the part, supply, cooler, LB or switch plate. */
  part: PartRef | null;
  /** The unit a save icon, lamp or online switch refers to. */
  unit: UnitRef | null;
  /** A switch port: the switch and port index (-1 = uplink row). */
  sw: SwitchRef | null;
  port: number | null;
  /** BuildSlotView.index, server slot or rack slot. */
  slot: number | null;
  /** Art px in the focus world. */
  rect: Rect;
}

/** UI state the world shows. The renderer never requests quotes. */
export interface ViewPresentation {
  /** HitTarget id to bracket, or null. */
  readonly selectedId: string | null;
  /** A tray item picked for placement: build slots of this kind light up. */
  readonly picked: string | null;
  /** Tray quotes the UI already holds for the visible level; null leaves ghosts unpriced. */
  readonly quotes: QuoteResult | null;
  readonly reducedMotion: boolean;
  /** The level a multi-level zoom is heading for (ViewState.goal), so its steps play as one move. */
  readonly zoomGoal?: LevelId | null;
}
/** The free world at rest, CSS px (the view below the strip, minus the gutters), and the shell's N. */
export interface RestArea { readonly w: number; readonly h: number; readonly scale: number }
/** Per-frame context for level drawing. Hardware motion reads `timeMs` only. */
export interface WorldFrame {
  readonly snapshot: RenderSnapshot;
  /** Presentation sim time: simTimeMs plus at most 100 ms of extrapolation, frozen while paused. */
  readonly timeMs: number;
  /** The round is not running: draw steady power LEDs only. The core draws the veil. */
  readonly paused: boolean;
  readonly reducedMotion: boolean;
  /** The zoom in progress, or null at rest. */
  readonly zoom: ZoomState | null;
  /** The layout form (RestFraming.form): desktop or phone. */
  readonly form?: WorldForm;
  /** At rest: the world rect (art px) visible below the band and strip. Null during a zoom or before framing. */
  readonly visible?: Rect | null;
  /**
   * The art scale this world rests at, CSS px per art px. It is the shell's N, or lower when the level
   * does not fit whole at N (A05). Levels arrange their labels by it (A01): stacked at 2 and below.
   */
  readonly scale?: number;
}

export interface LevelRenderer<L extends LevelId = LevelId> {
  readonly id: L;
  readonly name: string;
  /** World size in art px. Stable for one layout and form; it sizes the world buffer. */
  size(snapshot: SnapshotOf<L>, out: Rect, form?: WorldForm): Rect;
  /**
   * The rect the rest camera frames, inside `size`; the core contain-fits it whole (A05). `area` is the
   * free world at rest (CSS px) and the shell's N, for levels that frame part of a wide world (rack
   * row, world map); it is absent during zoom planning.
   */
  focus(snapshot: SnapshotOf<L>, viewport: Rect, out: Rect, form?: WorldForm, area?: RestArea): Rect;
  /** Optional: the art the pipe tags keep clear of, in world px, when the focus frames more than the art (the rack's phone gutter). Default: the focus. */
  tagClear?(snapshot: SnapshotOf<L>, out: Rect): Rect;
  /** Optional: the rect of this world that a parent's mini of it shows (CPU: its package). Defaults to `size`. */
  miniRect?(snapshot: SnapshotOf<L>, out: Rect, form?: WorldForm): Rect;
  /**
   * Optional: where the inbound link meets this level's art, at its top (D17): CPU the die's IN pad,
   * System the port cable at y 0, Rack the ceiling uplink, Room the gateway fibre, World the backbone hub.
   * The framed rest puts this point on the lattice, and the core's pipe drops into it.
   */
  entry?(snapshot: SnapshotOf<L>, out: Point, form?: WorldForm): Point;
  /** Backing-pixel scale increments at rest. Defaults to 1; dense boards may use half steps. */
  cameraScaleStep?(snapshot: SnapshotOf<L>): number;
  /** Full world into the level's buffer, in art px. */
  draw(g: CanvasRenderingContext2D, snapshot: SnapshotOf<L>, view: ViewPresentation, frame: WorldFrame): void;
  /** This level as a mini inside a parent world, filling `rect`. */
  drawMini(g: CanvasRenderingContext2D, source: MiniSources[L], rect: Rect, frame: WorldFrame): void;
  /** Drillable children and their mini rects. Write into `out` from 0; return the count. */
  children(snapshot: SnapshotOf<L>, out: ChildView[], form?: WorldForm): number;
  /** Tap targets, back to front, written from index `from` (children are already there).
   * Reuse the entries; never push. Return the new count, at most `out.length`.
   */
  targets(snapshot: SnapshotOf<L>, view: ViewPresentation, out: HitTarget[], from: number, form?: WorldForm): number;
  /** Optional: true while the player drags the view (rack row scroll); the rest camera then follows the focus with no lerp. */
  followFocus?(snapshot: SnapshotOf<L>): boolean;
  /** Optional: value labels, drawn crisp by the core at the body size, at rest only. */
  labels?(snapshot: SnapshotOf<L>, view: ViewPresentation, frame: WorldFrame, out: LabelWriter): void;
  /**
   * Optional: the component that completed `c` in this world (CPU core, socket or GPU card, sled,
   * rack, site). Writes its rect in art px to `out`; the payout pop centres on it. Returns a key that is
   * stable per component (pops on one key aggregate), or -1 when the component is not shown here.
   */
  payoutAnchor?(snapshot: SnapshotOf<L>, c: Completion, out: Rect, form?: WorldForm): number;
  /**
   * Optional: where a finished non-final shard (`ShardDoneView`) empties: a rect it drains across
   * (Rack: the sled's LCD). Without it the core drains the `payoutAnchor` component's rims.
   */
  shardAnchor?(snapshot: SnapshotOf<L>, d: ShardDoneView, out: Rect): number;
  /** Optional: how long completions on one component join its live pop (default 250 ms; Room 1 s). */
  popWindowMs?(snapshot: SnapshotOf<L>): number;
  /**
   * Optional: a number that rises when part target `id` is upgraded (generation, then level), or null
   * for no part. The core flashes the part gold for 300 ms when it rises or the part appears (A10).
   */
  partVersion?(snapshot: SnapshotOf<L>, id: string): number | null;
  /** Optional: seconds the rest camera eases to a new focus (default 0.25; the rack row snaps in 0.15). */
  restEaseS?(snapshot: SnapshotOf<L>): number;
  /** The level is always shown whole at rest (System, D15.2): never panned, even below scale 2 on phone. */
  readonly wholeAtRest?: boolean;
  /**
   * Optional: where a panned rest centres (art px), when the focus doesn't fit at 2. `hint` is the node
   * the player came from, or the home node of the level below. Defaults to the focus centre.
   */
  restCentre?(snapshot: SnapshotOf<L>, out: Point, hint: NodeRef | null): void;
  /** Optional: the panned rest's snap pitch in art px per axis (Room: the row pitch). */
  panSnap?(snapshot: SnapshotOf<L>): { readonly x: number; readonly y: number };
  /** Optional: world rects currently faulted (crashed, failed supply). Each gets real smoke. */
  faults?(snapshot: SnapshotOf<L>, out: Rect[]): number;
  /** 16×16 zoom rail icon. */
  icon(g: CanvasRenderingContext2D): void;
}
export type AnyLevelRenderer = { [L in LevelId]: LevelRenderer<L> }[LevelId];
export interface LevelRegistry {
  register(renderer: AnyLevelRenderer): void;
  level<L extends LevelId>(id: L): LevelRenderer<L>;
  has(id: LevelId): boolean;
  allLevels(): readonly AnyLevelRenderer[];
}

/** Wall-clock inputs. Navigation easing reads `nowS`; hardware never does. */
export interface FrameClock {
  readonly nowS: number;
  /** Wall ms since the store published `snapshot`. */
  readonly sincePublishMs: number;
}
export interface TransitionInfo {
  readonly from: NodeRef; readonly to: NodeRef;
  readonly direction: 'in' | 'out'; readonly progress: number;
}
export interface CanvasRenderer {
  /** `framing` sets the L2 rest framing (art scale N, lattice, band); null keeps the largest integer fit. */
  resize(widthCss: number, heightCss: number, dpr: number, viewport: Rect, framing?: RestFraming | null): void;
  draw(snapshot: RenderSnapshot, view: ViewPresentation, clock: FrameClock): void;
  /** Borrowed until the next hit call. Null during a zoom. */
  hit(xCss: number, yCss: number): HitTarget | null;
  /** CSS rect of the focus-world target with this id (the callout anchor). */
  anchor(id: string, out: Rect): boolean;
  /** The zoom in progress. The UI drops the scope partner once this is null again. */
  readonly transition: TransitionInfo | null;
  dispose(): void;
}
export interface CanvasRendererDebug extends CanvasRenderer {
  /** Freeze the zoom at a progress (QA); null releases it. */
  hold(progress: number | null): void;
  readonly bufferCount: number;
}

const GLOBAL_REF: NodeRef = { level: 'global', id: 0 };
export function createHitTarget(): HitTarget {
  return { id: '', kind: 'part', owner: GLOBAL_REF, drill: null, part: null, unit: null, sw: null, port: null, slot: null,
    rect: { x: 0, y: 0, w: 0, h: 0 } };
}
/** Clear every optional field so a level only writes what applies. */
export function resetHitTarget(t: HitTarget, id: string, kind: HitKind, owner: NodeRef): HitTarget {
  t.id = id; t.kind = kind; t.owner = owner; t.drill = null; t.part = null; t.unit = null; t.sw = null; t.port = null; t.slot = null;
  return t;
}
export function copyHitTarget(source: HitTarget, out: HitTarget): HitTarget {
  out.id = source.id; out.kind = source.kind; out.owner = source.owner; out.drill = source.drill; out.part = source.part;
  out.unit = source.unit; out.sw = source.sw; out.port = source.port; out.slot = source.slot;
  out.rect.x = source.rect.x; out.rect.y = source.rect.y; out.rect.w = source.rect.w; out.rect.h = source.rect.h;
  return out;
}
export function sameRef(a: NodeRef | null, b: NodeRef | null): boolean {
  return a === b || (!!a && !!b && a.level === b.level && a.id === b.id);
}
/** Allocates; call at navigation time only. */
export function refKey(ref: NodeRef): string { return `${ref.level}:${ref.id}`; }
/** The NodeRef a level snapshot draws. */
export function refOf(snapshot: LevelSnapshot): NodeRef {
  switch (snapshot.level) {
    case 'chip': return { level: 'chip', id: snapshot.systemId };
    case 'system': return { level: 'system', id: snapshot.systemId };
    case 'rack': return { level: 'rack', id: snapshot.rackId };
    case 'room': return { level: 'room', id: snapshot.roomId };
    case 'global': return GLOBAL_REF;
  }
}
/** The numeric id inside the NodeRef a level snapshot draws. No allocation. */
export function idOf(snapshot: LevelSnapshot): number {
  switch (snapshot.level) {
    case 'chip': case 'system': return snapshot.systemId;
    case 'rack': return snapshot.rackId;
    case 'room': return snapshot.roomId;
    case 'global': return 0;
  }
}
export function isRef(snapshot: LevelSnapshot | null, ref: NodeRef | null): boolean {
  return !!snapshot && !!ref && snapshot.level === ref.level && idOf(snapshot) === ref.id;
}
