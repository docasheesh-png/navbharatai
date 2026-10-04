/**
 * A package.json that is EMPTY in the sandbox is put back from the last valid copy, and the machine's
 * state at that moment is recorded so the next report names what emptied it.
 *
 * 🔴 WHY (autopsy of builds 1eaa5f5a / e3b0ce25, 2026-10-04). Twice in one build the sandbox's
 * package.json was 0 bytes while the saved copy (453 B) was fine. Every npm command then failed with
 * EJSONPARSE, the model spent four calls rewriting the file from memory, and the dev server would not
 * stay up (PREVIEW_SERVER_DOWN). Both times it happened while the platform's own write-time typecheck
 * was being run as a dev-server launch (fixed in devServerHost.ts), so concurrent installs and kills
 * were running in the workspace — but which process truncated the file was never recorded. An empty
 * manifest is never a valid project, so restoring it cannot overwrite real work.
 *
 * The OPEN half is the writer itself (PROGRESS.md / BUILD_REPORT_QUEUE.md): the evidence line below is
 * what lets the next report settle it. PURE helpers.
 */

/** True only for a file that exists and holds nothing but whitespace. A missing file is null, not empty. */
export function isEmptyManifest(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && raw.trim() === '';
}

/** The candidate when it is a real package.json (a JSON object), else null. */
export function validManifest(candidate: string | null | undefined): string | null {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? candidate : null;
  } catch {
    return null;
  }
}

/** The first valid copy, in the order given (the session's last write first, then the saved project). */
export function pickManifestRestore(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const v = validManifest(c);
    if (v) return v;
  }
  return null;
}

/**
 * What was running when the manifest was found empty: the file's own times, every npm/node process,
 * and the newest npm logs. Read-only and bounded.
 */
export const EMPTY_MANIFEST_EVIDENCE_COMMAND =
  "ls -la --time-style=full-iso package.json package-lock.json 2>&1 | head -3; "
  + "ps -eo pid,ppid,etimes,args 2>/dev/null | grep -E '[n]pm|[n]ode|[t]sc' | cut -c1-200 | head -15; "
  + 'ls -t /home/user/.npm/_logs 2>/dev/null | head -3; true';

/** The line the install log carries, so the report and the model both see what happened. */
export function emptyManifestNote(restored: boolean, evidence: string): string {
  const head = restored
    ? '[health-check] package.json was EMPTY in the sandbox — restored the last valid copy before installing.'
    : '[health-check] package.json was EMPTY in the sandbox and no valid copy was available to restore.';
  const ev = evidence.trim().split('\n').slice(0, 20).join('\n');
  return ev ? `${head}\n[health-check] state when found empty:\n${ev}` : head;
}
