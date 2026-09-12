import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createSign, createHash, randomBytes } from 'crypto';
import {
  unlockSecret, bufferToBase64url, base64urlToBuffer,
  mintChallenge, verifyChallenge, CHALLENGE_TTL_MS,
  mintUnlockTicket, verifyUnlockTicket, TICKET_TTL_MS,
  allowedOrigins, allowedRpIds, rpIdMatches,
  parseAuthenticatorData, verifyClientData,
  verifyAssertionSignature, signCounterOk, isAcceptedAlg,
  isFreshReauth, REAUTH_MAX_AGE_MS, UNLOCK_REFUSED_MESSAGE,
} from '../src/server/lib/deviceUnlock';

const SECRET = 'a-test-vault-key-0123456789abcdef';
const UID = 'user-abc';
const NOW = 1_757_000_000_000;

/** Build a real authenticatorData buffer: 32-byte rpIdHash, flags, 4-byte counter. */
function authData(opts: { rpId?: string; flags?: number; counter?: number } = {}): Buffer {
  const rpIdHash = createHash('sha256').update(opts.rpId ?? 'navbharatai.com', 'utf8').digest();
  const rest = Buffer.alloc(5);
  rest[0] = opts.flags ?? 0x05; // userPresent | userVerified
  rest.writeUInt32BE(opts.counter ?? 0, 1);
  return Buffer.concat([rpIdHash, rest]);
}

function clientData(opts: { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean }): Buffer {
  const body: Record<string, unknown> = {
    type: opts.type ?? 'webauthn.get',
    challenge: bufferToBase64url(Buffer.from(opts.challenge ?? '', 'utf8')),
    origin: opts.origin ?? 'https://navbharatai.com',
  };
  if (opts.crossOrigin !== undefined) body.crossOrigin = opts.crossOrigin;
  return Buffer.from(JSON.stringify(body), 'utf8');
}

