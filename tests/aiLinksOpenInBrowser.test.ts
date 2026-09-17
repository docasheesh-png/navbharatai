import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * EVERY LINK EVERY AI GIVES A USER — and where it opens on the Android app.
 *
 * `LinkedText` (src/lib/linkify.tsx) renders the links in EVERY NavBharatAI AI's replies: all ~70
 * Professionals (`ProfessionalChat`), Doctor AI (`SDAChat`) and NavBharatAI Pro (`FoldableMessage`).
 *
 * 🔴 A bare `target="_blank"` inside a Capacitor WebView does not open Chrome. It navigates in place,
 * or opens a chromeless child view with no address bar and no obvious way back — so a user who taps a
 * source link an AI handed them is stranded inside what still looks like NavBharatAI. Measured
 * 2026-09-17: 45 such links remain across 24 files, and this ONE file carries more of the product's
 * real link traffic than the other 44 sites combined.
 *
 * These tests pin the three properties that make the fix safe, each of which is a thing that would be
 * quietly lost by an "obvious" simplification.
 */

const src = readFileSync('src/lib/linkify.tsx', 'utf8');
/** Comments stripped — the helper's own comment names the code it explains. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the link reaches the real browser on the native shell', () => {
  it('a click on native is handed to openExternalUrl', () => {
    expect(code).toContain("import { isNativeApp, openExternalUrl } from './mobileNative';");
    expect(code).toContain('onClick={openInRealBrowser(p.href)}');
    expect(code).toContain('openExternalUrl(href);');
  });

  it('🔒 it is STILL an anchor — long-press "copy link" and the screen-reader role survive', () => {
    // A button would lose copy-link, the hover URL preview, and the announced role. Only the CLICK
    // is redirected; the href is untouched.
    const at = code.indexOf('onClick={openInRealBrowser(p.href)}');
    expect(at).toBeGreaterThan(0);
    const anchor = code.slice(at - 300, at + 200);
    expect(anchor).toContain('href={p.href}');
    expect(anchor).toContain('<a');
  });

  it('🔒 the WEB path is untouched — no interception, so ctrl/middle-click still opens a tab', () => {
    const at = code.indexOf('function openInRealBrowser');
    expect(at).toBeGreaterThan(0);
    const fn = code.slice(at, at + 500);
    expect(fn).toContain('if (!isNativeApp()) return;');
    // …and the existing web attributes are still there.
    expect(code).toContain('target="_blank"');
    expect(code).toContain('rel="noopener noreferrer"');
  });

  it('🔒 a MODIFIED click is never intercepted — the user asked for a new tab themselves', () => {
    const at = code.indexOf('function openInRealBrowser');
    const fn = code.slice(at, at + 500);
    for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) expect(fn, key).toContain(key);
    expect(fn).toContain('e.button !== 0');
    expect(fn).toContain('e.defaultPrevented');
  });
});

describe('🔒 every AI surface, including the one that does NOT use LinkedText', () => {
  it('the Professionals and NavBharatAI Pro render through LinkedText', () => {
    // ~70 professionals and the Pro builder share that one component, so they are covered above.
    for (const f of [
      'src/components/professionals/ProfessionalChat.tsx',
      'src/components/agentv3/FoldableMessage.tsx',
    ]) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/LinkedText/);
    }
  });

  it('🔴 Doctor AI does NOT — it has its own markdown anchor, and it carried the same defect', () => {
    // Found by checking rather than assuming: SDAChat imports only `isSafeHttpUrl` and renders model
    // text through ReactMarkdown with a custom `a` component. Its links are MEDICAL SOURCES, so being
    // stranded in a chromeless WebView matters most exactly there.
    const sda = readFileSync('src/components/sda/SDAChat.tsx', 'utf8');
    expect(sda).not.toMatch(/LinkedText/);
    expect(sda).toContain('openInRealBrowser');
  });

  it('…and it uses the SAME handler, not a second copy that would drift', () => {
    expect(readFileSync('src/components/sda/SDAChat.tsx', 'utf8'))
      .toContain("from '../../lib/linkify'");
    expect(code).toContain('export function openInRealBrowser');
  });
});
