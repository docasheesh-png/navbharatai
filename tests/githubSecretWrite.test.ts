/**
 * WRITING A SECRET INTO SOMEBODY ELSE'S REPOSITORY (admin 2026-09-15, the "auto" half of option 3).
 *
 * GitHub Actions secrets are not merely posted: a value must be SEALED to that repository's own public
 * key (libsodium `crypto_box_seal`) before it leaves us, which is what makes doing this on a user's
 * behalf safe. After the write, GitHub itself can only hand back the NAMES — to them and to us alike.
 *
 * Two rules carry the whole safety story, and both are tested here rather than described in a comment:
 *   1. An existing signing key is NEVER replaced without being asked in so many words. A user who has
 *      published once is tied to that upload key; replacing it makes their next update unpublishable.
 *   2. A partial write is never silent. Four secrets go up one at a time, and the caller learns exactly
 *      which landed — a repository holding two of four is the "half-configured key" case that
 *      `signingReadiness` already names, and discovering it at build time is the worse outcome.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import _sodium from 'libsodium-wrappers';
import axios from 'axios';
import { sealSecret, putRepoSecrets, describeGhError } from '../src/server/lib/githubSecrets';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the value is really sealed to the repository', () => {
  it('decrypts back to the plaintext with the matching secret key, and never equals it', async () => {
    await _sodium.ready;
    const pair = _sodium.crypto_box_keypair();
    const publicKeyB64 = _sodium.to_base64(pair.publicKey, _sodium.base64_variants.ORIGINAL);

    const secret = 'a-very-real-keystore-password';
    const sealed = await sealSecret(secret, publicKeyB64);

    expect(sealed).not.toContain(secret);
    const opened = _sodium.crypto_box_seal_open(
      _sodium.from_base64(sealed, _sodium.base64_variants.ORIGINAL),
      pair.publicKey,
      pair.privateKey,
    );
    expect(_sodium.to_string(opened)).toBe(secret);
  });

  /** A sealed box is randomised, so the same value twice must not produce the same ciphertext. */
  it('is not deterministic — two seals of one value differ', async () => {
    await _sodium.ready;
    const pair = _sodium.crypto_box_keypair();
    const pk = _sodium.to_base64(pair.publicKey, _sodium.base64_variants.ORIGINAL);
    expect(await sealSecret('same', pk)).not.toBe(await sealSecret('same', pk));
  });
});

describe('a partial write is reported, not swallowed', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const publicKeyReply = async () => {
    await _sodium.ready;
    const pair = _sodium.crypto_box_keypair();
    return { data: { key: _sodium.to_base64(pair.publicKey, _sodium.base64_variants.ORIGINAL), key_id: '123' } };
  };

  it('names every secret that landed and the one it stopped at', async () => {
    vi.spyOn(axios, 'get').mockImplementation(publicKeyReply as never);
    let calls = 0;
    vi.spyOn(axios, 'put').mockImplementation((async () => {
      calls += 1;
      if (calls === 3) throw Object.assign(new Error('boom'), { response: { status: 403 } });
      return { data: {} };
    }) as never);

    const out = await putRepoSecrets({}, 'o', 'r', [['A', '1'], ['B', '2'], ['C', '3'], ['D', '4']]);
    expect(out.written).toEqual(['A', 'B']);
    expect(out.failedAt).toBe('C');
    expect(out.error).toBeTruthy();
  });

  /**
   * ⚠️ NO ROLLBACK, DELIBERATELY. Deleting what it managed to set could delete a secret that was
   * already there and correct. Naming the real state is safer than guessing at a tidy one.
   */
  it('does not try to undo what it wrote', async () => {
    const src = read('../src/server/lib/githubSecrets.ts');
    expect(src).not.toContain('axios.delete');
    expect(src).toContain('does NOT roll back');
  });

  it('writes nothing at all when the repository key cannot be fetched', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('nope'), { response: { status: 404 } }));
    const put = vi.spyOn(axios, 'put').mockResolvedValue({ data: {} } as never);
    const out = await putRepoSecrets({}, 'o', 'r', [['A', '1']]);
    expect(put).not.toHaveBeenCalled();
    expect(out.written).toEqual([]);
    expect(out.error).toContain('could not find');
  });
});

describe('what the user is told when GitHub says no', () => {
  it('is a sentence they can act on, per status', () => {
    expect(describeGhError({ response: { status: 403 } })).toContain('permission');
    expect(describeGhError({ response: { status: 401 } })).toContain('Reconnect');
    expect(describeGhError({ response: { status: 404 } })).toContain('could not find');
    expect(describeGhError(new Error('socket hang up'))).toContain('try again');
  });

  /**
   * 🔒 An error body can carry request details, and this string is rendered on screen. It must be our
   * own words about the status, never GitHub's payload echoed back.
   */
  it('never echoes GitHub’s own response body', () => {
    const msg = describeGhError({ response: { status: 422, data: { message: 'secret value is invalid: AKIA...' } } });
    expect(msg).not.toContain('AKIA');
    expect(msg).not.toContain('invalid');
  });
});

describe('the route refuses to replace a key that is already there', () => {
  const route = read('../src/server/routes/mobileShip.ts');
  const body = route.slice(route.indexOf("'/api/mobile-ship/signing-setup'"), route.indexOf("app.get('/api/mobile-ship/runs'"));

  it('409s when any of the four already exist, unless replace is literally true', () => {
    expect(body).toContain('already.length > 0 && replace !== true');
    expect(body).toContain('409');
    expect(body).toContain('a new one cannot update it');
  });

  /** A repository we could not READ must not be written to: the key we cannot see is the one at risk. */
  it('never generates a key when the existing secrets could not be listed', () => {
    const listFail = body.indexOf('return res.status(502).json({ error: describeGhError(err) });');
    const generate = body.indexOf('generateUploadKeystore(');
    expect(listFail).toBeGreaterThan(-1);
    expect(listFail).toBeLessThan(generate);
  });

  /** 🔒 The key must exist in exactly two places: the user's repository, and their browser once. */
  it('stores no copy anywhere on our side', () => {
    expect(body).not.toContain('encrypt(');
    expect(body).not.toContain('saveSecret');
    expect(body).not.toContain('console.log');
  });
});
