// HEAL LEDGER — proof, not suspicion, that a self-heal did not survive.
//
// THE OPEN ROOT CAUSE THIS EXISTS TO CLOSE (build report 02be22e3, 2026-08-09). Three deterministic
// self-heals — "added 2 missing imports", "removed a duplicate import in src/App.tsx", "removed a
// duplicate import in src/main.tsx" — ran, and then the IDENTICAL three ran again twenty seconds
// later. `readEvalSnapshot` re-reads every file fresh from the sandbox on each pass, and the dedupe
// heal only fires when the content genuinely still differs, so the second run proves the first heal's
// writes were NOT present when the second read happened. Either a lost write, or something restoring
// older content over it.
//
// I refused to guess the mechanism (rule 4: no fixing from theories), and a suspicion recorded in
// PROGRESS.md cannot be acted on later. So this records the FACT with names and counts, in the one
// place both passes can reach.
//
// WHY A SHARED, WORKSPACE-KEYED STORE AND NOT A FIELD ON THE DISPATCHER: the two passes run on
// DIFFERENT ToolDispatcher instances — the reviewer gets a child dispatcher (see SubAgent) — so any
// per-instance memory is blind to exactly the case worth catching. Keyed by workspace, it is the
// smallest thing both can see.
//
// The dispatcher only WRITES here (a plain import, no new constructor parameter to thread through the
// sub-agent spawn); the route READS it at settle and records the finding, because that is where the
// diagnostics object lives. Pure decisions, bounded memory, never throws.

import { createHash } from 'node:crypto';

/** Per workspace: file path → how many times we healed it, and the content we last left behind. */
const LEDGER = new Map<string, Map<string, { times: number; hash: string }>>();

/** Bound the memory: a pathological build must not grow this without limit. */
const MAX_PATHS_PER_WORKSPACE = 500;
/** Bound the number of workspaces held at once (a long-lived server sees many). */
const MAX_WORKSPACES = 200;

function hashOf(content: string): string {
  return createHash('sha256').update(content ?? '').digest('hex').slice(0, 16);
}

/**
 * Record that we just healed `path`, leaving `contentAfter` behind. Called by every deterministic
 * self-heal that writes a file. Never throws.
 */
export function noteHeal(workspaceId: string, path: string, contentAfter: string): void {
  try {
    if (!workspaceId || !path) return;
    let ws = LEDGER.get(workspaceId);
    if (!ws) {
      if (LEDGER.size >= MAX_WORKSPACES) {
        // Drop the oldest inserted workspace — Map preserves insertion order.
        const oldest = LEDGER.keys().next();
        if (!oldest.done) LEDGER.delete(oldest.value);
      }
      ws = new Map();
      LEDGER.set(workspaceId, ws);
    }
    const prev = ws.get(path);
    if (!prev && ws.size >= MAX_PATHS_PER_WORKSPACE) return;
    ws.set(path, { times: (prev?.times ?? 0) + 1, hash: hashOf(contentAfter) });
  } catch { /* bookkeeping must never break a heal */ }
}

export interface HealRepeat {
  path: string;
  times: number;
}

/**
 * Files healed MORE THAN ONCE in this build — the proof that a heal's write did not survive to the
 * next reader. Sorted by path so the record is stable. PURE (reads the ledger, changes nothing).
 */
export function healRepeats(workspaceId: string): HealRepeat[] {
  const ws = LEDGER.get(workspaceId);
  if (!ws) return [];
  return [...ws.entries()]
    .filter(([, v]) => v.times > 1)
    .map(([path, v]) => ({ path, times: v.times }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The honest, ADMIN-facing line naming the evidence. Not user-facing: a user does not need to know
 * our repair passes ran twice, and the white-label rule keeps internal forensics off their screen.
 * PURE.
 */
export function healRepeatMessage(repeats: readonly HealRepeat[]): string {
  const total = repeats.reduce((n, r) => n + r.times, 0);
  const shown = repeats.slice(0, 5).map((r) => `${r.path} ×${r.times}`).join(', ');
  const more = repeats.length - Math.min(5, repeats.length);
  return `${repeats.length} file(s) had to be healed MORE THAN ONCE in this build (${shown}${more > 0 ? ` +${more} more` : ''}, ${total} heal passes in total). Each pass re-reads the file fresh from the sandbox and only acts when the defect is genuinely still there, so a repeat proves the earlier heal's write was NOT present on the next read — a lost write, or something restoring older content over it. The repair itself worked; what failed is that it did not last.`;
}

/** Start a build with a clean sheet, so a repeat means "twice in THIS build". Never throws. */
export function resetHealLedger(workspaceId: string): void {
  try { LEDGER.delete(workspaceId); } catch { /* best-effort */ }
}

/** Test seam — drop everything. */
export function _clearHealLedgerForTests(): void {
  LEDGER.clear();
}
