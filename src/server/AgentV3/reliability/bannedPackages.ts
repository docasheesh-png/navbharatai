/**
 * P5b — THE BANNED-PACKAGES LIST, ENFORCED IN CODE (fix/build-reliability, AGENTV3_BANNED_PACKAGE_GUARD).
 *
 * `packageChoiceRule()` tells the model which packages not to install, and `unfixableInstallNote`
 * warns AFTER an install — autopsy 3f959fde shows a builder reading that warning and shipping xlsx
 * anyway. A rule the model can ignore is advice; this makes it a guard:
 *   • a bash install that names a banned package is REFUSED before it runs (nothing is installed);
 *   • a package.json write has banned deps removed, and the model is told why and what to use.
 * The list is the same closed, reviewed list (`UNFIXABLE_NPM_PACKAGES` + `BUILT_IN_ALTERNATIVES`), so
 * the prompt rule and the guard can never disagree. PURE.
 */
import { BUILT_IN_ALTERNATIVES, UNFIXABLE_NPM_PACKAGES, packagesInstalledBy } from '../../lib/unfixablePackages';
import { reliabilityFlag } from './flags';

export function bannedPackageGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return reliabilityFlag('BANNED_PACKAGE_GUARD', env);
}

function adviceFor(name: string): string | null {
  const k = name.trim().toLowerCase();
  return UNFIXABLE_NPM_PACKAGES[k] ?? BUILT_IN_ALTERNATIVES[k] ?? null;
}

export function isBannedPackage(name: string): boolean {
  return adviceFor(name) !== null;
}

/** Banned packages an install command asks for. */
export function bannedPackagesInCommand(command: string): string[] {
  return [...new Set(packagesInstalledBy(command).filter(isBannedPackage))];
}

/** The refusal the bash tool returns instead of running the install. */
export function bannedInstallRefusal(command: string): string | null {
  const banned = bannedPackagesInCommand(command);
  if (!banned.length) return null;
  return [
    `⛔ Not run: this install includes ${banned.map((p) => `\`${p}\``).join(', ')}, which NavBharatAI does not allow in a built app.`,
    ...banned.map((p) => `- \`${p}\`: ${adviceFor(p)}`),
    'Re-run the install WITHOUT these packages and use the alternative named above.',
  ].join('\n');
}

/** Remove banned deps from a package.json text. Unparseable JSON is returned unchanged. */
export function stripBannedDeps(content: string): { content: string; removed: string[] } {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { content, removed: [] };
  }
  if (!pkg || typeof pkg !== 'object') return { content, removed: [] };
  const removed: string[] = [];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = pkg[field];
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
    for (const name of Object.keys(deps as Record<string, unknown>)) {
      if (isBannedPackage(name)) {
        delete (deps as Record<string, unknown>)[name];
        if (!removed.includes(name)) removed.push(name);
      }
    }
  }
  if (!removed.length) return { content, removed };
  const indent = /^\{\n(\s+)/.exec(content)?.[1] ?? '  ';
  return { content: `${JSON.stringify(pkg, null, indent)}\n`, removed };
}

export function strippedDepsNote(removed: readonly string[]): string {
  if (!removed.length) return '';
  return [`⛔ Removed ${removed.map((p) => `\`${p}\``).join(', ')} from package.json — not allowed in a built app:`, ...removed.map((p) => `- \`${p}\`: ${adviceFor(p)}`)].join('\n');
}
