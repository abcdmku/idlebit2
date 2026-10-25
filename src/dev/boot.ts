// No runtime imports: main can install this before loading the game, the shell or the
// renderer, so boot failures before App mounts still reach QA as `__br.bootError`.

export type BootStatus = 'booting' | 'ready' | 'error';
export interface BootError { readonly name: string; readonly message: string; readonly stack?: string }

/** The always-present part of `window.__br`. Live methods are attached when the shell mounts. */
export interface BootBridge {
  readonly version: 'v3';
  readonly bootStatus: BootStatus;
  readonly bootError: BootError | null;
  /** Resolves once a live backend reports ready; rejects on a boot failure. Await again after HMR. */
  ready(): Promise<void>;
}

export interface BridgeBootstrap<B extends object> {
  readonly bridge: BootBridge & Partial<B>;
  /** Attaches the live backend once `isReady` resolves. Returns a detach for unmount and HMR. */
  attach(backend: B, isReady: () => Promise<void>): () => void;
  failBoot(error: unknown): void;
  dispose(): void;
}

const BOOT_KEY = Symbol.for('idlebit2.bridge');
type BridgeHost = { __br?: unknown; [BOOT_KEY]?: BridgeBootstrap<object> };

const deferred = () => {
  let resolve = () => {}, reject = (_error: Error) => {};
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
};

/** Installs `window.__br` once per page. Later calls (HMR) return the same bootstrap. */
export function installBootBridge<B extends object>(host: BridgeHost = window as unknown as BridgeHost): BridgeBootstrap<B> {
  const existing = host[BOOT_KEY] as BridgeBootstrap<B> | undefined;
  if (existing) { host.__br = existing.bridge; return existing; }

  let status: BootStatus = 'booting', bootError: BootError | null = null, readiness = deferred();
  let attached: B | null = null, liveKeys: string[] = [];
  const bridge = {
    version: 'v3',
    get bootStatus() { return status; },
    get bootError() { return bootError; },
    ready: () => readiness.promise,
  } as BootBridge & Partial<B>;

  const failBoot = (error: unknown) => {
    const failure = error instanceof Error ? error : new Error(String(error));
    bootError = { name: failure.name, message: failure.message, stack: failure.stack };
    if (status !== 'booting') readiness = deferred();
    status = 'error'; readiness.reject(failure);
  };
  const onError = (event: ErrorEvent) => failBoot(event.error ?? new Error(event.message || 'Boot failed'));
  const onRejection = (event: PromiseRejectionEvent) => { if (status === 'booting') failBoot(event.reason); };
  const removeLive = () => {
    for (const key of liveKeys) delete (bridge as Record<string, unknown>)[key];
    liveKeys = [];
  };

  const bootstrap: BridgeBootstrap<B> = {
    bridge, failBoot,
    attach(backend, isReady) {
      if (status !== 'booting') readiness = deferred();
      removeLive();
      attached = backend; status = 'booting'; bootError = null;
      liveKeys = Object.keys(backend);
      Object.assign(bridge, backend);
      void Promise.resolve().then(isReady).then(() => {
        if (attached === backend && status === 'booting') { status = 'ready'; readiness.resolve(); }
      }, error => { if (attached === backend) failBoot(error); });
      return () => {
        if (attached !== backend) return;
        attached = null; removeLive();
        // Keep a boot failure visible until a replacement shell attaches.
        if (status === 'error') return;
        if (status === 'ready') readiness = deferred();
        status = 'booting';
      };
    },
    dispose() {
      attached = null; removeLive();
      if (typeof window !== 'undefined') {
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
      }
      if (host[BOOT_KEY] === bootstrap) delete host[BOOT_KEY];
      if (host.__br === bridge) delete host.__br;
    },
  };
  host[BOOT_KEY] = bootstrap as BridgeBootstrap<object>; host.__br = bridge;
  if (typeof window !== 'undefined') {
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
  }
  return bootstrap;
}
