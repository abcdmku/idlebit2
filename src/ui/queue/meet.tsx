// What a blocked task needs bought (user, 26 Oct): the sim's `meet` quote, one line per missing
// component, each at its minimal level in one tap ("Buy Cache 2 → 16 b"), or "Install …", or the
// research that allows it. Shared by the task detail, the round report's Fix line and the plates.
import type { MeetNeed, Quote, QueueEntryView, RenderSnapshot, ResearchId, SystemId } from '../../game';
import { SLOT_TITLE } from '../plates/copy';
import { useGameSelector, useQuote } from '../storeHooks';

/** The task's gates as the sim's MeetNeed: its working set where it is blocked, and its accelerator and ECC gates. */
export function meetNeed(t: Pick<QueueEntryView, 'blockedBy' | 'workingSetBits' | 'vramBits' | 'gpuCoresMin' | 'ecc'>): MeetNeed | null {
  if (!t.blockedBy) return null;
  const ws = t.workingSetBits;
  return {
    ...(t.blockedBy === 'cache' ? { cacheBits: ws } : t.blockedBy === 'ram' ? { ramBits: ws } : t.blockedBy === 'disk' ? { diskBits: ws } : {}),
    ...(t.vramBits > 0 ? { vramBits: t.vramBits } : {}),
    ...(t.gpuCoresMin > 0 ? { gpuCores: t.gpuCoresMin } : {}),
    ...(t.ecc ? { ecc: true } : {}),
  };
}

/** The system the head would run on: the one in view, else the home system. */
export function meetSystem(s: RenderSnapshot): SystemId {
  const f = s.focus;
  if (f.level === 'chip' || f.level === 'system') return f.systemId;
  return (s.home.system?.id ?? s.home.chip?.id ?? 0) as SystemId;
}

/** The meet lines for a task (empty when it isn't blocked). */
export function useMeet(t: QueueEntryView | null): readonly Quote[] {
  const system = useGameSelector(meetSystem);
  const need = t ? meetNeed(t) : null;
  return useQuote(need ? { kind: 'meet', system, need } : null)?.quotes ?? [];
}

const PART_WORD: Readonly<Record<string, string>> = { cache: 'Cache', scheduler: 'Queue', drive: 'Storage' };
const partWord = (kind: string) => PART_WORD[kind] ?? (SLOT_TITLE as Record<string, string>)[kind] ?? kind;

/** What a meet line says: research it, install it, or buy every level it needs. */
export function meetLabel(q: Quote, researchName?: (id: ResearchId) => string): string {
  const lock = q.locked;
  if (lock?.code === 'research' && lock.node) return `Research ${researchName?.(lock.node) ?? lock.text.replace(/^Needs /, '')}`;
  const a = q.action;
  switch (a.type) {
    case 'convertRamToEcc': return 'Enable ECC';
    case 'upgradePartTo': case 'upgradePart': return `Upgrade ${partWord(a.part.slot.kind)}`;
    case 'replacePart': return `Replace ${q.label || partWord(a.part.slot.kind)}`;
    case 'addPart': return `Install ${partWord(a.kind)}`;
    case 'installGpu': return `Install GPU ${a.model}`;
    default: return q.label || 'Buy';
  }
}
