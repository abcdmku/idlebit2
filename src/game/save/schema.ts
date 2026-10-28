import {
  FAMILY_HOT, PARENT, GLOBAL_COMPILED, LINK_COMPILED, LINK_HOT, RACK_COMPILED, RACK_HOT, RECORD, ROOM_COMPILED, ROOM_HOT,
  RING_HOT, RQ, SITE_COMPILED, SITE_HOT, SYS_COMPILED, SYS_HOT, TALLY,
} from '../core/buffers';
import type { Layout } from '../core/table';

/** Retains the v3 envelope; earlier layouts reset without migration (AGENTS.md). */
export const SAVE_SCHEMA = 'bitrouge-v3' as const;
/** Bumps on any layout or plain-state shape change; a different version is rejected. */
// Pre-live reset: freeze the head and 50 incoming tasks instead of five offers.
// Queue preparation adds CPU work-clock state and reserved cache. Earlier pre-live saves reset.
export const SAVE_VERSION = 32;

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
