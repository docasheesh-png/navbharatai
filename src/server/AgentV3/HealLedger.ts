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

/**
 * Per workspace: file path → how many times we healed it, the content we last left behind, and what
 * the NEXT pass found there.
 *
 * WHY `seenBefore` WAS ADDED (2026-08-10). The hash of what we left was already stored and nothing
 * ever read it, so the ledger could prove a heal REPEATED but not say why — and "a lost write, or
 * something restoring older content" is two different bugs in two different places. Comparing what the
 * next pass FOUND against what we LEFT separates them without guessing:
 *
 *   • found ≠ left  → the file genuinely changed underneath us. A lost write, or something later
 *                     overwriting it from a stale copy. The bug is in the write/restore path.
 *   • found = left  → our write survived intact, and the detector fired again on content we had
 *                     already fixed. Nothing was lost; the repair or its detector is not idempotent.
 *                     The bug is in OUR analyzer.
 *
 * Nobody had distinguished these, and the second was never even considered — the message asserted a
 * lost write as fact. One hash comparison decides it, at no cost, from the next real build.
 */
const LEDGER = new Map<string, Map<string, HealRecord>>();

interface HealRecord {
  times: number;
  /** Hash of what we left behind on the most recent heal. */
  hash: string;
  /**
   * Every content this build has ever written to this file, by hash.
   *
   * ⚠️ THIS IS WHAT CATCHES AN OSCILLATION (admin report 2026-08-25: src/main.tsx healed ×4, and this
   * ledger's own verdict was `unchanged` — our write survived and a detector fired again on content it
   * had already fixed). Three deterministic import fixers run over the same file in one pass: one
   * reconciles named↔default, one adds a missing import, one removes a duplicate. If any two disagree
   * about the same symbol, the file goes X → Y → X → Y for as many passes as the build allows.
   *
   * `hash` alone cannot see that: it only remembers the LAST thing we wrote, so X→Y→X looks like two
   * ordinary heals. The set remembers that we have been here before.
   *
   * I did NOT guess which fixer is at fault, and deliberately did not "fix" one on a theory — I tested
   * `dedupeSameModuleImports` against the shapes that would have made it the culprit (default+named,
   * two named sets, exact duplicate, two defaults) and it is idempotent and loses no binding. Without
   * the user's actual file the guilty pair cannot be identified, so the guard is at the LOOP, where it
   * works whichever fixer is wrong.
   */
  seen: Set<string>;
  /**
   * What a LATER pass found before healing again, compared with `hash` above.
   * 'unchanged' = our write survived; 'changed' = the file differs from what we left;
   * undefined = healed only once, so there is nothing to compare yet.
   */
  seenBefore?: 'unchanged' | 'changed';
}

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
 *
 * `contentBefore` is what this pass READ before repairing. Passing it is what turns a repeat from
 * "something went wrong" into a named cause — see the LEDGER comment. It is optional so an existing
 * caller keeps working unchanged; a repeat recorded without it simply reports the cause as unknown
 * rather than asserting one.
 */
export function noteHeal(workspaceId: string, path: string, contentAfter: string, contentBefore?: string): void {
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
    // Only meaningful on a REPEAT: on the first heal there is nothing we left behind to compare with.
    // Once a verdict is recorded it STICKS — a third pass that happens to read something else must not
    // erase the evidence the second pass gave us.
    const seenBefore = prev && contentBefore !== undefined
      ? (prev.seenBefore ?? (hashOf(contentBefore) === prev.hash ? 'unchanged' : 'changed'))
      : prev?.seenBefore;
    const seen = prev?.seen ?? new Set<string>();
    if (contentBefore !== undefined) seen.add(hashOf(contentBefore));
    seen.add(hashOf(contentAfter));
    ws.set(path, { times: (prev?.times ?? 0) + 1, hash: hashOf(contentAfter), seen, ...(seenBefore ? { seenBefore } : {}) });
  } catch { /* bookkeeping must never break a heal */ }
}

