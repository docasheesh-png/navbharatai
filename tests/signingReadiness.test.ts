/**
 * A PLAY BUNDLE BUILD THAT COULD NEVER HAVE SUCCEEDED (admin 2026-09-15, from a real failure report).
 *
 * A user pressed "Google Play bundle"; the run died in about a minute with `Missing signing secret(s):`
 * and that was the first they heard of it. Nothing was broken — the workflow's own pre-flight did
 * exactly the right thing, and refusing to hand back an unsigned bundle is correct, since Play rejects
 * one anyway. What was wrong is that the press could not have worked and only GitHub knew.
 *
 * The asymmetry that sets every default here: a wrong "your key is missing" costs one press. A build
 * that cannot succeed costs a run, several minutes, and the belief that the app builder is broken.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  ANDROID_SIGNING_SECRETS, missingSigningSecrets, signingVerdict, signingNotReadyMessage,
} from '../src/lib/signingReadiness';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the verdict', () => {
  it('is ready only when all four are present', () => {
    expect(signingVerdict([...ANDROID_SIGNING_SECRETS])).toBe('ready');
    expect(signingVerdict([...ANDROID_SIGNING_SECRETS, 'SOMETHING_ELSE'])).toBe('ready');
  });

  it('is missing when any one is absent, and names exactly which', () => {
    const three = ANDROID_SIGNING_SECRETS.slice(0, 3);
    expect(signingVerdict([...three])).toBe('missing');
    expect(missingSigningSecrets([...three])).toEqual(['ANDROID_KEY_PASSWORD']);
  });

  /**
   * 🔒 THE ONE THAT MUST NOT BE "SIMPLIFIED". A lookup we could not make says nothing about the user's
   * repository — treating it as missing would turn one GitHub hiccup into "you cannot ship", a worse
   * failure than the one this module exists to prevent.
   */
  it('is unknown — never missing — when the names could not be read', () => {
    expect(signingVerdict(null)).toBe('unknown');
    expect(signingVerdict(undefined)).toBe('unknown');
    // An empty repository IS a real answer, though: nothing is set up.
    expect(signingVerdict([])).toBe('missing');
  });

  it('matches GitHub case-insensitively and ignores blanks', () => {
    expect(signingVerdict(ANDROID_SIGNING_SECRETS.map((s) => s.toLowerCase()))).toBe('ready');
    expect(signingVerdict(['', '  ', ...ANDROID_SIGNING_SECRETS])).toBe('ready');
  });
});

describe('what the user is told', () => {
  it('names the thing that works right now, not just the thing that does not', () => {
    const msg = signingNotReadyMessage([...ANDROID_SIGNING_SECRETS]);
    expect(msg).toContain('.apk');
    expect(msg).toContain('signing key');
  });

  it('a HALF-configured key says which ones are missing — that is the hard case to debug', () => {
    const msg = signingNotReadyMessage(['ANDROID_KEY_ALIAS']);
    expect(msg).toContain('ANDROID_KEY_ALIAS');
    expect(msg).toContain('All four');
  });
});

/**
 * 🔴 THE DRIFT GUARD. This module asks GitHub about four names; the generated workflow requires four
 * names. If they are ever edited apart, the check asks about secrets nobody needs and the pre-flight
 * silently stops matching the failure it is meant to pre-empt.
 */
describe('the list is the same list the generated workflow requires', () => {
  const kit = read('../src/server/lib/mobileShipKit.ts');

  it('every secret this module requires is required by android-aab.yml too', () => {
    for (const name of ANDROID_SIGNING_SECRETS) {
      expect(kit).toContain(`secrets.${name}`);
    }
  });

  it('and the workflow requires no ANDROID_ signing secret this module has not heard of', () => {
    // ⚠️ DIGITS BELONG IN THIS CHARACTER CLASS: without them the match stops at ANDROID_KEYSTORE_BASE
    // and the test fails on a name that is perfectly correct (it did, first run).
    const inWorkflow = new Set((kit.match(/secrets\.ANDROID_[A-Z0-9_]+/g) || []).map((m) => m.replace('secrets.', '')));
    for (const name of inWorkflow) {
      expect(ANDROID_SIGNING_SECRETS as readonly string[]).toContain(name);
    }
  });
});

describe('the wiring — a press that cannot succeed never reaches GitHub', () => {
  const panel = read('../src/components/ide/StoreBuildPanel.tsx');
  const server = read('../src/server/routes/mobileShip.ts');

  it('the panel checks before it dispatches, and only for the workflow that needs a key', () => {
    const pre = panel.indexOf('/api/mobile-ship/signing-status');
    const dispatchCall = panel.indexOf('await dispatch(workflow');
    expect(pre).toBeGreaterThan(-1);
    expect(pre).toBeLessThan(dispatchCall);
    expect(panel).toContain('if (needsUserSecrets(workflow))');
  });

  it('only a real "missing" stops the build — unknown falls through', () => {
    expect(panel).toContain("d?.verdict === 'missing'");
    expect(panel).not.toContain("d?.verdict !== 'ready'");
  });

  it('the route reports unknown rather than missing when GitHub could not be read', () => {
    const body = server.slice(server.indexOf("'/api/mobile-ship/signing-status'"), server.indexOf("app.get('/api/mobile-ship/runs'"));
    expect(body).toContain("verdict: 'unknown'");
    expect(body).toContain('actions/secrets');
    // Names only — a route that could return values would be a credential leak, not a convenience.
    expect(body).not.toContain('secret.value');
  });
});
