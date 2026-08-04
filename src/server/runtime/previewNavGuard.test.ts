import { describe, it, expect } from 'vitest';
import { shouldBlockPreviewNav, injectPreviewNavGuard, previewNavGuardScript, NAV_GUARD_MARKER } from './previewNavGuard';

// Preview-takeover autopsy 2026-07-21: a same-origin srcdoc preview inherits the PLATFORM URL as its base,
// so an absolute redirect inside a generated app (login/auth/role-gated dashboards) loaded NavBharatAI Pro
// v5.0 itself INTO the preview. The guard blocks exactly those cross-document platform escapes.

const PLATFORM = 'https://navbharatai.com';
const BASE = 'https://navbharatai.com/build/abc123'; // the srcdoc's inherited base (a platform route)

describe('shouldBlockPreviewNav — block a same-origin cross-document platform escape', () => {
  it('BLOCKS an absolute redirect to the platform root (the exact bug: location=/ → NavBharatAI loads)', () => {
    expect(shouldBlockPreviewNav('/', BASE, PLATFORM)).toBe(true);
  });

  it('BLOCKS a redirect to a platform route (an auth guard sending the app to /login)', () => {
    expect(shouldBlockPreviewNav('/login', BASE, PLATFORM)).toBe(true);
    expect(shouldBlockPreviewNav('https://navbharatai.com/dashboard', BASE, PLATFORM)).toBe(true);
  });

  it('ALLOWS an in-page hash change (client anchors / hash routing must keep working)', () => {
    expect(shouldBlockPreviewNav('#section', BASE, PLATFORM)).toBe(false);
    expect(shouldBlockPreviewNav(`${BASE}#top`, BASE, PLATFORM)).toBe(false);
  });

  it('ALLOWS navigating to the SAME document (no real navigation)', () => {
    expect(shouldBlockPreviewNav(BASE, BASE, PLATFORM)).toBe(false);
  });

  it('ALLOWS an external site (the app opens it normally)', () => {
    expect(shouldBlockPreviewNav('https://example.com/', BASE, PLATFORM)).toBe(false);
    expect(shouldBlockPreviewNav('https://google.com', BASE, PLATFORM)).toBe(false);
  });

  it('empty / same-document targets are never blocked', () => {
    expect(shouldBlockPreviewNav('', BASE, PLATFORM)).toBe(false);
  });

  it('never throws — a malformed base just yields false (no crash)', () => {
    expect(() => shouldBlockPreviewNav('/', 'not-a-valid-base', PLATFORM)).not.toThrow();
    expect(shouldBlockPreviewNav('/', 'not-a-valid-base', PLATFORM)).toBe(false);
  });
});

describe('injectPreviewNavGuard', () => {
  it('injects the guard right after <head> so it runs before the app paints', () => {
    const out = injectPreviewNavGuard('<!DOCTYPE html><html><head><title>App</title></head><body>x</body></html>');
    expect(out).toContain(NAV_GUARD_MARKER);
    expect(out.indexOf(NAV_GUARD_MARKER)).toBeLessThan(out.indexOf('<title>')); // before the head content
  });

  it('is idempotent — never a second guard', () => {
    const once = injectPreviewNavGuard('<html><head></head><body></body></html>');
    const twice = injectPreviewNavGuard(once);
    expect(twice).toBe(once);
    expect((twice.match(new RegExp(NAV_GUARD_MARKER, 'g')) || []).length).toBe(1);
  });

  it('falls back to after <html>, then to a prepend, when there is no <head>', () => {
    expect(injectPreviewNavGuard('<html><body>x</body></html>')).toMatch(new RegExp(`<html><script>/\\*${NAV_GUARD_MARKER}`));
    expect(injectPreviewNavGuard('just a fragment')).toMatch(new RegExp(`^<script>/\\*${NAV_GUARD_MARKER}`));
  });

  it('is a no-op on empty input', () => {
    expect(injectPreviewNavGuard('')).toBe('');
  });

  it('the runtime script overrides assign/replace and intercepts clicks + submits', () => {
    const s = previewNavGuardScript();
    expect(s).toMatch(/location\[m\]=function/);      // assign/replace override
    expect(s).toMatch(/addEventListener\("click"/);
    expect(s).toMatch(/addEventListener\("submit"/);
    expect(s).toMatch(/preventDefault/);
  });

  it('the runtime script normalizes the initial path to "/" so a client router matches the index route', () => {
    const s = previewNavGuardScript();
    // Reset the inherited platform path (/build/xyz) to "/" via replaceState (no reload) before the app mounts.
    expect(s).toMatch(/location\.pathname!=="\/"/);
    expect(s).toMatch(/history\.replaceState\(null,"","\/"/);
  });
});
