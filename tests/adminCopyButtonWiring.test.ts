/**
 * The floating admin copy button is actually wired, and cannot leak (admin 2026-09-14).
 *
 * Asked for as: *"admin panel me ek floating 'copy' button bana — x(close) button ke sath. jab chahe
 * admin kisi bhi page par ho … (moving — finger se kahi bhi khiska sake, aur x(close) kar sake)"*.
 *
 * These are source-level assertions because the properties they protect are wiring, not logic, and
 * wiring is what silently disappears in a later refactor. Three things are pinned:
 *   • it renders on EVERY tab — a copy button that only exists on the Monitor page is not the ask;
 *   • it never copies itself, and never copies the live TOTP secret the Security tab renders;
 *   • a refused clipboard is REPORTED. `copyTextToClipboard` returns false rather than throwing, so
 *     an unconditional "Copied!" is the exact fake success this repo forbids — the admin would paste
 *     their previous clipboard and have no way to know why the page did not match.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const dashboard = read('src/components/AdminDashboard.tsx');
const button = read('src/components/admin/AdminCopyButton.tsx');
// The drag mechanics moved into ONE shared hook on 2026-09-22 (the Focus Mode exit button uses it too).
const hook = read('src/hooks/useDraggableFloat.ts');
const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

describe('the button is mounted on every admin page', () => {
  it('is imported and rendered by the admin dashboard', () => {
    expect(dashboard).toMatch(/import \{ AdminCopyButton \} from '\.\/admin\/AdminCopyButton'/);
    expect(dashboard).toContain('<AdminCopyButton');
  });

  it('is rendered OUTSIDE every per-tab conditional, so it survives a tab switch', () => {
    const jsx = dashboard.slice(dashboard.indexOf('\n  return ('));
    const mounted = jsx.indexOf('<AdminCopyButton');
    const firstTabGuard = jsx.indexOf('activeTab === ');
    expect(mounted).toBeGreaterThan(-1);
    expect(firstTabGuard).toBeGreaterThan(-1);
    expect(mounted).toBeLessThan(firstTabGuard);
  });

  it('names the page it is copying from the tab the admin is actually on', () => {
    expect(dashboard).toMatch(/<AdminCopyButton\s+pageLabel=\{TABS\.find\(\(t\) => t\.id === activeTab\)\?\.label/);
  });
});

describe('it can be moved and closed', () => {
  it('drags with pointer events, which covers a finger and a mouse with one path', () => {
    expect(button).toContain('useDraggableFloat(');
    expect(button).toContain('{...handlers}');
    for (const handler of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel']) {
      expect(hook).toContain(handler);
    }
    // Without this the browser scrolls the page instead of dragging the button on a touch screen.
    expect(button).toContain("touchAction: 'none'");
  });

  it('clamps every position it sets, so it can never be dragged off the screen', () => {
    expect(hook).toContain('clampPosition');
    // The drag itself, the first paint and a resize all go through the clamp — not just one of them.
    expect(hook.match(/clampPosition\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(hook).toMatch(/addEventListener\('resize'/);
    expect(hook).toMatch(/addEventListener\('orientationchange'/);
  });

  it('remembers where it was left, and re-clamps what it read back', () => {
    expect(button).toContain('storageKey: COPY_BUTTON_POSITION_KEY');
    expect(hook).toContain('parsePosition');
    expect(hook).toContain('serializePosition');
    expect(hook).toMatch(/stored \? clampPosition\(stored/);
  });

  it('has a close control that says how to get it back', () => {
    expect(button).toMatch(/aria-label="Hide the copy button"/);
    expect(button).toMatch(/reload the admin panel to bring it back/i);
  });

  it('does not copy the page when the close control is pressed', () => {
    // The X sits inside the draggable shell, so without both of these the pointer-down reaches the
    // drag handler and the pointer-up is read as a press — closing the button would also copy.
    expect(button).toMatch(/onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
    expect(button).toMatch(/onClick=\{\(e\) => \{ e\.stopPropagation\(\);/);
  });

  it('separates a press from a drag instead of copying on every pointer-up', () => {
    expect(hook).toContain('isTap(');
    expect(button).toContain('onTap: () => copyPageRef.current()');
  });
});

describe('what it copies', () => {
  it('copies the whole document, so a dialog or toast portalled to the body is included', () => {
    expect(button).toContain('outlinePage(document.body)');
  });

  it('excludes itself from the copy', () => {
    // Both renders — the button and the "hidden" note — carry the opt-out.
    expect(button.match(/data-nb-no-copy=""/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('reuses the existing diagnostics rather than growing a second copy of them', () => {
    expect(button).toMatch(/from '\.\.\/\.\.\/lib\/reportDiagnostics'/);
    expect(button).toMatch(/from '\.\.\/\.\.\/lib\/recentErrors'/);
    expect(button).toMatch(/from '\.\.\/\.\.\/lib\/appBuildId'/);
    expect(button).toMatch(/from '\.\.\/\.\.\/lib\/copyText'/);
  });

  it('measures the page at the moment of the press, not at mount', () => {
    const body = button.slice(button.indexOf('const copyPage'));
    expect(body).toContain('collectDiagnostics(window)');
    expect(body).toContain('outlinePage(document.body)');
  });
});

describe('honesty', () => {
  it('reports a refused clipboard instead of claiming a copy', () => {
    expect(button).toMatch(/const ok = await copyTextToClipboard\(/);
    expect(button).toMatch(/ok\s*\n?\s*\?/);
    expect(button).toMatch(/refused the clipboard/i);
  });

  it('reports a page it could not read', () => {
    expect(button).toMatch(/Could not read this page\. Nothing was copied\./);
  });
});

describe('the secret that must never ride along', () => {
  it('the admin TOTP secret and its otpauth URI are opted out of the copy', () => {
    expect(dashboard).toMatch(/<code data-nb-no-copy="" [^>]*>\{mfaEnroll\.secret\}<\/code>/);
    expect(dashboard).toMatch(/<p data-nb-no-copy="" [^>]*>Or paste this URI:/);
  });
});

describe('it stays a text copy', () => {
  it('no DOM-painting library is a dependency', () => {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const banned of ['html2canvas', 'html-to-image', 'dom-to-image', 'dom-to-image-more', 'modern-screenshot', '@snapdom/core', 'snapdom']) {
      expect(Object.keys(deps)).not.toContain(banned);
    }
  });

  it('the button imports no such library, and calls no screen-capture API', () => {
    // Comments are stripped first ON PURPOSE: the module's header NAMES these approaches to explain
    // why it does not use them, and a test that cannot tell prose from code would force that
    // explanation to be deleted to stay green.
    const code = button.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/html2canvas|html-to-image|dom-to-image|modern-screenshot|snapdom/);
    expect(code).not.toMatch(/getDisplayMedia|getUserMedia/);
  });
});
