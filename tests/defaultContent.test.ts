import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_HOME_DATA,
  DEFAULT_ABOUT_DATA,
  DEFAULT_DONATION_DATA,
  loadPersistedContent,
} from '../src/config/defaultContent';

describe('default content constants', () => {
  it('home data has hero fields and exactly 4 features', () => {
    expect(DEFAULT_HOME_DATA.heroTitle).toBeTruthy();
    expect(DEFAULT_HOME_DATA.features).toHaveLength(4);
    for (const f of DEFAULT_HOME_DATA.features) {
      expect(f.title).toBeTruthy();
      expect(f.icon).toBeTruthy();
      expect(f.color).toMatch(/from-/);
    }
  });

  it('about data has the required text fields', () => {
    expect(DEFAULT_ABOUT_DATA.headline).toBeTruthy();
    expect(DEFAULT_ABOUT_DATA.description).toBeTruthy();
    expect(DEFAULT_ABOUT_DATA.team).toBeTruthy();
    expect(DEFAULT_ABOUT_DATA.vision).toBeTruthy();
  });

  it('donation data has a UPI id and name', () => {
    expect(DEFAULT_DONATION_DATA.upiId).toContain('@');
    expect(DEFAULT_DONATION_DATA.name).toBeTruthy();
  });
});

describe('loadPersistedContent', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    });
  });

  it('returns fallback when nothing is stored', () => {
    expect(loadPersistedContent('missing_key', DEFAULT_HOME_DATA)).toBe(DEFAULT_HOME_DATA);
  });

  it('returns parsed value when valid JSON is stored', () => {
    localStorage.setItem('k', JSON.stringify({ headline: 'Custom' }));
    const result = loadPersistedContent('k', DEFAULT_ABOUT_DATA);
    expect(result).toEqual({ headline: 'Custom' });
  });

  it('returns fallback when stored JSON is corrupt', () => {
    localStorage.setItem('k', 'not-valid-json{');
    const result = loadPersistedContent('k', DEFAULT_DONATION_DATA);
    expect(result).toBe(DEFAULT_DONATION_DATA);
  });
});
