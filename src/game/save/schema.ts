import {
  FAMILY_HOT, PARENT, GLOBAL_COMPILED, LINK_COMPILED, LINK_HOT, RACK_COMPILED, RACK_HOT, RECORD, ROOM_COMPILED, ROOM_HOT,
  RING_HOT, RQ, SITE_COMPILED, SITE_HOT, SYS_COMPILED, SYS_HOT, TALLY,
} from '../core/buffers';
import type { Layout } from '../core/table';

/** Retains the v3 envelope; earlier layouts reset without migration (AGENTS.md). */
export const SAVE_SCHEMA = 'bitrouge-v3' as const;
/** Bumps on any layout or plain-state shape change; a different version is rejected. */
// Pre-live reset: freeze the head and 50 incoming tasks instead of five offers.
// One cache per CPU replaces the former multi-part cache shape. Earlier pre-live saves reset.
// Wallet history is now saved. Earlier pre-live saves reset.
// Independent RAM and drive speed levels. Earlier pre-live saves reset.
// Paid hardware histories support 50% Credit refunds. Earlier pre-live saves reset.
// Supply overload, failure, crash and power-cap state, the dark and crashed modes, the power and heat
// failure causes, the health filter and the first-taken list are removed (D79). Earlier pre-live saves reset.
// Supply overload returns as a 10 s trip (D82): overTicks columns and the power failure cause. Earlier pre-live saves reset.
export const SAVE_VERSION = 39;

export interface SaveEnvelope {
  readonly schema: typeof SAVE_SCHEMA;
  readonly version: number;
  readonly state: unknown;
}

/** Every table in a saved state and its layout, for validation. */
export const COMPILED_TABLES: Readonly<Record<string, Layout>> = {
  sys: SYS_COMPILED, rack: RACK_COMPILED, room: ROOM_COMPILED, site: SITE_COMPILED, global: GLOBAL_COMPILED, link: LINK_COMPILED,
};
export const HOT_TABLES: Readonly<Record<string, Layout>> = {
  sys: SYS_HOT, rack: RACK_HOT, room: ROOM_HOT, site: SITE_HOT, link: LINK_HOT,
  rec: RECORD, parent: PARENT, rq: RQ, tally: TALLY, fam: FAMILY_HOT, ring: RING_HOT,
};
