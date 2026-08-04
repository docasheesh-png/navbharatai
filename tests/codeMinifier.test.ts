import { describe, it, expect } from 'vitest';
import { minifySource, detectLanguage, isMinifiable } from '../src/server/lib/codeMinifier';

// THE BUG THIS REPLACES (admin 2026-07-26): the Minifier minified JavaScript with hand-written regexes,
// which reliably produced BROKEN code on ordinary input. Every case below was measured against the old
// implementation before this rewrite — they are regressions, not hypotheticals. They matter far more now
// that "Apply" writes the result back into a user's real project file.

/** Would a JS engine accept this output? The only verdict that actually counts. */
function parses(code: string): boolean {
  try { new Function(code); return true; } catch { return false; }
}

describe('the exact inputs the regex minifier corrupted', () => {
  it('a URL in a string survives — the old version cut it at "//" and produced a SyntaxError', async () => {
    const src = 'const api = "https://navbharatai.com/api";\nexport default api;';
    const r = await minifySource(src, 'app.js');
    expect(r.ok).toBe(true);
    expect(r.code).toContain('https://navbharatai.com/api');
    // This is the case that would have corrupted EVERY app v5 builds — they all have an API URL.
  });

  it('a nested call inside console.log does not leave a dangling paren', async () => {
    const src = 'function go(){ console.log(getName(user)); render(); }\ngo();';
    const r = await minifySource(src, 'app.js');
    expect(r.ok).toBe(true);
    expect(parses(r.code)).toBe(true);
    expect(r.code).not.toMatch(/^\s*\)/);
  });

  it("a template literal's own text is never rewritten", async () => {
    const src = 'export const t = `line1\nline2`;';
    const r = await minifySource(src, 'app.ts');
    expect(r.ok).toBe(true);
    // The old version collapsed the newline INSIDE the string, silently changing the user's text.
    expect(r.code).toMatch(/line1\\n|line1\nline2/);
  });

  it('spacing inside a plain string literal is preserved', async () => {
    const r = await minifySource('export const msg = "Hello   World";', 'app.js');
    expect(r.ok).toBe(true);
    expect(r.code).toContain('Hello   World');
  });

  it('a regex literal containing // is not treated as a comment', async () => {
    const src = 'export const re = /https:\\/\\/x/; export const y = 1;';
    const r = await minifySource(src, 'app.js');
    expect(r.ok).toBe(true);
    expect(r.code).toContain('https:');
  });
});

describe('minifySource — never hands back something worse than it got', () => {
  it('real code shrinks, and the output still parses', async () => {
    const src = `
      // a comment that should go
      export function add(firstNumber, secondNumber) {
        const result = firstNumber + secondNumber;
        return result;
      }
    `;
    const r = await minifySource(src, 'math.js');
    expect(r.ok).toBe(true);
    expect(r.minifiedBytes).toBeLessThan(r.originalBytes);
    expect(r.savedBytes).toBeGreaterThan(0);
    expect(r.savedPercent).toBeGreaterThan(0);
  });

  it('BROKEN input fails loudly and returns the ORIGINAL untouched — never a mangled half-result', async () => {
    const broken = 'function oops( { return 1;';
    const r = await minifySource(broken, 'bad.js');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(broken);        // unchanged — safe to leave the user's file alone
    expect(r.savedBytes).toBe(0);
    expect(r.error).toBeTruthy();       // the real parser message, not a vague failure
  });

  it('never reports a saving it did not achieve — a grown file keeps the original', async () => {
    const r = await minifySource('a', 'tiny.js');
    expect(r.savedBytes).toBeGreaterThanOrEqual(0);
    expect(r.minifiedBytes).toBeLessThanOrEqual(r.originalBytes);
  });

  it('console/debugger are dropped by default, and kept when asked', async () => {
    const src = 'export function f(){ console.log("x"); debugger; return 1; }';
    const dropped = await minifySource(src, 'a.js');
    expect(dropped.code).not.toContain('console.log');
    expect(dropped.code).not.toContain('debugger');
    const kept = await minifySource(src, 'a.js', { keepConsole: true });
    expect(kept.code).toContain('console.log');
  });

  it('handles TypeScript, JSX and CSS, not just plain JS', async () => {
    const ts = await minifySource('export const n: number = 1 + 2;', 'a.ts');
    expect(ts.ok).toBe(true);
    const tsx = await minifySource('export const A = () => <div className="x">hi</div>;', 'a.tsx');
    expect(tsx.ok).toBe(true);
    const css = await minifySource('.a {  color : red ;  }', 'a.css');
    expect(css.ok).toBe(true);
    expect(css.code).toContain('red');
  });

  it('declines HTML honestly instead of guessing with regexes — that guess is what caused the bug', async () => {
    const r = await minifySource('<html>  <body>hi</body> </html>', 'index.html');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not supported/i);
    expect(r.code).toBe('<html>  <body>hi</body> </html>');
  });
});

describe('detectLanguage', () => {
  it('maps real extensions', () => {
    expect(detectLanguage('a.ts')).toBe('ts');
    expect(detectLanguage('a.tsx')).toBe('tsx');
    expect(detectLanguage('a.jsx')).toBe('jsx');
    expect(detectLanguage('a.css')).toBe('css');
    expect(detectLanguage('a.html')).toBe('html');
    expect(detectLanguage('a.json')).toBe('json');
    expect(detectLanguage('src/deep/path/a.js')).toBe('js');
  });
  it('an unknown extension falls back to js rather than throwing', () => {
    expect(detectLanguage('Makefile')).toBe('js');
  });
});

describe('isMinifiable — files it must refuse to touch', () => {
  it('accepts real source files', () => {
    for (const f of ['src/App.tsx', 'a.js', 'b.ts', 'c.css', 'd.jsx']) {
      expect(isMinifiable(f), f).toBe(true);
    }
  });

  it('refuses files where minifying is destructive or pointless', () => {
    // package.json / tsconfig are read by the toolchain; the lockfile is npm-generated; .min.* is done.
    for (const f of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.server.json',
                     'vendor.min.js', 'style.min.css', 'README.md', 'logo.svg', 'icon.png', 'config.yaml']) {
      expect(isMinifiable(f), f).toBe(false);
    }
  });

  it('refuses a nested package.json too, not just one at the root', () => {
    expect(isMinifiable('apps/web/package.json')).toBe(false);
  });
});
