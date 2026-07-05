// B7 (audit Batch 5) — persist the v3.0 chat composer's unsent draft across reloads.
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
