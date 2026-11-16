/**
 * Owner t362u (2026-11-16): a user sees only the TOTAL charged in rupees. Token counts, a USD amount, the
 * USD→INR rate, the full (admin) build report and adminDetail never reach a browser — live SSE, the replay
 * buffer, the cross-device channel, the reopened conversation record or the history list. The server's own
 * billing facts (and admin views) are unchanged.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { userCostBreakdown } from '../src/server/routes/agentv3';
import { userCharge, userConversationView, userFinalState, userResultEvent } from '../src/server/AgentV3/userChargeView';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { rupeeCharge } from '../src/components/agentv3/rupeeCharge';
import { agentV3Reducer } from '../src/components/agentv3/agentV3Reducer';
import { initialAgentV3State } from '../src/components/agentv3/agentV3Types';

const LEAK = /inputTokens|outputTokens|billedUsd|usdInrRate|"tokens"|costBreakdown|adminDetail|"billing"|"model"|providerDelivery/;
const RUPEE_KEYS = new Set(['billedInr', 'tier', 'engine', 'livePreviewSeconds', 'livePreviewInr', 'sandboxFeeInr', 'sandboxFeePct', 'preSandboxSubtotalInr', 'listInr', 'discountInr', 'discountPct']);

const fullReport = () => {
  const d = new BuildDiagnostics({ now: () => 1000 });
  d.record({ phase: 'provider', severity: 'warning', code: 'PROVIDER_FAILED', autoResolved: true, message: 'step failed, next engine answered', adminDetail: 'supplier HTTP 429 at $0.06/M' } as never);
  d.record({ phase: 'build', severity: 'info', code: 'ENGINE_COST_ESTIMATED', autoResolved: true, message: 'priced by estimate' });
  return { ...d.report(), model: 'some-model', billing: { billedUsd: 0.4, usdInrRate: 87 } } as never;
};
const breakdown = () => userCostBreakdown({ inputTokens: 120_000, outputTokens: 30_000 }, 0.4, 'weak', 87.5, { seconds: 120, usd: 0.01 });
const liveResult = () => ({
  type: 'result', ok: true, summary: 'Built', steps: 5, buildId: 'b1', billedUsd: 0.4, billedInr: 35, tokens: 150_000,
  walletTokensDebited: 3500, walletTokenBalance: 900, walletDebitedInr: 35, costBreakdown: breakdown(), diagnostics: fullReport(), adminDetail: 'x',
});

describe('the live result event a browser receives', () => {
  it('carries the ₹ total and a rupee-only charge, nothing about how it was worked out', () => {
    const out = userResultEvent(liveResult()) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(LEAK);
    expect(out.billedInr).toBe(35);
    expect(Object.keys(out.charge as object).every((k) => RUPEE_KEYS.has(k))).toBe(true);
    expect((out.charge as { billedInr: number }).billedInr).toBe(breakdown().billedInr);
    expect(out.walletTokensDebited).toBe(3500); // the wallet unit and balance are unchanged
  });
  it('sends the user build report (no admin billing block, model or adminDetail)', () => {
    const out = userResultEvent(liveResult()) as { diagnostics: { issues: Array<{ code: string }> } };
    expect(out.diagnostics.issues.map((i) => i.code)).toEqual(['PROVIDER_FAILED']);
    expect(JSON.stringify(out.diagnostics)).not.toMatch(/adminDetail|"billing"|some-model|\$0\.06/);
  });
  it('an error event keeps its message, but its report becomes the user copy', () => {
    const out = userResultEvent({ type: 'error', message: 'boom', ts: 1, diagnostics: fullReport(), adminDetail: 'why' }) as Record<string, unknown>;
    expect(out.message).toBe('boom');
    expect(JSON.stringify(out)).not.toMatch(/adminDetail|"billing"|some-model/);
  });
  it('drops an unreadable report instead of passing it through (fail closed), and never throws', () => {
    const out = userResultEvent({ type: 'result', ok: false, summary: 's', steps: 0, billedInr: 0, diagnostics: { billing: { billedUsd: 1 } } }) as Record<string, unknown>;
    expect('diagnostics' in out).toBe(false);
    expect(() => userResultEvent({ type: 'result', costBreakdown: 'nonsense' })).not.toThrow();
  });
  it('leaves every other event exactly as it was (same object)', () => {
    for (const e of [{ type: 'narration', text: 'hi', ts: 1 }, { type: 'file_changed', change: { path: 'a' } }, null, 'x']) expect(userResultEvent(e)).toBe(e);
  });
});

describe('the persisted record as its owner receives it', () => {
  const rec = () => ({
    id: 'c1', userId: 'u', workspaceId: 'w', title: 't', status: 'complete', messages: [], createdAt: 1, updatedAt: 2,
    billedUsd: 0.4, usage: { inputTokens: 120_000, outputTokens: 30_000 },
    finalState: { ok: true, billedUsd: 0.4, billedInr: 35, tokens: 150_000, walletTokensDebited: 3500, buildHealth: { score: 90 }, timelineDropped: 0, report: fullReport() },
  });
  it('shows the ₹ total only; USD, token usage, the admin report and adminDetail stay on the server', () => {
    const out = userConversationView(rec()) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(LEAK);
    expect(out.finalState).toMatchObject({ billedInr: 35, walletTokensDebited: 3500, buildHealth: { score: 90 } });
    expect((out.finalState as { report: { issues: unknown[] } }).report.issues).toHaveLength(1);
  });
  it('does not change the stored record it was given (admin views keep the full detail)', () => {
    const r = rec();
    userConversationView(r);
    expect(r.billedUsd).toBe(0.4);
    expect(r.finalState.tokens).toBe(150_000);
  });
  it('older records without finalState, or with a malformed one, never crash', () => {
    expect(userConversationView({ id: 'old', billedUsd: 1, usage: {} })).toEqual({ id: 'old' });
    expect(userFinalState('x')).toBeUndefined();
    expect(userConversationView(null)).toBeNull();
  });
});

describe('billing math is untouched', () => {
  it('the server-side breakdown still carries its full facts for admin and the debit path', () => {
    const b = breakdown();
    expect(b).toMatchObject({ inputTokens: 120_000, outputTokens: 30_000, billedUsd: 0.4, usdInrRate: 87.5 });
    expect(userCharge(b)?.billedInr).toBe(b.billedInr);
  });
});

describe('the browser', () => {
  it('keeps only rupee facts even when an older server sends tokens, USD and the rate', () => {
    const s = agentV3Reducer(initialAgentV3State(), { ...(liveResult() as never), diagnostics: undefined });
    expect(s.tokens).toBeUndefined();
    expect(s.billedUsd).toBeUndefined();
    expect(Object.keys(s.costBreakdown ?? {}).every((k) => RUPEE_KEYS.has(k))).toBe(true);
    expect(rupeeCharge({ inputTokens: 5 })).toBeUndefined();
  });
  it('the build panel shows no token line, token badge or USD amount', () => {
    const panel = readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8');
    expect(panel).not.toMatch(/costBreakdown\.(inputTokens|outputTokens|billedUsd|usdInrRate)/);
    expect(panel).not.toMatch(/state\.tokens\b/);
    expect(panel).not.toMatch(/state\.billedUsd/);
  });
});

describe('every browser-bound path goes through the user view', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('live broadcast (subscribers, replay buffer, cross-device channel) is the user view; the timeline records the full event first', () => {
    const fn = route.slice(route.indexOf('function broadcastBuild('), route.indexOf('function endBuild('));
    expect(fn).toMatch(/const e = userResultEvent\(eIn\);/);
    expect(fn.indexOf('userResultEvent(eIn)')).toBeLessThan(fn.indexOf('rb.buffer.push(e)'));
    expect(route).toContain('sessionTimeline.record(event); broadcastBuild(rb, event);');
  });
  it('the chat-turn stream, the preflight stream, the conversation GET and the history list', () => {
    expect(route).toContain('res.write(JSON.stringify(userResultEvent(honestResultEvent(e))) +');
    expect(readFileSync('src/server/AgentV3/BuildRequestCoordination.ts', 'utf8')).toContain('res.write(JSON.stringify(userResultEvent(value)) +');
    expect(route).toContain('res.json({ conversation: userConversationView(rec), workspaceState })');
    const list = route.slice(route.indexOf("app.get('/api/agentv3/conversations',"), route.indexOf("app.get('/api/agentv3/conversations/:id',"));
    expect(list).not.toContain('billedUsd: c.billedUsd');
  });
});
