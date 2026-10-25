import { describe, expect, it } from 'vitest';
import { isNewVersion } from './version';

describe('new-version notice', () => {
  it('offers a reload only when a real, different build is deployed', () => {
    expect(isNewVersion('abc123-l9x', { id: 'def456-l9y' })).toBe(true);
    expect(isNewVersion('abc123-l9x', { id: 'abc123-l9x' })).toBe(false);
    // dev and tests never compare; malformed or empty files never nag
    expect(isNewVersion('dev', { id: 'def456' })).toBe(false);
    expect([isNewVersion('abc', null), isNewVersion('abc', { id: '' }), isNewVersion('abc', { version: 2 })]).toEqual([false, false, false]);
  });
});
