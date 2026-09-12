import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  unlockIsLive, secondsRemaining, deviceLabel, toBase64url, fromBase64url, UNLOCK_TICKET_HEADER,
} from '../src/lib/vaultLock';
import { UNLOCK_TICKET_HEADER as SERVER_HEADER } from '../src/server/routes/secrets';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * The wiring, not the crypto.
 *
 * The lock's rules are proven in `deviceUnlock.test.ts` and `vaultUnlockEndToEnd.test.ts`. What those
 * cannot see is whether the SCREEN is actually plumbed into them — and this feature has a specific way
 * of rotting silently: someone removes the gate, or reintroduces an unticketed delete, and every
 * security test still passes because the server is untouched while the UI simply stops asking.
 */
describe('the client and the server agree on the ticket header', () => {
  it('one header name, defined on both sides and identical', () => {
    // A mismatch here would fail every unlock with a 401 while every unit test stayed green — the
    // failure would look like broken crypto and be a misspelled string.
    expect(UNLOCK_TICKET_HEADER).toBe('x-vault-unlock');
    expect(SERVER_HEADER).toBe(UNLOCK_TICKET_HEADER);
  });
});

describe('the Secrets screen is behind the gate', () => {
  const src = read('src/components/SecretManager.tsx');

  it('wraps the saved-key list in VaultLockGate', () => {
    expect(src).toContain("import { VaultLockGate } from './VaultLockGate'");
    expect(src).toMatch(/<VaultLockGate/);
  });

  it('reads values ONLY through the ticketed reveal call', () => {
    expect(src).toContain('revealSecrets(userId, unlock.ticket)');
  });

  it('deletes ONLY through the ticketed delete call', () => {
    expect(src).toContain('deleteSecretLocked(userId, id, unlock.ticket)');
  });

  it('🔒 does not import an unticketed delete from the old client', () => {
    // The specific regression: `deleteSecret` was removed from secretsApi precisely so this cannot come
    // back by autocomplete. If it ever returns, the screen would be issuing deletes that always 401.
    expect(src).not.toMatch(/\bdeleteSecret\b(?!Locked)/);
  });

  it('the ADD form is deliberately NOT gated — pasting a key you hold reveals nothing', () => {
    // Stated as a test because it is a decision someone could "tidy up" by moving the whole screen
    // behind the lock, adding friction with no security behind it.
    const gateAt = src.indexOf('<VaultLockGate');
    const addAt = src.indexOf('const addSecret');
    expect(addAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    expect(src.slice(gateAt)).not.toContain('const addSecret');
  });
});

describe('no screen deletes a key as part of saving one', () => {
  // The four settings screens used to delete-then-save to overwrite a key. That duplicated logic the
  // save route has had since #2842 AND lost the key outright if it failed between the two calls — and it
  // would now break outright, because DELETE needs an unlock ticket an overwrite has no reason to hold.
  const files = [
    'src/components/settings/DatabaseSettings.tsx',
    'src/components/settings/AuthSettings.tsx',
    'src/components/settings/StorageSettings.tsx',
    'src/components/ide/MonetizationWizard.tsx',
  ];

  for (const f of files) {
    it(`${f.split('/').pop()} saves over a key instead of deleting it first`, () => {
      const src = read(f);
      expect(src).not.toMatch(/\bdeleteSecret\b/);
      expect(src).toContain('saveSecret(');
    });
  }
});

describe('the server keeps the value on exactly one route', () => {
  const src = read('src/server/routes/secrets.ts');

  it('only the reveal route decrypts', () => {
    // `decrypt` appearing anywhere else in this file would be a second, unguarded way out for a value.
    const occurrences = src.split(/\bdecrypt\(/).length - 1;
    expect(occurrences).toBe(1);
  });

  it('both the reveal and the delete demand a ticket', () => {
    expect(src.split('ticketFor(req, userId)').length - 1).toBe(2);
  });

  it('the delete is a real document removal, not a flag', () => {
    expect(src).toContain('await deleteDoc(ref)');
    expect(src).not.toContain("updateDoc(ref, { deleted: true })");
  });
});

describe('the client helpers a screen depends on', () => {
  const now = 1_757_000_000_000;

  it('unlockIsLive is false for null, an empty ticket and an expired one', () => {
    expect(unlockIsLive(null, now)).toBe(false);
    expect(unlockIsLive({ ticket: '', method: 'device-lock', expiresAt: now + 1000 }, now)).toBe(false);
    expect(unlockIsLive({ ticket: 't', method: 'device-lock', expiresAt: now - 1 }, now)).toBe(false);
    expect(unlockIsLive({ ticket: 't', method: 'device-lock', expiresAt: now + 1 }, now)).toBe(true);
  });

  it('secondsRemaining floors at zero rather than counting down past it', () => {
    expect(secondsRemaining({ ticket: 't', method: 'device-lock', expiresAt: now + 90_000 }, now)).toBe(90);
    expect(secondsRemaining({ ticket: 't', method: 'device-lock', expiresAt: now - 90_000 }, now)).toBe(0);
    expect(secondsRemaining(null, now)).toBe(0);
  });

  it('base64url round-trips in the browser direction too', () => {
    const bytes = new Uint8Array([0, 1, 250, 255, 128, 64]);
    expect(Array.from(fromBase64url(toBase64url(bytes)))).toEqual(Array.from(bytes));
    expect(toBase64url(bytes)).not.toMatch(/[+/=]/);
  });

  it('names the device without identifying it', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('iPhone');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('Android phone');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0)')).toBe('Windows PC');
    expect(deviceLabel('something unrecognised')).toBe('This device');
  });
});