describe('base64url — the encoding every WebAuthn field arrives in', () => {
  it('round-trips arbitrary bytes', () => {
    for (let n = 1; n < 40; n += 7) {
      const bytes = randomBytes(n);
      expect(base64urlToBuffer(bufferToBase64url(bytes)).equals(bytes), String(n)).toBe(true);
    }
  });

  it('never produces standard-base64 characters, which would break in a URL', () => {
    const encoded = bufferToBase64url(Buffer.from([0xfb, 0xff, 0xfe, 0x00]));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('refuses junk with an EMPTY buffer rather than throwing or guessing', () => {
    // Every caller treats empty as "reject", so this is the refusal path for a malformed field.
    for (const bad of ['', '   ', 'not base64!!', 'abc$def', '../../etc', 'a b']) {
      expect(base64urlToBuffer(bad).length, bad).toBe(0);
    }
  });
});

describe('the challenge — proof that an assertion answers OUR question', () => {
  it('verifies for the user it was minted for, inside its window', () => {
    const c = mintChallenge(UID, NOW, SECRET);
    expect(verifyChallenge(c, UID, NOW + 1_000, SECRET)).toBe(true);
  });

  it('is refused for a DIFFERENT user — one person cannot answer another person\'s challenge', () => {
    const c = mintChallenge(UID, NOW, SECRET);
    expect(verifyChallenge(c, 'someone-else', NOW + 1_000, SECRET)).toBe(false);
  });

  it('expires, so a captured challenge cannot be answered tomorrow', () => {
    const c = mintChallenge(UID, NOW, SECRET);
    expect(verifyChallenge(c, UID, NOW + CHALLENGE_TTL_MS - 1, SECRET)).toBe(true);
    expect(verifyChallenge(c, UID, NOW + CHALLENGE_TTL_MS + 1, SECRET)).toBe(false);
  });

  it('is refused under a different signing key, and cannot be hand-forged', () => {
    const c = mintChallenge(UID, NOW, SECRET);
    expect(verifyChallenge(c, UID, NOW, 'another-key-entirely')).toBe(false);
    expect(verifyChallenge(`deadbeef.${NOW + 60_000}.0000`, UID, NOW, SECRET)).toBe(false);
  });

  it('is unguessable — two challenges never collide', () => {
    const seen = new Set(Array.from({ length: 50 }, () => mintChallenge(UID, NOW, SECRET)));
    expect(seen.size).toBe(50);
  });

  it('refuses a malformed shape instead of reading past the end', () => {
    for (const bad of ['', 'a', 'a.b', 'a.b.c.d', '..']) expect(verifyChallenge(bad, UID, NOW, SECRET)).toBe(false);
  });
});

describe('the unlock ticket — what the reveal and delete routes actually check', () => {
  it('verifies and reports HOW the vault was opened', () => {
    const t = mintUnlockTicket(UID, NOW, SECRET, 'device-lock');
    expect(verifyUnlockTicket(t, UID, NOW + 1_000, SECRET)).toEqual({ method: 'device-lock' });
    const r = mintUnlockTicket(UID, NOW, SECRET, 'account-reauth');
    expect(verifyUnlockTicket(r, UID, NOW + 1_000, SECRET)).toEqual({ method: 'account-reauth' });
  });

  it('is bound to ONE user — a ticket cannot open somebody else\'s vault', () => {
    const t = mintUnlockTicket(UID, NOW, SECRET, 'device-lock');
    expect(verifyUnlockTicket(t, 'other-user', NOW, SECRET)).toBeNull();
  });

  it('lapses, so the vault re-locks itself on an abandoned screen', () => {
    const t = mintUnlockTicket(UID, NOW, SECRET, 'device-lock');
    expect(verifyUnlockTicket(t, UID, NOW + TICKET_TTL_MS - 1, SECRET)).not.toBeNull();
    expect(verifyUnlockTicket(t, UID, NOW + TICKET_TTL_MS + 1, SECRET)).toBeNull();
  });

  it('refuses an invented method, so the audit trail cannot be poisoned', () => {
    expect(verifyUnlockTicket(`admin.${NOW + 60_000}.abc`, UID, NOW, SECRET)).toBeNull();
  });

  it('cannot be extended by editing its expiry — the MAC covers it', () => {
    const t = mintUnlockTicket(UID, NOW, SECRET, 'device-lock');
    const [method, , sig] = t.split('.');
    const stretched = `${method}.${NOW + 10 * TICKET_TTL_MS}.${sig}`;
    expect(verifyUnlockTicket(stretched, UID, NOW, SECRET)).toBeNull();
  });

  it('🔒 a CHALLENGE cannot be used as a TICKET, or the other way round', () => {
    // This is the whole reason the two carry different labels. A single shared signer would make these
    // interchangeable strings, and a payload collision would then open a vault with a preview token.
    const challenge = mintChallenge(UID, NOW, SECRET);
    expect(verifyUnlockTicket(challenge, UID, NOW, SECRET)).toBeNull();
    const ticket = mintUnlockTicket(UID, NOW, SECRET, 'device-lock');
    expect(verifyChallenge(ticket, UID, NOW, SECRET)).toBe(false);
  });
});

describe('origins and rp ids — what stops a phishing page replaying an assertion here', () => {
  it('defaults to the real site, and derives the rp ids from it', () => {
    expect(allowedOrigins({} as NodeJS.ProcessEnv)).toContain('https://navbharatai.com');
    expect(allowedRpIds({} as NodeJS.ProcessEnv)).toContain('navbharatai.com');
  });

  it('can be overridden by env for a staging host', () => {
    const env = { VAULT_LOCK_ORIGINS: 'https://staging.navbharatai.com' } as unknown as NodeJS.ProcessEnv;
    expect(allowedOrigins(env)).toEqual(['https://staging.navbharatai.com']);
    expect(allowedRpIds(env)).toEqual(['staging.navbharatai.com']);
  });

  it('DROPS a malformed env entry rather than widening the set', () => {
    // A typo must never turn into "any origin". An unusable list falls back to the built-in defaults.
    const env = { VAULT_LOCK_ORIGINS: 'navbharatai.com, javascript:alert(1), not a url' } as unknown as NodeJS.ProcessEnv;
    expect(allowedOrigins(env)).toContain('https://navbharatai.com');
    expect(allowedOrigins(env)).not.toContain('javascript:alert(1)');
  });

  it('matches the rpIdHash of our own domain and nothing else', () => {
    const env = { VAULT_LOCK_ORIGINS: 'https://navbharatai.com' } as unknown as NodeJS.ProcessEnv;
    expect(rpIdMatches(createHash('sha256').update('navbharatai.com').digest(), env)).toBe(true);
    expect(rpIdMatches(createHash('sha256').update('evil.example').digest(), env)).toBe(false);
    expect(rpIdMatches(Buffer.alloc(0), env)).toBe(false);
  });
});

describe('authenticatorData — where "the device really checked the person" is recorded', () => {
  it('reads the rpIdHash, the flags and the counter at their fixed offsets', () => {
    const parsed = parseAuthenticatorData(authData({ counter: 42 }));
    expect(parsed).not.toBeNull();
    expect(parsed!.signCounter).toBe(42);
    expect(parsed!.flags.userPresent).toBe(true);
    expect(parsed!.flags.userVerified).toBe(true);
    expect(parsed!.rpIdHash.length).toBe(32);
  });

  it('🔒 reports userVerified FALSE when the device only detected a touch', () => {
    // The difference between "somebody tapped the key" and "the owner's face or PIN was accepted".
    // The route refuses the first, which is why this bit has to be read correctly rather than assumed.
    const parsed = parseAuthenticatorData(authData({ flags: 0x01 }));
    expect(parsed!.flags.userPresent).toBe(true);
    expect(parsed!.flags.userVerified).toBe(false);
  });

  it('returns null for a buffer too short to be real, instead of reading past the end', () => {
    expect(parseAuthenticatorData(Buffer.alloc(0))).toBeNull();
    expect(parseAuthenticatorData(Buffer.alloc(36))).toBeNull();
    expect(parseAuthenticatorData('not a buffer' as unknown as Buffer)).toBeNull();
  });

  it('extracts the credential id from a registration response', () => {
    const id = randomBytes(20);
    const head = authData({ flags: 0x45 }); // userPresent | userVerified | attestedCredentialData
    const len = Buffer.alloc(2);
    len.writeUInt16BE(id.length, 0);
    const parsed = parseAuthenticatorData(Buffer.concat([head, Buffer.alloc(16), len, id]));
    expect(parsed!.flags.hasAttestedCredential).toBe(true);
    expect(parsed!.credentialId?.equals(id)).toBe(true);
  });

  it('does not invent a credential id when the attested-data flag is absent', () => {
    expect(parseAuthenticatorData(authData())!.credentialId).toBeNull();
  });

  it('survives a truncated credential id without throwing', () => {
    const head = authData({ flags: 0x45 });
    const len = Buffer.alloc(2);
    len.writeUInt16BE(200, 0); // claims 200 bytes that are not there
    expect(parseAuthenticatorData(Buffer.concat([head, Buffer.alloc(16), len, randomBytes(4)]))!.credentialId).toBeNull();
  });
});

describe('clientDataJSON — the browser\'s own statement of what it was asked, and by whom', () => {
  const env = { VAULT_LOCK_ORIGINS: 'https://navbharatai.com' } as unknown as NodeJS.ProcessEnv;
  const good = () => mintChallenge(UID, NOW, SECRET);

  it('accepts a well-formed assertion from our own site', () => {
    const cd = clientData({ challenge: good() });
    expect(verifyClientData(cd.toString('utf8'), { expectedType: 'webauthn.get', uid: UID, nowMs: NOW, secret: SECRET, env }).ok).toBe(true);
  });

  it('🔒 refuses an assertion collected by another origin — the anti-phishing check', () => {
    const cd = clientData({ challenge: good(), origin: 'https://navbharatai.com.evil.example' });
    const r = verifyClientData(cd.toString('utf8'), { expectedType: 'webauthn.get', uid: UID, nowMs: NOW, secret: SECRET, env });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('origin not allowed');
  });

  it('refuses a REGISTRATION response offered as an unlock, and vice versa', () => {
    const cd = clientData({ challenge: good(), type: 'webauthn.create' });
    expect(verifyClientData(cd.toString('utf8'), { expectedType: 'webauthn.get', uid: UID, nowMs: NOW, secret: SECRET, env }).reason)
      .toBe('wrong ceremony type');
  });

  it('refuses a cross-origin (iframed) ceremony', () => {
    const cd = clientData({ challenge: good(), crossOrigin: true });
    expect(verifyClientData(cd.toString('utf8'), { expectedType: 'webauthn.get', uid: UID, nowMs: NOW, secret: SECRET, env }).reason)
      .toBe('cross-origin ceremony refused');
  });

  it('🔒 refuses a replayed assertion whose challenge we never issued', () => {
    const cd = clientData({ challenge: 'i-made-this-up' });
    expect(verifyClientData(cd.toString('utf8'), { expectedType: 'webauthn.get', uid: UID, nowMs: NOW, secret: SECRET, env }).ok).toBe(false);
  });

  it('refuses an assertion whose challenge belonged to a DIFFERENT user', () => {
    const cd = clientData({ challenge: mintChallenge('another-user', NOW, SECRET) });
    expect(verifyClientData(cd.toString('utf8'), { expectedType: 'webauthn.get', uid: UID, nowMs: NOW, secret: SECRET, env }).ok).toBe(false);
  });

  it('refuses non-JSON and a missing challenge rather than throwing', () => {
    expect(verifyClientData('<html>', { expectedType: 'webauthn.get', uid: UID, nowMs: NOW, secret: SECRET, env }).reason).toBe('clientData is not JSON');
    expect(verifyClientData(JSON.stringify({ type: 'webauthn.get', origin: 'https://navbharatai.com' }), { expectedType: 'webauthn.get', uid: UID, nowMs: NOW, secret: SECRET, env }).reason)
      .toBe('challenge missing');
  });
});

describe('the signature — verified against a REAL key pair, not a mock', () => {
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });

  const sign = (priv: import('crypto').KeyObject, data: Buffer) => {
    const s = createSign('SHA256');
    s.update(data);
    s.end();
    return s.sign(priv);
  };
  const signedBlob = (ad: Buffer, cd: Buffer) => Buffer.concat([ad, createHash('sha256').update(cd).digest()]);

  it('accepts a genuine ES256 signature over authenticatorData ‖ SHA256(clientData)', () => {
    const ad = authData();
    const cd = clientData({ challenge: 'x' });
    expect(verifyAssertionSignature({
      spkiDer: ec.publicKey.export({ format: 'der', type: 'spki' }) as Buffer,
      authenticatorData: ad, clientDataJSON: cd, signature: sign(ec.privateKey, signedBlob(ad, cd)),
    })).toBe(true);
  });

  it('accepts a genuine RS256 signature through the SAME code path', () => {
    // One path for both algorithms: the key type comes from the SPKI, so there is no algorithm switch
    // to get wrong — which is why ACCEPTED_COSE_ALGS is a short list rather than a wide one.
    const ad = authData();
    const cd = clientData({ challenge: 'x' });
    expect(verifyAssertionSignature({
      spkiDer: rsa.publicKey.export({ format: 'der', type: 'spki' }) as Buffer,
      authenticatorData: ad, clientDataJSON: cd, signature: sign(rsa.privateKey, signedBlob(ad, cd)),
    })).toBe(true);
  });

  it('🔒 refuses a signature from a DIFFERENT key — the core guarantee', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const ad = authData();
    const cd = clientData({ challenge: 'x' });
    expect(verifyAssertionSignature({
      spkiDer: ec.publicKey.export({ format: 'der', type: 'spki' }) as Buffer,
      authenticatorData: ad, clientDataJSON: cd, signature: sign(other.privateKey, signedBlob(ad, cd)),
    })).toBe(false);
  });

  it('🔒 refuses when authenticatorData was altered after signing', () => {
    const ad = authData({ counter: 1 });
    const cd = clientData({ challenge: 'x' });
    const sig = sign(ec.privateKey, signedBlob(ad, cd));
    expect(verifyAssertionSignature({
      spkiDer: ec.publicKey.export({ format: 'der', type: 'spki' }) as Buffer,
      authenticatorData: authData({ counter: 999 }), clientDataJSON: cd, signature: sig,
    })).toBe(false);
  });

  it('🔒 refuses when clientData was swapped after signing — so the challenge cannot be substituted', () => {
    const ad = authData();
    const cd = clientData({ challenge: 'one' });
    const sig = sign(ec.privateKey, signedBlob(ad, cd));
    expect(verifyAssertionSignature({
      spkiDer: ec.publicKey.export({ format: 'der', type: 'spki' }) as Buffer,
      authenticatorData: ad, clientDataJSON: clientData({ challenge: 'two' }), signature: sig,
    })).toBe(false);
  });

  it('returns FALSE (never throws) for a malformed key, an empty signature or missing parts', () => {
    const ad = authData();
    const cd = clientData({ challenge: 'x' });
    expect(verifyAssertionSignature({ spkiDer: Buffer.from('garbage'), authenticatorData: ad, clientDataJSON: cd, signature: Buffer.alloc(64) })).toBe(false);
    expect(verifyAssertionSignature({ spkiDer: ec.publicKey.export({ format: 'der', type: 'spki' }) as Buffer, authenticatorData: ad, clientDataJSON: cd, signature: Buffer.alloc(0) })).toBe(false);
    expect(verifyAssertionSignature({ spkiDer: Buffer.alloc(0), authenticatorData: ad, clientDataJSON: cd, signature: Buffer.alloc(64) })).toBe(false);
  });

  it('accepts only ES256 and RS256', () => {
    expect(isAcceptedAlg(-7)).toBe(true);
    expect(isAcceptedAlg(-257)).toBe(true);
    expect(isAcceptedAlg(-8)).toBe(false); // EdDSA needs a different call shape, so it is refused
    expect(isAcceptedAlg('-7')).toBe(false);
    expect(isAcceptedAlg(undefined)).toBe(false);
  });
});

