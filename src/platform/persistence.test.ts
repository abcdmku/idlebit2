import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPersistenceAdapter } from "./persistence";

let nextNamespace = 0;

describe("persistence", () => {
  let namespace: string;

  beforeEach(() => {
    namespace = `persistence-test-${nextNamespace++}`;
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("restores serialized values in a new adapter and only clears its namespace", async () => {
    const adapter = createPersistenceAdapter({ namespace });
    const other = createPersistenceAdapter({ namespace: `${namespace}-other` });
    const value = { counter: 4, nested: ["task", false, null] };
    await adapter.set("save", value);
    await other.set("save", "keep");
    value.counter = 9;

    const restored = createPersistenceAdapter({ namespace });
    expect(restored.driver).toBe("browser");
    expect(await restored.get("save")).toEqual({
      counter: 4,
      nested: ["task", false, null],
    });
    await restored.clear();
    expect(await adapter.get("save")).toBeNull();
    expect(await other.get("save")).toBe("keep");
  });

  it("reads the existing save when storage is full and keeps subsequent progress in memory", async () => {
    window.localStorage.setItem(`${namespace}:save`, JSON.stringify("existing save"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is full", "QuotaExceededError");
    });

    const adapter = createPersistenceAdapter({ namespace });
    expect(await adapter.get("save")).toBe("existing save");
    expect(adapter.setImmediate("save", "new progress")).toBe(false);
    expect(adapter.driver).toBe("memory");
    expect(await adapter.get("save")).toBe("new progress");
    await expect(adapter.set("save", "later progress")).resolves.toBeUndefined();
    expect(await adapter.get("save")).toBe("later progress");
    expect(window.localStorage.getItem(`${namespace}:save`)).toBe(
      JSON.stringify("existing save"),
    );
  });

  it("falls back to session data when browser reads become unavailable", async () => {
    const adapter = createPersistenceAdapter({ namespace });
    await adapter.set("save", { tasks: 12 });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });

    await expect(adapter.get("save")).resolves.toEqual({ tasks: 12 });
    expect(adapter.driver).toBe("memory");
    await adapter.remove("save");
    expect(await adapter.get("save")).toBeNull();
  });

  it("uses shared session storage when the browser storage getter is unavailable", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });
    const adapter = createPersistenceAdapter({ namespace });
    expect(adapter.driver).toBe("memory");
    expect(adapter.setImmediate("save", { tasks: 3 })).toBe(true);
    const second = createPersistenceAdapter({ namespace });
    expect(await second.get("save")).toEqual({ tasks: 3 });
    await second.clear();
    expect(await adapter.get("save")).toBeNull();
  });

  it("returns the fallback for corrupt JSON and allows a later save to repair it", async () => {
    const corrupt = "{incomplete save";
    window.localStorage.setItem(`${namespace}:save`, corrupt);
    const adapter = createPersistenceAdapter({ namespace });

    await expect(adapter.get("save")).resolves.toBeNull();
    await expect(adapter.get("save", "fresh")).resolves.toBe("fresh");
    expect(window.localStorage.getItem(`${namespace}:save`)).toBe(corrupt);
    await adapter.set("save", "repaired");
    expect(await adapter.get("save")).toBe("repaired");
    expect(adapter.driver).toBe("browser");
  });

  it("keeps falsy fallback values and saved values intact", async () => {
    const adapter = createPersistenceAdapter({ namespace });
    expect(await adapter.get("missing", false)).toBe(false);
    expect(await adapter.get("missing", 0)).toBe(0);
    expect(await adapter.get("missing", "")).toBe("");
    await adapter.set("zero", 0);
    await adapter.set("false", false);
    await adapter.set("empty", "");
    expect(await adapter.get("zero")).toBe(0);
    expect(await adapter.get("false")).toBe(false);
    expect(await adapter.get("empty")).toBe("");
  });

  it("does not reject when removing or clearing browser storage fails", async () => {
    const adapter = createPersistenceAdapter({ namespace });
    await adapter.set("save", "old");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });

    await expect(adapter.remove("save")).resolves.toBeUndefined();
    expect(adapter.driver).toBe("memory");
    expect(await adapter.get("save")).toBeNull();

    const second = createPersistenceAdapter({ namespace });
    expect(await second.get("save")).toBe("old");
    await expect(second.clear()).resolves.toBeUndefined();
    expect(second.driver).toBe("memory");
    expect(await second.get("save")).toBeNull();
  });

  it("rejects invalid namespaces and keys before touching storage", async () => {
    expect(() => createPersistenceAdapter({ namespace: "" })).toThrow(
      "Invalid persistence key.",
    );
    expect(() => createPersistenceAdapter({ namespace: "invalid space" })).toThrow();
    const adapter = createPersistenceAdapter({ namespace });
    await expect(adapter.get("invalid space")).rejects.toThrow();
    expect(() => adapter.setImmediate("invalid space", "bad")).toThrow();
  });
});