/**
 * WHICH DOOR THE SCREEN PUTS FIRST.
 *
 * Not decoration. The admin opened this screen on an iPhone that CAN do Face ID and still asked whether
 * a simple phone lock was possible at all — because the phone-lock button was the small outline one at
 * the bottom while the password path wore the primary colour. Every security test passed throughout:
 * the lock was real, the screen just pointed at the wrong door. Nothing except an assertion on the
 * SCREEN can catch that, which is why these live here rather than in the crypto tests.
 */
describe('the phone lock is the door this screen offers first', () => {
  const src = read('src/components/VaultLockGate.tsx');
  const setUpAt = src.indexOf('Set up ${deviceLabel()');
  const accountAt = src.indexOf('{accountLabel}');

  it('the set-up button wears the primary style, not a quiet outline', () => {
    expect(setUpAt).toBeGreaterThan(0);
    const button = src.slice(src.lastIndexOf('<button', setUpAt), setUpAt);
    expect(button).toContain('primaryButton');
    // The uppercase micro-type is what made it read as an afterthought.
    expect(button).not.toContain('uppercase');
  });

  it('the account door steps down to secondary exactly when the device can do it', () => {
    expect(src).toContain('const deviceIsPrimary = hasDeviceLock === true || offerSetUp;');
    expect(src).toContain('deviceIsPrimary ? secondaryButton : primaryButton');
  });

  it('the device path is rendered above the account path, not below it', () => {
    expect(setUpAt).toBeGreaterThan(0);
    expect(accountAt).toBeGreaterThan(0);
    expect(setUpAt).toBeLessThan(accountAt);
  });

  it('🔒 the account door is still offered unconditionally — a device lock must never strand somebody outside their own keys', () => {
    const buttonAt = src.lastIndexOf('<button', accountAt);
    // A `{something && (` immediately before the tag would be a guard hiding the fallback door.
    expect(src.slice(buttonAt - 160, buttonAt)).not.toMatch(/&&\s*\(\s*$/);
  });

  it('nobody is sent to a device prompt that cannot appear', () => {
    expect(src).toContain('const offerSetUp = canUseDevice === true && hasDeviceLock !== true;');
  });

  it('a Google account confirms in one tap, and the button says Google rather than password', () => {
    // It used to take two: the first tap only revealed a password field that a Google user never gets.
    expect(src).toContain('askPassword || isGoogleAccount ? void unlockViaAccount() : setAskPassword(true)');
    expect(src).toMatch(/isGoogleAccount[\s\S]{0,60}'Confirm with Google'/);
    expect(src).toContain('const showPasswordField = askPassword && !!auth.currentUser && !isGoogleAccount;');
  });

  it('setting up on a password account reveals the field instead of raising an error that says the same thing', () => {
    expect(src).toContain("if (!isGoogleAccount && !password) { setAskPassword(true); return; }");
  });
});