describe('the signature counter — clone detection that does not lock out phones', () => {
  it('lets a never-counting authenticator stay at zero forever', () => {
    // Phones and laptops legitimately report a constant 0. Demanding an increase would refuse exactly
    // the devices this feature exists for.
    expect(signCounterOk(0, 0)).toBe(true);
  });

  it('requires a counter that has moved before to keep moving', () => {
    expect(signCounterOk(5, 6)).toBe(true);
    expect(signCounterOk(5, 5)).toBe(false);
    expect(signCounterOk(5, 4)).toBe(false);
  });

  it('refuses nonsense rather than treating it as zero', () => {
    expect(signCounterOk(0, -1)).toBe(false);
    expect(signCounterOk(0, NaN)).toBe(false);
  });
});

describe('the fallback — a fresh account sign-in, enforced by the server', () => {
  it('accepts a sign-in from moments ago', () => {
    expect(isFreshReauth(Math.floor(NOW / 1000) - 10, NOW)).toBe(true);
  });

  it('🔒 refuses a sign-in from earlier today — this is what makes it a RE-auth', () => {
    // The client cannot turn an old token into a new one, so this check is the whole fallback.
    expect(isFreshReauth(Math.floor((NOW - REAUTH_MAX_AGE_MS - 1_000) / 1000), NOW)).toBe(false);
  });

  it('tolerates a small clock skew but refuses a token from the future', () => {
    expect(isFreshReauth(Math.floor(NOW / 1000) + 30, NOW)).toBe(true);
    expect(isFreshReauth(Math.floor(NOW / 1000) + 600, NOW)).toBe(false);
  });

  it('treats anything unreadable as stale', () => {
    for (const bad of [undefined, null, 0, -1, 'yesterday', {}, NaN]) {
      expect(isFreshReauth(bad, NOW), String(bad)).toBe(false);
    }
  });
});

