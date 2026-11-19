import { isPlatformFile } from './editPromotionGate';
import { holdsOnlyOurStarter } from './starterFragment';
import { toDurableFileKey } from '../lib/workspacePath';

export interface EditPromotionBaseSelection {
  base: Record<string, string> | null;
  verifiedHead: boolean;
  completeHydration: boolean;
}

/** A successful store call may still omit a missing content document: compare the inventory too. */
export function editBaseHydrationIsComplete(
  expectedPaths: readonly string[] | null,
  files: Readonly<Record<string, string>> | null,
  status: unknown,
  unchecked: boolean,
): boolean {
  if ((status !== 'ok' && status !== 'empty') || unchecked !== false || !Array.isArray(expectedPaths) || files === null) return false;
  if (Object.values(files).some(content => typeof content !== 'string')) return false;
  const normalize = (paths: readonly string[]): Set<string> | null => {
    const result = new Set<string>();
    for (const path of paths) {
      if (typeof path !== 'string') return null;
      const key = toDurableFileKey(path);
      if (key === null || result.has(key)) return null;
      result.add(key);
    }
    return result;
  };
  const expected = normalize(expectedPaths);
  const loaded = normalize(Object.keys(files));
  if (expected === null || loaded === null || expected.size !== loaded.size) return false;
  if (status === 'empty' && loaded.size !== 0) return false;
  return [...expected].every(path => loaded.has(path));
}

/**
 * A fully read, unverified platform starter is setup, not an authored app to preserve.
 * The same platform-file exclusions and historical seed recognition used elsewhere
 * decide this; any custom, unreadable or unknown base keeps the replacement guard.
 * This only selects the comparison base. It grants no build/readiness/promotion pass.
 */
export function selectEditPromotionBase({ base, verifiedHead, completeHydration }: EditPromotionBaseSelection): Record<string, string> | null {
  if (base === null || verifiedHead !== false || completeHydration !== true) return base;
  const entries = Object.entries(base);
  // Be conservative even if an untyped persistence boundary supplies an unreadable value.
  if (entries.some(([, content]) => typeof content !== 'string')) return base;
  const appFiles = Object.fromEntries(entries.filter(([path]) => !isPlatformFile(path)));
  return holdsOnlyOurStarter(appFiles) ? null : base;
}
