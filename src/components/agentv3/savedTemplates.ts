// AgentV3 — user-saved starter templates (on-device).
//
// Completes the starter library: after building something they like, a user can SAVE it as their own
// reusable template. Saved templates sit alongside the built-in STARTER_TEMPLATES in the empty-state
// picker, so their next project starts from THEIR prompt in one tap. Stored on-device (localStorage,
// never uploaded) — instant, private, no server. Cross-device sync is a deliberate later slice.
//
// Pure + testable: every function accepts an optional Storage so tests inject a fake; the component uses
// the default localStorage. Mirrors offlineChatStore's defensive load/save discipline.

export interface SavedTemplate {
  id: string;
  label: string;
  prompt: string;
  /** Epoch ms saved (newest first in the list). */
  savedAt: number;
}

/** Versioned localStorage key (a format change bumps the suffix, never corrupts an old blob). */
export const SAVED_TEMPLATES_KEY = 'navbharat_saved_templates_v1';
/** Cap so a device's saved list can never grow unbounded (newest kept). */
export const SAVED_TEMPLATES_MAX = 20;

function resolve<T extends keyof Storage>(storage: Pick<Storage, T> | undefined, _op: T): Pick<Storage, T> | undefined {
  return storage ?? (typeof localStorage !== 'undefined' ? (localStorage as Pick<Storage, T>) : undefined);
}

/** Load the saved templates, newest first. Safe: [] on any error or malformed data. */
export function loadSavedTemplates(storage?: Pick<Storage, 'getItem'>): SavedTemplate[] {
  try {
    const store = resolve(storage, 'getItem');
    const raw = store?.getItem(SAVED_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is SavedTemplate =>
        t && typeof t.id === 'string' && typeof t.label === 'string' && typeof t.prompt === 'string' && typeof t.savedAt === 'number')
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/**
 * Save (or update) a template and return the new list (newest first, capped). A blank prompt is ignored
 * (returns the current list unchanged). De-dupes by identical trimmed prompt — re-saving the same build
 * refreshes its timestamp/label instead of piling up duplicates. `now` is injectable for deterministic tests.
 */
export function saveTemplate(
  label: string,
  prompt: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
  now: number = Date.now(),
): SavedTemplate[] {
  const cleanPrompt = String(prompt || '').trim();
  const cleanLabel = String(label || '').trim() || cleanPrompt.slice(0, 40);
  const existing = loadSavedTemplates(storage);
  if (!cleanPrompt) return existing;
  const withoutDupe = existing.filter((t) => t.prompt.trim() !== cleanPrompt);
  const entry: SavedTemplate = { id: `tpl_${now}_${withoutDupe.length}`, label: cleanLabel, prompt: cleanPrompt, savedAt: now };
  const next = [entry, ...withoutDupe].slice(0, SAVED_TEMPLATES_MAX);
  try {
    const store = resolve(storage, 'setItem');
    store?.setItem(SAVED_TEMPLATES_KEY, JSON.stringify(next));
  } catch {
    /* quota / serialization — non-fatal; the caller still gets the intended list for this session */
  }
  return next;
}

/** Remove one saved template by id and return the new list. Safe. */
export function removeSavedTemplate(id: string, storage?: Pick<Storage, 'getItem' | 'setItem'>): SavedTemplate[] {
  const next = loadSavedTemplates(storage).filter((t) => t.id !== id);
  try {
    const store = resolve(storage, 'setItem');
    store?.setItem(SAVED_TEMPLATES_KEY, JSON.stringify(next));
  } catch {
    /* non-fatal */
  }
  return next;
}
