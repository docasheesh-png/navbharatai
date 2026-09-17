import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeShowDownloadApp, apkDownloadUrl, DEFAULT_LISTING_URL, PUBLIC_LISTING_URL } from './appDownload';

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Safari/537.36';

describe('computeShowDownloadApp — mobile web on navbharatai.com only', () => {
  it('shows for a mobile browser on navbharatai.com', () => {
    expect(computeShowDownloadApp({ native: false, userAgent: MOBILE_UA, innerWidth: 390, hostname: 'navbharatai.com' })).toBe(true);
  });

  it('shows on a navbharatai.com subdomain too', () => {
    expect(computeShowDownloadApp({ native: false, userAgent: MOBILE_UA, innerWidth: 390, hostname: 'www.navbharatai.com' })).toBe(true);
  });

  it('HIDES inside the installed native app (nothing to download)', () => {
    expect(computeShowDownloadApp({ native: true, userAgent: MOBILE_UA, innerWidth: 390, hostname: 'navbharatai.com' })).toBe(false);
  });

  it('HIDES on desktop (wide, desktop UA)', () => {
    expect(computeShowDownloadApp({ native: false, userAgent: DESKTOP_UA, innerWidth: 1440, hostname: 'navbharatai.com' })).toBe(false);
  });

  it('HIDES on any other host (localhost / preview / a user app)', () => {
    expect(computeShowDownloadApp({ native: false, userAgent: MOBILE_UA, innerWidth: 390, hostname: 'localhost' })).toBe(false);
    expect(computeShowDownloadApp({ native: false, userAgent: MOBILE_UA, innerWidth: 390, hostname: 'evil-navbharatai.com.attacker.net' })).toBe(false);
  });

  it('a narrow desktop-UA window on the site still counts as mobile (width < 768)', () => {
    expect(computeShowDownloadApp({ native: false, userAgent: DESKTOP_UA, innerWidth: 600, hostname: 'navbharatai.com' })).toBe(true);
  });

  it('the default is the PUBLIC Play listing — the exact link the admin gave', () => {
    expect(DEFAULT_LISTING_URL).toBe(PUBLIC_LISTING_URL);
    expect(PUBLIC_LISTING_URL).toBe('https://play.google.com/store/apps/details?id=com.navbharat.ai');
  });

  it('with no build-time override baked in, the button points at the Play listing', () => {
    // Production is exactly this case: neither VITE_ value is passed as a Docker build ARG, so
    // `import.meta.env` carries neither and the default is what every visitor gets.
    expect(apkDownloadUrl()).toBe(PUBLIC_LISTING_URL);
  });
});

// 🔴 THE REVERSION GUARD, and it is the point of this file.
//
// The old default was the Play INTERNAL-TEST opt-in link. That was correct while the app was in
// internal testing and became wrong the day it reached production (release 91, 2026-08-25) — with
// nothing failing to say so, because a URL constant cannot be typechecked and no test asserted where a
// real visitor would land. Every ordinary user tapping "Download app" was sent to a page they could
// not open unless the admin had personally added them as one of at most 100 testers.
//
// So this asserts the SOURCE, not just the export: re-introducing an internal-test URL anywhere in the
// module fails CI, even if it is added as a constant that nothing assigns to the default yet. A value
// sitting one assignment away from being the default again is how this returns.
describe('no internal-test link may live in this module', () => {
  const source = readFileSync(join(__dirname, 'appDownload.ts'), 'utf8');
  // Comments are stripped: the header explains the incident and legitimately says "internal-test".
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('the module contains no play.google.com/apps/internaltest URL', () => {
    expect(code).not.toContain('internaltest');
  });

  it('every play.google.com URL in the module is the public listing', () => {
    const urls = code.match(/https:\/\/play\.google\.com\/[^'"`\s]+/g) || [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toBe(PUBLIC_LISTING_URL);
  });
});
