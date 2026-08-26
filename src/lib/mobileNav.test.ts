import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MOBILE_NAV_CONTENT_HEIGHT, MOBILE_NAV_TOTAL_HEIGHT } from './mobileNav';

describe('the mobile tab bar height', () => {
  it('includes the device inset, which is the whole point', () => {
    // The bar is 3.5rem of taps PLUS the iPhone home-indicator strip. A page that reserves only the
    // 3.5rem hides its bottom row — the Professionals composer — by exactly the inset.
    expect(MOBILE_NAV_TOTAL_HEIGHT).toContain(MOBILE_NAV_CONTENT_HEIGHT);
    expect(MOBILE_NAV_TOTAL_HEIGHT).toContain('safe-area-inset-bottom');
  });

  it('falls back to 0, so the web is byte-identical to the old pb-14', () => {
    expect(MOBILE_NAV_TOTAL_HEIGHT).toContain('0px');
  });
});

describe('the bar and the space reserved for it cannot disagree (locked)', () => {
  const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');

  it('BOTH the bar and the page reservation read the shared constant', () => {
    // App.tsx already shares a BOOLEAN for whether the bar exists, after that drifted twice. It still
    // hand-typed the HEIGHT in two places, which is how the inset went missing from one of them.
    expect(app.split('MOBILE_NAV_TOTAL_HEIGHT').length - 1).toBeGreaterThanOrEqual(3); // import + 2 uses
  });

  it('no longer reserves a bare pb-14 for a bar that is taller than that', () => {
    expect(app).not.toContain('showsGlobalMobileNav ? "pb-14"');
  });

  it('reserves nothing when the bar is not rendered', () => {
    // Focus mode and Code Studio hide the bar; reserving 56px for a bar that is not there leaves a
    // dead strip, which this file's own history records as a real past bug.
    expect(app).toContain('showsGlobalMobileNav ? { paddingBottom: MOBILE_NAV_TOTAL_HEIGHT } : undefined');
  });
});

describe('every professional gets the compact header (locked)', () => {
  const chat = readFileSync(resolve(__dirname, '../components/professionals/ProfessionalChat.tsx'), 'utf8');

  it('is ONE component, so the trim reaches all of them at once', () => {
    expect(chat).toContain('export function ProfessionalChat');
    expect(chat).toContain('config.name');
  });

  it('uses the shorter header row', () => {
    expect(chat).toContain('px-4 py-2 border-b border-white/5');
    expect(chat).not.toContain('px-4 py-3 border-b border-white/5');
  });

  it('lets a long name truncate instead of wrapping the header onto a second row', () => {
    // "Pet-Care / Dog-Training AI" would otherwise wrap and give back the height just saved.
    expect(chat).toContain('truncate min-w-0');
  });

  it('keeps the composer compact', () => {
    expect(chat).toContain('px-3 py-2 border-t border-white/5');
  });
});
