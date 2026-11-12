// AgentV3 — the fast lane's dependency reconcile, BEFORE its compile check (autopsy BR1959, 2026-11-09).
//
// 🔴 THE DEFECT. A school app's Navbar and App imported `react-router-dom`, which the scaffold's package.json
// did not declare. The fast lane type-checks the files it wrote (`fastVerify`) BEFORE it ever installs
// anything — the only dependency reconcile it had lived in `fastPreview`, which runs after verify PASSES.
// So `tsc` reported TS2307 "Cannot find module 'react-router-dom'" five times, the paid repair round (which
// can only rewrite files — it cannot install a package) spent 27 s and changed nothing, and the build was
// handed to the full builder at 379 s, which ran `npm install react-router-dom` itself 47 s later. The fix
// had one correct answer the whole time, and the platform already knew it (`WELL_KNOWN_DEPS` pins it).
//
// 🔴 THE SIBLING, in the same lane. `fastPreview`'s reconcile read only the files the lane WROTE. When the
// lane did not write package.json (BR1959 did not), `findMissingDependencies` saw no manifest, counted
// every import — `react` included — as undeclared, and installed all of them unpinned.
//
// 🔑 ONE PURE PLAN FOR BOTH CALLERS. The manifest is the package.json the lane wrote, else the one on disk,
// else there is none — and with none, nothing is guessed. Allowlisted packages are ADDED to package.json at
// their pinned range (`applyWellKnownMissingDeps`, add-only, re-parse validated, guarded against ever
// dropping a declared dependency); anything still undeclared is installed by name, shell-safe and capped,
// exactly as the preview reconcile always did. PURE — no I/O.

import { applyWellKnownMissingDeps, restoreDroppedDependencies } from './DependencyAutoFix';
import { findMissingDependencies } from './DependencyReconciler';

export interface FastLaneDependencyPlan {
  /** Where the manifest came from; `none` plans nothing. */
  manifest: 'written' | 'disk' | 'none';
  /** The package.json to write before installing — only when a pinned dependency was added to it. */
  packageJson: string | null;
  /** Dependencies added to package.json at their pinned range. */
  pinned: Array<{ package: string; version: string }>;
  /** Imported packages still undeclared after that — installed by name. */
  unpinned: string[];
}

const SHELL_SAFE_PACKAGE = /^(?:@[\w.-]+\/)?[\w.-]+$/;
const MAX_UNPINNED = 20;

export function fastLaneDependencyPlan(written: Record<string, string>, diskPackageJson: string | null | undefined): FastLaneDependencyPlan {
  const none: FastLaneDependencyPlan = { manifest: 'none', packageJson: null, pinned: [], unpinned: [] };
  const writtenPkg = written['package.json'];
  const manifest = typeof writtenPkg === 'string' ? 'written' : typeof diskPackageJson === 'string' ? 'disk' : 'none';
  const raw = typeof writtenPkg === 'string' ? writtenPkg : diskPackageJson;
  if (manifest === 'none' || typeof raw !== 'string') return none;
  try { JSON.parse(raw); } catch { return { ...none, manifest }; } // an unreadable manifest is never rewritten or guessed past
  const files = { ...written, 'package.json': raw };
  let content = raw;
  let pinned: FastLaneDependencyPlan['pinned'] = [];
  try {
    const added = applyWellKnownMissingDeps(files);
    if (added.added.length > 0) {
      content = restoreDroppedDependencies(added.files['package.json'], raw).content;
      pinned = added.added;
    }
  } catch { /* nothing pinned — the by-name remainder below still runs */ }
  let unpinned: string[] = [];
  try {
    const pinnedNames = new Set(pinned.map((p) => p.package));
    unpinned = findMissingDependencies({ ...files, 'package.json': content })
      .filter((p) => SHELL_SAFE_PACKAGE.test(p) && !pinnedNames.has(p))
      .slice(0, MAX_UNPINNED);
  } catch { unpinned = []; }
  return { manifest, packageJson: pinned.length > 0 ? content : null, pinned, unpinned };
}

/**
 * The one install command for a plan, or null when there is nothing to install. `pinnedWritten` says whether
 * the pinned package.json reached the workspace: when it did, a plain install fetches the pinned packages;
 * when it did not, they are named with their pinned range so they are still installed exactly as pinned.
 * `|| … --legacy-peer-deps` retries only on a strict-resolution failure (EventHive autopsy), as the
 * preview reconcile always did. PURE.
 */
export function fastLaneDependencyInstallCommand(plan: FastLaneDependencyPlan, pinnedWritten = true): string | null {
  const named = [
    ...(pinnedWritten ? [] : plan.pinned.map((p) => `'${p.package}@${p.version.replace(/'/g, '')}'`)),
    ...plan.unpinned,
  ];
  if (plan.pinned.length === 0 && named.length === 0) return null;
  const args = named.length > 0 ? ` ${named.join(' ')}` : '';
  return `npm install --no-audit --no-fund${args} || npm install --no-audit --no-fund --legacy-peer-deps${args}`;
}

/** The one line said about it, after the install ran — the packages, pinned ones with their range. '' when nothing was planned. PURE. */
export function fastLaneDependencyNote(plan: FastLaneDependencyPlan, stage: 'verify' | 'preview', installed: boolean): string {
  const all = [...plan.pinned.map((p) => `${p.package}@${p.version}`), ...plan.unpinned];
  if (all.length === 0) return '';
  const when = stage === 'verify' ? 'before the compile check' : 'before the dev server started';
  return installed
    ? `Installed ${all.length} package(s) the code imports but package.json did not declare, ${when}: ${all.join(', ')}.`
    : `Tried to install ${all.length} package(s) the code imports but package.json did not declare, ${when} — the install reported an error: ${all.join(', ')}.`;
}
