// GREEN GUARD — the app that worked yesterday must still work today.
//
// ADMIN 2026-08-09 (the sharpest question of the project): "pehli build me 4-5 min me app 100% ban
// jati hai, working app — to baad me 20 min tak usko edit kar ke kharab kyu kiya jata hai? Iska koi
// permanent solution nahi hai? … ek double layer protection banao, time bhi kam lage aur app bhi best
// of best bane. App banne ke baad kharab nahi honi chahiye."
//
// WHY IT HAPPENS TODAY (the mechanism, not a theory):
//   1. The durable project is saved at the END of every turn, whatever the outcome. So the saved state
//      is "the LAST turn", not "the last WORKING turn". A bad edit therefore overwrites the good app,
//      and the good version survives only as a git commit inside a sandbox that is eventually recycled.
//   2. When an edit breaks something, the engine's answer is MORE model passes — repair, heal, review,
//      autofix. Each pass is another chance to break something else, and it is where the twenty
//      minutes go. Repair is expensive and probabilistic; going back is cheap and certain.
//
// THE PRINCIPLE, ALREADY PROVEN IN THIS CODEBASE: EndgameRepair's convergence guard snapshots files
// before a repair and rolls them back if the error count got worse — "monotone by construction: it
// helps or does nothing, never harms." That is exactly the right idea, applied to ONE pass and ONE
// metric. This module raises it to the level that actually matters — the whole TURN — so a turn, like
// a repair, can only help or do nothing.
//
// THE DOUBLE LAYER:
//   • LAYER 1, PREVENT — every time a turn ends with a GENUINELY EARNED green verdict (the preview was
//     visited and really rendered, not merely "a port is open"), that exact file set is kept as the
//     workspace's LAST KNOWN GOOD, in a place a later turn cannot overwrite.
//   • LAYER 2, UNDO — when a turn ends NOT-green on a workspace that WAS green, the good state is put
//     back automatically and the user is told plainly. The user never ends a turn worse off than they
//     started it. This also collapses the time: seconds to restore, instead of twenty minutes of
//     repair roulette.
//
// This module is the PURE decision half — no Firestore, no sandbox, no I/O — so every rule below is
// unit-testable and cannot lie about what it did.

/** What we know about the app's health at one point in time. */
export interface GreenState {
  /** True only for an EARNED verdict: the preview was visited and genuinely rendered the app. */
  green: boolean;
  /** When that verdict was taken (epoch ms) — used only for honest messaging. */
  at?: number;
}

export type GreenAction = 'save' | 'restore' | 'none';

export interface GreenDecision {
  action: GreenAction;
  /** Admin-facing explanation of WHY — recorded in the build report, never guessed at later. */
  reason: string;
}

/**
 * The one rule, stated once:
 *   • green now                     → SAVE it as the new last-known-good.
 *   • not green now, but was green  → RESTORE, because this turn made a working app not work.
 *   • never green                   → NONE. There is no good state to protect yet, and restoring a
 *                                     half-built app over a half-built app helps nobody.
 * PURE.
 */
export function decideGreenGuard(input: {
  before: GreenState | null | undefined;
  after: GreenState | null | undefined;
  /** False for the very first build of a workspace — there is nothing to protect yet. */
  hasSnapshot: boolean;
}): GreenDecision {
  const afterGreen = input.after?.green === true;
  const beforeGreen = input.before?.green === true;
  if (afterGreen) {
    return { action: 'save', reason: 'The turn ended with a verified working app — recorded as the last known good state.' };
  }
  if (beforeGreen && input.hasSnapshot) {
    return { action: 'restore', reason: 'The app was verified working before this turn and is not working after it — the last known good state was restored.' };
  }
  if (beforeGreen && !input.hasSnapshot) {
    // Honest gap: we believe it was working but never captured the files, so we cannot put them back.
    return { action: 'none', reason: 'The app stopped working this turn, but no verified-good snapshot was captured earlier, so there is nothing to restore.' };
  }
  return { action: 'none', reason: 'No verified working state exists yet for this workspace — nothing to save or restore.' };
}

export interface RestorePlan {
  /** Files to write back, path → the last-known-good content. */
  write: Record<string, string>;
  /** Files this turn CREATED that the good state never had — they must go, or the result is a hybrid. */
  remove: string[];
  /** Files already identical to the good state — counted for an honest message, never rewritten. */
  unchanged: number;
}

/**
 * Turn a snapshot + the current (broken) tree into the exact writes and deletions that restore it.
 *
 * The `remove` half is what makes this a real restore rather than an overlay. A broken edit typically
 * ADDS files — a new component the rest of the app now imports, a stray config. Writing the good
 * files back on top while leaving the new ones in place produces a THIRD state that was never tested:
 * neither the working app nor the broken one. That hybrid is the classic way a "rollback" quietly
 * makes things worse, so it is closed here by construction. PURE.
 */
export function restorePlan(
  snapshot: Record<string, string>,
  current: Record<string, string>,
): RestorePlan {
  const write: Record<string, string> = {};
  let unchanged = 0;
  for (const [path, content] of Object.entries(snapshot || {})) {
    if (current && current[path] === content) unchanged++;
    else write[path] = content;
  }
  const remove = Object.keys(current || {}).filter((p) => !(p in (snapshot || {})));
  return { write, remove, unchanged };
}

/**
 * What the USER is told when their app is put back. Honest and specific — never silent, because a
 * user whose files changed under them without explanation has lost trust in the tool, and never
 * blaming their request. Carries no vendor or model name (the white-label law). PURE.
 */
export function greenGuardMessage(plan: RestorePlan): string {
  const changed = Object.keys(plan.write).length;
  const removed = plan.remove.length;
  const bits: string[] = [];
  if (changed > 0) bits.push(`${changed} file${changed === 1 ? '' : 's'} put back`);
  if (removed > 0) bits.push(`${removed} file${removed === 1 ? '' : 's'} added by that attempt removed`);
  const detail = bits.length > 0 ? ` (${bits.join(', ')})` : '';
  return `↩️ That change stopped your app from working, so I restored the last version that ran correctly${detail}. Your working app is back exactly as it was — nothing of it was lost. Tell me what you wanted and I'll try a different way.`;
}

/**
 * Where a workspace's last-known-good files live: the SAME durable store as the project itself, under
 * a suffixed key.
 *
 * Deliberately not a new storage system. The file store already solves the hard parts — one document
 * per file (so a big project never hits the 1 MB document limit), sharded writes, bounded deletes,
 * every one of them proven in production. A snapshot store of my own would have to re-earn all of
 * that, and would re-learn the same size lesson the hard way. PURE.
 */
export function greenWorkspaceKey(workspaceId: string): string {
  return `${workspaceId}::green`;
}

/** True for a snapshot key — used to keep snapshots OUT of anything that lists the user's apps. */
export function isGreenSnapshotKey(workspaceId: string): boolean {
  return typeof workspaceId === 'string' && workspaceId.endsWith('::green');
}

/** Master kill switch, honouring the project convention: set `off` to disable without a deploy. */
export function greenGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_GREEN_GUARD ?? '').trim().toLowerCase() !== 'off';
}
