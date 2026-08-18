import { describe, it, expect } from 'vitest';
import { previewVisible, previewMounted, previewWrapClass, shouldPrewarmPreview, shouldWatchLivePreview } from './previewKeepAlive';

describe('preview keep-alive (admin 2026-07-07 — preview must never be destroyed by a tab switch)', () => {
  it('lazy first mount: never mounted before the preview is first opened', () => {
    expect(previewMounted(false, false, 'preview')).toBe(false); // workspace closed
    expect(previewMounted(false, true, 'files')).toBe(false);    // workspace open on another tab
  });
  it('mounts when the preview becomes visible', () => {
    expect(previewVisible(true, 'preview')).toBe(true);
    expect(previewMounted(false, true, 'preview')).toBe(true);
  });
  it('THE REGRESSION: once opened, stays mounted through tab switches AND collapsing to chat', () => {
    expect(previewMounted(true, true, 'files')).toBe(true);    // switched to Files
    expect(previewMounted(true, true, 'terminal')).toBe(true); // switched to Terminal
    expect(previewMounted(true, false, 'preview')).toBe(true); // workspace collapsed (back to chat)
  });
  it('hidden via CSS (not unmounted) when another surface is on top', () => {
    expect(previewWrapClass(true, 'preview')).not.toContain('hidden');
    expect(previewWrapClass(true, 'files')).toContain('hidden');
    expect(previewWrapClass(false, 'preview')).toContain('hidden');
  });
});

describe('preview pre-warm (admin 2026-07-18 — open Preview must be instant, not a cold multi-minute compile)', () => {
  it('pre-warms once a build is idle and produced files', () => {
    expect(shouldPrewarmPreview(false, false, true)).toBe(true);
  });
  it('does NOT pre-warm while a build is still running (client or server)', () => {
    expect(shouldPrewarmPreview(true, false, true)).toBe(false);
    expect(shouldPrewarmPreview(false, true, true)).toBe(false);
  });
  it('does NOT pre-warm when there are no files yet (a brand-new chat)', () => {
    expect(shouldPrewarmPreview(false, false, false)).toBe(false);
  });
  it('the pre-warm flag mounts PreviewSurface off-screen before the user ever opens Preview', () => {
    // hidden (not the active tab) but still in the tree so it compiles in the background:
    expect(previewMounted(false, true, 'files', true)).toBe(true);
    expect(previewMounted(false, false, 'preview', true)).toBe(true); // workspace collapsed to chat
    expect(previewWrapClass(true, 'files')).toContain('hidden'); // stays hidden until opened
  });
  it('without the pre-warm flag, the lazy first-mount behaviour is unchanged', () => {
    expect(previewMounted(false, true, 'files', false)).toBe(false);
    expect(previewMounted(false, true, 'files')).toBe(false); // default arg = no pre-warm
  });
});

describe('shouldWatchLivePreview — a preview nobody is looking at must not hold a billed sandbox', () => {
  const base = { autoResume: true, mode: 'live', hasWorkspace: true, paneVisible: true, documentHidden: false };

  it('watches while the user is genuinely looking at the Live preview', () => {
    expect(shouldWatchLivePreview(base)).toBe(true);
  });

  it('THE REPORTED BUG: stops when the user switches to chat inside the app', () => {
    // Admin 2026-08-17: "preview chala, fir koi aur chat open kar li, preview aise hi chor diya —
    // kya billing me add hota rahega?" It did. The pane stays MOUNTED (previewMounted keeps it, on
    // purpose, so the iframe survives the detour) with display:none, and the browser tab is still
    // 'visible' — so the old document-visibility guard never fired and the 150s watchdog kept
    // running, kept probing the sandbox, and kept the 300s idle sweep from ever winning.
    expect(shouldWatchLivePreview({ ...base, paneVisible: false })).toBe(false);
  });

  it('the pane stays MOUNTED in exactly that state — which is why the flag, not unmounting, is the fix', () => {
    // previewMounted is true (keep-alive) while previewVisible is false. Both are correct; the
    // watchdog simply needed to follow the second one rather than the first.
    expect(previewMounted(true, true, 'files')).toBe(true);
    expect(previewVisible(true, 'files')).toBe(false);
  });

  it('still stops behind a hidden browser tab — the original guard is kept, not replaced', () => {
    expect(shouldWatchLivePreview({ ...base, documentHidden: true })).toBe(false);
  });

  it('never watches the in-browser preview — it has no sandbox and costs nothing', () => {
    expect(shouldWatchLivePreview({ ...base, mode: 'inbrowser' })).toBe(false);
  });

  it('never watches during a live build — the build drives the preview itself', () => {
    expect(shouldWatchLivePreview({ ...base, autoResume: false })).toBe(false);
  });

  it('never watches without a workspace', () => {
    expect(shouldWatchLivePreview({ ...base, hasWorkspace: false })).toBe(false);
  });

  it('EVERY reason to stop is independent — one of them being false is enough', () => {
    // Guards against a future edit turning the && chain into something that only stops when several
    // conditions agree. Each of these alone must silence the watchdog.
    for (const off of [
      { autoResume: false }, { mode: 'inbrowser' }, { hasWorkspace: false },
      { paneVisible: false }, { documentHidden: true },
    ]) {
      expect(shouldWatchLivePreview({ ...base, ...off })).toBe(false);
    }
  });

  it('the watchdog interval is SHORTER than the idle limit — which is why the gate is required', () => {
    // Documents the arithmetic that made this a leak rather than a slow drift: the watchdog polls
    // every 150s and the sandbox idle sweep pauses at 300s, so an ungated watchdog wins every time.
    // If either number ever changes, this test is the place that explains why they relate.
    const WATCH_INTERVAL_MS = 150_000;
    const SANDBOX_IDLE_MS = 5 * 60_000;
    expect(WATCH_INTERVAL_MS).toBeLessThan(SANDBOX_IDLE_MS);
  });
});
