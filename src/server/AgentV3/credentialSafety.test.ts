import { describe, it, expect } from 'vitest';
import {
  inspectCredential, inspectCredentials, credentialWarningSummary,
  isBrowserExposedName, isUnambiguouslySecretValue, testKeyPrefix,
} from './credentialSafety';

const kinds = (name: string, value: string) => inspectCredential(name, value).map((w) => w.kind);

describe('exposed-secret — a server secret published to every visitor', () => {
  it('catches a catalogued server-only key saved under a browser prefix', () => {
    expect(kinds('VITE_STRIPE_SECRET_KEY', 'sk_live_abc123')).toContain('exposed-secret');
    expect(kinds('NEXT_PUBLIC_CLERK_SECRET_KEY', 'sk_live_xyz')).toContain('exposed-secret');
    expect(kinds('REACT_APP_RAZORPAY_KEY_SECRET', 'somerealsecretvalue')).toContain('exposed-secret');
  });

  it('catches a secret the catalogue has never heard of, by its value prefix alone', () => {
    expect(kinds('VITE_MY_CUSTOM_THING', 'sk_live_abc')).toContain('exposed-secret');
    expect(kinds('VITE_HOOK', 'whsec_abc123')).toContain('exposed-secret');
    expect(kinds('VITE_MAIL', 'SG.abcdef.ghijkl')).toContain('exposed-secret');
    expect(kinds('VITE_MAP_TOKEN', 'sk.eyJhbGciOi')).toContain('exposed-secret');
  });

  it('does NOT fire on keys that are MEANT to be public — the precision budget', () => {
    // Every one of these is designed to ship in the browser. Warning here would train people to
    // dismiss the warning, and the next one is the real one.
    expect(kinds('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_live_abc')).toEqual([]);
    expect(kinds('VITE_CLERK_PUBLISHABLE_KEY', 'pk_live_abc')).toEqual([]);
    expect(kinds('VITE_SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiJ9.abc')).toEqual([]);
    expect(kinds('VITE_SUPABASE_URL', 'https://x.supabase.co')).toEqual([]);
    expect(kinds('VITE_MAPBOX_ACCESS_TOKEN', 'pk.eyJhbGciOi')).toEqual([]);
    expect(kinds('VITE_FIREBASE_API_KEY', 'AIzaSyABC')).toEqual([]);
  });

  it('does NOT fire on a server secret stored correctly, without a browser prefix', () => {
    expect(kinds('STRIPE_SECRET_KEY', 'sk_live_abc')).toEqual([]);
    expect(kinds('RAZORPAY_KEY_SECRET', 'realsecret')).toEqual([]);
    expect(kinds('CLOUDINARY_URL', 'cloudinary://1:2@cloud')).toEqual([]);
  });

  it('never guesses from shape alone — a long random browser value is not an incident', () => {
    expect(kinds('VITE_SOMETHING', 'a8f7d6s5a4f3d2s1a0f9d8s7a6f5d4s3')).toEqual([]);
    expect(kinds('VITE_ANALYTICS_ID', 'G-ABCDEF1234')).toEqual([]);
  });

  it('tells the user to ROTATE, not just to move it — the old value is already public', () => {
    const [w] = inspectCredential('VITE_STRIPE_SECRET_KEY', 'sk_live_abc');
    expect(w.message).toMatch(/change the key/i);
    expect(w.message).toContain('Settings → App Settings → Secrets & API Keys');
  });
});

