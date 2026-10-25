/** Inject before ES modules. Test-only seeded randomness and controlled effect clocks. */
export function controlledClock(seed) {
  return `(() => {
    let seed = ${seed >>> 0}, now = 0, id = 0;
    const frames = new Map(), timers = new Map();
    const animations = new WeakMap();
    const freezeAnimations = () => {
      for (const animation of document.getAnimations()) {
        if (!animations.has(animation)) animations.set(animation, now);
        animation.pause(); animation.currentTime = now - animations.get(animation);
      }
    };
    Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    Object.defineProperty(performance, 'now', { value: () => now });
    Date.now = () => 1700000000000 + now;
    requestAnimationFrame = fn => { const key = ++id; frames.set(key, fn); return key; };
    cancelAnimationFrame = key => frames.delete(key);
    const timer = (fn, delay, repeat, args) => {
      if (typeof fn !== 'function') throw new Error('QA clock requires function timers');
      const key = ++id; timers.set(key, { fn, at: now + Math.max(1, Number(delay) || 1), repeat, args }); return key;
    };
    setTimeout = (fn, delay, ...args) => timer(fn, delay, 0, args);
    setInterval = (fn, delay, ...args) => timer(fn, delay, Math.max(1, Number(delay) || 1), args);
    clearTimeout = clearInterval = key => timers.delete(key);
    window.__qaTick = duration => {
      const end = now + duration; let guard = 0;
      while (now < end) {
        now = Math.min(end, now + 1000 / 60);
        for (const [key, task] of [...timers].sort((a,b) => a[1].at - b[1].at || a[0] - b[0])) {
          if (task.at > now) continue;
          if (++guard > 100000) throw new Error('QA timer loop exceeded bound');
          if (!timers.has(key)) continue;
          if (task.repeat) task.at += task.repeat; else timers.delete(key);
          task.fn(...task.args);
        }
        const batch = [...frames.values()]; frames.clear();
        for (const fn of batch) fn(now);
        freezeAnimations();
      }
      return now;
    };
  })();`;
}
