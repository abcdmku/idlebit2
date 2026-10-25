import {
  FAMILY_HOT, PARENT, GLOBAL_COMPILED, LINK_COMPILED, LINK_HOT, RACK_COMPILED, RACK_HOT, RECORD, ROOM_COMPILED, ROOM_HOT,
  RING_HOT, RQ, SITE_COMPILED, SITE_HOT, SYS_COMPILED, SYS_HOT, TALLY,
} from '../core/buffers';
import type { Layout } from '../core/table';

/** Retains the v3 envelope; earlier layouts reset without migration (AGENTS.md). */
export const SAVE_SCHEMA = 'bitrouge-v3' as const;
/** Bumps on any layout or plain-state shape change; a different version is rejected. */
// Pre-live reset: v4 saves hold the D9 arrival plan and pending feed; D10 replaced both with the endless queue.
// Pre-live reset: v6 adds saved per-family round work and dismissal counters.
// Pre-live reset: v7 is D25 (divisible tasks): record units/shard/parent, the parent pool and router queues.
// Pre-live reset: v8 is D26 (memory hierarchy, windows): record placement and parts, parent windows, the deadline ring.
// Pre-live reset: v9 is D27 (research is a task that cuts the line): research holders in hot, the research modes removed.
// Pre-live reset: v10 adopts the CSV clock and RAM progression (36 levels, ×1.5 per level): saved levels change meaning.
// Pre-live reset: v11 is D28 (SLA is a count ratio over the last 50 resolved tasks): the window in hot.g.
// Pre-live reset: v12 is D31 (start controllers, rack batteries, site generation): build parts, start hot state, the standby mode.
export const SAVE_VERSION = 12;

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
