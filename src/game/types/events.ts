import type { FamilyId, RackId, ResearchId, RoomId, SiteId, SystemId } from './ids';

/**
 * Exactly seven failure causes (program D4.1; D26.5 adds late). `swap` covers a cold change or an offline toggle
 * that kills work. A distributed task records the root cause of the member loss.
 * Index in FAIL_CAUSES = the u8 stored in buffers and tallies.
 */
export const FAIL_CAUSES = ['timeout', 'cantRun', 'misroute', 'power', 'heat', 'swap', 'late'] as const;
export type FailCause = (typeof FAIL_CAUSES)[number];
export type FailCounts = Readonly<Record<FailCause, number>>;

/**
 * The detail word after a cause (D5.3, spec §4.2): "Can't run · RAM", "Timed out · link". Index =
 * the u8 in hot fam.failDetail; 255 = none. cantRun and misroute use the gate words in check order
 * (cache … link); timeout: link (still in transfer); power: psu … grid; heat: rack, room;
 * swap: cold, offline; late: disk, ram (D26.5). A cantRun memory detail names the deepest tier the
 * system has (D26.1). The GPU core detail is appended last; check order is the spec's,
 * not this index order. The UI maps detail codes to readable labels.
 */
export const FAIL_DETAILS = [
  'cache', 'ram', 'gpu', 'vram', 'disk', 'ecc', 'members', 'zones', 'region', 'link',
  'psu', 'pdu', 'ups', 'grid', 'rack', 'room', 'cold', 'offline', 'gpuCores',
] as const;
export type FailDetail = (typeof FAIL_DETAILS)[number];
export const NO_DETAIL = 255;

export type SupplyKind = 'psu' | 'pdu' | 'ups' | 'grid';
export type SupplyRef =
  | { readonly kind: 'psu'; readonly id: SystemId }
  | { readonly kind: 'pdu'; readonly id: RackId }
  | { readonly kind: 'ups'; readonly id: RoomId; readonly index: number }
  | { readonly kind: 'grid'; readonly id: SiteId };
export type LumpRef = { readonly kind: 'rack'; readonly id: RackId } | { readonly kind: 'room'; readonly id: RoomId };

/** Cosmetic events, per cohort per tick (never per task). `seq` increases by 1 per event. */
export type GameEventBody =
  /** system / rack / room / site: the one unit where the family's cohorts completed this tick, or null when several did. */
  | {
    readonly kind: 'met'; readonly family: FamilyId; readonly count: number;
    readonly system: SystemId | null; readonly rack: RackId | null; readonly room: RoomId | null; readonly site: SiteId | null;
  }
  | { readonly kind: 'failed'; readonly family: FamilyId; readonly count: number; readonly cause: FailCause; readonly detail: FailDetail | null }
  | { readonly kind: 'roundStarted'; readonly round: number }
  | { readonly kind: 'roundEnded'; readonly round: number }
  | { readonly kind: 'supplyFailed'; readonly supply: SupplyRef }
  | { readonly kind: 'supplyRebooted'; readonly supply: SupplyRef }
  | { readonly kind: 'crashed'; readonly lump: LumpRef }
  | { readonly kind: 'recovered'; readonly lump: LumpRef }
  | { readonly kind: 'researchCompleted'; readonly project: ResearchId }
  | { readonly kind: 'researchStopped'; readonly project: ResearchId };
export type GameEvent = GameEventBody & { readonly seq: number; readonly tick: number };

/** 256 entries, oldest first. `nextSeq` is the seq the next event will get. */
export interface EventRing {
  readonly nextSeq: number;
  readonly entries: readonly GameEvent[];
}
