// Game entry (index.html). The DEV boot bridge installs before anything else loads, so a failure
// while importing or booting the shell, renderer or sim still reaches QA as `__br.bootError`.
import { installBootBridge } from '../dev/boot';
import type { LiveBridge } from '../dev/bridge';

const early = import.meta.env.DEV ? installBootBridge<LiveBridge>() : null;
// Recovery must work even when loading or advancing the saved game would hang.
const boot = new URLSearchParams(window.location.search).has('rescue')
  ? import('./recovery/SaveRecovery').then(({ bootRecovery }) => bootRecovery())
  : import('./App').then(({ boot }) => boot());
boot.catch((error: unknown) => {
  early?.failBoot(error);
  console.error(error);
});
