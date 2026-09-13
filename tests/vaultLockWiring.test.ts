import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { unlockIsLive, secondsRemaining, looksLikePin, lockoutMinutes, UNLOCK_TICKET_HEADER } from '../src/lib/appLock';
import { UNLOCK_TICKET_HEADER as SERVER_HEADER } from '../src/server/lib/vaultTicketHttp';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * The wiring, not the crypto.
 *
 * The lock's rules are proven in `vaultPin.test.ts`, `vaultTicket.test.ts` and `vaultPinRoutes.test.ts`.
 * What those cannot see is whether the SCREEN is actually plumbed into them — and this feature has a
 * specific way of rotting silently: someone removes the gate, or reintroduces an unticketed delete, and
 * every security test still passes because the server is untouched while the UI simply stops asking.
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

  it('wraps the saved-key list in the app lock', () => {
    expect(src).toContain("import { AppLockGate } from './AppLockGate'");
    expect(src).toMatch(/<AppLockGate/);
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

  it('🔒 EVERYTHING is now inside the gate, including adding a key', () => {
    // This used to assert the OPPOSITE, and the reversal is deliberate rather than a loosened test.
    // Pasting a key you already hold reveals nothing, so leaving the add form outside the lock was
    // defensible — and it produced the screen the admin photographed: a form, then a lock card halfway
    // down, which reads as a half-locked room. Since the rows themselves are now editable in place there
    // is no separate form left to leave outside, and the panel has one door.
    const gateAt = src.indexOf('<AppLockGate');
    expect(gateAt).toBeGreaterThan(-1);
    expect(src.indexOf('<CredentialTable')).toBeGreaterThan(gateAt);
    // The old top-of-screen form is gone entirely, not merely moved.
    expect(src).not.toContain('const addSecret');
    expect(src).not.toContain('Save Secret');
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
    expect(unlockIsLive({ ticket: '', method: 'pin', expiresAt: now + 1000 }, now)).toBe(false);
    expect(unlockIsLive({ ticket: 't', method: 'pin', expiresAt: now - 1 }, now)).toBe(false);
    expect(unlockIsLive({ ticket: 't', method: 'pin', expiresAt: now + 1 }, now)).toBe(true);
  });

  it('secondsRemaining floors at zero rather than counting down past it', () => {
    expect(secondsRemaining({ ticket: 't', method: 'pin', expiresAt: now + 90_000 }, now)).toBe(90);
    expect(secondsRemaining({ ticket: 't', method: 'pin', expiresAt: now - 90_000 }, now)).toBe(0);
    expect(secondsRemaining(null, now)).toBe(0);
  });

  it('looksLikePin only enables the button — it is a field check, never the security', () => {
    expect(looksLikePin('8274')).toBe(true);
    for (const bad of ['', '1', '123', '12345', '82a4', ' 827']) expect(looksLikePin(bad), bad).toBe(false);
    // Note what it deliberately does NOT do: it accepts 1234. The WEAK-PIN rule lives on the server
    // (`pinRejectReason`), so a client that skipped this check cannot set a guessable PIN anyway.
    expect(looksLikePin('1234')).toBe(true);
  });

  it('lockoutMinutes never says "0 minutes" — a lock-out that reads as over is worse than none', () => {
    expect(lockoutMinutes(15 * 60_000)).toBe(15);
    expect(lockoutMinutes(61_000)).toBe(2);
    expect(lockoutMinutes(1)).toBe(1);
    expect(lockoutMinutes(0)).toBe(1);
  });
});

/**
 * THE SHAPE OF THE DOOR, now that there is only one.
 *
 * Not decoration. The previous version of this block asserted which of TWO doors wore the primary colour,
 * because the admin had opened the screen on an iPhone that can do Face ID and still asked whether a
 * phone lock was possible at all — the button existed, it just looked like an afterthought. Every
 * security test passed throughout; only an assertion on the SCREEN could catch it. With one door that
 * particular trap is gone, and what remains worth pinning is that the door can always be OPENED: a
 * locked-out user, a user with no PIN and a user with no email must each be offered a real next step
 * rather than a dead end, because a vault nobody can open loses somebody their keys for good.
 */
describe('every state of the door offers a real way forward', () => {
  const src = read('src/components/AppLockGate.tsx');

  it('a fresh account is taken straight to setup, not asked for a PIN that does not exist', () => {
    expect(src).toContain("setMode(s.hasPin ? 'unlock' : 'setup')");
  });

  it('a locked-out user is offered a reset, which is the only thing that actually helps them', () => {
    const lockedBranch = src.slice(src.indexOf('lockedForMs > 0 ? ('), src.indexOf("mode === 'unlock' ? ("));
    expect(lockedBranch).toContain('Reset my PIN');
  });

  it('the PIN field cannot waste a try on a stray letter', () => {
    // Five attempts is the whole defence; one spent on a keyboard slip is a real cost to the owner.
    expect(src).toContain("setPinValue(e.target.value.replace(/\\D/g, '').slice(0, 4))");
  });

  it('🔒 the unlock is never gated behind the setup form or vice versa — both are always reachable', () => {
    expect(src).toContain("setMode('setup')");
    expect(src).toContain("setMode('unlock')");
  });

  it('the server is the authority on lock-outs: a refusal re-reads the status instead of guessing', () => {
    expect(src).toContain("if (typeof e?.lockedForMs === 'number' || e?.needsSetup) void refreshStatus(true);");
  });

  it('the lock closes ITSELF, and the timer lives in the shared store rather than per screen', () => {
    // MOVED, not dropped (2026-09-13): with one PIN in front of six screens, a per-component timer would
    // let one screen sit open while another had already re-locked. `appLock.ts` holds ONE timer and every
    // gate subscribes, so they close together — and the expiry is re-checked on READ as well, because a
    // suspended tab's timeout may never fire.
    const store = read('src/lib/appLock.ts');
    expect(store).toContain('expiryTimer = setTimeout(');
    expect(store).toContain('export function subscribeAppLock');
    expect(store).toMatch(/export function currentUnlock[\s\S]{0,200}unlockIsLive\(unlockState\)/);
    // And the user can still close it by hand, on the screen where that matters.
    expect(src).toContain('Lock now');
  });
});
