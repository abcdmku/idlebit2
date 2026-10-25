// A stale cached build after a deploy (GitHub Pages serves max-age=600): the running game polls
// version.json, which the build emits next to index.html (vite.config.ts), and offers a reload.
// Production only: dev and tests run as "dev" and never poll. It never reloads by itself.
import { useEffect, useState } from 'react';

declare const __BUILD_ID__: string;

/** This build's id, defined by the Vite config; "dev" outside a production build. */
export const RUNNING_BUILD: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const POLL_MS = 5 * 60_000;

/** True when a fetched version.json names a different, real build than the running one. */
export function isNewVersion(running: string, fetched: unknown): boolean {
  if (running === 'dev' || !fetched || typeof fetched !== 'object') return false;
  const id = (fetched as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 && id !== running;
}

/** Polls every 5 min and when the tab comes back; true once a newer build is deployed. */
export function useNewVersion(): boolean {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD || RUNNING_BUILD === 'dev' || typeof window === 'undefined' || typeof fetch !== 'function') return;
    let stopped = false;
    const check = async () => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
        if (r.ok && !stopped && isNewVersion(RUNNING_BUILD, await r.json())) setNewer(true);
      } catch { /* Offline or blocked: try again on the next poll. */ }
    };
    const onFocus = () => { if (document.visibilityState === 'visible') void check(); };
    const timer = window.setInterval(check, POLL_MS);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    void check();
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, []);
  return newer;
}
