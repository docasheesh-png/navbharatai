/**
 * The typecheck-gate repair, written so it can only HELP (BR2532): the repair's files are written, the compiler re-run,
 * and every file the repair broke put back (repairBreakage.ts), then the compiler re-run so the answer is the
 * workspace's own. Moved out of the build route (Q-3237: the handler only shrinks). Never throws.
 */
import { parseTscErrors } from '../EndgameRepair';
import { filesTheRepairBroke, normRepairPath } from '../repairBreakage';

export interface RepairCheck { ok: boolean; verified: boolean; errors: string }
export interface GuardedRepairPorts<C extends RepairCheck = RepairCheck> {
  /** The file as it is now in the workspace ('' or a throw when it does not exist). */
  read: (path: string) => Promise<string>;
  /** Writes files; returns the paths that LANDED (a refused write did not change anything). */
  write: (files: Array<{ path: string; content: string }>, tag: string) => Promise<string[]>;
  /** Runs the compiler on the workspace. */
  check: () => Promise<C>;
  record: (d: { phase: 'build'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean }) => void;
}

/**
 * Write a repair, re-check, and put back what it broke (then re-check again, so the answer is the workspace's own).
 * `before` is the check that started the repair. Never throws: a failed step leaves the workspace as the last check saw it.
 */
export async function writeRepairKeepingOnlyWhatHelps<C extends RepairCheck>(
  fixes: Array<{ path: string; content: string }>,
  before: C,
  ports: GuardedRepairPorts<C>,
  tag: string,
): Promise<C> {
  const snapshot = new Map<string, string>();
  for (const f of fixes) {
    try { snapshot.set(normRepairPath(f.path), await ports.read(f.path)); } catch { snapshot.set(normRepairPath(f.path), ''); }
  }
  let landed: string[] = [];
  try { landed = (await ports.write(fixes, tag)).map(normRepairPath); } catch { landed = []; }
  let after = await ports.check();
  if (!before.verified || !after.verified || landed.length === 0) return after; // no honest before/after to compare
  const { revert, why } = filesTheRepairBroke(parseTscErrors(before.errors), parseTscErrors(after.errors), landed);
  // A file the repair CREATED (empty snapshot) is not written back as an empty file; only real earlier contents return.
  const restore = revert.filter((p) => (snapshot.get(p) ?? '') !== '').map((p) => ({ path: p, content: snapshot.get(p)! }));
  if (!restore.length) return after;
  let put: string[] = [];
  try { put = await ports.write(restore, `${tag}undo-`); } catch { put = []; }
  ports.record({
    phase: 'build', severity: 'warning', code: 'REPAIR_REVERTED',
    message: (why === 'more-errors'
      ? `The repair pass raised the number of type errors, so the ${put.length} file(s) it changed were put back: `
      : `The repair pass broke ${put.length} file(s) that had compiled cleanly before it, so they were put back to their working version: `)
      + put.join(', ') + (put.length < restore.length ? ` (${restore.length - put.length} could not be written back)` : ''),
    autoResolved: false,
  });
  after = await ports.check();
  return after;
}
