// Fetching a finished mobile build out of GitHub Actions — ONE implementation, two callers.
//
// WHY THIS FILE EXISTS. `/api/mobile-ship/download` already does this: pull the artifact zip from the
// GitHub API, unwrap it, and pick the real .aab/.apk/.ipa out of it. The Nav App Store's
// "Publish from the build" needs the exact same bytes. Copying the logic is how this repo has been
// bitten before — four drifted copies of one path helper, and retired model ids duplicated across five
// files — so the second caller triggers extraction, not a copy-paste.
//
// The invariant worth stating: a GitHub artifact is ALWAYS a zip, even for a single file. Serving that
// zip to a non-technical user (or handing it to the store's APK inspector) fails in a confusing way,
// so unwrapping is not a nicety — it is what makes the bytes usable at all.
//
// Pure-ish and dependency-injected: the HTTP getter is a parameter, so every branch is unit-testable
// without a network and without a GitHub token.

/** A GitHub artifact id is numeric — never interpolate a caller-supplied string into an API path. */
export function isValidArtifactId(id: unknown): boolean {
  return (typeof id === 'string' || typeof id === 'number') && /^\d{1,20}$/.test(String(id));
}

/** Owner/repo must look like real GitHub names — same reason: these land inside a URL path. */
export function isValidRepoRef(owner: unknown, repo: unknown): boolean {
  const ok = (v: unknown): boolean => typeof v === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(v);
  return ok(owner) && ok(repo);
}

/**
 * Pick the real binary out of an artifact zip.
 *
 * Order matters: `.aab` first because a Play-Store submission wants the bundle, then `.apk` for direct
 * install, then `.ipa` for iOS. `__MACOSX/` entries are the resource-fork junk a macOS runner can add —
 * they carry matching extensions and would otherwise be picked in place of the real file.
 *
 * Returns null when the zip holds nothing app-shaped so the caller fails honestly rather than handing
 * back an archive nobody can install.
 */
export function pickBinaryName(names: string[]): string | null {
  for (const ext of ['.aab', '.apk', '.ipa']) {
    const hit = names.find((n) => n.toLowerCase().endsWith(ext) && !n.startsWith('__MACOSX/'));
    if (hit) return hit;
  }
  return null;
}

export type ArtifactFailure =
  | 'bad-request'   // caller supplied an unusable owner/repo/artifactId
  | 'expired'       // GitHub 404s — artifacts are deleted after 14 days
  | 'not-app'       // the zip contained nothing installable
  | 'fetch-failed'; // anything else from GitHub

export interface ArtifactResult {
  ok: true;
  /** The real binary bytes, already unwrapped from the zip. */
  bytes: Buffer;
  /** The file name as it should reach the user, e.g. `app-release.aab`. */
  fileName: string;
}

export interface ArtifactError {
  ok: false;
  failure: ArtifactFailure;
  /** Written for the USER, saying what to do next — not a raw HTTP error. */
  message: string;
}

/** The one HTTP call this needs, injected so tests need no network. Returns the raw zip bytes. */
export type ArtifactFetcher = (url: string, token: string) => Promise<{ status: number; data: ArrayBuffer }>;

/**
 * Fetch one finished build and return the installable binary inside it.
 *
 * A 404 is reported as EXPIRED rather than "not found", because that is what it almost always means in
 * practice: GitHub keeps Actions artifacts for 14 days, so a user returning to an older build hits this
 * constantly. Telling them "run the build again" is actionable; "404" is not.
 */
export async function fetchBuildArtifact(
  input: { owner: string; repo: string; artifactId: string; token: string },
  fetcher: ArtifactFetcher,
  loadZip: (buf: Buffer) => Promise<{ files: Record<string, { async: (t: 'nodebuffer') => Promise<Buffer> }> }>,
): Promise<ArtifactResult | ArtifactError> {
  if (!isValidRepoRef(input.owner, input.repo)) {
    return { ok: false, failure: 'bad-request', message: 'A valid GitHub owner and repository name are required.' };
  }
  if (!isValidArtifactId(input.artifactId)) {
    return { ok: false, failure: 'bad-request', message: 'A valid file id is required.' };
  }
  if (!input.token) {
    return { ok: false, failure: 'bad-request', message: 'Connect GitHub first — no access token was sent.' };
  }

  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/actions/artifacts/${input.artifactId}/zip`;
  let raw: ArrayBuffer;
  try {
    const res = await fetcher(url, input.token);
    if (res.status === 404) {
      return { ok: false, failure: 'expired',
        message: 'That file has expired on GitHub (builds are kept for 14 days). Run the build again.' };
    }
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, failure: 'fetch-failed', message: 'Could not download the app from GitHub.' };
    }
    raw = res.data;
  } catch (e) {
    // axios throws on a 404, so the status has to be recovered from the error too — otherwise the most
    // common real case (an expired artifact) would surface as a generic failure.
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      return { ok: false, failure: 'expired',
        message: 'That file has expired on GitHub (builds are kept for 14 days). Run the build again.' };
    }
    return { ok: false, failure: 'fetch-failed', message: 'Could not download the app from GitHub.' };
  }

  try {
    const zip = await loadZip(Buffer.from(raw));
    const name = pickBinaryName(Object.keys(zip.files));
    if (!name) {
      return { ok: false, failure: 'not-app', message: 'That build did not contain an installable app file.' };
    }
    const bytes = await zip.files[name].async('nodebuffer');
    return { ok: true, bytes, fileName: name.split('/').pop() || name };
  } catch {
    return { ok: false, failure: 'fetch-failed', message: 'Could not read the app file from that build.' };
  }
}
