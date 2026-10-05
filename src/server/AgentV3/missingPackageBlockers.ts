// AgentV3 — a package the app LOADS but nobody installed makes "Ready" untrue (Q-143, admin-approved (b)
// 2026-10-05).
//
// A package imported but neither declared nor installed was only ever ADVISORY ("verify, may be a local
// alias"). For the curated allowlist the reconciler adds it to package.json itself, so those were fine; for
// anything else the build could finish READY over an app whose first import throws "Cannot find module".
//
// THE RULE, option (b): it is a readiness blocker only when ALL of these hold —
//   • a file that imports it is one the app actually loads (`appReachability` — a stray file nothing
//     imports is harmless), and the reachability verdict exists at all (withheld ⇒ no block, today's
//     behaviour: a heuristic must never false-fail a working app);
//   • it is still undeclared AFTER the allowlist reconciler ran (so a package the heal just added never
//     blocks — that is the allowlist half of (b), read from the result instead of assumed);
//   • it is not in the sandbox's node_modules either (installed-but-undeclared works here and fails on a
//     fresh install; that stays a medium finding, not a blocker, because the app does run).
// PURE — the node_modules probe lives at the call site, where the actuator is.

import { isUnreachable, type ReachabilityVerdict } from './appReachability';
import { normalizeImportToPackage } from './DependencyAnalysis';

export interface MissingPackageUse {
  package: string;
  /** The first loaded file that imports it. */
  file: string;
}

/**
 * The missing packages a LOADED file imports, one entry per package, in file order. Empty when the
 * reachability verdict is absent or not applicable — never a block on a guess.
 */
export function loadedMissingPackageUses(
  imports: Readonly<Record<string, readonly string[]>>,
  missingPackages: Iterable<string>,
  reach: ReachabilityVerdict | null | undefined,
  skipFiles: ReadonlySet<string> = new Set(),
): MissingPackageUse[] {
  if (!reach || !reach.applicable) return [];
  const missing = new Set(missingPackages);
  if (missing.size === 0) return [];
  const out: MissingPackageUse[] = [];
  const seen = new Set<string>();
  for (const [file, specs] of Object.entries(imports ?? {})) {
    if (skipFiles.has(file) || isUnreachable(reach, file)) continue;
    for (const spec of specs ?? []) {
      if (typeof spec !== 'string' || spec.startsWith('.')) continue;
      const pkg = normalizeImportToPackage(spec);
      if (!pkg || !missing.has(pkg) || seen.has(pkg)) continue;
      seen.add(pkg);
      out.push({ package: pkg, file });
    }
  }
  return out;
}

/** The readiness line for packages the app loads that are not installed. */
export function notInstalledBlockerLabel(uses: readonly MissingPackageUse[]): string {
  const shown = uses.slice(0, 3).map((u) => `${u.package} (imported by ${u.file})`).join(', ');
  return `${uses.length} package(s) the app loads are not installed — it will fail with "Cannot find module": ${shown}`
    + `${uses.length > 3 ? ', …' : ''}. Add each to package.json and install it, or remove the import.`;
}

/** The finding for packages that are installed here but declared nowhere — a fresh install would fail. */
export function undeclaredInstalledLabel(uses: readonly MissingPackageUse[]): string {
  const shown = uses.slice(0, 3).map((u) => u.package).join(', ');
  return `${uses.length} package(s) installed in this sandbox but missing from package.json (a fresh install, `
    + `including publishing, would fail): ${shown}${uses.length > 3 ? ', …' : ''}`;
}
