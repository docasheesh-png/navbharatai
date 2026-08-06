import { describe, it, expect } from 'vitest';
import { classifyPreviewHealth, shouldAutoRebootPreview, previewHealthContextLine, type PreviewHealthSignals } from './PreviewHealth';

const base: PreviewHealthSignals = {
  hasFiles: true, liveBackend: true, livePortUp: null, everPublished: false, lastError: null, booting: false,
};

describe('classifyPreviewHealth — v5.0 knows the REAL preview state', () => {
  it('empty when no files exist yet (nothing to preview)', () => {
    const h = classifyPreviewHealth({ ...base, hasFiles: false });
    expect(h.status).toBe('empty');
    expect(h.canReboot).toBe(false);
  });

  it('inbrowser_only when no live backend is configured (E2B off)', () => {
    const h = classifyPreviewHealth({ ...base, liveBackend: false });
    expect(h.status).toBe('inbrowser_only');
    expect(h.canReboot).toBe(false);
  });

  it('live when a port probe currently succeeds', () => {
    expect(classifyPreviewHealth({ ...base, livePortUp: true }).status).toBe('live');
  });

  it('booting takes precedence while a boot/heal is in progress', () => {
    expect(classifyPreviewHealth({ ...base, booting: true, livePortUp: false }).status).toBe('booting');
  });

  it('sleeping (EXPECTED) when the port is down/cold with NO error — idle-recycled, rebootable', () => {
    // The core "reopen years later" case: files saved, sandbox long gone, no crash — just asleep.
    const h = classifyPreviewHealth({ ...base, livePortUp: false, everPublished: true, lastError: null });
    expect(h.status).toBe('sleeping');
    expect(h.canReboot).toBe(true);
    expect(h.summary).toMatch(/saved/i);
  });

  it('sleeping when never probed (null) — cold reopen, rebootable from saved files', () => {
    expect(classifyPreviewHealth({ ...base, livePortUp: null }).status).toBe('sleeping');
  });

  it('crashed (distinct from sleeping) when the port went down WITH an error → heal', () => {
    const h = classifyPreviewHealth({ ...base, livePortUp: false, everPublished: true, lastError: "Missing dependency 'tailwindcss'" });
    expect(h.status).toBe('crashed');
    expect(h.canReboot).toBe(true);
    expect(h.summary).toContain('tailwindcss');
  });
});

describe('shouldAutoRebootPreview — bounded, cooldown-gated, idle-vs-crash aware', () => {
  const sleeping = classifyPreviewHealth({ ...base, livePortUp: false, everPublished: true });
  const crashed = classifyPreviewHealth({ ...base, livePortUp: false, everPublished: true, lastError: 'boom' });
  const live = classifyPreviewHealth({ ...base, livePortUp: true });

  it('reboots a sleeping/crashed rebootable preview when attempts + cooldown allow', () => {
    expect(shouldAutoRebootPreview(sleeping, 0, 2, Infinity, 30_000)).toBe(true);
    expect(shouldAutoRebootPreview(crashed, 0, 2, 60_000, 30_000)).toBe(true);
  });

  it('never reboots a live preview', () => {
    expect(shouldAutoRebootPreview(live, 0, 2, Infinity, 30_000)).toBe(false);
  });

  it('stops once attempts are exhausted (never loops)', () => {
    expect(shouldAutoRebootPreview(sleeping, 2, 2, Infinity, 30_000)).toBe(false);
  });

  it('respects the cooldown between attempts', () => {
    expect(shouldAutoRebootPreview(sleeping, 1, 3, 5_000, 30_000)).toBe(false);
  });

  it('never reboots when the preview cannot be rebooted (no backend/files)', () => {
    const noBackend = classifyPreviewHealth({ ...base, liveBackend: false });
    expect(shouldAutoRebootPreview(noBackend, 0, 2, Infinity, 30_000)).toBe(false);
  });
});

describe('previewHealthContextLine — real state for the AI, never a guess', () => {
  it('is empty for an empty project (nothing to say)', () => {
    expect(previewHealthContextLine(classifyPreviewHealth({ ...base, hasFiles: false }))).toBe('');
  });

  it('states RUNNING with the never-guess instruction when live', () => {
    const line = previewHealthContextLine(classifyPreviewHealth({ ...base, livePortUp: true }));
    expect(line).toContain('RUNNING');
    expect(line).toContain('never guess');
  });

  it('states ASLEEP for the reopen-years-later case', () => {
    const line = previewHealthContextLine(classifyPreviewHealth({ ...base, livePortUp: false, everPublished: true }));
    expect(line).toContain('ASLEEP');
  });
});

// ADMIN REPORT 2026-08-06 — the screenshot that made this necessary: the Preview tab, labelled
// "Live server", rendering a raw `Cannot GET /customer/home` page AS the user's app while the build
// was still running.
//
// ROOT CAUSE, in our code, not the user's: the liveness probe read only an HTTP STATUS CODE from `/`
// and counted 301/302 as healthy. The app's `/` did `res.redirect("/customer/home")` → 302 → we said
// "live — up and running" → the tab iframed the URL → the iframe followed the redirect → 404.
// A status code is not a working app. This is the same "EARN THE VERDICT" rule the import boot already
// applied via analyzePreviewHtml — the health probe simply never used it.
describe('classifyPreviewHealth — a port that answers is not an app that works', () => {
  const base = { hasFiles: true, liveBackend: true, everPublished: true, lastError: null, booting: false };

  it('THE REPORTED CASE: port answers, page is "Cannot GET" → NOT live', () => {
    const h = classifyPreviewHealth({
      ...base, livePortUp: true,
      pageRendered: false,
      pageProblems: ['the server returned 404 / "Cannot GET" — the dev server is not serving the app at this path'],
    });
    expect(h.status).toBe('not_serving');
    expect(h.status).not.toBe('live');
    expect(h.summary).toMatch(/not serving your app/i);
    expect(h.summary).toContain('Cannot GET');
  });

  it('a genuinely serving app is still "live" — the happy path is untouched', () => {
    expect(classifyPreviewHealth({ ...base, livePortUp: true, pageRendered: true }).status).toBe('live');
  });

  it('backward-compatible: when the page was not checked, behaviour is exactly as before', () => {
    expect(classifyPreviewHealth({ ...base, livePortUp: true }).status).toBe('live');
    expect(classifyPreviewHealth({ ...base, livePortUp: true, pageRendered: null }).status).toBe('live');
  });

  it('not_serving is never auto-rebooted — a reboot cannot wire missing page routes', async () => {
    const { shouldAutoRebootPreview } = await import('./PreviewHealth');
    const h = classifyPreviewHealth({ ...base, livePortUp: true, pageRendered: false, pageProblems: ['404'] });
    expect(shouldAutoRebootPreview(h, 0, 3, Infinity, 0)).toBe(false);
  });

  it('a down port still classifies as before (sleeping / crashed), unaffected by the new signal', () => {
    expect(classifyPreviewHealth({ ...base, livePortUp: false, pageRendered: false }).status).toBe('sleeping');
    expect(classifyPreviewHealth({ ...base, livePortUp: false, lastError: 'boom', pageRendered: false }).status).toBe('crashed');
  });

  it('every AI reads the honest state, not "RUNNING"', async () => {
    const { previewHealthContextLine } = await import('./PreviewHealth');
    const line = previewHealthContextLine(classifyPreviewHealth({ ...base, livePortUp: true, pageRendered: false, pageProblems: ['404'] }));
    expect(line).toContain('NOT SERVING');
    expect(line).not.toContain('RUNNING (live)');
  });
});
