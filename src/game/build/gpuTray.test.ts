import { fixtureState } from '../view/fixtures';
import { systemId } from '../types/ids';
import { quote } from './quotes';

describe('tray GPU item (QA-15)', () => {
  it('with a card installed and a bay free, offers the installed card\'s next step, not another card', () => {
    const s = fixtureState('rackSplit'), spec = s.build.systems[0]!.spec;
    expect(spec.accels.map((a) => a.kind)).toEqual(['gpu']);
    const gpu = quote(s, { kind: 'tray', at: { level: 'system', id: systemId(0) } }).quotes
      .find((q) => q.action.type === 'installGpu' || (q.action.type === 'upgradePart' && q.action.part.slot.kind === 'gpu'))!;
    expect(gpu.action).toEqual({ type: 'upgradePart', part: { unit: { kind: 'system', id: 0 }, slot: { kind: 'gpu', index: 0 } } });
  });
});
