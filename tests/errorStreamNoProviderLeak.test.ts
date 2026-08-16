/**
 * A CRASHING BUILD MUST NOT TELL THE USER WHICH AI WE RUN.
 *
 * ADMIN QUESTION 2026-08-16: "koi bhi F12 press kar ke dekh sakta hai ham background me kaun sa AI use
 * kar rahe hai, kaha api call ho rahi hai — kya isko chupa sakte hai?"
 *
 * The NETWORK tab was already safe by architecture: every AI call happens server-side, so the browser
 * only ever talks to navbharatai.com and never to any vendor. But auditing the question found two real
 * leaks on the ERROR path, and both walked around a guard that already existed:
 *
 *   1. The crash handler attached the RAW build-diagnostics report to the client `error` event. That is
 *      the ADMIN-ONLY forensic document — it carries "Provider GLM failed", `deliveredVia`, model ids
 *      and our internal cost/markup. `GET /api/agentv3/diagnostics` gates it carefully
 *      (`showProviderDetail`, failing CLOSED); the stream handed it over with no gate at all.
 *   2. Both `error` emits sent the RAW thrown message, which on a provider failure is the vendor's own
 *      wording ("429 …", "anthropic: rate_limit_error").
 *
 * 🔒 CLAUDE.md's white-label law names error bodies specifically — "a regression test asserts that
 * user-facing streams (narration, done summaries, billing payloads, ERROR BODIES) contain none of the
 * forbidden vendor/model tokens" — and error bodies were the one surface never covered. This is that
 * test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { redactProvidersText } from '../src/server/lib/providerRedaction';
import { userFacingReport } from '../src/server/AgentV3/BuildDiagnostics';

const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

/** The names a user must never read. Model ids and vendors alike. */
const FORBIDDEN = [
  'anthropic', 'claude', 'sonnet', 'opus', 'haiku',
  'openai', 'gpt', 'gemini', 'vertex', 'google ai',
  'glm', 'z.ai', 'bigmodel', 'kimi', 'moonshot',
  'grok', 'xai', 'bedrock', 'deepseek',
];

const leaks = (text: string): string[] =>
  FORBIDDEN.filter((name) => text.toLowerCase().includes(name));

describe('🔒 real provider errors are scrubbed before they reach a browser', () => {
  it('the vendor wordings a failing build actually produces', () => {
    for (const raw of [
      // 🔒 BARE HOSTS — the likeliest crash text of all, and the gap this audit actually found.
      '429 Too Many Requests from open.bigmodel.cn',
      'getaddrinfo ENOTFOUND api.moonshot.cn',
      'ECONNREFUSED api.anthropic.com:443',
      'bedrock-runtime.us-east-1.amazonaws.com timed out',
      'anthropic: rate_limit_error — claude-sonnet-4-6 is overloaded',
      'Provider GLM failed (glm-5.2), falling back to kimi-k2.7-code',
      'Error calling api.moonshot.cn: ECONNRESET',
      'gemini-2.5-pro returned 503 from generativelanguage.googleapis.com',
      'xAI grok-4 timed out after 60s',
    ]) {
      expect(leaks(redactProvidersText(raw)), raw).toEqual([]);
    }
  });

  it('🔒 …and the message still says something useful, never an empty string', () => {
    const out = redactProvidersText('anthropic: rate_limit_error — claude is overloaded');
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it('🔒 the user’s OWN preview link is NOT redacted away — they must be able to open it', () => {
    // e2b.app is deliberately absent from the host list: it is the user's live app, not a vendor
    // identity. The infra vendor's NAME is degraded separately.
    expect(redactProvidersText('Your app is live at 3000-abc.e2b.app')).toContain('e2b.app');
  });

  it('an ordinary error with no vendor in it survives intact', () => {
    const plain = 'The build ran out of time before the app was finished.';
    expect(redactProvidersText(plain)).toBe(plain);
  });
});

describe('🔒 the crash report handed to the client is the anonymized one', () => {
  it('userFacingReport strips vendor names out of a realistic crash report', () => {
    const raw = {
      buildId: 'b1', workspaceId: 'w1', prompt: 'build me an app',
      startedAt: 1, endedAt: 2, ok: false,
      summary: 'Provider GLM failed, retried on kimi-k2.7-code, then claude-sonnet-4-6 finished it.',
      rootCause: 'anthropic rate_limit_error',
      issues: [
        { ts: 1, phase: 'provider', severity: 'error', code: 'PROVIDER_FALLBACK',
          message: 'Provider GLM failed (429 from open.bigmodel.cn) — falling back to Kimi',
          detail: 'model=glm-5.2 → kimi-k2.7-code', autoResolved: true },
      ],
      problems: [
        { ts: 1, phase: 'provider', severity: 'error', code: 'PROVIDER_FALLBACK',
          message: 'ECONNREFUSED api.anthropic.com:443', autoResolved: false },
      ],
      counts: { total: 1, errors: 1, warnings: 0, autoResolved: 1, unresolved: 0 },
    } as never;
    const safe = userFacingReport(raw);
    expect(leaks(JSON.stringify(safe))).toEqual([]);
  });
});

describe('🔒 the route sends the safe versions — pinned against the source', () => {
  // Nothing FAILS if a refactor drops these calls: the build still crashes, the user still sees an
  // error card, and the vendor name simply reappears inside it. So the wiring itself is the assertion.
  it('the crash report is passed through userFacingReport before being emitted', () => {
    expect(route).toContain('crashReportForClient = userFacingReport(crashReport)');
  });

  it('every client-bound error message is redacted', () => {
    const emits = route.match(/(?:emit|send|sendLine)\(\{\s*type: 'error'[^}]*\}/g) ?? [];
    expect(emits.length, 'no error emits found — has the shape changed?').toBeGreaterThan(0);
    for (const e of emits) {
      // Either the message is redacted, or it is a fixed string we wrote ourselves (no vendor in it).
      const ok = e.includes('redactProvidersText') || leaks(e).length === 0;
      expect(ok, `unredacted error emit: ${e.slice(0, 160)}`).toBe(true);
    }
  });

  it('🔒 the raw report is STILL recorded for the admin — this must not blind our own diagnostics', () => {
    // The point is to anonymize the USER's copy, not to lose the forensic one. The admin-side record
    // keeps the verbatim message and the full report; the gated endpoint serves it with detail.
    expect(route).toContain("code: 'BUILD_EXCEPTION', message: errMsg");
    expect(route).toContain('saveDiagnostics(workspaceId, crashReport)');
  });
});
