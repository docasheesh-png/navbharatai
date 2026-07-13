import { describe, it, expect } from 'vitest';
import { computeShowDownloadApp, DEFAULT_LISTING_URL, PUBLIC_LISTING_URL, INTERNAL_TEST_URL } from './appDownload';

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

  it('the default fallback is the internal-test link (the working link while in internal testing)', () => {
    expect(DEFAULT_LISTING_URL).toBe(INTERNAL_TEST_URL);
    expect(DEFAULT_LISTING_URL).toContain('internaltest');
    // The public listing constant is kept for when the app goes to production.
    expect(PUBLIC_LISTING_URL).toContain('com.navbharat.ai');
  });
});
