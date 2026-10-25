export type PersistenceDriver = "browser" | "memory";

export type PersistedValue =
  | boolean
  | number
  | string
  | null
  | PersistedValue[]
  | { [key: string]: PersistedValue };

export interface PersistenceOptions {
  namespace?: string;
}

export interface PersistenceAdapter {
  /** Changes to memory if browser storage becomes unavailable during play. */
  readonly driver: PersistenceDriver;
  readonly readError?: string | null;
  clear(): Promise<void>;
  get<T extends PersistedValue>(key: string, fallbackValue: T): Promise<T>;
  get<T extends PersistedValue>(key: string): Promise<T | null>;
  remove(key: string): Promise<void>;
  set<T extends PersistedValue>(key: string, value: T): Promise<void>;
  /** False when a browser write failed; the value remains in session memory. */
  setImmediate<T extends PersistedValue>(key: string, value: T): boolean;
}

const DEFAULT_NAMESPACE = "idlebit2";
const KEY_PATTERN = /^[a-zA-Z0-9._:-]+$/;
const MAX_KEY_LENGTH = 160;
const memoryStore = new Map<string, string>();

function browserStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    // A full store can still contain a readable save. A write probe would
    // discard that save before the game gets a chance to restore it.
    return window.localStorage;
  } catch {
    return null;
  }
}

function storageKey(namespace: string, key: string): string {
  const fullKey = `${namespace}:${key}`;

  if (
    !namespace.trim() ||
    !key.trim() ||
    fullKey.length > MAX_KEY_LENGTH ||
    !KEY_PATTERN.test(fullKey)
  ) {
    throw new Error("Invalid persistence key.");
  }

  return fullKey;
}

function stringifyPersistedValue(value: PersistedValue): string {
  return JSON.stringify(value);
}

export function createPersistenceAdapter(
  options: PersistenceOptions = {},
): PersistenceAdapter {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  storageKey(namespace, "validate");
  let storage = browserStorage();
  let readError: string | null = null;

  const writeImmediately = <T extends PersistedValue>(
    key: string,
    value: T,
  ): boolean => {
    const resolvedKey = storageKey(namespace, key);
    const serializedValue = stringifyPersistedValue(value);
    memoryStore.set(resolvedKey, serializedValue);
    if (!storage) return true;

    try {
      storage.setItem(resolvedKey, serializedValue);
      return true;
    } catch {
      // Preserve this session when quota, privacy settings, or permissions
      // change. The driver exposes that these writes cannot survive a reload.
      storage = null;
      return false;
    }
  };

  return {
    get driver() {
      return storage ? "browser" : "memory";
    },
    get readError() { return readError; },
    async clear() {
      const prefix = `${namespace}:`;
      for (const key of Array.from(memoryStore.keys())) {
        if (key.startsWith(prefix)) memoryStore.delete(key);
      }
      if (!storage) return;
      try {
        for (let index = storage.length - 1; index >= 0; index -= 1) {
          const key = storage.key(index);
          if (key?.startsWith(prefix)) storage.removeItem(key);
        }
      } catch {
        storage = null;
      }
    },
    async get<T extends PersistedValue>(
      key: string,
      fallbackValue?: T,
    ): Promise<T | null> {
      const resolvedKey = storageKey(namespace, key);
      readError = null;
      let rawValue = memoryStore.get(resolvedKey);
      if (storage) {
        try {
          rawValue = storage.getItem(resolvedKey) ?? undefined;
          if (rawValue === undefined) memoryStore.delete(resolvedKey);
          else memoryStore.set(resolvedKey, rawValue);
        } catch {
          storage = null;
        }
      }
      if (rawValue === undefined) return fallbackValue ?? null;
      try {
        return JSON.parse(rawValue) as T;
      } catch {
        // Invalid outer JSON must not keep the game on its loading screen.
        // Leave the browser value intact so it can still be inspected.
        memoryStore.delete(resolvedKey);
        readError = 'Invalid save reset';
        return fallbackValue ?? null;
      }
    },
    async remove(key: string) {
      const resolvedKey = storageKey(namespace, key);
      memoryStore.delete(resolvedKey);
      if (!storage) return;
      try {
        storage.removeItem(resolvedKey);
      } catch {
        storage = null;
      }
    },
    async set<T extends PersistedValue>(key: string, value: T) {
      writeImmediately(key, value);
    },
    setImmediate: writeImmediately,
  };
}

export const bitRougePersistence = createPersistenceAdapter();
