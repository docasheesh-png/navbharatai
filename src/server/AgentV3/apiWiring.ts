// HOW DOES THIS FRONTEND FIND ITS API — and does splitting it off actually make sense?
//
// Slice 3 of "welcome any app, in any format" (admin 2026-08-23).
//
// 🔒 THE NON-OBVIOUS CONCLUSION, AND THE REASON THIS MODULE EXISTS. The plan for fullstack was to
// SPLIT: frontend to the CDN, API to a Node host. That is the textbook answer and it is often wrong,
// because it quietly assumes the frontend can be TOLD where its API went. Most fullstack apps are not
// written that way. They call `fetch('/api/orders')` — a RELATIVE path that works precisely because
// one server serves both halves. Put that frontend on a CDN and every call goes to
// `https://theirsite.com/api/orders`, which the CDN has never heard of. The app builds, deploys,
// looks fine, and every button silently fails — a worse outcome than not splitting at all, and much
// harder to diagnose than a page that plainly does not load.
//
// Firebase Hosting cannot rescue this: its rewrites target Cloud Functions, Cloud Run or a local path
// — never an arbitrary external URL — so there is no proxy to hide the seam behind.
//
// So the right question is not "how do we split this?" but "SHOULD we?", and the answer is in the
// code the user already wrote:
//
//   • the app reads an API base from an env var  → it was BUILT to be split. Inject the backend URL
//     at build time and the split is genuinely free.
//   • the app uses relative /api paths           → do NOT split. Ship it WHOLE to the Node host,
//     which already serves both halves correctly. This is not a lesser fallback; for this app it is
//     the correct deployment, and it is what the author implicitly designed for.
//   • the app hardcodes localhost                → it cannot work anywhere yet. Say which file, so
//     the fix is a minute's work rather than a hunt.
//
// Choosing "ship it whole" for the middle case is the part competitors' one-size pipelines get wrong.
// PURE: files in, verdict out. No network, no env.

export type ApiWiring = 'env' | 'relative' | 'localhost' | 'none';

export type DeployStrategy = 'split' | 'whole' | 'fix-first';

export interface ApiWiringReport {
  wiring: ApiWiring;
  /** What to actually do with this app. */
  strategy: DeployStrategy;
  /** The env var the frontend reads for its API base, when it reads one (e.g. VITE_API_URL). */
  envVar: string;
  /** A file that shows the problem, for `localhost` — so a fix is not a search. */
  evidenceFile: string;
  /** One plain sentence for a non-technical user. */
  summary: string;
}

/** Only files that can contain frontend network calls. */
const CODE = /\.(t|j)sx?$/;
/** A build-time env base the bundler will inline — Vite, CRA and Next in that order of likelihood. */
const ENV_BASE = /\b(?:import\.meta\.env|process\.env)\.((?:VITE|REACT_APP|NEXT_PUBLIC)_[A-Z0-9_]*(?:API|BACKEND|SERVER)[A-Z0-9_]*)\b/;
/** `fetch('/api/…')` or axios with a root-relative path — the pattern that breaks when split. */
const RELATIVE_CALL = /(?:fetch|axios(?:\.\w+)?)\s*\(\s*[`'"]\/(?:api|graphql)\b/;
/** A hardcoded dev address, which works on the author's machine and nowhere else. */
const LOCALHOST_CALL = /[`'"]https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/;

/**
 * Decide how this app should be deployed, from how its frontend addresses its API. PURE.
 *
 * 🔒 ORDER IS THE DESIGN. An env base is checked FIRST and wins outright, because an app that reads
 * one was written to be split — even if it also contains a relative call or a stale localhost string
 * in a comment or a dev-only fallback. Checking `localhost` first would condemn a perfectly
 * splittable app over a line that never runs in production.
 *
 * 🔒 AND THE DEFAULT IS "WHOLE", NOT "SPLIT". When we cannot tell, shipping the app in one piece to a
 * host that runs servers is the choice that WORKS — the same app the user already runs locally. A
 * wrong guess toward `split` produces a site whose every button fails silently; a wrong guess toward
 * `whole` costs some CDN speed the user never knew they could have. Only one of those is a bug.
 */
export function analyzeApiWiring(files: Record<string, string>): ApiWiringReport {
  const whole = (summary: string, over: Partial<ApiWiringReport> = {}): ApiWiringReport => ({
    wiring: 'none', strategy: 'whole', envVar: '', evidenceFile: '', summary, ...over,
  });
  if (!files || typeof files !== 'object') {
    return whole('Your app will be deployed in one piece, exactly as it runs now.');
  }

  let relativeHit = '';
  let localhostHit = '';
  for (const [path, content] of Object.entries(files)) {
    if (!CODE.test(path) || typeof content !== 'string') continue;
    const env = content.match(ENV_BASE);
    if (env) {
      return {
        wiring: 'env',
        strategy: 'split',
        envVar: env[1],
        evidenceFile: path,
        summary: 'Your app already reads its server address from a setting, so the website and the server '
          + 'can be hosted separately — the website gets the fast global network, and we point it at your server '
          + 'automatically.',
      };
    }
    if (!relativeHit && RELATIVE_CALL.test(content)) relativeHit = path;
    if (!localhostHit && LOCALHOST_CALL.test(content)) localhostHit = path;
  }

  if (relativeHit) {
    return {
      wiring: 'relative',
      strategy: 'whole',
      envVar: '',
      evidenceFile: relativeHit,
      summary: 'Your website and your server talk to each other by sharing one address, so they belong together. '
        + 'We will deploy them as one app — which is exactly how it already works on your screen.',
    };
  }
  if (localhostHit) {
    return {
      wiring: 'localhost',
      strategy: 'fix-first',
      envVar: '',
      evidenceFile: localhostHit,
      summary: `Your app points at a web address that only exists on your own computer (in ${localhostHit}), `
        + 'so it would stop working once it is online. That one address needs changing first.',
    };
  }
  return whole('Your app will be deployed in one piece, exactly as it runs now.');
}

/**
 * The build-time setting that tells a split frontend where its backend went. PURE.
 *
 * Returns an empty object unless the app genuinely reads an env base — we never invent a variable the
 * code does not read, because a setting nothing consumes is indistinguishable from a working one and
 * would turn a broken split into a mysterious one.
 */
export function buildEnvForSplit(report: ApiWiringReport, backendUrl: string): Record<string, string> {
  if (report.strategy !== 'split' || !report.envVar || !backendUrl.trim()) return {};
  return { [report.envVar]: backendUrl.trim().replace(/\/+$/, '') };
}
