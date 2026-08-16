/**
 * TWO FILES WHOSE NAMES DIFFER ONLY BY CASE WILL BREAK THE macOS BUILD — AND ONLY THE macOS BUILD.
 *
 * REAL INCIDENT (2026-08-16). `src/components/agentv3/` held BOTH:
 *     StarterSketch.tsx   — the React component, exporting `StarterSketch`
 *     starterSketch.ts    — the shape lookup, exporting `sketchFor`
 *
 * Linux is case-SENSITIVE, so `import { StarterSketch } from './StarterSketch'` resolved to the
 * component and every Linux build passed — CI, the Android .aab, and every developer machine.
 * macOS is case-INSENSITIVE, so on the iOS runner the same import resolved to `starterSketch.ts`,
 * which does not export `StarterSketch`, and the build died:
 *
 *     "StarterSketch" is not exported by "src/components/agentv3/starterSketch.ts"
 *
 * 🔒 IT HID FOR ELEVEN DAYS, and the way it hid is the reason this test exists. The collision landed
 * on 2026-08-05; the last successful iOS build was 2026-08-02; the next iOS build was not run until
 * 2026-08-16. Nothing was broken *by* the iOS build — it was broken all along and simply never asked.
 * A green CI is not evidence about a platform CI does not run on.
 *
 * So the check belongs HERE, in the suite that runs on every PR, where it costs milliseconds and fails
 * the instant a colliding pair is added — not on a macOS runner that might be two weeks away.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '..');
/** Where we ship from. Build output and dependencies are not ours to police. */
const ROOTS = ['src', 'tests', 'scripts', 'server.ts'];
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'public']);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else out.push(relative(ROOT, full));
  }
  return out;
}

describe('🔒 no two paths differ only by case', () => {
  it('the whole shipped tree is safe on a case-insensitive filesystem', () => {
    const files: string[] = [];
    for (const r of ROOTS) {
      const p = join(ROOT, r);
      try {
        if (statSync(p).isDirectory()) walk(p, files);
        else files.push(r);
      } catch { /* an absent root is not a failure — the repo layout may change */ }
    }
    expect(files.length).toBeGreaterThan(100); // the walk actually walked; a silent empty pass is worthless

    const byLower = new Map<string, string[]>();
    for (const f of files) {
      const key = f.toLowerCase();
      const list = byLower.get(key) ?? [];
      list.push(f);
      byLower.set(key, list);
    }

    const collisions = [...byLower.values()].filter((paths) => new Set(paths).size > 1);
    expect(
      collisions.map((c) => c.join('  ⟷  ')),
      'These paths differ only by case. macOS treats them as ONE file, so an import of either can ' +
      'resolve to the wrong one and the iOS build fails while every Linux build passes. Rename one.',
    ).toEqual([]);
  });

  it('🔒 …including the exact pair that broke the iOS build', () => {
    // Pinned by name so a revert of the rename fails loudly here rather than on a macOS runner
    // whenever someone next happens to build for iOS.
    const dir = join(ROOT, 'src/components/agentv3');
    const names = readdirSync(dir);
    // The COMPONENT keeps its conventional PascalCase name; what must never come back is a sibling
    // whose name collides with it once case is removed. Compare on the stem, since `.tsx` and `.ts`
    // are different files but `StarterSketch` and `starterSketch` are the same one to macOS.
    const stem = (n: string): string => n.replace(/\.(tsx?|jsx?)$/, '').toLowerCase();
    const clashing = names.filter((n) => stem(n) === 'startersketch');
    expect(
      clashing.sort(),
      'Only the component may own this stem — a starterSketch.ts beside StarterSketch.tsx is the exact pair that broke iOS.',
    ).toEqual(['StarterSketch.tsx']);
  });
});
