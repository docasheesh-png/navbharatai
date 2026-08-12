// Telling the user, in the same message that says their app is ready, what it does NOT do.
//
// THE GAP (dukaan report). The user wrote "upar search box ho". No search was built. The readiness
// scan CONFIRMED the absence and recorded it — as a WARNING, which by design does not block a build.
// So the build succeeded, and the message the user actually read was the model's own summary of
// everything it had made. The one fact they needed was in a build-health card beside it.
//
// Not blocking is right: refusing to ship a working app over one missing surface would be worse, and
// the finding is high-precision, not infallible. But "do not block" was quietly implemented as "do not
// mention", and those are different decisions. A user who is told their app is ready, and later finds
// the search box they asked for is missing, has been misled by omission — the second and third
// absolute rules apply to what we SAY as much as to what we build.
//
// So: ship it, and say what is missing. That turns a silent skip into something the user can act on
// with one sentence, which is also the cheapest possible fix for it.
//
// Deliberately only CONFIRMED absences reach this text. An unconfirmed "not found" is a name-only
// guess that has produced real false positives (Registration.tsx, an admin/ folder), and telling a
// user their app lacks something it actually has is worse than saying nothing at all.
//
// Pure — no I/O. The caller passes the readiness warnings it already has.

/** The exact label the readiness scan uses for a CONFIRMED absence. Kept in one place. */
export const CONFIRMED_MISSING_PREFIX = 'Requested feature NOT BUILT:';

/**
 * The feature names the scan confirmed were not built, read out of the readiness warnings.
 *
 * Reading the warnings the runner already holds avoids threading a second channel up from the
 * dispatcher — and it means the notice can never disagree with the readiness card next to it.
 */
export function confirmedMissingFeatures(warnings: readonly string[] | undefined): string[] {
  return (Array.isArray(warnings) ? warnings : [])
    .map((w) => String(w ?? ''))
    .filter((w) => w.includes(CONFIRMED_MISSING_PREFIX))
    .map((w) => w.slice(w.indexOf(CONFIRMED_MISSING_PREFIX) + CONFIRMED_MISSING_PREFIX.length).trim())
    .filter(Boolean);
}

const list = (items: readonly string[]): string =>
  items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * The line appended to a SUCCESSFUL build's summary. '' when nothing was confirmed missing, so a
 * complete build reads exactly as it does today.
 *
 * Written to be acted on rather than worried about: it names the feature in the user's own terms, says
 * plainly that the rest works, and tells them the one thing that gets it added. No apology and no
 * hedging — a user who reads "something may be missing" learns nothing and trusts the product less.
 */
export function missingFeatureNotice(warnings: readonly string[] | undefined): string {
  const missing = confirmedMissingFeatures(warnings);
  if (!missing.length) return '';
  const one = missing.length === 1;
  return (
    `\n\n⚠️ One thing you asked for isn't in the app yet: **${list(missing)}**. `
    + `Everything else is built and working — just reply "add ${one ? 'it' : 'them'}" and I'll put ${one ? 'it' : 'them'} in.`
  );
}