describe('what the user is told', () => {
  it('one message for every refusal, naming no internal reason', () => {
    // "challenge expired" and "origin not allowed" help us and help someone probing the endpoint; the
    // screen gets a line that helps only an honest user.
    expect(UNLOCK_REFUSED_MESSAGE).toContain('Could not confirm it is you');
    for (const leak of ['challenge', 'origin', 'signature', 'hmac', 'counter', 'rpId']) {
      expect(UNLOCK_REFUSED_MESSAGE.toLowerCase(), leak).not.toContain(leak.toLowerCase());
    }
  });
});

describe('the signing key', () => {
  it('uses SECRET_ENCRYPTION_KEY so tickets verify across every server instance', () => {
    expect(unlockSecret({ SECRET_ENCRYPTION_KEY: 'abc' } as unknown as NodeJS.ProcessEnv)).toBe('abc');
  });

  it('falls back to a per-process RANDOM value, never a constant in source', () => {
    // A hardcoded fallback would let anyone with the repo forge an unlock ticket. The cost of randomness
    // is that a dev restart re-locks the vault, which is the right way round.
    const a = unlockSecret({} as NodeJS.ProcessEnv);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toBe(unlockSecret({ SECRET_ENCRYPTION_KEY: '   ' } as unknown as NodeJS.ProcessEnv));
  });
});
