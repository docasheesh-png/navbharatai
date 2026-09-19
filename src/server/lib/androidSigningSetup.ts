// ENSURE THE USER'S UPLOAD KEY EXISTS — one implementation, called from every place that needs it.
//
// 🔴 THE ROOT CAUSE THIS CLOSES (autopsy 2026-09-19, `12thmentors/app-50-files-2026-09-19`).
// A user pressed "Google Play bundle"; the run died in twelve seconds with all four signing secrets
// absent. A pre-flight built on 2026-09-15 exists to stop exactly that press — and it could not have
// run for that user, because **it lives in the browser bundle**:
//
//   • The Android app is BUNDLED mode (`webDir: 'dist'`, no `server.url`), so its frontend is whatever
//     shipped inside the last `.aab`. `ANDROID_LATEST_VERSION_CODE` is **91**, uploaded 2026-08-25 —
//     three weeks BEFORE the pre-flight was written. No installed Android user has that code at all.
//   • `/api/mobile-ship/trigger`, the server route that actually starts the build, checked nothing. So
//     an old client, a cached web bundle, or any caller at all reached the dispatch unguarded.
//
// The original diagnosis — an org where the user lacked admin — is WRONG and is recorded here so it is
// not re-derived: `mobileSetup.ts` takes `owner` from `GET /user`, the token's own login, so the
// repository is always in the user's PERSONAL account and they always have admin on it.
//
// 🔒 SO THE FIX IS ARCHITECTURAL, NOT A BETTER MESSAGE (the 50/50 law). A guard that ships in the app
// binary protects only users who have reinstalled; a guard on the server protects everyone the moment
// it merges — CLAUDE.md's own rule, that a SERVER change reaches installed app users immediately and a
// FRONTEND change does not. Both halves live here:
//   1. PREVENT — the key is created at SETUP, before the button that needs it can be pressed at all.
//   2. GUARD   — and if it somehow is not there, the SERVER refuses the dispatch, not the browser.

import { generateUploadKeystore, type GeneratedKeystore } from './androidKeystore';
import { listRepoSecretNames, putRepoSecrets, ghErrorStatus, ghRateLimitRemaining } from './githubSecrets';
import type { GhHeaders } from './githubRepoWrite';
import {
  ANDROID_SIGNING_SECRETS, missingSigningSecrets,
  signingLookupReason, signingLookupNote, type SigningLookupReason,
} from '../../lib/signingReadiness';

export type EnsureSigningState =
  /** There was no key and we made one. `key` is the ONLY time it exists outside the repository. */
  | 'created'
  /** All four were already there. Never touched — a published app is tied to its upload key. */
  | 'present'
  /** SOME were there. Deliberately not completed: see the note on `ensureUploadKeystore`. */
  | 'partial'
  /** We could not read or could not write. Honest, and never confused with "there is no key". */
  | 'blocked';

export interface EnsureSigningResult {
  state: EnsureSigningState;
  /** Which of the four are on the repository (after this call). */
  present: readonly string[];
  /** Set only on `created` — the caller decides whether to hand it to the user. */
  key?: GeneratedKeystore;
  /** Set only on `blocked`. */
  reason?: SigningLookupReason;
  /** Set only on `blocked` — plain words, no token, no secret, no value. */
  note?: string;
}

/**
 * Make sure the repository can sign a Play bundle, creating the upload key if it has none.
 *
 * 🔴 IT WILL NEVER REPLACE AN EXISTING KEY. A user who has published once is tied to that upload key;
 * replacing it silently makes their next update unpublishable, and no amount of convenience is worth
 * that. Any of the four present ⇒ we stop and report what is there.
 *
 * ⚠️ AND A PARTIAL KEY IS NOT COMPLETED EITHER, which looks unhelpful and is not. The four values are
 * one key: a fresh keystore beside somebody's existing password produces "Cannot recover key" at build
 * time — a failure that reads like a broken builder rather than a mismatch. The honest move is to name
 * what is there and let a human decide.
 *
 * 🔒 NavBharatAI KEEPS NO COPY. The key is sealed into the user's own repository; nothing here writes
 * it to the vault, to Firestore or to a log. Losing it is recoverable — Play resets an UPLOAD key.
 */
export async function ensureUploadKeystore(
  headers: GhHeaders,
  owner: string,
  repo: string,
  appName: string,
): Promise<EnsureSigningResult> {
  let existing: string[];
  try {
    existing = await listRepoSecretNames(headers, owner, repo);
  } catch (err) {
    // We could not read the repository, so we must not write to it: creating a key beside one we
    // simply failed to see is the single outcome this function exists to prevent.
    const reason = signingLookupReason(ghErrorStatus(err), ghRateLimitRemaining(err));
    return { state: 'blocked', present: [], reason, note: signingLookupNote(reason) };
  }

  const have = new Set(existing.map((n) => String(n ?? '').trim().toUpperCase()));
  const present = ANDROID_SIGNING_SECRETS.filter((n) => have.has(n));
  if (present.length === ANDROID_SIGNING_SECRETS.length) return { state: 'present', present };
  if (present.length > 0) return { state: 'partial', present };

  const key = generateUploadKeystore(appName);
  const outcome = await putRepoSecrets(headers, owner, repo, [
    ['ANDROID_KEYSTORE_BASE64', key.base64],
    ['ANDROID_KEYSTORE_PASSWORD', key.storePassword],
    ['ANDROID_KEY_ALIAS', key.keyAlias],
    ['ANDROID_KEY_PASSWORD', key.keyPassword],
  ]);
  if (outcome.failedAt) {
    // A repository left holding two of four is the `partial` case above, and the caller is told which
    // landed rather than the user discovering it at build time.
    return {
      state: 'blocked',
      present: outcome.written,
      reason: 'unavailable',
      note: outcome.error || 'The signing key could not be saved to your repository.',
    };
  }
  return { state: 'created', present: [...ANDROID_SIGNING_SECRETS], key };
}

/**
 * Should the SERVER refuse to dispatch this build? Pure, so the decision is testable without GitHub.
 *
 * ⚠️ `null` names (we could not look) returns `false` — never block on our own blindness. That rule is
 * `signingVerdict`'s and is deliberately not restated as a second rule here; `missingSigningSecrets`
 * treats a null list as "all four missing", which is right for a MESSAGE and wrong for a REFUSAL, so
 * the null case is answered before it is consulted.
 */
export function shouldRefuseUnsignedDispatch(names: readonly string[] | null | undefined): boolean {
  if (names == null) return false;
  return missingSigningSecrets(names).length > 0;
}
