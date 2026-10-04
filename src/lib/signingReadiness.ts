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

/**
 * The four repository secrets `ios-ipa.yml` requires, exactly as the generated workflow spells them.
 *
 * 🔴 WHY THIS LIST EXISTS (report SHANKU-AI/instamony run 36792748246, 2026-10-01). Every reader of
 * "is the signing key there?" knew only the ANDROID list, so an iPhone build with none of its Apple
 * keys was dispatched without a check, died in 20 seconds, and was then classified as STALE_WORKFLOW
 * ("the build stopped while installing your app's libraries", "NavBharatAI can fix this itself") —
 * three false statements about a run whose log named all four missing secrets. Each platform now has
 * ONE list here, and `tests/eachPlatformKnowsItsOwnKeys.test.ts` asserts both against the workflows
 * the ship kit really generates.
 */
export const IOS_SIGNING_SECRETS = [
  'IOS_ASC_KEY_ID',
  'IOS_ASC_ISSUER_ID',
  'IOS_ASC_KEY_BASE64',
  'IOS_TEAM_ID',
] as const;

export type SigningPlatform = 'android' | 'ios';

/** The secrets a platform's signed build needs. The one place that answers "which list?". */
export function signingSecretsFor(platform: SigningPlatform): readonly string[] {
  return platform === 'ios' ? IOS_SIGNING_SECRETS : ANDROID_SIGNING_SECRETS;
}

/** Which platform a list of missing secret names belongs to. Android when nothing says otherwise. */
export function signingPlatformOf(missing: readonly string[] | null | undefined): SigningPlatform {
  const ios = new Set<string>(IOS_SIGNING_SECRETS);
  return Array.isArray(missing) && missing.some((m) => ios.has(String(m ?? '').trim().toUpperCase()))
    ? 'ios'
    : 'android';
}

export type SigningVerdict = 'ready' | 'missing' | 'unknown';

/** Which required secrets are NOT on the repository. Case-insensitive: GitHub upper-cases names. */
export function missingSigningSecrets(
  names: readonly string[] | null | undefined,
  required: readonly string[] = ANDROID_SIGNING_SECRETS,
): string[] {
  if (!Array.isArray(names)) return [...required];
  const have = new Set(names.map((n) => String(n ?? '').trim().toUpperCase()).filter(Boolean));
  return required.filter((s) => !have.has(s));
}

/**
 * The verdict for a repository whose secret names we either read or could not read.
 *
 * `null` means "we could not look" and yields `unknown` — deliberately NOT `missing`. A failed lookup
 * that blocked the build would turn one GitHub hiccup into "you cannot ship", which is a worse failure
 * than the one this whole module exists to prevent.
 */
export function signingVerdict(
  names: readonly string[] | null | undefined,
  required: readonly string[] = ANDROID_SIGNING_SECRETS,
): SigningVerdict {
  if (names == null) return 'unknown';
  return missingSigningSecrets(names, required).length === 0 ? 'ready' : 'missing';
}

/**
 * What the user is told when the APPLE keys are not there. Unlike the Android key, NavBharatAI cannot
 * create these: Apple issues them only inside the user's own Apple Developer account, so the sentence
 * says where each one is and never offers a button that would make an Android keystore instead.
 */
export function appleSigningNotReadyMessage(missing: readonly string[]): string {
  const all = missing.length === 0 || missing.length >= IOS_SIGNING_SECRETS.length;
  return (all
    ? 'An iPhone build has to be signed with your own Apple keys, and this repository does not have them yet. '
    : `Your Apple keys are only partly set up — ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} still missing. `)
    + 'Apple issues these only to your own Apple Developer account, so NavBharatAI cannot create them for you. '
    + 'Create an App Store Connect API key (App Store Connect → Users and Access → Integrations), then add '
    + `${all ? IOS_SIGNING_SECRETS.join(', ') : 'the missing ones'} in GitHub → your repository → Settings → Secrets and variables → Actions. `
    + 'SHIPPING.md in your repository says where each value is.';
}

