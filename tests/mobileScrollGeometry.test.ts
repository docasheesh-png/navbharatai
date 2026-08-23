import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * ADMIN REPORT 2026-08-23 (phone, two surfaces, one root cause):
 *   1. Code Studio → Files: "sabhi files niche scroll kar ke dekhi nahi ja sakti — vertical scroll
 *      kaam nahi kar raha hai."
 *   2. Publish → after the final DNS submit, the last screen (Visit your website / Publish again):
 *      "waha bhi niche scroll nahi hota hai."
 *
 * 🔒 THE ROOT CAUSE BOTH SHARE — and why "scroll is dead" rather than "content is clipped".
 * A scroll container was sized from a height LARGER than the area the user can actually see:
 *   • the IDE sidebar was `absolute inset-0 top-9` PLUS `h-full` — over-constrained, so CSS drops
 *     `bottom` and the panel ran a full root-height starting 36px down, i.e. ~36px past the bottom,
 *     with the 4rem+safe-area tab bar covering ~100px more;
 *   • the dialogs capped themselves at `85vh`, and on a mobile browser `vh` is the LARGE viewport
 *     (toolbar hidden), which is ~100-150px taller than what is on screen.
 * In BOTH cases the overflow container ends up taller than the screen. A container taller than the
 * screen does not need to scroll — so the browser offers no scroll at all and the content at the
 * bottom is simply unreachable. That is the exact symptom reported, and it is why capping by a
 * VISIBLE-viewport measure is the fix rather than "add overflow-y-auto".
 *
 * These tests read the source so the rule holds for every surface, not just the two reported.
 */

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (rel.endsWith('.tsx') && !rel.endsWith('.test.tsx')) out.push(rel);
  }
  return out;
}

describe('mobile scroll geometry — a scroll container may never be taller than the screen', () => {
  it('defines the shared sheet geometry once, with a dvh cap and a vh fallback', () => {
    const css = read('src/index.css');
    // One definition every dialog uses, so no screen has to guess a viewport fraction again.
    expect(css).toContain('.nb-sheet-overlay');
    expect(css).toContain('.nb-sheet');
    // `dvh` tracks the VISIBLE viewport. The plain `vh` line above it must stay: it is the fallback
    // for an engine that does not understand `dvh`, and dropping it would leave those with no height.
    expect(css).toMatch(/\.nb-sheet-overlay\s*\{[^}]*height:\s*100vh;[^}]*height:\s*100dvh;/);
    // `min-height: 0` is as load-bearing as the cap — without it a flex child of the card refuses to
    // shrink and pushes its own scroll body back past the cap, recreating the bug one level down.
    expect(css).toMatch(/\.nb-sheet\s*\{[^}]*max-height:\s*100%;[^}]*min-height:\s*0;/);
  });

  it('never caps a container with a bare `vh` fraction anywhere in the UI', () => {
    // `vh` on its own is the large-viewport trap. Every occurrence must carry a `dvh` companion
    // (or be replaced by `nb-sheet`). Scanning the whole tree is deliberate: this bug reached the
    // admin twice from two different files, so the rule has to be repo-wide to actually hold.
    const offenders: string[] = [];
    for (const file of walk('src')) {
      const src = read(file);
      const re = /max-h-\[(\d+)vh\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const rest = src.slice(m.index, m.index + 120);
        if (!rest.includes(`supports-[height:100dvh]:max-h-[${m[1]}dvh]`)) {
          offenders.push(`${file}: ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the reported publish sheet caps against the visible viewport, not 85vh', () => {
    const src = read('src/components/agentv3/HostingChooser.tsx');
    // The card that holds the domain-connect screen, whose last controls (Publish again, Visit)
    // were the ones the admin could not reach.
    expect(src).toContain('nb-sheet-overlay fixed inset-0');
    expect(src).toMatch(/className="nb-sheet w-full max-w-lg/);
    // The body stays the one scroll container, with the header pinned above it.
    expect(src).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain');
  });

  it('the publish celebration card can scroll and is capped (it had neither)', () => {
    const src = read('src/components/agentv3/PublishCelebration.tsx');
    expect(src).toContain('nb-sheet-overlay fixed inset-0');
    expect(src).toContain('nb-sheet relative w-full max-w-md overflow-y-auto');
  });
});

describe('Code Studio — the mobile Files panel must end where the screen ends', () => {
  const src = read('src/components/ide/CodeStudio.tsx');

  it('anchors the mobile sidebar to the workspace row, not to the whole component', () => {
    // `relative` on the row is what makes `inset-0` mean "the workspace area". Without it the panel
    // resolved against the component root, which also contains the header and the bottom tab bar.
    expect(src).toContain('className="flex-1 flex overflow-hidden relative"');
  });

  it('never re-introduces the over-constrained `top-9` + `h-full` pair', () => {
    // THE EXACT REGRESSION. `top` + `height` together make CSS ignore `bottom`, so the panel ran
    // past the bottom of the screen and its file list had nothing to scroll.
    expect(src).not.toContain('absolute inset-0 top-9');
    expect(src).toContain('isMobile ? "absolute inset-0" : "h-full"');
  });

  it('gives every sidebar screen a bounded, shrinkable slot', () => {
    // `min-h-0` is the flexbox trap this file keeps re-learning: without it a screen's own
    // overflow-y-auto grows past the panel and is clipped by the `overflow-hidden` above.
    expect(src).toMatch(/<div className="flex-1 min-h-0 flex flex-col">\s*\{renderSidebarContent\(\)\}/);
  });

  it('keeps the file list itself scrollable inside that slot', () => {
    const fx = read('src/components/ide/FileExplorer.tsx');
    expect(fx).toContain('flex-1 min-h-0 overflow-y-auto');
  });
});
