const STORAGE_KEY = "dynamics-ribbon-designer.session.v1";

/**
 * Only the settings that stay meaningful without a loaded ribbon are persisted. The button
 * selection is not: every ribbon load clears it, so a restored selection could never match
 * the controls on screen.
 */
const PERSISTED_FIELDS = ["tableName", "publisher", "surface", "newSolutionName"];

export function loadSession(fallback) {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const stored = JSON.parse(raw);
    const session = { ...fallback };
    for (const field of PERSISTED_FIELDS) {
      if (typeof stored?.[field] === "string") session[field] = stored[field];
    }
    return session;
  } catch {
    return fallback;
  }
}

export function saveSession(session) {
  try {
    const persisted = Object.fromEntries(PERSISTED_FIELDS.map((field) => [field, session[field]]));
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Private browsing and a full quota must not break the designer.
  }
}

export function clearSession() {
  try {
    window.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to recover from; the in-memory session is still authoritative.
  }
}
