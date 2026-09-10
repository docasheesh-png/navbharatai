// SHOWING THE USER THAT WE ACTUALLY CHECKED — the proof, not just the claim.
//
// WHY (gap analysis 2026-09-10). After a build, NavBharatAI already drives a real browser through the
// app's own forms: it fills them in, submits, RELOADS, and confirms the entry is still there. That
// last step is the only thing separating an app which really saves data from one that merely looks
// like it does, and it is the single most valuable check the platform performs.
//
// The user was never told any of it. The result went into the admin diagnostics report — which the
// user cannot open — while the chat said some version of "your app is ready", indistinguishable from
// what it says when nothing was verified at all. Antigravity's whole pitch is showing the user what
// the agent did; we were doing the harder half and keeping it to ourselves.
//
// 🔒 TWO RULES. (1) NEVER OVERCLAIM: a journey that could not run says so plainly rather than being
// rounded up into a pass, because "we checked" is a promise. (2) The user's words, not ours: no
// finding codes, no "journey", no provider or tool names — a sentence about their app.

import type { JourneyResult } from './journeyDerivation';

export interface JourneyUserSummary {
  /** true only when something was genuinely proven — never when nothing ran. */
  ok: boolean;
  /** The headline the panel shows. Empty ⇒ there is nothing honest to show, so show nothing. */
  headline: string;
  /** One plain line per check performed. */
  steps: string[];
}

function pageName(route: string): string {
  const r = (route || '').trim();
  if (!r || r === '/') return 'the home page';
  return `the ${r} page`;
}

/**
 * Turn the runner's raw verdicts into something the person who asked for the app can read.
 *
 * PURE. Returns an empty headline when nothing ran, so the caller shows nothing rather than an
 * encouraging sentence about work that did not happen.
 */
export function journeyUserSummary(results: readonly JourneyResult[] | null | undefined): JourneyUserSummary {
  const list = Array.isArray(results) ? results : [];
  if (list.length === 0) return { ok: false, headline: '', steps: [] };

  const steps: string[] = [];
  for (const r of list) {
    if (!r || typeof r.route !== 'string') continue;
    if (r.verdict === 'passed') {
      steps.push(r.kind === 'create-persists'
        // The reload is the whole point, so it is the part that gets said out loud.
        ? `Filled in the form on ${pageName(r.route)}, saved it, reloaded — and it was still there.`
        : `Used ${pageName(r.route)} and it responded correctly.`);
    } else if (r.verdict === 'failed') {
      steps.push(`${pageName(r.route)} did not work: ${r.note || 'it failed partway through'}.`);
    } else {
      // 'unreachable' is neither a pass nor a failure — a login wall tells us nothing about the app,
      // and calling it either would be inventing a result.
      steps.push(`Could not reach ${pageName(r.route)} to check it${r.note ? ` — ${r.note}` : ''}.`);
    }
  }
  if (steps.length === 0) return { ok: false, headline: '', steps: [] };

  const failed = list.filter((r) => r?.verdict === 'failed').length;
  const passed = list.filter((r) => r?.verdict === 'passed').length;

  if (failed > 0) {
    return {
      ok: false,
      headline: passed > 0
        ? 'NavBharatAI tested your app and found a problem'
        : 'NavBharatAI tested your app and it did not pass',
      steps,
    };
  }
  if (passed === 0) {
    // Everything was unreachable. Saying "checked and it works" here would be the exact overclaim
    // this module exists to prevent.
    return { ok: false, headline: 'NavBharatAI tried to test your app but could not reach it', steps };
  }
  return {
    ok: true,
    headline: passed === 1 ? 'NavBharatAI tested your app in a real browser' : `NavBharatAI ran ${passed} tests on your app in a real browser`,
    steps,
  };
}
