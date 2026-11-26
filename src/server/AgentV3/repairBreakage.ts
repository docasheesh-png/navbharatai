/**
 * 🩹 A REPAIR NEVER BREAKS A FILE THAT WAS CLEAN (BR2532, admin 2026-11-26: "isme game ban gaya par enemy aa hi nahi rahe").
 *
 * What happened. The builder wrote `src/game/features/monsters.ts`, and the write-time typecheck said "monsters.ts is
 * clean, but 3 error(s) remain elsewhere" (old kit files). At the end of the build the typecheck-gate repair pass was
 * shown EVERY file this build wrote and asked to fix those 3. It rewrote monsters.ts — a file with no error — into one
 * that used `world.scene` and `controller.position`, which do not exist, so the monsters were never added to the scene.
 * The re-check failed, and the pass's writes were KEPT. The user was told "kaam ho gaya", then the production build
 * named four errors in monsters.ts.
 *
 * THE CLASS: a model repair whose writes are kept even when they made the project worse. The agentic endgame already
 * reverted a repair that raised the TOTAL error count (CrewHub 59 → 67), but not one that fixed three errors in one file
 * and made three new ones in another (count unchanged), and the typecheck-gate pass reverted nothing at all.
 *
 * THE RULE, shared by every compiler-checked repair: after the repair, a file it touched that now has an error and had
 * none before is put back; if the total rose, every file it touched is put back. PURE.
 */

export const normRepairPath = (p: string) => String(p ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * The touched files to put back: those that gained their first error from the repair — or, when the repair raised the
 * total, every touched file. `b`/`a` are the parsed errors before and after (EndgameRepair's parseTscErrors). PURE.
 */
export function filesTheRepairBroke(
  b: ReadonlyArray<{ file: string }>,
  a: ReadonlyArray<{ file: string }>,
  touched: Iterable<string>,
): { revert: string[]; why: 'more-errors' | 'newly-broken' | null } {
  const was = new Set(b.map((e) => normRepairPath(e.file)));
  const now = new Set(a.map((e) => normRepairPath(e.file)));
  const paths = [...new Set([...touched].map(normRepairPath))];
  if (a.length > b.length) return { revert: paths, why: 'more-errors' };
  const broke = paths.filter((p) => now.has(p) && !was.has(p));
  return broke.length ? { revert: broke, why: 'newly-broken' } : { revert: [], why: null };
}

