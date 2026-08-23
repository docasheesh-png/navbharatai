// AgentV3 — DOES THIS APP ACTUALLY BUILD? Ask before the user finds out at Publish.
//
// THE HOLE THIS FILLS WAS ALREADY DESIGNED, AND LEFT EMPTY. `BuildOutcome.ts` declares
// `prodBuildOk?: boolean | null` with the comment "tsc clean but `npm run build` broke" — and nothing
// in the codebase has ever set it. Every gate we run answers a different question: `tsc --noEmit`
// type-checks, the preview proves the DEV server renders, the vaccine runs the app's tests. **Nobody
// runs the command that Publish, the APK workflow and every deploy provider depend on.**
//
// WHAT THAT COST, MEASURED (admin report 2026-08-23, "Make an VPN App"): the vite-react scaffold's
// package.json ran `tsc -p tsconfig.build.json && vite build` while the provider never wrote that
// file, so `npm run build` had failed with TS5058 on EVERY app that provider ever made. The dev server
// never runs the build script, so it was invisible in every preview — and surfaced only at the one
// moment it mattered, mid-build, where a repair pass "fixed" it by copying a different config and
// produced 96,610 characters of fresh type errors on an app that had been rendering a minute earlier.
// The scaffold bug is fixed (#2592). The BLIND SPOT that let it survive unnoticed is this.
//
// SO THIS IS A DETECTOR, DELIBERATELY NOT A GATE. It runs AFTER the app is delivered and green, it can
// never block or fail a build, and it does NOT feed `classifyBuildOutcome` — a green, rendering app
// whose production build is broken is not a failed build, it is a working app with a shipping problem,
// and calling it BUILD_FAILED would both lie to the user and change what they are charged. It says the
// true thing instead: your app runs, and here is what will stop you publishing it.
//
// COST, honestly: one `npm run build` per successful build — roughly 10-25s of sandbox time, about
// $0.006 at the measured rate. Against a class of defect that silently breaks Publish and the APK for
// every app a provider makes, that is not a close call. Kill switch: AGENTV3_PROD_BUILD_GATE=off.
//
// PURE — no I/O, no clock. The caller runs the command and passes the result in.

/** Kill switch. Default ON. */
export function prodBuildGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_PROD_BUILD_GATE !== 'off';
}

/** A production build is bounded; a hung bundler must never eat the advisory window. */
export const PROD_BUILD_TIMEOUT_MS = 180_000;

/**
 * The project's real build script, or null when there is nothing worth running.
 *
 * Null for a missing script and for the placeholder ones a scaffold or a generator leaves behind — an
 * `echo` or an `exit 0` "passes" without building anything, and reporting that as proof the app ships
 * would be precisely the fake-success this file exists to prevent.
 */
export function buildScriptFrom(packageJsonRaw: string | null | undefined): string | null {
  if (!packageJsonRaw) return null;
  try {
    const pkg = JSON.parse(String(packageJsonRaw));
    const script = pkg?.scripts?.build;
    if (typeof script !== 'string') return null;
    const t = script.trim();
    if (!t) return null;
    // The bare colon is the shell no-op and needs its own test: it is not a word character, so a
    // trailing word boundary would require one to follow — and a build script of exactly ":" has
    // nothing following it.
    if (t === ':' || /^(echo|true|exit\s+0)\b/i.test(t)) return null; // a placeholder proves nothing
    if (/\bno\s+build\b/i.test(t)) return null;
    return t;
  } catch {
    return null; // unparseable package.json — the build would fail for a different reason
  }
}

/** The command to run. `2>&1` because bundlers put the useful part on stderr. */
export function prodBuildCommand(): string {
  return 'npm run build 2>&1 | tail -120';
}

export interface ProdBuildResult {
  ok: boolean;
  /** Null when the command could not be run at all (no sandbox, timeout) — different from failing. */
  ran: boolean;
  /** Diagnostics code + message, ready to record. */
  code: 'PROD_BUILD_OK' | 'PROD_BUILD_FAILED' | 'PROD_BUILD_UNVERIFIED';
  message: string;
}

/**
 * The lines worth showing out of a failed build's output.
 *
 * A bundler prints a great deal that is not the error. This keeps the lines that name a real failure
 * and drops the noise, so the diagnostics record carries the CAUSE rather than the last 120 lines of
 * progress output. Capped, because a report nobody can read is a report nobody reads.
 */
export function summarizeProdBuildFailure(output: string | null | undefined): string {
  const lines = String(output ?? '').split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const interesting = lines.filter((l) => /error|ERR!|cannot find|not found|failed|ENOENT|TS\d{4}|SyntaxError|Unexpected/i.test(l));
  const picked = (interesting.length ? interesting : lines).slice(0, 12);
  const text = picked.join('\n');
  return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
}

/**
 * Turn a run into an honest finding.
 *
 * Three outcomes, not two. "Could not run" is NOT "failed": a sandbox that has gone away or a bundler
 * that outran its timeout tells us nothing about the app, and recording it as a defect of the user's
 * code is the exact class of false verdict this codebase keeps removing.
 */
export function judgeProdBuild(input: {
  ran: boolean;
  exitCode: number | null;
  output: string | null | undefined;
}): ProdBuildResult {
  if (!input?.ran || typeof input.exitCode !== 'number') {
    return {
      ok: false, ran: false, code: 'PROD_BUILD_UNVERIFIED',
      message: 'The production build could not be run, so whether this app packages cleanly is unknown. This is not a fault in your app.',
    };
  }
  if (input.exitCode === 0) {
    return {
      ok: true, ran: true, code: 'PROD_BUILD_OK',
      message: 'The production build succeeded — this app is ready to publish and to package.',
    };
  }
  const detail = summarizeProdBuildFailure(input.output);
  return {
    ok: false, ran: true, code: 'PROD_BUILD_FAILED',
    message: `The app runs, but its PRODUCTION build fails (exit ${input.exitCode}) — Publish and the APK both use it, so they would fail too:\n${detail}`,
  };
}

/**
 * The one line the user sees, or null when there is nothing they need to know.
 *
 * Only on a genuine failure. A user whose app works does not need to be told that a check they never
 * heard of passed, and telling them a check could not run would be noise about our own infrastructure.
 * Names no vendor and no internal tool — "packaging" is the thing they actually care about.
 */
export function prodBuildUserNote(r: ProdBuildResult): string | null {
  if (r.ok || !r.ran) return null;
  return '⚠️ Your app is running fine, but its production packaging currently fails — that is the step Publish and the Android build use. Say "fix the production build" and I will sort it out.';
}
