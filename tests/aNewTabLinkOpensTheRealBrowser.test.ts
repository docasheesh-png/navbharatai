/**
 * QUEUE Q-112: A `target="_blank"` LINK IN THE PHONE APP OPENED INSIDE THE APP'S OWN WEBVIEW.
 *
 * Inside Capacitor a new-tab link does not reach Chrome or Safari; it navigates the app in place or
 * opens a chromeless view with no way back. Two surfaces were fixed one link at a time and ~28 stayed
 * bare. The class: "every new-tab link must remember to open the system browser". It is now ONE
 * delegated listener installed by the native shell, so a link written tomorrow is covered too.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { installExternalLinkHandler } from '../src/lib/nativeShell';

const ROOT = join(__dirname, '..');
const NATIVE = { Capacitor: { isNativePlatform: () => true } };
const WEB = { Capacitor: undefined };

function harness(ctx: object = NATIVE) {
  let listener: ((e: Event) => void) | null = null;
  const root = {
    addEventListener: (_t: string, cb: (e: Event) => void) => { listener = cb; },
    removeEventListener: () => { listener = null; },
  };
  const opened: string[] = [];
  const off = installExternalLinkHandler(ctx as never, root, () => 'https://localhost', (h) => opened.push(h));
  const click = (link: { href?: string; target?: string; download?: boolean } | null, mods: Partial<MouseEvent> = {}) => {
    let prevented = Boolean(mods.defaultPrevented);
    const anchor = link && link.target === '_blank'
      ? { href: link.href, hasAttribute: (n: string) => n === 'download' && Boolean(link.download) }
      : null;
    const e = {
      button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods,
      get defaultPrevented() { return prevented; },
      preventDefault: () => { prevented = true; },
      target: { closest: (s: string) => (s === 'a[target="_blank"]' ? anchor : null) },
    } as unknown as Event;
    listener?.(e);
    return prevented;
  };
  return { click, opened, off, installed: () => listener !== null };
}

describe('installExternalLinkHandler', () => {
  it('a new-tab link to another site opens in the system browser', () => {
    const h = harness();
    expect(h.click({ href: 'https://github.com/settings/tokens', target: '_blank' })).toBe(true);
    expect(h.opened).toEqual(['https://github.com/settings/tokens']);
  });

  it('is never installed on the web', () => {
    const h = harness(WEB);
    expect(h.installed()).toBe(false);
  });

  it('leaves alone: our own origin, a non-http scheme, a download, a link without _blank', () => {
    const h = harness();
    expect(h.click({ href: 'https://localhost/privacy', target: '_blank' })).toBe(false);
    expect(h.click({ href: 'mailto:a@b.c', target: '_blank' })).toBe(false);
    expect(h.click({ href: 'blob:https://localhost/x', target: '_blank' })).toBe(false);
    expect(h.click({ href: 'https://example.com/f.zip', target: '_blank', download: true })).toBe(false);
    expect(h.click({ href: 'https://example.com', target: '_self' })).toBe(false);
    expect(h.opened).toEqual([]);
  });

  it('leaves alone a click a component already handled, and a modified or non-primary click', () => {
    const h = harness();
    const link = { href: 'https://example.com', target: '_blank' };
    h.click(link, { defaultPrevented: true } as never);
    h.click(link, { ctrlKey: true });
    h.click(link, { metaKey: true });
    h.click(link, { button: 1 });
    expect(h.opened).toEqual([]);
  });
});

describe('the wiring — proven by reversion', () => {
  it('the native shell installs it on the document, beside the tap feedback', () => {
    const src = readFileSync(join(ROOT, 'src/lib/nativeShell.ts'), 'utf8');
    expect(src).toContain('installExternalLinkHandler(ctx, document);');
    expect(src).toMatch(/import\('\.\/mobileNative'\)\.then\(\(m\) => m\.openExternalUrl\(href\)\)/);
  });

  it('🔒 every JSX new-tab link also carries rel (comments ignored)', () => {
    const files = execSync("grep -rl '_blank' src --include=*.tsx --include=*.ts", { cwd: ROOT }).toString().trim().split('\n')
      .filter((f) => f && !f.startsWith('src/server/'));
    const bare: string[] = [];
    for (const f of files) {
      const s = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      const re = /<a\b/g; let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        let i = m.index + 2; let depth = 0; let q: string | null = null;
        for (; i < s.length; i++) {
          const c = s[i];
          if (q) { if (c === q && s[i - 1] !== '\\') q = null; continue; }
          if (c === '"' || c === "'" || c === '`') { q = c; continue; }
          if (c === '{') depth++; else if (c === '}') depth--; else if (c === '>' && depth === 0) break;
        }
        const tag = s.slice(m.index, i + 1);
        if (/target=(?:"_blank"|\{['"]_blank['"]\}|'_blank')/.test(tag) && !/\brel=/.test(tag)) {
          bare.push(`${f}:${s.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(bare).toEqual([]);
  });
});
