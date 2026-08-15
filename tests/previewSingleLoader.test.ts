import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * ADMIN REPORT 2026-08-14 — "preview press kare to 2 tarah ki loading hoti hai, pehle dark background
 * phir white background, aur yeh dono alternative (1-2-1-2-1-2) aate rehte hain. Bas ek rakho — white
 * jisme timer laga rahta hai."
 *
 * TWO LOADERS IS NOT THE BUG, and that distinction is why this file exists rather than one of them
 * being deleted. Each covers a phase the other cannot see:
 *   • the PANEL loader (dark, PreviewSurface) covers the wait before any preview page exists at all;
 *   • the BOOT overlay (white, ReactPreview) lives INSIDE the generated page and covers the wait from
 *     that page's first paint until the app actually mounts.
 * Delete the white one and a mounting app is a blank white screen again — the exact complaint it was
 * added for. Delete the dark one and the first load shows nothing at all.
 *
 * THE BUG WAS THE ORDER. `loadInBrowser` deliberately keeps the previous `html` while fetching the next
 * one, but the panel branch sat above the iframe branch and tested only `loading` — so every re-compile
 * tore the working preview off screen for the dark spinner, then re-mounted the iframe, which ran the
 * white overlay again. A build writing files in several batches reloads several times, and the user
 * watches the two alternate for the whole build.
 */

const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');
const preview = readFileSync(join(process.cwd(), 'src/server/runtime/ReactPreview.ts'), 'utf8');

describe('the panel loader is first-load only', () => {
  it('it is guarded on there being no page yet', () => {
    // The whole fix. Without `&& !html` a reload blanks a working preview back to a spinner.
    expect(surface).toContain('loading && !html ?');
  });

  it('a reload keeps the existing preview, because html is never cleared to fetch', () => {
    /**
     * The guard only helps if `html` actually survives a reload. `loadInBrowser` sets `setLoading(true)`
     * and fetches WITHOUT clearing `html`, assigning the new value only once it arrives — if a future
     * edit added a `setHtml('')` next to `setLoading(true)`, the guard would silently stop working and
     * the flicker would return with nothing failing.
     */
    const fn = surface.slice(surface.indexOf('setLoading(true);'), surface.indexOf('setErr(e instanceof Error'));
    expect(fn.length).toBeGreaterThan(100);
    expect(fn).not.toMatch(/setHtml\(\s*''\s*\)/);
    // The only assignment inside the successful path is the freshly-fetched page.
    expect(fn).toContain('setHtml(nextHtml)');
  });

  it('a FAILED reload still clears html, so a stale app is not left looking live', () => {
    // The other direction, and it must stay: if the recompile errored, continuing to frame the previous
    // build would show a working app while the real answer is "this no longer compiles".
    const catchBlock = surface.slice(surface.indexOf('setErr(e instanceof Error'), surface.indexOf('inFlight.current = false;'));
    expect(catchBlock).toMatch(/setHtml\(\s*''\s*\)/);
  });
});

describe('both loaders still exist and still show a timer', () => {
  it('the white in-iframe overlay is intact', () => {
    // What the admin asked to KEEP. It is the one that covers a mounting app.
    expect(preview).toContain('id="__nbai_boot"');
    expect(preview).toContain('background:#ffffff');
    expect(preview).toContain('__nbai_boot_s'); // the seconds counter element
  });

  it('the panel loader still counts seconds on a first load', () => {
    // "Loading vs stuck" is the reason a counter is there at all; a first load with no timer is the
    // blank-mystery-screen the overlay work removed.
    expect(surface).toContain('loadSeconds');
  });
});
