import { describe, it, expect } from 'vitest';
import { suggestPathsByBasename, pathMissHint } from './suggestFilePath';

/**
 * Locks the path-miss recovery that killed the real "12 read_file 'does not exist' loops" (SaaS admin
 * dashboard report, 2026-08-01): a component created at src/components/ui/X.tsx but read from
 * src/components/X.tsx must resolve to the REAL path by basename, so the builder self-corrects on the
 * first miss instead of guessing the same wrong root repeatedly.
 */
describe('suggestPathsByBasename', () => {
  it('resolves the exact ui/ path drift from the report (missing folder segment)', () => {
    const known = ['src/components/ui/button.tsx', 'src/App.tsx', 'src/main.tsx'];
    // The builder read src/components/button.tsx — the real file is under ui/.
    expect(suggestPathsByBasename('src/components/button.tsx', known)).toEqual(['src/components/ui/button.tsx']);
  });

  it('resolves the REVERSE drift (read ui/, file is one level up)', () => {
    const known = ['src/components/Card.tsx'];
    expect(suggestPathsByBasename('src/components/ui/Card.tsx', known)).toEqual(['src/components/Card.tsx']);
  });

  it('matches case-insensitively (Button.tsx ~ button.tsx)', () => {
    const known = ['src/components/ui/button.tsx'];
    expect(suggestPathsByBasename('src/components/Button.tsx', known)).toEqual(['src/components/ui/button.tsx']);
  });

  it('matches the same stem across extensions WITHIN the source family (.tsx ~ .ts)', () => {
    const known = ['src/lib/db.ts'];
    expect(suggestPathsByBasename('src/lib/db.tsx', known)).toEqual(['src/lib/db.ts']);
  });

  it('does NOT suggest a markup/style file for a missing source file (real report: index.ts ↛ index.html/css)', () => {
    // src/types/index.ts genuinely did not exist; the old stem-match wrongly offered index.html + index.css.
    const known = ['index.html', 'src/index.css'];
    expect(suggestPathsByBasename('src/types/index.ts', known)).toEqual([]);
  });

  it('still cross-suggests within the style family (.scss ~ .css) but not into source', () => {
    expect(suggestPathsByBasename('src/theme/main.scss', ['src/theme/main.css'])).toEqual(['src/theme/main.css']);
    expect(suggestPathsByBasename('src/theme/main.ts', ['src/theme/main.css'])).toEqual([]);
  });

  it('prefers an exact case-sensitive basename over a case-insensitive one', () => {
    const known = ['src/a/Modal.tsx', 'src/b/modal.tsx'];
    expect(suggestPathsByBasename('src/z/Modal.tsx', known)[0]).toBe('src/a/Modal.tsx');
  });

  it('never suggests the missing path itself, and returns [] when nothing matches', () => {
    expect(suggestPathsByBasename('src/App.tsx', ['src/App.tsx'])).toEqual([]);
    expect(suggestPathsByBasename('src/Nope.tsx', ['src/Other.tsx'])).toEqual([]);
    expect(suggestPathsByBasename('src/App.tsx', [])).toEqual([]);
  });

  it('caps the number of suggestions', () => {
    const known = Array.from({ length: 10 }, (_, i) => `src/pkg${i}/x.tsx`);
    expect(suggestPathsByBasename('src/z/x.tsx', known, 4)).toHaveLength(4);
  });
});

describe('pathMissHint', () => {
  it('gives an actionable single-path hint that names the real location', () => {
    const hint = pathMissHint('src/components/button.tsx', ['src/components/ui/button.tsx']);
    expect(hint).toContain('src/components/ui/button.tsx');
    expect(hint.toLowerCase()).toContain('did you mean');
  });

  it('lists multiple real locations when there is more than one match', () => {
    const hint = pathMissHint('src/z/x.tsx', ['src/a/x.tsx', 'src/b/x.tsx']);
    expect(hint).toContain('src/a/x.tsx');
    expect(hint).toContain('src/b/x.tsx');
  });

  it('adds nothing (never misleads) when there is no plausible match', () => {
    expect(pathMissHint('src/Nope.tsx', ['src/Other.tsx'])).toBe('');
  });
});
