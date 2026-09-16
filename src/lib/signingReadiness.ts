// IS THE USER'S ANDROID SIGNING KEY ACTUALLY SET UP? — asked BEFORE the build, not after it fails.
//
// ADMIN 2026-09-15, after reading a real failure report: a user pressed "Google Play bundle", the run
// died in about a minute with `Missing signing secret(s): …`, and that was the FIRST they heard of it.
// Nothing was broken — the workflow's pre-flight did exactly what it should, and refusing to hand back
// an unsigned bundle is correct (Play rejects one anyway). What was wrong is that the press could never
// have succeeded, and only GitHub knew that.
//
// THE ASYMMETRY THAT DECIDES THE DEFAULT: telling a user their key is missing when it is present costs
// them one press. Letting them start a build that CANNOT succeed costs a run, several minutes, and the
// belief that the app builder is broken. So this blocks only on a verdict it actually has — an
// UNKNOWN answer (GitHub unreachable, the token cannot list secrets, an unexpected shape) never blocks,
// because our own inability to check is not evidence about the user's repository.
//
// WHY THE NAMES ONLY, AND WHY THAT IS ENOUGH: GitHub's API lists a repository's secret NAMES and never
// their values — by design, and it is the whole reason this check is safe to make. A name that is
// present but holds a wrong value still fails at build time, and `mobileBuildRepair` already classifies
// that separately ("the password or alias does not match the key"). This answers one question only:
// has the user put their key here at all?
//
// PURE — no I/O, no clock. The route fetches; this decides.

/**
 * The four repository secrets `android-aab.yml` requires, exactly as the generated workflow spells
 * them. ⚠️ `tests/signingReadiness.test.ts` asserts this list against the workflow the ship kit really
 * generates, so a rename in one place fails CI instead of quietly making this check ask about secrets
 * nobody needs.
 */
export const ANDROID_SIGNING_SECRETS = [
  'ANDROID_KEYSTORE_BASE64',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
] as const;

export type SigningVerdict = 'ready' | 'missing' | 'unknown';

/** Which required secrets are NOT on the repository. Case-insensitive: GitHub upper-cases names. */
export function missingSigningSecrets(names: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(names)) return [...ANDROID_SIGNING_SECRETS];
  const have = new Set(names.map((n) => String(n ?? '').trim().toUpperCase()).filter(Boolean));
  return ANDROID_SIGNING_SECRETS.filter((s) => !have.has(s));
}

/**
 * The verdict for a repository whose secret names we either read or could not read.
 *
 * `null` means "we could not look" and yields `unknown` — deliberately NOT `missing`. A failed lookup
 * that blocked the build would turn one GitHub hiccup into "you cannot ship", which is a worse failure
 * than the one this whole module exists to prevent.
 */
export function signingVerdict(names: readonly string[] | null | undefined): SigningVerdict {
  if (names == null) return 'unknown';
  return missingSigningSecrets(names).length === 0 ? 'ready' : 'missing';
}

/**
 * What the user is told when the key is not there. Names the alternative that works RIGHT NOW, because
 * a message that only says "no" leaves someone who wanted to try their app with nothing to press.
 */
export function signingNotReadyMessage(missing: readonly string[]): string {
  const all = missing.length >= ANDROID_SIGNING_SECRETS.length;
  return all
    ? 'A Play Store bundle has to be signed with your own signing key, and this repository does not have one yet. '
      + 'Build the installable .apk instead — it needs nothing set up and installs straight onto your phone — '
      + 'and set up your signing key when you are ready to publish.'
    : `Your signing key is only partly set up — ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} still missing. `
      + 'All four have to be present before a Play Store bundle can be signed. The installable .apk needs none of them.';
}
