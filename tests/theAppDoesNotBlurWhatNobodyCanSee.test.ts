import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * A BLUR THAT LIVES OVER SCROLLING CONTENT IS PAID FOR ON EVERY FRAME (2026-09-19).
 *
 * Admin, about the Capacitor Android app: *"page scroll karne me lag hota hai"*. The global mobile
 * bottom nav — `fixed`, full width, on screen for essentially the whole app — carried
 * `backdrop-blur-xl` (24px) behind a **95% opaque** surface. The content behind it moves while the
 * user scrolls, so the compositor re-blurred that strip every frame to produce something at most 5%
 * of which could ever be seen. Cheap to lose, expensive to keep, and worst exactly where the report
 * came from: an Android WebView on a mid-range GPU.
 *
 * ⚠️ These are STRUCTURAL assertions. No test here can prove a frame rate on a real phone, and the
 * PR does not claim one — what they lock is that a permanent, unseen per-frame blur does not come
 * back by accident.
 */
describe('the mobile bottom nav does not blur what nobody can see', () => {
  const app = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const nav = app.slice(app.indexOf('{showsGlobalMobileNav && ('), app.indexOf('{showsGlobalMobileNav && (') + 900);

  it('🔴 the always-visible nav carries no backdrop blur', () => {
    expect(nav).toContain('<nav className="fixed bottom-0');
    expect(nav).not.toMatch(/backdrop-blur/);
  });

  it('🔒 and it is OPAQUE — a translucent bar with no blur would ghost the moving content under it', () => {
    // Removing the blur but keeping `/95` would be the worse of both: still a per-frame blend, and now
    // unblurred content showing through. `bg-surface` is the same --surface-base colour, fully opaque.
    expect(nav).toMatch(/<nav className="[^"]*\bbg-surface\b/);
    expect(nav).not.toMatch(/<nav className="[^"]*bg-\[var\(--surface-base\)\]\/\d/);
  });
});

/**
 * THE RULE THIS GENERALISES TO, so the next one is caught when it is written rather than when a user
 * reports it: a blur may sit over a MODAL backdrop (nothing moves behind it, it is visible, and it
 * lasts as long as the dialog) but not over the app's own scrolling content for the whole session.
 */
describe('no permanently-visible element blurs the scrolling app behind it', () => {
  const root = join(__dirname, '..', 'src');
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { if (entry !== 'server') walk(full); }
      else if (/\.tsx$/.test(entry)) files.push(full);
    }
  })(root);

  it('every `fixed`/`sticky` backdrop-blur is a modal-style overlay, never app chrome', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const line of src.split('\n')) {
        if (!/backdrop-blur/.test(line)) continue;
        if (!/\b(fixed|sticky)\b/.test(line)) continue;
        // A full-bleed overlay (`inset-0`) is a dialog backdrop: it covers a background that is not
        // scrolling, the blur is the point of it, and it exists only while the dialog does.
        if (/\binset-0\b/.test(line)) continue;
        // A `sticky` element inside a panel's own scroll area is bounded to that panel and transient.
        if (/\bsticky\b/.test(line) && !/\bfixed\b/.test(line)) continue;
        // An exception must JUSTIFY ITSELF IN PLACE, in the twelve lines above it, rather than be
        // listed here — a list in a test file drifts away from the code it excuses, and the next
        // reader cannot tell a considered exception from a forgotten one.
        const lines = src.split('\n');
        const idx = lines.indexOf(line);
        if (lines.slice(Math.max(0, idx - 12), idx).join('\n').includes('BLUR-OVER-SCROLL-OK')) continue;
        offenders.push(`${file.replace(root, 'src')}: ${line.trim().slice(0, 100)}`);
      }
    }
    expect(offenders, `blur over scrolling app chrome:\n${offenders.join('\n')}`).toEqual([]);
  });
});
