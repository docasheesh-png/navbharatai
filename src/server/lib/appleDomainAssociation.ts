// APPLE DOMAIN VERIFICATION — serve the file Apple looks for (admin 2026-08-21).
//
// WHY THIS EXISTS. Sign in with Apple on the WEB reached Apple's consent screen with the right
// client_id and the right redirect_uri, and then Apple's OWN authorize endpoint answered 403 twice —
// nothing of ours was in that request. That is what Apple does when a Service ID's domain is
// registered but NOT VERIFIED: it accepts the app, shows the sheet, and refuses the authorization.
//
// Apple verifies a domain by fetching a file it gives you:
//     https://<domain>/.well-known/apple-developer-domain-association.txt
// We never served that path. `express.static` would not have helped even if the file were on disk —
// its `dotfiles` default is 'ignore', so a directory beginning with a dot is skipped. Hence an
// explicit route, mounted before the static handler.
//
// TWO SOURCES, in this order, because they suit two different moments:
//   1. `APPLE_DOMAIN_ASSOCIATION` — the admin pastes Apple's file into Cloud Run and it is live on the
//      next revision, with no code change and no waiting for anyone. That is the fast path, and this
//      kind of verification is usually a one-evening job.
//   2. A committed file at public/.well-known/… — the durable path, for when the value should live in
//      the repo like any other deployed asset.
// Neither present ⇒ null, and the route answers an honest 404 rather than an empty 200. An empty 200
// is worse than a 404 here: Apple would read it as a file whose contents do not match, and the failure
// would look like a mismatch rather than a missing file.
//
// PURE (env + reader injected) so the precedence is unit-testable without touching a filesystem.

/** The exact path Apple fetches. Kept as a constant so the route and the tests cannot drift. */
export const APPLE_DOMAIN_ASSOCIATION_PATH = '/.well-known/apple-developer-domain-association.txt';

/** Where the committed copy lives, relative to the repo root. */
export const APPLE_DOMAIN_ASSOCIATION_FILE = 'public/.well-known/apple-developer-domain-association.txt';

/**
 * The association file's contents, or null when neither source has it.
 *
 * `readFile` is injected and may throw — a missing file is the normal case, not an error.
 */
export function appleDomainAssociation(
  env: NodeJS.ProcessEnv,
  readFile: (path: string) => string,
): string | null {
  const fromEnv = String(env?.APPLE_DOMAIN_ASSOCIATION || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = String(readFile(APPLE_DOMAIN_ASSOCIATION_FILE) || '').trim();
    if (fromFile) return fromFile;
  } catch { /* not committed — that is the ordinary case */ }
  return null;
}
