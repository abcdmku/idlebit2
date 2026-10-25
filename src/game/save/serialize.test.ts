import { advanceGame } from '../core/advance';
import { createInitialState } from '../core/state';
import { FLEETS } from '../testkit/fleets';
import { decodeBase64, encodeBase64 } from './base64';
import { deserializeSave, serializeSave } from './serialize';

describe('v3 save', () => {
  it('round-trips the boot state exactly', () => {
    const state = createInitialState(42);
    const loaded = deserializeSave(serializeSave(state));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state).toEqual(state);
    expect(loaded.state.hot.sys.due).toBeInstanceOf(Float64Array);
    expect(loaded.state.hot.sys.due[0]).toBe(Infinity);
  });

  it('continues identically after a mid-run save and load', () => {
    const start = createInitialState(42);
    const straight = advanceGame(start, 60_000).state;
    const half = advanceGame(start, 30_050).state;
    const loaded = deserializeSave(serializeSave(half));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(advanceGame(loaded.state, 29_950).state).toEqual(straight);
  });

  it('round-trips a multi-rack room', () => {
    const state = FLEETS.roomFull();
    const loaded = deserializeSave(serializeSave(state));
    expect(loaded.ok && loaded.state).toEqual(state);
  });

  it.each([
    ['garbage', 'not json'],
    ['wrong schema', JSON.stringify({ schema: 'bitrouge-v2', version: 1, state: {} })],
    ['wrong version', JSON.stringify({ schema: 'bitrouge-v3', version: 999, state: {} })],
    ['missing state', JSON.stringify({ schema: 'bitrouge-v3', version: 1, state: { schema: 'bitrouge-v3' } })],
  ])('rejects %s', (_name, text) => {
    expect(deserializeSave(text).ok).toBe(false);
  });

  it('rejects a fractional wallet and a short buffer', () => {
    const text = serializeSave(createInitialState(42));
    const frac = deserializeSave(text.replace('"credits":"0"', '"credits":"0.5"'));
    expect(!frac.ok && frac.error).toMatch(/wallet.credits/);
    const json = JSON.parse(text);
    json.state.hot.sys.mode.b64 = '';
    const short = deserializeSave(JSON.stringify(json));
    expect(!short.ok && short.error).toMatch(/hot.sys.mode/);
  });

  it('base64 round-trips every remainder length', () => {
    for (let n = 0; n < 10; n += 1) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 255);
      expect([...decodeBase64(encodeBase64(bytes))]).toEqual([...bytes]);
    }
    expect(encodeBase64(new TextEncoder().encode('Man'))).toBe('TWFu');
  });
});
