import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FailDetail } from '../../game';
import { fixtureScope, fixtureState } from '../../game/fixtures';
import { createGameStore, type RuntimeStore } from '../../platform';
import { causeLine } from '../hooks/feedModel';
import { entry, mount, type Mounted } from '../hooks/testShell';
import { blockedText } from '../hooks/taskRequirements';
import { PlateLayer } from '../plates/PlateLayer';
import { statusLine } from '../queue/TaskDetail';
import { pointAt, pointFix } from './pointAt';

let mounted: Mounted | undefined, store: RuntimeStore | undefined;
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { mounted?.unmount(); mounted = undefined; store?.dispose(); store = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('outages: no system can take work (lead, 26 Oct)', () => {
  const OUTAGES: readonly [FailDetail, string][] = [
    ['psu', 'Power supply down'], ['pdu', 'Rack PDU down'], ['ups', 'UPS down'], ['grid', 'Grid down'],
    ['rack', 'Rack overheated'], ['room', 'Room overheated'], ['offline', 'No system online'],
  ];
  it('names what is down on the head card, the task status and the report alike', () => {
    for (const [code, label] of OUTAGES) {
      const t = { ...entry(1), blockedBy: code };
      expect(blockedText(t)).toBe(label);
      expect(causeLine('power', code)).toBe(label);
    }
    expect(statusLine({ ...entry(1), blockedBy: 'psu' }, true, true).text).toBe('Blocked: power supply down');
    expect(statusLine({ ...entry(1), blockedBy: 'ups' }, true, true).text).toBe('Blocked: UPS down');
    expect(statusLine({ ...entry(1), blockedBy: 'pdu' }, true, true).text).toBe('Blocked: rack PDU down');
    // other details keep their words
    expect(causeLine('cantRun', 'cache')).toBe("Can't run · cache");
  });

  it('points a down power supply at its plate and a hot rack at its cooler', () => {
    expect([pointFix('psu')?.kind, pointFix('rack')?.kind, pointFix('ups'), pointFix(null)]).toEqual(['psu', 'rackCooler', null, null]);
    store = createGameStore({ initialState: fixtureState('systemTop', 'between'), scope: fixtureScope('systemTop') });
    store.setLifecycle({ hydrated: true });
    mounted = mount(<PlateLayer />, store);
    act(() => pointAt(mounted!.shell, 'psu'));
    expect(mounted.shell.view.getState()).toMatchObject({ selectedId: 'psu', plate: true });
    expect(mounted.host.querySelector('.p-title')?.textContent).toBe('Power supply');
  });
});