/** The not-ready sentence for whichever platform these missing names belong to. */
export function signingNotReadyMessageFor(platform: SigningPlatform, missing: readonly string[]): string {
  return platform === 'ios' ? appleSigningNotReadyMessage(missing) : signingNotReadyMessage(missing);
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

// ─────────────────────────────────────────────────────────────────────────────
// WHY THE GATE DECLINED TO DECIDE — added 2026-09-19 after a real report.
//
// A user pressed "Google Play bundle" on `12thmentors/app-50-files-2026-09-19`, and the run died in
// TWELVE SECONDS with all four secrets missing. The pre-flight above is exactly the thing that exists
// to stop that press, and it did not stop it — so it must have answered `unknown`, which falls through
// to the build by design (see the comment on `signingVerdict`).
//
// 🔴 AND NOBODY COULD SAY WHY, WHICH IS THE ACTUAL DEFECT. The route swallowed every failure into one
// bare `catch`, so "GitHub refused this token permission to read the secrets" and "GitHub had a bad
// second" produced the identical verdict, no log line, and nothing in the failure report the admin
// reads. That report lists nine steps and the failure, and says not one word about the gate that was
// supposed to prevent it — so an autopsy cannot even tell whether the gate ran. It is the same shape
// as `JOURNEY_NOT_RUN`, whose check had never once launched a browser while reporting a pass.
//
// ⚠️ THIS DELIBERATELY DOES NOT CHANGE ANY VERDICT, AND MUST NOT BE "FINISHED" BY MAKING IT ONE.
// Blocking on a 403 would be the trade this repo forbids: a repository whose secrets were set by
// somebody ELSE (an org where this user has write but not admin) genuinely CAN build, and would be
// refused on our own lack of permission. Measure first — CLAUDE.md's own `POST_GREEN_WRITES` /
// `TIME_TO_FIRST_RENDER` precedent — and build the stronger protection when the measurement produces
// evidence. What this adds is the evidence.

/** Why a secrets lookup produced no verdict. `unavailable` is the honest catch-all. */
export type SigningLookupReason = 'forbidden' | 'not-found' | 'rate-limited' | 'unavailable';

/**
 * Classify a failed secrets lookup from its HTTP status.
 *
 * ⚠️ GitHub answers **403 for a rate limit as well as for a permission denial**, so the status alone
 * cannot separate them — and calling a rate limit "you do not have permission" would send a user to
 * fix an access problem they do not have. `x-ratelimit-remaining: 0` is what distinguishes them, so it
 * is an input here rather than an afterthought. Anything unreadable stays `unavailable`.
 */
export function signingLookupReason(
  status: number | null | undefined,
  rateLimitRemaining?: string | number | null,
): SigningLookupReason {
  const remaining = rateLimitRemaining == null || rateLimitRemaining === ''
    ? null
    : Number(rateLimitRemaining);
  if (status === 429) return 'rate-limited';
  if (status === 403) return remaining === 0 ? 'rate-limited' : 'forbidden';
  if (status === 404) return 'not-found';
  return 'unavailable';
}

/**
 * Is this reason a DURABLE fact about the repository rather than a passing hiccup?
 *
 * It matters beyond the wording: the same repository permission that lists secrets is the one that
 * WRITES them, so a durable reason means the one-press "Create my signing key" offer will fail too —
 * the user is about to be handed a button that cannot work. Retrying is the right advice for the
 * others and the wrong advice for these.
 */
export function signingLookupIsDurable(reason: SigningLookupReason): boolean {
  return reason === 'forbidden' || reason === 'not-found';
}

/** One admin-facing line naming what happened. Never carries a token, a secret or a value. */
export function signingLookupNote(reason: SigningLookupReason): string {
  switch (reason) {
    case 'forbidden':
      return 'GitHub refused this token permission to read the repository\'s Actions secrets — '
        + 'listing (and writing) them needs admin access to that repository.';
    case 'not-found':
      return 'GitHub reported no such repository for this token.';
    case 'rate-limited':
      return 'GitHub rate-limited the request.';
    default:
      return 'The secrets lookup did not complete.';
  }
}

/**
 * Did this build fail for want of the signing secrets (either platform)? Read from the failure's own detail, so
 * it cannot drift from what the classifier actually produced.
 */
export function isSigningSecretFailure(detail: Record<string, string | string[]> | null | undefined): boolean {
  const missing = detail?.['missing'];
  if (!Array.isArray(missing) || missing.length === 0) return false;
  // Both platforms: the gate's report matters as much for an iPhone build as for a Play bundle.
  const known = new Set<string>([...ANDROID_SIGNING_SECRETS, ...IOS_SIGNING_SECRETS]);
  return missing.some((m) => known.has(String(m ?? '').trim().toUpperCase()));
}
