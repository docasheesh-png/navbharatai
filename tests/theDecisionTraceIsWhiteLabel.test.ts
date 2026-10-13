/**
 * Q-978 — THE DECISION TRACE IS WHITE-LABEL (discovered while root-causing Q-970, autopsy 303e8a6f).
 *
 * THE LEAK. `GET /api/agentv3/decision-trace` is gated to the workspace OWNER, not the admin. The trace it
 * returns records the engine choice in vendor terms — `haiku (GLM)`, `sonnet (claude-sonnet-4-6)` — and a
 * reason such as "analyzer chose sonnet start tier". So any owner who opened the URL learned which
 * third-party models built their app. The White-Label Law forbids that on every surface a normal user can
 * reach; the build-report route closed the same hole long ago (`showProviderDetail`, Fix 68), and this
 * route was its unhunted sibling.
 *
 * THE CLASS. An owner-gated route that returns an engine record without passing it through the admin
 * check first. The fix is the same shape the diagnostics route uses: resolve the VERIFIED email, ask
 * `isReportAdmin`, fail closed, and redact through the one shared scrubber for everyone else.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decisionTraceForViewer, type Decision } from '../src/server/AgentV3/DecisionTraceManager';
import { hasProviderLeak } from '../src/server/lib/providerRedaction';

const AT = '2026-10-12T10:00:00.000Z';
// The shapes the route really records (agentv3.ts, the `decisionTrace.record('model', …)` line).
const TRACE: Decision[] = [
  { stage: 'intent', decision: 'new_build', reason: 'no existing files in workspace', at: AT },
  { stage: 'model', decision: 'gemini (GLM)', reason: "analyzer chose sonnet start tier", at: AT },
  { stage: 'model', decision: 'sonnet (claude-sonnet-4-6)', reason: "pinned tier 'mini' selected", at: AT },
  { stage: 'model', decision: 'haiku (glm-4.7-flashx)', reason: 'analyzer chose haiku start tier', at: AT },
  { stage: 'outcome', decision: 'success', reason: '14 file(s) written in 41000ms', at: AT },
];

describe('Q-978 · a non-admin owner never reads a vendor or model name in the decision trace', () => {
  it('🔴 the raw trace leaks — this is what an owner used to receive', () => {
    expect(hasProviderLeak(JSON.stringify(TRACE))).toBe(true);
  });

  it('🔒 a non-admin viewer gets every field scrubbed', () => {
    const out = decisionTraceForViewer(TRACE, false);
    expect(hasProviderLeak(JSON.stringify(out))).toBe(false);
    expect(out).toHaveLength(TRACE.length);
    // Order, stages, timestamps and non-vendor facts survive — only the names go.
    expect(out.map((d) => d.stage)).toEqual(TRACE.map((d) => d.stage));
    expect(out.map((d) => d.at)).toEqual(TRACE.map((d) => d.at));
    expect(out[0].decision).toBe('new_build');
    expect(out[4].reason).toBe('14 file(s) written in 41000ms');
  });

  it('the admin gets the trace exactly as recorded, as a copy', () => {
    const out = decisionTraceForViewer(TRACE, true);
    expect(out).toEqual(TRACE);
    expect(out[0]).not.toBe(TRACE[0]);
  });

  it('never mutates the stored trace', () => {
    const before = JSON.stringify(TRACE);
    decisionTraceForViewer(TRACE, false);
    expect(JSON.stringify(TRACE)).toBe(before);
  });

  it('🔒 the route decides the viewer from the VERIFIED email and fails closed', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    const start = route.indexOf("app.get('/api/agentv3/decision-trace'");
    expect(start).toBeGreaterThan(0);
    const handler = route.slice(start, route.indexOf('\n  });', start));
    expect(handler).toContain('isReportAdmin(await resolveGrantEmail(verifiedTraceUid ?? \'\').catch(() => null))');
    expect(handler).toContain('res.json({ decisions: decisionTraceForViewer(decisions, showTraceProviders) })');
    // The raw trace is never what the route sends.
    expect(handler).not.toMatch(/res\.json\(\{\s*decisions\s*\}\)/);
  });
});
