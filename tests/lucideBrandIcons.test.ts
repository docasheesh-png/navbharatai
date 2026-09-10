import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * lucide-react 1.x REMOVED every brand mark. `Github` and `Figma` are not renamed and not moved to a
 * subpath — they are absent from the runtime bundle and from all three type-declaration files.
 *
 * 🔴 WHY THIS TEST EXISTS RATHER THAN TRUSTING THE COMPILER. lucide-react ships no `types` field and
 * no `exports` map, so `import { Github } from 'lucide-react'` type-resolves loosely and COMPILES
 * CLEAN while evaluating to `undefined` at runtime — and rendering an undefined component is a React
 * "Element type is invalid" crash, not a missing glyph. On the upgrade attempt the typecheck passed
 * and the whole 20,000-test suite caught it in exactly one place (`homeToolGroups.test.ts`, which
 * happens to assert that every tool has an icon), while the sign-in screen, Settings, the Git panel
 * and the v5 builder panel would all have crashed.
 *
 * The two marks are vendored in `src/components/ui/BrandIcons.tsx` from lucide's own 0.546 path data,
 * so they still render exactly as before. This test keeps them from creeping back in — including
 * inside the TEMPLATE STRINGS we generate user apps from, which is where one survived the first sweep
 * (an unused `Github` import in the portfolio starter that would have crashed a user's own build).
 */
const REMOVED_BRAND_ICONS = ['Github', 'Figma'];
const SRC = resolve(__dirname, '..', 'src');
const VENDORED = join('components', 'ui', 'BrandIcons.tsx');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('🔒 no brand icon may be imported from lucide-react', () => {
  it('lucide-react is never asked for an icon it no longer has', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      // The vendored component names them in its own explanation of why it exists.
      if (file.endsWith(VENDORED)) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
        const names = match[1].split(',').map((n) => n.trim().split(' as ')[0].trim());
        const bad = names.filter((n) => REMOVED_BRAND_ICONS.includes(n));
        if (bad.length) offenders.push(`${file.slice(SRC.length + 1)} → ${bad.join(', ')}`);
      }
    }
    expect(
      offenders,
      `These import a brand icon lucide-react 1.x removed; import it from src/components/ui/BrandIcons instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the vendored icons are real components with lucide\'s own shape', async () => {
    const { Github, Figma } = await import('../src/components/ui/BrandIcons');
    expect(typeof Github).toBe('function');
    expect(typeof Figma).toBe('function');
    const source = readFileSync(join(SRC, VENDORED), 'utf8');
    // The exact path data lucide 0.546 shipped — so the marks render identically to what they replace.
    expect(source).toContain('M9 18c-4.51 2-5-2-7-2');
    expect(source).toContain('M12 2h3.5a3.5 3.5 0 1 1 0 7H12V2z');
    expect(source).toContain("viewBox: '0 0 24 24'");
    expect(source).toContain("stroke: 'currentColor'");
  });
});
