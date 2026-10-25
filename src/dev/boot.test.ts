import { describe, expect, it } from 'vitest';
import { installBootBridge } from './boot';

interface Backend { ping(): string }

describe('v3 boot bridge', () => {
  it('reports booting, then ready with the live methods attached', async () => {
    const host: Record<PropertyKey, unknown> = {};
    const boot = installBootBridge<Backend>(host);
    expect(host.__br).toBe(boot.bridge);
    expect(boot.bridge.bootStatus).toBe('booting');
    expect(boot.bridge.ping).toBeUndefined();
    boot.attach({ ping: () => 'pong' }, async () => {});
    await boot.bridge.ready();
    expect(boot.bridge.bootStatus).toBe('ready');
    expect(boot.bridge.ping?.()).toBe('pong');
    boot.dispose();
    expect(host.__br).toBeUndefined();
  });

  it('records boot failures and survives reinstall', async () => {
    const host: Record<PropertyKey, unknown> = {};
    const boot = installBootBridge<Backend>(host);
    const waiting = boot.bridge.ready();
    boot.failBoot(new TypeError('renderer missing'));
    await expect(waiting).rejects.toThrow('renderer missing');
    expect(boot.bridge.bootStatus).toBe('error');
    expect(boot.bridge.bootError).toMatchObject({ name: 'TypeError', message: 'renderer missing' });
    expect(installBootBridge<Backend>(host)).toBe(boot);
    boot.dispose();
  });

  it('detaches live methods and waits for a replacement shell', async () => {
    const host: Record<PropertyKey, unknown> = {};
    const boot = installBootBridge<Backend>(host);
    const detach = boot.attach({ ping: () => 'one' }, async () => {});
    await boot.bridge.ready();
    detach();
    expect(boot.bridge.bootStatus).toBe('booting');
    expect(boot.bridge.ping).toBeUndefined();
    const next = boot.bridge.ready();
    boot.attach({ ping: () => 'two' }, async () => {});
    await next;
    expect(boot.bridge.ping?.()).toBe('two');
    boot.dispose();
  });
});
