import { beforeEach, describe, expect, it } from "vitest";
import { clearSession, loadSession, saveSession } from "./persistence";

const STORAGE_KEY = "dynamics-ribbon-designer.session.v1";
const fallback = { tableName: "account", publisher: "brg", surface: "all", newSolutionName: "Designer" };

function stubStorage(failing = false) {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => {
        if (failing) throw new Error("Storage is blocked.");
        return store.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (failing) throw new Error("Storage is blocked.");
        store.set(key, value);
      },
      removeItem: (key) => store.delete(key)
    }
  };
  return store;
}

describe("session persistence", () => {
  beforeEach(() => stubStorage());

  it("round-trips the ribbon-independent settings", () => {
    saveSession({ tableName: "contact", publisher: "con", surface: "grid", newSolutionName: "Contact ribbon" });
    expect(loadSession(fallback)).toEqual({
      tableName: "contact",
      publisher: "con",
      surface: "grid",
      newSolutionName: "Contact ribbon"
    });
  });

  it("never stores a button selection", () => {
    const store = stubStorage();
    saveSession({ ...fallback, hiddenIds: ["Mscrm.Form.account.Delete"] });
    expect(JSON.parse(store.get(STORAGE_KEY))).not.toHaveProperty("hiddenIds");
  });

  it("ignores a selection left by an earlier version", () => {
    const store = stubStorage();
    store.set(STORAGE_KEY, JSON.stringify({ tableName: "contact", hiddenIds: ["Mscrm.Form.contact.Delete"] }));
    expect(loadSession(fallback)).toEqual({ ...fallback, tableName: "contact" });

    saveSession(loadSession(fallback));
    expect(JSON.parse(store.get(STORAGE_KEY))).not.toHaveProperty("hiddenIds");
  });

  it("falls back when stored values are the wrong shape", () => {
    const store = stubStorage();
    store.set(STORAGE_KEY, JSON.stringify({ tableName: 42, surface: null }));
    expect(loadSession(fallback)).toEqual(fallback);

    store.set(STORAGE_KEY, "not json");
    expect(loadSession(fallback)).toEqual(fallback);
  });

  it("survives storage that throws", () => {
    stubStorage(true);
    expect(loadSession(fallback)).toEqual(fallback);
    expect(() => saveSession(fallback)).not.toThrow();
    expect(() => clearSession()).not.toThrow();
  });
});
