// WRITE A SECRET INTO THE USER'S OWN REPOSITORY — the other half of "one press, not a Java tutorial".
//
// ADMIN 2026-09-15. GitHub Actions secrets are not merely posted: a secret must be sealed to the
// repository's OWN public key before it leaves us (libsodium's `crypto_box_seal`), which is what makes
// this safe to do on a user's behalf. The plaintext exists for the length of one request and is never
// logged, never stored, and never returned by any route that lists secrets — GitHub itself can only
// give back the NAMES afterwards, not the values, including to us.
//
// 🔒 WE ARE WRITING INTO SOMEBODY ELSE'S ACCOUNT, so two rules are enforced by the caller and stated
// here because they are the whole safety story:
//   1. NEVER overwrite a signing secret that already exists. A user who has published once is tied to
//      that upload key; replacing it silently would make their next update unpublishable. The route
//      refuses unless the caller says explicitly that a replacement is intended.
//   2. A partial write must be visible. Four secrets go up one at a time, and if the third fails the
//      user is told exactly which ones landed — a repository holding two of four is the
//      "half-configured key" case `signingReadiness` already names, and silence there is worse than
//      the original problem.
//
// The token is the user's own (scope `repo`, which covers Actions secrets). NavBharatAI never holds a
// token that could reach a repository the user has not connected.

import axios from 'axios';
import _sodium from 'libsodium-wrappers';

/** libsodium is WASM and initialises asynchronously; every entry point awaits this once. */
async function sodium(): Promise<typeof _sodium> {
  await _sodium.ready;
  return _sodium;
}

export interface RepoPublicKey {
  key_id: string;
  key: string;
}

/**
 * Seal a value to a repository's public key. Exported so a test can prove the output is a real sealed
 * box — it decrypts back to the plaintext with the matching secret key, and never equals the input.
 */
export async function sealSecret(value: string, publicKeyBase64: string): Promise<string> {
  const s = await sodium();
  const key = s.from_base64(publicKeyBase64, s.base64_variants.ORIGINAL);
  const sealed = s.crypto_box_seal(s.from_string(value), key);
  return s.to_base64(sealed, s.base64_variants.ORIGINAL);
}

export interface GhHeaders { [k: string]: string }

/** The repository's own encryption key — every secret must be sealed to it, and it is per repository. */
export async function repoPublicKey(headers: GhHeaders, owner: string, repo: string): Promise<RepoPublicKey> {
  const r = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`,
    { headers },
  );
  const key = r.data?.key;
  const keyId = r.data?.key_id;
  if (typeof key !== 'string' || typeof keyId !== 'string' || !key || !keyId) {
    throw new Error('GitHub did not return an encryption key for this repository.');
  }
  return { key, key_id: keyId };
}

/** Create or update ONE repository secret. Throws on a GitHub refusal so the caller can name it. */
export async function putRepoSecret(
  headers: GhHeaders, owner: string, repo: string,
  name: string, value: string, publicKey: RepoPublicKey,
): Promise<void> {
  const encrypted_value = await sealSecret(value, publicKey.key);
  await axios.put(
    `https://api.github.com/repos/${owner}/${repo}/actions/secrets/${encodeURIComponent(name)}`,
    { encrypted_value, key_id: publicKey.key_id },
    { headers },
  );
}

/** The repository's secret NAMES. GitHub never returns values — which is the point (see the header). */
export async function listRepoSecretNames(headers: GhHeaders, owner: string, repo: string): Promise<string[]> {
  const r = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/actions/secrets?per_page=100`,
    { headers },
  );
  return (r.data?.secrets || []).map((s: { name?: unknown }) => String(s?.name ?? '')).filter(Boolean);
}

export interface WriteOutcome {
  written: string[];
  /** Set when a write failed: the secret it stopped at, so a half-written repository is never silent. */
  failedAt?: string;
  error?: string;
}

/**
 * Write several secrets, in order, reporting exactly how far it got.
 *
 * ⚠️ It does NOT roll back a partial write, and that is deliberate: deleting the secrets it managed to
 * set could delete one that was already there and correct. Naming what landed lets the caller — and the
 * user — see the real state, which `signingReadiness` will then read back from GitHub anyway.
 */
export async function putRepoSecrets(
  headers: GhHeaders, owner: string, repo: string, entries: ReadonlyArray<[string, string]>,
): Promise<WriteOutcome> {
  let publicKey: RepoPublicKey;
  try {
    publicKey = await repoPublicKey(headers, owner, repo);
  } catch (err) {
    return { written: [], failedAt: entries[0]?.[0], error: describeGhError(err) };
  }
  const written: string[] = [];
  for (const [name, value] of entries) {
    try {
      await putRepoSecret(headers, owner, repo, name, value, publicKey);
      written.push(name);
    } catch (err) {
      return { written, failedAt: name, error: describeGhError(err) };
    }
  }
  return { written };
}

/**
 * A sentence a non-technical user can act on. ⚠️ It must never echo GitHub's raw body: an error
 * response can carry request details, and this string is shown on screen.
 */
export function describeGhError(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 403) return 'GitHub refused — your connected account may not have permission to change this repository’s secrets.';
  if (status === 404) return 'GitHub could not find that repository, or your account cannot see it.';
  if (status === 401) return 'Your GitHub connection has expired. Reconnect GitHub and try again.';
  return 'GitHub could not be reached just now. Please try again in a moment.';
}
