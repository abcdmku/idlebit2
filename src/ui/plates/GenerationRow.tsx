// D31.4 a site's off-grid generation: what kind, its output and how much of it the site uses now.
import type { GenerationView } from '../../game';
import { watts } from './format';

export const GENERATION_NAMES: Readonly<Record<GenerationView['kind'], string>> = {
  solar: 'Solar farm', wind: 'Wind farm', fuelCell: 'Fuel cell', ownPlant: 'Own plant',
};
const FUELLED = new Set<GenerationView['kind']>(['fuelCell', 'ownPlant']);

/** The plate's title line: the generation tag ("Solar farm · L1") and its usage ("40 kW / 64 kW"; a fuelled kind adds "fuel billed"). */
export function generationLines(g: GenerationView | null): [string, string] {
  if (!g) return ['Empty slot', ''];
  return [`${GENERATION_NAMES[g.kind]} · L${g.level}`, `${watts(g.usedW)} / ${watts(g.outputW)}${FUELLED.has(g.kind) ? ' · fuel billed' : ''}`];
}

/** How much of its output the site uses now. */
export function GenerationRow({ generation }: { generation: GenerationView | null }) {
  if (!generation) return null;
  const used = generation.outputW > 0 ? Math.min(1, generation.usedW / generation.outputW) : 0;
  return <div className="gen-row" data-testid="generation-row" data-kind={generation.kind}>
    <i className="gen-bar" role="meter" aria-label="Generation used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)}><b style={{ width: `${Math.round(used * 100)}%` }} /></i>
  </div>;
}
