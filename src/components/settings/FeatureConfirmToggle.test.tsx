import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FeatureConfirmToggle } from './FeatureConfirmToggle';
import { FEATURE_CONFIRM_PREF_KEY, featureConfirmDisabled, setFeatureConfirmDisabled } from '../agentv3/featureConfirm';

// The suite runs in node; the preference only needs a Storage-shaped object on `window`.
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  },
};

describe('Settings → Confirm features before building', () => {
  beforeEach(() => { store.clear(); });

  it('is ON by default, and says so to a screen reader', () => {
    const html = renderToStaticMarkup(<FeatureConfirmToggle />);
    expect(html).toContain('Confirm features before building');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
  });

  it('reads the SAME preference the card\'s "Don\'t ask again" writes — so it is the way back', () => {
    setFeatureConfirmDisabled(true); // what the card's checkbox does
    expect(window.localStorage.getItem(FEATURE_CONFIRM_PREF_KEY)).toBe('1');
    expect(renderToStaticMarkup(<FeatureConfirmToggle />)).toContain('aria-checked="false"');
    setFeatureConfirmDisabled(false); // what switching it back on does
    expect(featureConfirmDisabled()).toBe(false);
    expect(window.localStorage.getItem(FEATURE_CONFIRM_PREF_KEY)).toBeNull();
  });

  it('is really on the General settings screen, beside the other per-device build preferences', () => {
    const panel = readFileSync(join(process.cwd(), 'src/components/panels/SettingsPanel.tsx'), 'utf8');
    const sig = panel.indexOf('<AppSignatureToggle />');
    const mine = panel.indexOf('<FeatureConfirmToggle />');
    expect(sig).toBeGreaterThan(-1);
    expect(mine).toBeGreaterThan(sig);
    expect(mine - sig).toBeLessThan(400);
  });

  it('writes no second key of its own', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/settings/FeatureConfirmToggle.tsx'), 'utf8');
    expect(src).not.toMatch(/localStorage/);
  });
});
