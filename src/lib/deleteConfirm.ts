// Type-to-confirm guard for destructive deletes (admin-mandated 2026-07-17).
//
// Problem: when an app is already built and its files exist, a delete control that fires on a single
// click means one accidental tap can wipe EVERY file — irreversibly. The fix (GitHub's repo-delete
// pattern): a genuinely destructive delete (deleting MANY files at once, or a whole app/session) must
// not proceed until the user physically types the word "delete". A single-file delete stays one-click
// (small, recoverable). Pure + dependency-free so the rule is one source of truth and fully unit-tested.

/** The exact word the user must type to arm a destructive delete. */
export const DELETE_CONFIRM_WORD = 'delete';

/**
 * Does deleting `count` items need the typed-"delete" guard? A bulk delete (2+ files) is the
 * "sari file chali jayegi" case — one stray click there is catastrophic, so it must be armed by typing.
 * A single file is low-risk and stays one-click. (Non-positive counts never open a dialog → false.)
 */
export function requiresTypedConfirm(count: number): boolean {
  return Number.isFinite(count) && count > 1;
}

/** Is the user's typed text a valid confirmation? Case-insensitive, trimmed — but must equal "delete". */
export function isTypedConfirmValid(typed: string): boolean {
  return typeof typed === 'string' && typed.trim().toLowerCase() === DELETE_CONFIRM_WORD;
}

/**
 * The single gate the UI asks before actually deleting: may we proceed?
 * - Not a bulk delete → yes (the modal's own Cancel/Delete buttons are the guard).
 * - Bulk delete → ONLY when the user typed "delete" exactly. Until then, nothing is deleted.
 */
export function canProceedWithDelete(count: number, typed: string): boolean {
  if (!requiresTypedConfirm(count)) return true;
  return isTypedConfirmValid(typed);
}
