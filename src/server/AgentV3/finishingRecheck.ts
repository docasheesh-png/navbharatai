// POST-GREEN FINISHING RE-CHECK (owner item 2, 2026-10-19).
//
// THE GAP: the finishing passes (e2e scaffold + its tsconfig exclude, the architecture note, production
// defaults: service worker, manifest, icons, the index.html patch) write AFTER the in-build green proof
// may already have saved a last-known-good snapshot. If one of those writes breaks the preview, the only
// net was the end-of-build GreenGuard, which restores the WHOLE snapshot — throwing away every legitimate
// change made after green — or, if the later checks happen to be inconclusive, nothing at all.
//
// THE FIX: right after the finishing passes, when the app was already proven green in this build and those
// passes wrote something, look at the preview once. Only a CONCLUSIVE "did not render" (the GreenGuard rule:
// ignorance is not evidence) rolls back exactly the finishing files to their content in the last green
// snapshot — a file the snapshot does not hold was created by a finishing pass and is removed. Nothing the
// model wrote is touched. Every run leaves one line on the timeline. Kill switch:
// AGENTV3_POST_GREEN_RECHECK=off. No billing, wallet or login code is involved.

export function postGreenRecheckEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.AGENTV3_POST_GREEN_RECHECK || '').trim().toLowerCase() !== 'off';
}

export interface FinishingRollbackPlan {
  write: Record<string, string>;
  remove: string[];
}

/** Which finishing files go back to the snapshot and which are removed. Pure. */
export function finishingRollbackPlan(paths: Iterable<string>, snapshot: Record<string, string>): FinishingRollbackPlan {
  const write: Record<string, string> = {};
  const remove: string[] = [];
  for (const p of new Set(paths)) {
    if (typeof snapshot[p] === 'string') write[p] = snapshot[p];
    else remove.push(p);
  }
  return { write, remove };
}

export interface RecheckNote {
  severity: 'info' | 'warning';
  code: 'POST_GREEN_RECHECK_OK' | 'POST_GREEN_RECHECK_INCONCLUSIVE' | 'POST_GREEN_ROLLBACK' | 'POST_GREEN_ROLLBACK_SKIPPED';
  message: string;
  detail?: string;
  autoResolved: boolean;
}

export interface FinishingRecheckDeps {
  enabled: boolean;
  /** Epoch ms of this build's proven green render; 0 = never proven (nothing to protect). */
  greenAt: number;
  /** Files the finishing passes wrote. */
  paths: string[];
  aborted: () => boolean;
  /** One preview look. `conclusive` is false for timeouts, a down server, inconclusive verdicts. */
  look: () => Promise<{ rendered: boolean; conclusive: boolean }>;
  loadSnapshot: () => Promise<Record<string, string>>;
  restore: (plan: FinishingRollbackPlan) => Promise<void>;
  record: (note: RecheckNote) => void;
}

export type FinishingRecheckResult =
  | { action: 'skipped' }
  | { action: 'ok' | 'inconclusive' }
  | { action: 'rolled-back'; plan: FinishingRollbackPlan; recovered: boolean | null }
  | { action: 'no-snapshot' };

/** The I/O-free orchestration (all effects are injected). Never throws. */
export async function recheckAfterFinishingWrites(d: FinishingRecheckDeps): Promise<FinishingRecheckResult> {
  try {
    if (!d.enabled || !(d.greenAt > 0) || d.paths.length === 0 || d.aborted()) return { action: 'skipped' };
    const files = d.paths.slice(0, 12).join(', ');
    const first = await d.look().catch(() => ({ rendered: false, conclusive: false }));
    if (first.rendered) {
      d.record({ severity: 'info', code: 'POST_GREEN_RECHECK_OK', autoResolved: true, message: `The app still renders after the finishing passes wrote ${d.paths.length} file(s).`, detail: files });
      return { action: 'ok' };
    }
    if (!first.conclusive) {
      d.record({ severity: 'info', code: 'POST_GREEN_RECHECK_INCONCLUSIVE', autoResolved: true, message: 'The preview could not be checked after the finishing passes, so their files were kept.', detail: files });
      return { action: 'inconclusive' };
    }
    const snapshot = await d.loadSnapshot().catch(() => ({} as Record<string, string>));
    if (Object.keys(snapshot).length === 0) {
      d.record({ severity: 'warning', code: 'POST_GREEN_ROLLBACK_SKIPPED', autoResolved: false, message: 'The app stopped rendering after the finishing passes, but no green snapshot could be read to roll back to.', detail: files });
      return { action: 'no-snapshot' };
    }
    const plan = finishingRollbackPlan(d.paths, snapshot);
    await d.restore(plan);
    const after = await d.look().catch(() => ({ rendered: false, conclusive: false }));
    const recovered = after.rendered ? true : after.conclusive ? false : null;
    d.record({
      severity: 'warning', code: 'POST_GREEN_ROLLBACK', autoResolved: recovered === true,
      message: `The app stopped rendering after the finishing passes; their ${d.paths.length} file(s) were rolled back to the last green snapshot${recovered === true ? ' and it renders again' : recovered === false ? ', but it still does not render' : ' (re-check inconclusive)'}.`,
      detail: `restored: ${Object.keys(plan.write).join(', ') || '—'} · removed: ${plan.remove.join(', ') || '—'}`,
    });
    return { action: 'rolled-back', plan, recovered };
  } catch {
    return { action: 'skipped' };
  }
}
