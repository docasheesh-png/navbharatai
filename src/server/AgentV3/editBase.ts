// The turn-start half of "an edit starts from a verified revision": read the project's head revision, prove the
// hydrated workspace IS that head (complete), and, when it is not, find the last browser-verified copy that is.
// Kept out of the route on purpose — the route's one function is already at TypeScript's control-flow limit.

import { verifyBase, type BaseVerification, type RevisionRecord, type RevisionStore } from './projectRevisions';

export interface EditBaseResult {
  head: RevisionRecord | null;
  check: BaseVerification;
  /** A complete copy that matches the head, used as the base when the hydrated workspace is not it. */
  verifiedBase: Record<string, string> | null;
  /** A report finding to record, or null when there is nothing to say. */
  finding: { severity: 'info' | 'warning'; code: string; message: string; detail?: string; autoResolved: boolean } | null;
}

export async function checkEditBase(i: {
  workspaceId: string;
  hydrated: Readonly<Record<string, string>>;
  store: RevisionStore;
  loadVerifiedCopy: () => Promise<Record<string, string>>;
  withTimeout: <T>(p: Promise<T>, ms: number, label: string) => Promise<T>;
}): Promise<EditBaseResult> {
  const none: BaseVerification = { state: 'no-head', missing: [], extra: [], differing: [] };
  try {
    const head = await i.withTimeout(i.store.head(i.workspaceId), 4_000, 'revisionHead');
    const check = verifyBase(head, i.hydrated);
    if (!head) {
      return { head, check, verifiedBase: null, finding: { severity: 'info', code: 'EDIT_BASE_LEGACY', message: 'This project has no verified revision yet (it was saved before revisions existed). Its saved source is the base for this edit; the first verified revision is recorded when this edit is promoted.', autoResolved: true } };
    }
    if (check.state === 'verified') return { head, check, verifiedBase: null, finding: null };
    const copy = await i.loadVerifiedCopy().catch(() => ({} as Record<string, string>));
    const verifiedBase = verifyBase(head, copy).state === 'verified' ? copy : null;
    const partial = check.state === 'partial';
    return {
      head, check, verifiedBase,
      finding: {
        severity: partial ? 'warning' : 'info',
        code: partial ? 'EDIT_BASE_PARTIAL' : 'EDIT_BASE_STALE',
        message: partial
          ? `The saved copy read back at the start of this turn is missing ${check.missing.length} file(s) the project's verified version has. ${verifiedBase ? 'The last browser-verified copy that matches that version is the base for this edit.' : 'No verified copy was available, so this edit is judged against what was read back.'}`
          : 'The saved copy differs from the project\'s verified head (it was changed after the last verified edit), so this edit is not a verified successor of it.',
        detail: `missing=${check.missing.slice(0, 8).join(', ')} differing=${check.differing.slice(0, 8).join(', ')} extra=${check.extra.slice(0, 8).join(', ')} · recovered-from-verified-copy=${verifiedBase ? 'yes' : 'no'}`,
        autoResolved: verifiedBase !== null,
      },
    };
  } catch (err) {
    return { head: null, check: none, verifiedBase: null, finding: { severity: 'warning', code: 'EDIT_BASE_UNCHECKED', message: 'The project\'s revision head could not be read, so its saved copy could not be proven complete. The edit is still compared with the saved copy.', detail: String((err as Error)?.message ?? err).slice(0, 160), autoResolved: false } };
  }
}

const SKIPPED: EditBaseResult = { head: null, check: { state: 'no-head', missing: [], extra: [], differing: [] }, verifiedBase: null, finding: null };

/** `checkEditBase`, or a no-op for the turns it does not apply to (an import, an unreadable or empty saved copy). */
export async function checkEditBaseForTurn(
  i: Parameters<typeof checkEditBase>[0] & { isImportTurn: boolean; hasImportIntent: boolean; durableUnreadable: boolean },
): Promise<EditBaseResult> {
  if (i.isImportTurn || i.hasImportIntent || i.durableUnreadable || Object.keys(i.hydrated).length === 0) return SKIPPED;
  return checkEditBase(i);
}

/** The id one edit carries through retries, reconnects and provider fallbacks, so it can promote at most once. */
export function editIdFor(workspaceId: string, requestId: unknown, fallback: string): string {
  const r = typeof requestId === 'string' ? requestId.trim().slice(0, 80) : '';
  return `${workspaceId}:${r || fallback}`;
}