describe('test-key — correct while building, silent failure in production', () => {
  it('recognises the sandbox prefixes the catalogue records', () => {
    expect(kinds('RAZORPAY_KEY_ID', 'rzp_test_abc')).toEqual(['test-key']);
    expect(kinds('STRIPE_SECRET_KEY', 'sk_test_abc')).toEqual(['test-key']);
    expect(kinds('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_abc')).toEqual(['test-key']);
  });

  it('stays quiet for a live key', () => {
    expect(kinds('RAZORPAY_KEY_ID', 'rzp_live_abc')).toEqual([]);
    expect(kinds('STRIPE_PUBLISHABLE_KEY', 'pk_live_abc')).toEqual([]);
  });

  it('does not scold — a test key is the RIGHT thing to build against', () => {
    const [w] = inspectCredential('RAZORPAY_KEY_ID', 'rzp_test_abc');
    expect(w.message).toMatch(/exactly right/i);
    // …but it must still name the real consequence rather than being merely reassuring.
    expect(w.message).toMatch(/cannot take real money/i);
    expect(w.message).toMatch(/nothing will reach your account/i);
  });

  it('only trusts the catalogue — "test" inside an unrelated value is not a sandbox key', () => {
    expect(testKeyPrefix('SMTP_USER', 'test@example.com')).toBeNull();
    expect(testKeyPrefix('UNKNOWN_VAR', 'sk_test_abc')).toBeNull();
    expect(kinds('SMTP_USER', 'testing123')).toEqual([]);
  });
});

describe('both at once', () => {
  it('reports exposure AND the test-key note — fixing one leaves the other', () => {
    const ks = kinds('VITE_STRIPE_SECRET_KEY', 'sk_test_abc');
    expect(ks).toContain('exposed-secret');
    expect(ks).toContain('test-key');
    expect(ks).toHaveLength(2);
  });
});

describe('inspectCredentials — the whole vault', () => {
  it('puts the security incident before the note about later', () => {
    const out = inspectCredentials({
      RAZORPAY_KEY_ID: 'rzp_test_abc',
      VITE_STRIPE_SECRET_KEY: 'sk_live_abc',
    });
    expect(out.map((w) => w.kind)).toEqual(['exposed-secret', 'test-key']);
  });

  it('is empty and cheap for a clean vault, and never throws on junk input', () => {
    expect(inspectCredentials({ DATABASE_URL: 'postgres://u:p@host/db', STRIPE_SECRET_KEY: 'sk_live_a' })).toEqual([]);
    expect(inspectCredentials(null)).toEqual([]);
    expect(inspectCredentials({})).toEqual([]);
    expect(inspectCredential('', '')).toEqual([]);
    expect(inspectCredential('VITE_X', '')).toEqual([]);
    expect(() => inspectCredentials({ X: undefined as unknown as string })).not.toThrow();
  });
});

describe('the admin summary never carries a secret VALUE', () => {
  it('names variables only — a build report is stored forever', () => {
    const secrets = { VITE_STRIPE_SECRET_KEY: 'sk_live_SUPERSECRETVALUE', RAZORPAY_KEY_ID: 'rzp_test_ABC123' };
    const summary = credentialWarningSummary(inspectCredentials(secrets));
    expect(summary).toContain('VITE_STRIPE_SECRET_KEY');
    expect(summary).toContain('RAZORPAY_KEY_ID');
    for (const value of Object.values(secrets)) expect(summary).not.toContain(value);
    // not even a truncated fragment
    expect(summary).not.toContain('SUPERSECRET');
    expect(summary).not.toContain('ABC123');
  });

  it('is empty for a clean vault', () => {
    expect(credentialWarningSummary([])).toBe('');
  });

  it('the user-facing messages never carry a value either', () => {
    const value = 'sk_live_SUPERSECRETVALUE';
    for (const w of inspectCredential('VITE_STRIPE_SECRET_KEY', value)) {
      expect(w.message).not.toContain(value);
      expect(w.message).not.toContain('SUPERSECRET');
    }
  });
});

describe('helpers', () => {
  it('knows which prefixes a bundler publishes', () => {
    expect(isBrowserExposedName('VITE_X')).toBe(true);
    expect(isBrowserExposedName('NEXT_PUBLIC_X')).toBe(true);
    expect(isBrowserExposedName('REACT_APP_X')).toBe(true);
    expect(isBrowserExposedName('X')).toBe(false);
    expect(isBrowserExposedName('MY_VITE_X')).toBe(false);
  });

  it('identifies vendor-assigned secret prefixes and nothing else', () => {
    expect(isUnambiguouslySecretValue('sk_live_a')).toBe(true);
    expect(isUnambiguouslySecretValue('pk_live_a')).toBe(false);
    expect(isUnambiguouslySecretValue('')).toBe(false);
    expect(isUnambiguouslySecretValue('just-a-long-random-looking-string')).toBe(false);
  });
});
