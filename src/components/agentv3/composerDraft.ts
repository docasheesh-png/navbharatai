// B7 (audit Batch 5) — persist the v5.0 chat composer's unsent draft across reloads.
//
// ROOT CAUSE of "typing lost on reload": the composer's `prompt` was pure in-memory React state, so a
// reload (now MORE likely thanks to B8's prompt SW-update reloads, and always possible on a phone
// backgrounding the tab) wiped whatever the user had typed but not sent. The honest fix is to make the
// draft survive — NOT to bolt an intrusive `beforeunload` "are you sure?" dialog over the data loss
// (with the draft persisted AND sticky sessions resuming the build, nothing is actually lost, so a
// confirm dialog would only annoy). This tiny module is the pure, testable storage boundary.

/** One global key: the composer holds one unsent message; it is restored wherever the user lands. */
export const COMPOSER_DRAFT_KEY = 'nbai_v3_composer_draft';

/** Cap the persisted draft so a giant paste can't blow the localStorage quota. */
export const MAX_DRAFT_CHARS = 20_000;

type WritableStorage = Pick<Storage, 'setItem' | 'removeItem'>;
type ReadableStorage = Pick<Storage, 'getItem'>;

/** Persist a non-empty draft (trimmed check); an empty/whitespace draft CLEARS the stored one. */
export function saveDraft(text: string, storage?: WritableStorage): void {
  const s = storage ?? safeLocalStorage();
  if (!s) return;
  try {
    if (text && text.trim()) s.setItem(COMPOSER_DRAFT_KEY, text.slice(0, MAX_DRAFT_CHARS));
    else s.removeItem(COMPOSER_DRAFT_KEY);
  } catch { /* storage full / unavailable — the draft is best-effort, never breaks typing */ }
}

/** Read the persisted draft, or '' when none / storage is unavailable. */
export function loadDraft(storage?: ReadableStorage): string {
  const s = storage ?? safeLocalStorage();
  if (!s) return '';
  try { return s.getItem(COMPOSER_DRAFT_KEY) ?? ''; } catch { return ''; }
}

function safeLocalStorage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/**
 * Put `insert` where the caret is (or over the selected text) and say where the caret goes next — the user's own words are
 * never replaced (admin 2026-11-26: a Game Library pick used to overwrite the whole box). A space is added on a side only
 * where the neighbouring text is not already a space. No caret known (the box was never focused) ⇒ at the end. PURE.
 */
export function insertAtCursor(text: string, insert: string, start: number | null, end: number | null): { text: string; caret: number } {
  const value = String(text ?? '');
  const from = typeof start === 'number' && start >= 0 && start <= value.length ? start : value.length;
  const to = typeof end === 'number' && end >= from && end <= value.length ? end : from;
  const before = value.slice(0, from), after = value.slice(to);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : after ? '' : ' ';
  const out = before + lead + insert + trail + after;
  return { text: out, caret: (before + lead + insert + trail).length };
}
