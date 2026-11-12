import type { GenerationView, ScopeRef, StartCtlView } from '../../game';
import { GenerationRow, generationLines } from './GenerationRow';
import { PlateFrame } from './PlateFrame';
import { PowerKeys, powerGeneration } from './PowerKeys';
import { StartRow, startStatus } from './StartRow';
import type { PlateCommon } from './types';

/** Start controllers and generation have their own purchase scope. */
export function AuxPartPlate({ unit, kind, start, generation, ...common }: PlateCommon & {
  unit: ScopeRef; kind: 'start' | 'generation'; start?: StartCtlView | null; generation?: GenerationView | null;
}) {
  const { quotes, onAction, onResearch, researchName, ...frame } = common;
  const installed = kind === 'start' ? start : generation;
  const title = kind === 'start' ? 'Start controller' : 'Generation';
  const scope = unit.kind === 'room' ? 'room' : 'global';
  const keys = { quotes, installed: !!installed, onAction, onResearch, researchName };
  // Generation reads as a memory module does: its kind and level, then what is used, on the title line.
  const [tag, usage] = kind === 'generation' ? generationLines(generation ?? null) : [installed ? `L${installed.level}` : 'Empty slot', ''];
  return <PlateFrame {...frame} title={title} sub={tag} usage={usage} className="part auxiliary" generation={powerGeneration(keys)}>
    {kind === 'generation' && <GenerationRow generation={generation ?? null} />}
    {kind === 'start' && start && <>
      <p className="p-status">{startStatus(start, scope)}</p>
      <section className="component-options"><StartRow unit={unit} scope={scope} view={start} onAction={onAction} /></section>
    </>}
    <PowerKeys {...keys} level={installed?.level ?? 0} noun={title} wake={kind === 'start'} />
  </PlateFrame>;
}
