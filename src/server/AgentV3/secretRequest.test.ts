import { describe, it, expect } from 'vitest';
import {
  isUsableEnvName, isPlatformSecret, planSecretRequest, secretRequestPrompt, secretRequestResult,
} from './secretRequest';

/**
 * ASKING THE USER FOR A KEY, MID-BUILD.
 *
 * The filters are the feature. Each one exists because skipping it is worse than not asking at all:
 * re-asking for a key the user already saved teaches them their input does not stick; an unusable name
 * reaches `.env` and silently never resolves; and asking for NavBharatAI's OWN provider keys would have
 * a user paste a real credential believing it configures their app.
 */

describe('isUsableEnvName — what can actually be read back', () => {
  it('accepts the shapes generated code reads', () => {
    for (const n of ['STRIPE_SECRET_KEY', 'VITE_MAPS_TOKEN', 'A1', 'Twilio_Auth_Token']) {
      expect(isUsableEnvName(n)).toBe(true);
    }
  });

  it('refuses names that could never resolve', () => {
    // A dash or a space needs quoting the generated code will not have; a leading digit is not a valid
    // identifier; one character is almost certainly a mistake.
    for (const n of ['', 'A', '1KEY', 'MY-KEY', 'MY KEY', 'KEY!', 'a'.repeat(65)]) {
      expect(isUsableEnvName(n)).toBe(false);
    }
  });
});

describe('isPlatformSecret — NavBharatAI\'s own keys are never requested', () => {
  it('recognises the platform credentials a model might plausibly emit', () => {
    // A model that has seen this repo could suggest any of these. A user typing a value would be
    // pasting a key that configures nothing, costs them money if real, and names a vendor on a
    // user-facing screen (white-label law).
    for (const n of [
      'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GLM_API_KEY', 'KIMI_API_KEY',
      'GROK_API_KEY', 'E2B_API_KEY', 'AGENTV3_ENABLED', 'ADMIN_PASSWORD', 'SECRET_ENCRYPTION_KEY',
      'AWS_SECRET_ACCESS_KEY', 'CASHFREE_SECRET_KEY',
    ]) expect(isPlatformSecret(n)).toBe(true);
  });

  it('leaves the user\'s OWN app keys alone', () => {
    for (const n of ['STRIPE_SECRET_KEY', 'RAZORPAY_KEY_SECRET', 'TWILIO_AUTH_TOKEN', 'DATABASE_URL', 'VITE_MAPS_TOKEN']) {
      expect(isPlatformSecret(n)).toBe(false);
    }
  });
});

describe('planSecretRequest — asks only for what is genuinely missing', () => {
  it('asks for a key the user does not have', () => {
    const p = planSecretRequest([{ name: 'STRIPE_SECRET_KEY', why: 'To take card payments.' }], []);
    expect(p.ask).toEqual([{ name: 'STRIPE_SECRET_KEY', why: 'To take card payments.' }]);
  });

  it('NEVER re-asks for a key already in the vault — case-insensitively', () => {
    // Re-asking is how a product teaches someone their input did not stick.
    const p = planSecretRequest([{ name: 'STRIPE_SECRET_KEY' }], ['stripe_secret_key']);
    expect(p.ask).toEqual([]);
    expect(p.alreadyHave).toEqual(['STRIPE_SECRET_KEY']);
  });

  it('drops unusable names and platform keys, and REPORTS them rather than silently discarding', () => {
    const p = planSecretRequest(
      [{ name: 'MY-KEY' }, { name: 'ANTHROPIC_API_KEY' }, { name: 'GOOD_KEY' }],
      [],
    );
    expect(p.ask.map((a) => a.name)).toEqual(['GOOD_KEY']);
    expect(p.rejected).toEqual(['MY-KEY', 'ANTHROPIC_API_KEY']);
  });

  it('the same key twice in one request is one key', () => {
    const p = planSecretRequest([{ name: 'API_KEY' }, { name: 'api_key' }], []);
    expect(p.ask).toHaveLength(1);
  });

  it('a missing reason gets an honest default, never an empty label', () => {
    const p = planSecretRequest([{ name: 'API_KEY' }], []);
    expect(p.ask[0].why).toBe('This app needs this key to work.');
  });

  it('junk input never throws and asks for nothing', () => {
    for (const bad of [null, undefined, [], [{}], [{ name: '   ' }]]) {
      expect(() => planSecretRequest(bad as never, null)).not.toThrow();
      expect(planSecretRequest(bad as never, null).ask).toEqual([]);
    }
  });
});

describe('the words the user reads', () => {
  it('the prompt says why it stopped and where the key goes', () => {
    // A popup demanding credentials with no context is the shape of a phishing prompt, and the user is
    // being asked for real money keys.
    const p = planSecretRequest([{ name: 'STRIPE_SECRET_KEY' }], []);
    const text = secretRequestPrompt(p);
    expect(text).toContain('your own encrypted vault');
    expect(text).toContain('Settings → Secrets & API Keys');
    expect(text).toContain('never shows them to the AI');
  });

  it('an empty plan says nothing at all', () => {
    expect(secretRequestPrompt(planSecretRequest([], []))).toBe('');
  });

  it('saving reports what was wired', () => {
    expect(secretRequestResult('saved', ['STRIPE_SECRET_KEY'])).toContain('wired it into the app');
  });

  it('SKIPPING is a first-class outcome that names the consequence', () => {
    // The build carries on and finishes. What it must not do is pretend the feature works.
    const msg = secretRequestResult('skipped', ['STRIPE_SECRET_KEY']);
    expect(msg).toContain('stay switched off');
    expect(msg).toContain('Settings → Secrets & API Keys');
  });

  it('nothing to ask produces no line — silence beats noise on a working build', () => {
    expect(secretRequestResult('nothing-to-ask', [])).toBe('');
  });
});

describe('THE VALUE NEVER PASSES THROUGH HERE', () => {
  it('the module\'s whole surface is names and reasons — there is no value field anywhere', () => {
    // This is the security property of the design: the client saves the value straight to the encrypted
    // vault through the existing authenticated API, and the build only ever learns that it was saved.
    // If a `value` ever appears in this module's types, a live credential is about to start travelling
    // through the build's event stream — which `buildDiag.recordCommand` stores UNREDACTED.
    const source = require('fs').readFileSync(require('path').join(__dirname, 'secretRequest.ts'), 'utf8');
    const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''); // strip commentary
    expect(code).not.toMatch(/\bvalue\s*[:?]/);
    expect(code).not.toMatch(/secretValue/);
  });
});
