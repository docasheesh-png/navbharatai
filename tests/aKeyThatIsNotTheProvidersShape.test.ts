/**
 * Q-156: a real vault held `VITE_RAZORPAY_KEY_ID=doc.asheesh` and `RAZORPAY_KEY_SECRET=` a phone-number-like
 * password, and the build injected them silently and said "🔐 Loaded your saved keys". Nothing checked the
 * shape of a saved value. The class: a value the provider could never have issued, passed on as a key. Where
 * a provider issues keys in a fixed shape, the catalogue now records it, and a value outside it is named —
 * by variable, never by value — while still being given to the app exactly as saved.
 */
import { describe, it, expect } from 'vitest';
import { inspectCredential, inspectCredentials, credentialWarningSummary } from '../src/server/AgentV3/credentialSafety';
import { CREDENTIAL_RECIPES } from '../src/lib/credentialRecipes';

describe('a value that is not the provider\'s key shape is named', () => {
  it('the report\'s own value', () => {
    const w = inspectCredential('VITE_RAZORPAY_KEY_ID', 'doc.asheesh');
    expect(w.map((x) => x.kind)).toContain('wrong-shape');
    const msg = w.find((x) => x.kind === 'wrong-shape')!.message;
    expect(msg).toContain('rzp_test_ or rzp_live_');
    expect(msg).toContain('Settings → App Settings → Secrets & API Keys');
    expect(msg).not.toContain('doc.asheesh');
  });

  it('real shapes pass, test and live alike', () => {
    for (const [n, v] of [['RAZORPAY_KEY_ID', 'rzp_live_AbC123'], ['RAZORPAY_KEY_ID', 'rzp_test_AbC123'], ['STRIPE_SECRET_KEY', 'sk_live_x'],
      ['OPENAI_API_KEY', 'sk-proj-abc'], ['VITE_SUPABASE_ANON_KEY', 'eyJhbGciOi'], ['VITE_SUPABASE_ANON_KEY', 'sb_publishable_x'],
      ['VITE_SUPABASE_URL', 'http://localhost:54321'], ['MONGODB_URI', 'mongodb+srv://u:p@c.x.net/db']] as const) {
      expect(inspectCredential(n, v).map((x) => x.kind), `${n}`).not.toContain('wrong-shape');
    }
  });

  it('a variable whose provider has no fixed shape is never judged — the secret half of the report is not guessed at', () => {
    expect(inspectCredential('RAZORPAY_KEY_SECRET', 'Nav@8949199709')).toEqual([]);
    expect(inspectCredential('SMTP_PASS', 'anything at all')).toEqual([]);
    expect(inspectCredential('MY_OWN_SETTING', 'x')).toEqual([]);
  });

  it('the build report names it with the others', () => {
    const s = credentialWarningSummary(inspectCredentials({ VITE_RAZORPAY_KEY_ID: 'doc.asheesh', STRIPE_SECRET_KEY: 'sk_test_1' }));
    expect(s).toContain("1 saved value(s) that are not the provider's key shape: VITE_RAZORPAY_KEY_ID");
    expect(s).not.toContain('doc.asheesh');
  });

  it('census: every declared shape is a list of non-empty prefixes, and every test prefix is one of its shapes', () => {
    let declared = 0;
    for (const r of CREDENTIAL_RECIPES) for (const o of r.options) for (const v of o.vars) {
      if (!v.valuePrefixes) continue;
      declared++;
      expect(v.valuePrefixes.length, v.name).toBeGreaterThan(0);
      for (const p of v.valuePrefixes) expect(p.length, v.name).toBeGreaterThan(1);
      // A test key that the shape check would call "not this provider's key" would be a lie about a correct key.
      for (const t of v.testPrefixes ?? []) expect(v.valuePrefixes.some((p) => t.startsWith(p)), `${v.name} ${t}`).toBe(true);
    }
    expect(declared).toBeGreaterThanOrEqual(15);
  });
});