/**
 * Would writing `proposed` to `path` put this file back into a state this build has already left it in?
 *
 * That is an OSCILLATION, not a repair: two fixers disagreeing about the same code, each undoing the
 * other. Every further pass costs a write, a narration and a step of the build's budget, and converges
 * on nothing. Returns false on the first sight of any content, so an ordinary heal — and an ordinary
 * SECOND heal that genuinely moves the file forward — is untouched.
 *
 * Deliberately compares against contents ALREADY WRITTEN, not against the current one: writing the
 * same thing twice is a harmless no-op that other code already skips. What has to stop is going BACK.
 *
 * Never throws; on any doubt it returns false, because wrongly refusing a real repair is worse than
 * one extra oscillation. PURE apart from the read.
 */
export function healWouldOscillate(workspaceId: string, path: string, proposed: string): boolean {
  try {
    const rec = LEDGER.get(workspaceId)?.get(path);
    if (!rec || !rec.seen || rec.seen.size === 0) return false;
    const h = hashOf(proposed ?? '');
    // The content we are ABOUT to write is one we have written before, and it is not what is there now
    // — so the file is being moved back to an earlier state.
    return rec.seen.has(h) && h !== rec.hash;
  } catch {
    return false;
  }
}

export interface HealRepeat {
  path: string;
  times: number;
  /**
   * What the repeating pass found, relative to what the previous one left.
   * 'changed' → the file moved underneath us (lost write / stale overwrite).
   * 'unchanged' → our write held and the detector re-fired on already-fixed content.
   * undefined → the caller did not supply the before-content, so we do not claim to know.
   */
  cause?: 'changed' | 'unchanged';
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
    .map(([path, v]) => ({ path, times: v.times, ...(v.seenBefore ? { cause: v.seenBefore } : {}) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The honest, ADMIN-facing line naming the evidence. Not user-facing: a user does not need to know
 * our repair passes ran twice, and the white-label rule keeps internal forensics off their screen.
 * PURE.
 */
export function healRepeatMessage(repeats: readonly HealRepeat[]): string {
  const total = repeats.reduce((n, r) => n + r.times, 0);
  const label = (r: HealRepeat): string =>
    `${r.path} ×${r.times}${r.cause === 'changed' ? ' (file changed under us)' : r.cause === 'unchanged' ? ' (our write held)' : ''}`;
  const shown = repeats.slice(0, 5).map(label).join(', ');
  const more = repeats.length - Math.min(5, repeats.length);
  const head = `${repeats.length} file(s) had to be healed MORE THAN ONCE in this build (${shown}${more > 0 ? ` +${more} more` : ''}, ${total} heal passes in total).`;

  // The verdict is stated ONLY from the hash comparison. The previous wording asserted "the write was
  // NOT present" as established fact, which was a theory — and it happens to be the theory that sends
  // whoever reads it to investigate the sandbox write path. If the truth is the other branch, that is
  // days spent in the wrong file.
  const changed = repeats.filter((r) => r.cause === 'changed').length;
  const held = repeats.filter((r) => r.cause === 'unchanged').length;
  const unknown = repeats.length - changed - held;

  const parts: string[] = [];
  if (changed) {
    parts.push(
      `${changed} file(s) did NOT contain what the previous heal left behind — the file genuinely changed `
      + 'underneath us, so the cause is a lost write or something later overwriting it from a stale copy. '
      + 'Look at the write/restore path.',
    );
  }
  if (held) {
    parts.push(
      `${held} file(s) still contained EXACTLY what the previous heal wrote — nothing was lost. The repair `
      + 'survived and the detector fired again on content it had already fixed, so the bug is in our '
      + 'analyzer or in a repair that is not idempotent. Look at the detector, not at the sandbox.',
    );
  }
  if (unknown) {
    parts.push(
      `${unknown} file(s) were recorded without the content the pass read, so their cause is genuinely `
      + 'unknown — not assumed.',
    );
  }
  return `${head} ${parts.join(' ')}`;
}

/** Start a build with a clean sheet, so a repeat means "twice in THIS build". Never throws. */
export function resetHealLedger(workspaceId: string): void {
  try { LEDGER.delete(workspaceId); } catch { /* best-effort */ }
}

/** Test seam — drop everything. */
export function _clearHealLedgerForTests(): void {
  LEDGER.clear();
}
