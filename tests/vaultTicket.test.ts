/**
 * THE VAULT TICKET — the string that stands between a session and a decrypted API key.
 *
 * Small file, because the ticket is a small idea, and that is exactly why it survived three redesigns of
 * the door (WebAuthn device lock → account re-auth → 4-digit PIN) untouched. What it must never do is
 * accept something it did not mint: a ticket forged by the client, one that has expired, or one minted
 * for a DIFFERENT purpose by the same server secret.
 */
import { describe, it, expect } from 'vitest';
import {
  unlockSecret, mintUnlockTicket, verifyUnlockTicket, TICKET_TTL_MS, UNLOCK_REFUSED_MESSAGE,
} from '../src/server/lib/vaultTicket';

const NOW = 1_800_000_000_000;
const SECRET = 'a-test-server-secret';

describe('a ticket opens the vault only for the user it was minted for', () => {
  it('verifies for its own uid and nobody else', () => {
    const t = mintUnlockTicket('user_a', NOW, SECRET);
    expect(verifyUnlockTicket(t, 'user_a', NOW + 1_000, SECRET)).toEqual({ method: 'pin' });
    // The uid is inside the signed payload, so another user's id cannot be substituted in the URL.
    expect(verifyUnlockTicket(t, 'user_b', NOW + 1_000, SECRET)).toBeNull();
  });

  it('expires, and there is no "expired but valid" shade', () => {
    const t = mintUnlockTicket('user_a', NOW, SECRET);
    expect(verifyUnlockTicket(t, 'user_a', NOW + TICKET_TTL_MS - 1, SECRET)).not.toBeNull();
    expect(verifyUnlockTicket(t, 'user_a', NOW + TICKET_TTL_MS + 1, SECRET)).toBeNull();
  });

  it('cannot be forged, edited or stretched', () => {
    const t = mintUnlockTicket('user_a', NOW, SECRET);
    const [method, exp, sig] = t.split('.');
    // Pushing the expiry out is the obvious attack, and the signature covers it.
    expect(verifyUnlockTicket(`${method}.${Number(exp) + 3600_000}.${sig}`, 'user_a', NOW, SECRET)).toBeNull();
    expect(verifyUnlockTicket(`${method}.${exp}.${'0'.repeat(sig.length)}`, 'user_a', NOW, SECRET)).toBeNull();
    expect(verifyUnlockTicket(t, 'user_a', NOW, 'a-different-secret')).toBeNull();
    for (const junk of ['', 'x', 'a.b', 'a.b.c.d', 'pin..sig', `pin.notanumber.${sig}`]) {
      expect(verifyUnlockTicket(junk, 'user_a', NOW, SECRET), junk).toBeNull();
    }
  });

  it('🔴 refuses a ticket whose METHOD is not one we mint — including the retired device-lock tickets', () => {
    // Worth pinning rather than assuming: the method is part of the signed payload, so a ticket minted
    // under the old WebAuthn door cannot be replayed after the door was replaced, and a future method
    // cannot be invented client-side by editing the prefix.
    const t = mintUnlockTicket('user_a', NOW, SECRET);
    const exp = t.split('.')[1];
    for (const method of ['device-lock', 'account-reauth', 'admin', '']) {
      const [, , sig] = t.split('.');
      expect(verifyUnlockTicket(`${method}.${exp}.${sig}`, 'user_a', NOW, SECRET), method).toBeNull();
    }
  });
});

describe('the signing key', () => {
  it('uses the configured secret when there is one', () => {
    expect(unlockSecret({ SECRET_ENCRYPTION_KEY: '  a-real-key  ' } as NodeJS.ProcessEnv)).toBe('a-real-key');
  });

  it('falls back to a per-process RANDOM value, never a constant in source', () => {
    // A hardcoded fallback would let anyone holding this repository forge an unlock ticket. A random one
    // costs only an extra unlock when the load balancer moves a user between instances.
    const a = unlockSecret({} as NodeJS.ProcessEnv);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(unlockSecret({ SECRET_ENCRYPTION_KEY: '   ' } as NodeJS.ProcessEnv));
  });
});

describe('what a refused unlock is allowed to say', () => {
  it('names no reason an attacker could use to probe the endpoint', () => {
    expect(UNLOCK_REFUSED_MESSAGE).toBe('Could not open your vault. Please try again.');
    for (const leak of ['signature', 'expired', 'origin', 'challenge', 'hash', 'uid']) {
      expect(UNLOCK_REFUSED_MESSAGE.toLowerCase(), leak).not.toContain(leak);
    }
  });
});
