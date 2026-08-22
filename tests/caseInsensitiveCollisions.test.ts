/**
 * NO TWO SOURCE PATHS MAY DIFFER ONLY BY CASE.
 *
 * THE BROKEN RELEASE THIS CATCHES (2026-08-22). `PreviewWelcome.tsx` (the React component) sat beside
 * `previewWelcome.ts` (its pure copy/state module). On Linux those are two different files, so every
 * dev machine, every test run and all of CI were perfectly happy for a day.
 *
 * macOS is case-INSENSITIVE. On the iOS release runner, `import … from './PreviewWelcome'` resolved to
 * the LOWERCASE module — which exports no component — and the build died with
 *
 *     "PreviewWelcome" is not exported by "src/components/agentv3/previewWelcome.ts"
 *
 * so the .ipa could not be built at all. The failure was invisible everywhere except at a release,
 * which is the worst possible place to discover it: nothing else in the pipeline runs on a
 * case-insensitive disk, and iOS builds are occasional.
 *
 * A rename fixes that one pair. THIS fixes the class — it fails on Linux, in CI, on the PR that
 * introduces the next pair, which is exactly where a repo-wide naming convention (PascalCase
 * components beside camelCase modules) will keep producing them.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('case-insensitive filesystems (macOS iOS runner, Windows) must see distinct files', () => {
  it('no two tracked paths collide when lowercased', () => {
    // git's own list, so nothing untracked or ignored produces noise.
    const paths = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      .split('\n').map((l) => l.trim()).filter(Boolean);
    expect(paths.length).toBeGreaterThan(100); // sanity: the listing really ran

    const byLower = new Map<string, string[]>();
    for (const p of paths) {
      const key = p.toLowerCase();
      byLower.set(key, [...(byLower.get(key) ?? []), p]);
    }
    const collisions = [...byLower.values()]
      .filter((group) => group.length > 1)
      .map((group) => group.sort().join('  ↔  '))
      .sort();

    expect(
      collisions,
      'These paths differ only by case. They work on Linux and BREAK on macOS/Windows — an import of '
      + 'one silently resolves to the other. Rename one so the names differ by more than capitalisation.',
    ).toEqual([]);
  });
});
