import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

/**
 * INLINE STYLE COLOURS (the half of the theme problem CSS could never reach, fixed 2026-08-16).
 *
 * `theme-compat.css` can remap a CLASS, but it can do nothing about `style={{ background: '#0d1117' }}`
 * — an inline style outranks any stylesheet. 229 of those were painting surfaces and text dark in
 * every theme, including the two light ones. The fix reads the colour from the theme variable
 * instead, which is a no-op on dark by construction: `:root` defines `--surface-card: #161b22`, the
 * exact hex the code used to hardcode. Verified in Chromium — dark computes rgb(22,27,34).
 *
 * The traps this suite exists to remember, all three of which bit during the sweep:
 */

const sh = (c: string) => execSync(c, { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the sweep reached the inline styles', () => {
  it('no chrome surface is still painted with a hardcoded palette hex', () => {
    // ShellTerminal is excluded BY NAME, not by a loose pattern: its hexes are xterm's config and are
    // pinned as deliberate by TRAP 1 below. An exception that is not named is an exception nobody
    // can tell from an oversight.
    const hits = sh(
      `grep -rnE "(background|backgroundColor|color|borderColor):[[:space:]]*'#(0d1117|161b22|21262d|8b949e|c9d1d9|484f58)'" src/ --include="*.tsx" || true`,
    ).filter((line) => !line.includes('ShellTerminal.tsx'));
    expect(hits, 'these stay dark in a light theme').toEqual([]);
  });

  it('the replacement is the theme variable, so dark is unchanged', () => {
    // :root defines these to the very hexes the code used to hardcode.
    const css = read('src/index.css');
    expect(css).toMatch(/--surface-base:\s*#0d1117/);
    expect(css).toMatch(/--surface-card:\s*#161b22/);
    expect(css).toMatch(/--text-muted:\s*#8b949e/);
  });
});

describe('TRAP 1 — a library config is not a DOM style', () => {
  it('xterm keeps literal hexes; it parses colours itself and cannot read var()', () => {
    /**
     * The first pass rewrote xterm's theme object and had to be backed out. An inline style goes to
     * the browser; a library's config goes to the library.
     */
    const term = read('src/components/ide/ShellTerminal.tsx');
    expect(term).toMatch(/theme:\s*\{[^}]*background:\s*'#0d1117'/);
    expect(term).not.toMatch(/theme:\s*\{[^}]*var\(--/);
  });
});

describe('TRAP 2 — the user\'s colours are not ours', () => {
  it('generated pages, theme presets and branding keep real colours', () => {
    // These values are exported into the USER'S app, where our variables do not exist.
    for (const f of ['src/components/ide/MultiPageBuilder.tsx',
                     'src/components/ide/DarkModeGenerator.tsx',
                     'src/components/ide/WhitelabelBranding.tsx']) {
      expect(read(f), f).toMatch(/#0d1117|#161b22/);
    }
  });
});

describe('TRAP 3 — theming a surface without its text is worse than theming neither', () => {
  it('white button labels on brand backgrounds stay white', () => {
    /**
     * The consent banner proved this the hard way: the background became white and the text stayed
     * near-white, so the sweep briefly made it LESS readable than before. Text on themed surfaces is
     * now themed too — but a label on an indigo button must keep its white, or the sweep would have
     * put dark text on a dark-blue button.
     */
    const consent = read('src/components/ConsentBanner.tsx');
    expect(consent).toMatch(/background: '#4f46e5',\s*\n?\s*color: '#fff'/);
    const auth = read('src/components/AuthComponent.tsx');
    expect(auth).toContain("style={{ color: '#ffffff' }}");
  });

  it('plain headings on themed surfaces became themed', () => {
    expect(read('src/main.tsx')).toContain("color: 'var(--text-primary)'");
    expect(read('src/components/SharePortal.tsx')).toContain("color: 'var(--text-primary)'");
  });
});
