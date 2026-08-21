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
//
// ⚠️ THE COMMITTED PATH WAS DEAD IN PRODUCTION UNTIL 2026-08-21, and that is worth spelling out because
// it fails SILENTLY. The runtime Docker stage copies only package.json, node_modules and `dist/` — NOT
// `public/`. So a file committed to `public/.well-known/` is simply absent from the container, the read
// throws, and the route answers 404 while the repo plainly shows the file sitting there. Anyone
// debugging would be looking at a file that exists everywhere except where it is read.
//
// Vite copies `publicDir` into the build output, dotfiles included, so the deployed copy really lives at
// `dist/.well-known/…`. That is now the path tried first, with `public/` kept after it for `npm run dev`,
// where there is no dist. Same file, two homes, and the lookup covers both instead of assuming one.
// Neither present ⇒ null, and the route answers an honest 404 rather than an empty 200. An empty 200
// is worse than a 404 here: Apple would read it as a file whose contents do not match, and the failure
// would look like a mismatch rather than a missing file.
//
// PURE (env + reader injected) so the precedence is unit-testable without touching a filesystem.

/** The exact path Apple fetches. Kept as a constant so the route and the tests cannot drift. */
export const APPLE_DOMAIN_ASSOCIATION_PATH = '/.well-known/apple-developer-domain-association.txt';

/** Where the committed copy lives in the SOURCE tree (used by `npm run dev`, absent from the image). */
export const APPLE_DOMAIN_ASSOCIATION_FILE = 'public/.well-known/apple-developer-domain-association.txt';

/** Where Vite lands that same file in the build output — the ONLY copy that exists in production. */
export const APPLE_DOMAIN_ASSOCIATION_DIST_FILE = 'dist/.well-known/apple-developer-domain-association.txt';

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
  // dist FIRST: in production that is the only copy that exists. Trying `public/` first would work in
  // dev and quietly find nothing in the one environment Apple actually fetches from.
  for (const file of [APPLE_DOMAIN_ASSOCIATION_DIST_FILE, APPLE_DOMAIN_ASSOCIATION_FILE]) {
    try {
      const fromFile = String(readFile(file) || '').trim();
      if (fromFile) return fromFile;
    } catch { /* not present here — the ordinary case for whichever of the two this is */ }
  }
  return null;
}

/**
 * Which SOURCE the file came from — for the admin diagnostic, never for the public route.
 *
 * Separate from `appleDomainAssociation` on purpose: the public route must answer with the file and
 * nothing else, while the person debugging needs to know whether they are looking at the env value or a
 * committed one. Returns null when there is nothing at all.
 */
export function appleDomainAssociationSource(
  env: NodeJS.ProcessEnv,
  readFile: (path: string) => string,
): 'env' | 'dist-file' | 'source-file' | null {
  if (String(env?.APPLE_DOMAIN_ASSOCIATION || '').trim()) return 'env';
  for (const [file, source] of [
    [APPLE_DOMAIN_ASSOCIATION_DIST_FILE, 'dist-file'],
    [APPLE_DOMAIN_ASSOCIATION_FILE, 'source-file'],
  ] as const) {
    try {
      if (String(readFile(file) || '').trim()) return source;
    } catch { /* absent */ }
  }
  return null;
}
