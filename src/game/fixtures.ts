/**
 * Second public entry, for tests, the renderer harness and dev pages only: snapshot fixtures.
 * Production code imports the barrel (index.ts), never this file.
 */
export { LEVEL_FIXTURES } from './testkit/snapshotFixtures';
export { gpuLoadedState } from './testkit/gpuLoaded';
export { FIXTURE_NAMES, FIXTURE_ROUNDS, fixtureSnapshot, fixtureState, fixtureScope, type FixtureName } from './view/fixtures';
