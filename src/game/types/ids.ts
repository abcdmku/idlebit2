/**
 * Branded ids. A unit's id is its index into its buffers; ids are never reused,
 * so a removed unit leaves a dead slot (architecture §1.3).
 */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type SystemId = Brand<number, 'SystemId'>;
export type RackId = Brand<number, 'RackId'>;
export type RoomId = Brand<number, 'RoomId'>;
export type SiteId = Brand<number, 'SiteId'>;
/** Index into the family catalog (market/families.ts). Stored as u16 in records. */
export type FamilyId = Brand<number, 'FamilyId'>;
/** Research node id string from docs/research.md §9, e.g. "pipelining". */
export type ResearchId = Brand<string, 'ResearchId'>;
/** Index into the link tables. */
export type LinkId = Brand<number, 'LinkId'>;

export const systemId = (n: number) => n as SystemId;
export const rackId = (n: number) => n as RackId;
export const roomId = (n: number) => n as RoomId;
export const siteId = (n: number) => n as SiteId;
export const familyId = (n: number) => n as FamilyId;
export const researchId = (s: string) => s as ResearchId;

export type UnitKind = 'system' | 'rack' | 'room' | 'site';
export type UnitRef =
  | { readonly kind: 'system'; readonly id: SystemId }
  | { readonly kind: 'rack'; readonly id: RackId }
  | { readonly kind: 'room'; readonly id: RoomId }
  | { readonly kind: 'site'; readonly id: SiteId };
export interface GlobalRef { readonly kind: 'global' }
export type ScopeRef = UnitRef | GlobalRef;

export type LevelId = 'chip' | 'system' | 'rack' | 'room' | 'global';
/** chip and system: SystemId; rack: RackId; room: RoomId; global: 0. */
export type NodeRef =
  | { readonly level: 'chip'; readonly id: SystemId }
  | { readonly level: 'system'; readonly id: SystemId }
  | { readonly level: 'rack'; readonly id: RackId }
  | { readonly level: 'room'; readonly id: RoomId }
  | { readonly level: 'global'; readonly id: 0 };

/** Where a part sits inside its owning unit. Socket and index are 0-based. */
export type PartSlot =
  | { readonly kind: 'cpu' | 'clock' | 'l1' | 'l2' | 'l3'; readonly socket: number }
  | { readonly kind: 'core'; readonly socket: number; readonly index: number }
  | { readonly kind: 'scheduler' | 'psu' }
  | { readonly kind: 'ram' | 'gpu' | 'drive'; readonly index: number }
  | { readonly kind: 'rackCooler' | 'pdu' | 'lb' | 'switch' }
  | { readonly kind: 'roomCooler' | 'roomLb' | 'roomSwitch' }
  | { readonly kind: 'ups'; readonly index: number }
  | { readonly kind: 'dataPlane' | 'grid' | 'backbone' }
  | { readonly kind: 'globalScheduler' }
  /** D31: rack Power control, room and global start controllers, site generation. */
  | { readonly kind: 'powerCtl' | 'roomStart' | 'globalStart' | 'generation' };
export type PartSlotKind = PartSlot['kind'];

/** Board parts and drives belong to a system; rack infra to a rack; room parts to a room;
 * data plane, grid and backbone link to a site; the global scheduler to global. */
export interface PartRef { readonly unit: ScopeRef; readonly slot: PartSlot }
export type SwitchRef = { readonly kind: 'rack'; readonly id: RackId } | { readonly kind: 'room'; readonly id: RoomId };
