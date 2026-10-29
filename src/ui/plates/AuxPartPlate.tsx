import type { GenerationView, ScopeRef, StartCtlView } from '../../game';
import { GenerationRow } from './GenerationRow';
import { PlateFrame } from './PlateFrame';
import { PowerKeys } from './PowerKeys';
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
  return <PlateFrame {...frame} title={title} sub={installed ? `L${installed.level}` : 'Empty slot'} className="part auxiliary">
    {kind === 'generation' && <GenerationRow generation={generation ?? null} />}
    {kind === 'start' && start && <>
      <p className="p-status">{startStatus(start, scope)}</p>
      <details className="component-options"><summary>Settings</summary><StartRow unit={unit} scope={scope} view={start} onAction={onAction} /></details>
    </>}
    <PowerKeys quotes={quotes} installed={!!installed} level={installed?.level ?? 0} noun={title} wake={kind === 'start'}
      onAction={onAction} onResearch={onResearch} researchName={researchName} />
  </PlateFrame>;
}
