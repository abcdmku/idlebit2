import { expect, it } from 'vitest';

// Keep real cold imports: room sprites and rack art have circular dependencies through core.
// The public game barrel also loads the simulation graph. An isolated run takes ~2.3s,
// but concurrent full-suite transforms exceed 5s on this host. Only this test gets 15s.
it('imports the rack, room and global level modules without initialization errors', async () => {
  const found = import.meta.glob<Record<string, unknown>>(['../room/index.ts', '../global/index.ts', './index.ts', './art.ts', './cabinet.ts']);
  expect(Object.keys(found).sort()).toEqual(['../global/index.ts', '../room/index.ts', './art.ts', './cabinet.ts', './index.ts']);
  for (const load of Object.values(found)) expect(await load()).toBeTruthy();
  expect((await found['./index.ts']!()).createRackRenderer).toBeTypeOf('function');
  expect((await found['../room/index.ts']!()).createRoomRenderer).toBeTypeOf('function');
  expect((await found['../global/index.ts']!()).createGlobalRenderer).toBeTypeOf('function');
}, 15_000);
