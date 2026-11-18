/**
 * BR1992 — build-report autopsy (docs/build-report-autopsy-BR1992.md). Synthetic fixtures only.
 *
 * F1 · A Surplus call stopped by the build's clock was RECORDED under the request's Claude default on a Weak
 *      build that can never call Claude: the Surplus session's runner (and its pre-write fail-open wrapper)
 *      carried no `TurnRunner.plannedModel`, so AgentRunner fell back to the request model. Records only.
 * F2 · "Almost done… running the final checks" was repeated for minutes while the integrity pass was building
 *      newly sent user requests it had picked up. A pickup STRICTLY after the phase began ends the phase.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: vi.fn(async () => {}), aiMaintenanceStore: { onChange: () => () => {} }, AiMaintenanceError: class extends Error {} }));
import { wrapSurplusRunnerPreWriteFailOpen } from '../src/server/AI/SurplusRegistry/surplusPreWriteFailOpen';
import { createSurplusBuildSession, type SurplusReviewedAdapter, type SurplusReviewedState } from '../src/server/AI/SurplusRegistry/buildSession';
import type { TurnRunner, TurnResult } from '../src/server/AgentV3/ClaudeClient';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { withStopSignal } from '../src/server/AgentV3/stopSignal';
import { finalChecksAfterSteer, etaPhaseLine } from '../src/server/AgentV3/progressEta';
import { createSteeringHandoff } from '../src/server/AgentV3/steeringHandoff';

const CLAUDE_ID = /claude|sonnet|opus/i;
const REQUEST_MODEL = 'claude-sonnet-4-6'; // the request default the defect filed Surplus calls under

// ── a reviewed Surplus state (same synthetic shape as buildSession.test.ts) ────────────────────────────
const now = 1800000000000;
function state(): SurplusReviewedState {
  return {
    snapshot: { version: 'generation', startedAt: now, observedAt: now, expiresAt: now + 300000, models: ['model-a'], offers: [{ model: 'model-a', offerId: 'offer-a', providerId: 'provider-a', available: true, healthy: true, trusted: true, providerTrustConfirmed: true, trustObservedAt: now,
      discountPct: 95, rates: { input: '1', output: '1' }, referenceRates: { input: '100', output: '100' }, unit: 'unverified', observedAt: now, upstreamGeneratedAt: null, sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30, sourceUrl: 'https://www.surplusintelligence.ai/api/markets/model-a' }] },
    reviews: { quality: [{ binding: 'model-provider', model: 'model-a', providerId: 'provider-a', benchmarkId: 'bench', cohort: 'coding', approved: true, artifactSha256: 'a'.repeat(64), reviewedAt: now - 1, expiresAt: now + 300000 }], pricingContract: { unit: 'micro-usd-per-million', sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing', reviewedAt: now - 1, expiresAt: now + 300000 }, accountAndPrivacyReviewedUntil: now + 300000 },
    capabilities: [{ reviewId: 'capability', model: 'model-a', modelVersion: 'reviewed-v1', providerId: 'provider-a', reviewedAt: now - 1, expiresAt: now + 300000, contextTokens: 200000, maxOutputTokens: 8192, tools: true, parallelTools: true, transcriptRoundTrip: true, providerPinVerified: true, returnedIdentityVerified: true, reportedChargeContractVerified: true, endpoint: 'https://api.surplusintelligence.ai/min90/v1' }],
    floorContract: { kind: 'observation-only-provider-request-time-floor', endpoint: 'https://api.surplusintelligence.ai/min90/v1', reviewId: 'floor', reviewedAt: now - 1, expiresAt: now + 300000, providerPin: 'top-level-provider', objective: 'price', marketplaceOnly: true, allowFallbacks: false },
  };
}
function session() {
  const s = state();
  const completion = { model: 'model-a', choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } };
  const adapter: SurplusReviewedAdapter = { readState: vi.fn(async () => s), routing: review => ({ provider: review.providerId, si_route: { objective: 'price' } }), dispatch: vi.fn(async () => completion), identify: raw => ({ model: 'model-a', providerId: 'provider-a', completion: raw as typeof completion }), receipt: vi.fn(async () => { throw new Error('not reached'); }) };
  return { adapter, make: () => createSurplusBuildSession({ buildId: 'build', tier: 'weak', enabled: true, adapter, now: () => now }) };
}

// ── AgentRunner harness (same shape as aBuildIsNamedByItsLadderNotByClaude.test.ts) ────────────────────
class NullActuator implements ActuatorPort {
  async readFile(): Promise<string> { throw new Error('ENOENT'); }
  async writeFile(): Promise<void> { /* nothing */ }
  async listFiles(): Promise<string[]> { return []; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}
type Row = { model: string; ok: boolean };
function runnerOn(client: TurnRunner, rows: Row[], signal?: AbortSignal): AgentRunner {
  const stream = new AgentEventStream();
  const st = new WorkspaceState(stream);
  return new AgentRunner({
    client, dispatcher: new ToolDispatcher(new NullActuator(), 'ws-br1992', st, stream), state: st, events: stream,
    model: REQUEST_MODEL, system: 'You are the Architect.', tools: defaultToolCatalog(),
    ...(signal ? { signal } : {}),
    onLlmCall: ((c: Row) => rows.push({ model: c.model, ok: c.ok })) as never,
  });
}
const answer = (model?: string): TurnResult => ({
  text: 'done', toolUses: [], stopReason: 'end_turn',
  usage: { inputTokens: 5, outputTokens: 3, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  rawContent: [{ type: 'text', text: 'done' }], ...(model ? { model } : {}),
});
const hooks = (dropped = false) => ({ state: { dropped }, userFilesWritten: () => 0 });

describe('F1 · a Surplus session says what it will call — for records only', () => {
  it('🔴 the session runner plans its own sticky model, never a Claude id', async () => {
    const s = await (session().make());
    const r = s!.runner();
    expect(r.plannedModel).toBe('model-a');
    expect(r.plannedModel).not.toMatch(CLAUDE_ID);
  });
  it('the plan is what is dispatched (the record and the request agree)', async () => {
    const { make, adapter } = session(); const s = await make();
    const r = s!.runner();
    const planned = r.plannedModel;
    await r.runTurn({ model: 'ignored', system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], maxTokens: 50 }).catch(() => undefined);
    expect(adapter.dispatch).toHaveBeenCalledWith(expect.objectContaining({ model: planned }), expect.anything(), expect.anything());
  });
  it('survives the route\'s stop-signal wrapper', async () => {
    const s = await (session().make());
    expect(withStopSignal(s!.runner(), new AbortController().signal).plannedModel).toBe('model-a');
  });
  it('wrapper: not dropped ⇒ the Surplus plan', () => {
    const w = wrapSurplusRunnerPreWriteFailOpen({ plannedModel: 'surplus-x', runTurn: async () => answer() }, () => ({ plannedModel: 'weak-y', runTurn: async () => answer() }), hooks());
    expect(w.plannedModel).toBe('surplus-x');
  });
  it('wrapper: dropped before the Weak chain exists ⇒ undefined (main fallback), and it never builds the chain to answer', () => {
    const factory = vi.fn(() => ({ plannedModel: 'weak-y', runTurn: async () => answer() }));
    const w = wrapSurplusRunnerPreWriteFailOpen({ plannedModel: 'surplus-x', runTurn: async () => answer() }, factory, hooks(true));
    expect(w.plannedModel).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
  });
  it('wrapper: dropped after the Weak chain ran ⇒ the Weak chain\'s plan', async () => {
    const w = wrapSurplusRunnerPreWriteFailOpen({ plannedModel: 'surplus-x', runTurn: async () => answer() }, () => ({ plannedModel: 'weak-y', runTurn: async () => answer() }), hooks(true));
    await w.runTurn({ model: 'm', system: 's', messages: [], tools: [], maxTokens: 8 });
    expect(w.plannedModel).toBe('weak-y');
  });
  it('wrapper neighbour: a Surplus runner without a plan stays undefined (main behaviour)', () => {
    const w = wrapSurplusRunnerPreWriteFailOpen({ runTurn: async () => answer() }, () => ({ runTurn: async () => answer() }), hooks());
    expect(w.plannedModel).toBeUndefined();
  });

  it('🔴 a STOPPED Surplus call is filed under the Surplus model, not the request\'s Claude default', async () => {
    const rows: Row[] = [];
    const ac = new AbortController();
    // As the route wires it: the Surplus wrapper inside the build's stop-signal wrapper; the call honours the signal.
    const hanging = withStopSignal(wrapSurplusRunnerPreWriteFailOpen({ plannedModel: 'surplus-x', runTurn: (p) => new Promise<TurnResult>((_, reject) => p.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) }, () => ({ runTurn: async () => answer() }), hooks()), ac.signal);
    const run = runnerOn(hanging, rows, ac.signal).run('synthetic map viewer edit').catch(() => undefined);
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    await run;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) { expect(r.ok).toBe(false); expect(r.model).toBe('surplus-x'); expect(r.model).not.toMatch(CLAUDE_ID); }
  });
  it('🔴 a FAILED Surplus call is filed under the Surplus model too', async () => {
    const rows: Row[] = [];
    const failing: TurnRunner = { plannedModel: 'surplus-x', runTurn: async () => { throw new Error('synthetic 503'); } };
    await runnerOn(failing, rows).run('synthetic edit').catch(() => undefined);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.model).toBe('surplus-x');
  });
  it('neighbour: a runner with no plan keeps the request model (byte-identical to main)', async () => {
    const rows: Row[] = [];
    await runnerOn({ runTurn: async () => { throw new Error('synthetic 503'); } }, rows).run('synthetic edit').catch(() => undefined);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.model).toBe(REQUEST_MODEL);
  });
  it('neighbour: a delivered turn is still named by the model that answered', async () => {
    const rows: Row[] = [];
    await runnerOn({ plannedModel: 'surplus-x', runTurn: async () => answer('model-answered') }, rows).run('synthetic edit').catch(() => undefined);
    expect(rows[0]).toEqual({ model: 'model-answered', ok: true });
  });
});

describe('F2 · a user message picked up after the loop ended ends "running the final checks"', () => {
  it('helper table (fail-safe: only a pickup STRICTLY after the phase began ends it)', () => {
    expect(finalChecksAfterSteer(0, 0)).toBe(false);          // not in final checks
    expect(finalChecksAfterSteer(0, 500)).toBe(false);        // a pickup alone never starts the phase
    expect(finalChecksAfterSteer(1000, 0)).toBe(true);        // no pickup ever ⇒ main
    expect(finalChecksAfterSteer(1000, 999)).toBe(true);      // picked up before the phase ⇒ main
    expect(finalChecksAfterSteer(1000, 1000)).toBe(true);     // same millisecond is unclear ⇒ main
    expect(finalChecksAfterSteer(1000, 1001)).toBe(false);    // 🔴 picked up after ⇒ working again
    expect(finalChecksAfterSteer(Number.NaN, 2000)).toBe(false);
    expect(finalChecksAfterSteer(1000, Number.NaN)).toBe(true);
    expect(finalChecksAfterSteer(1000, Number.POSITIVE_INFINITY)).toBe(true);
  });
  it('a re-started phase (the integrity pass) is final again until the next pickup', () => {
    expect(finalChecksAfterSteer(3000, 2000)).toBe(true);
    expect(finalChecksAfterSteer(3000, 3500)).toBe(false);
  });
  it('the handoff stamps a pickup only when it actually hands a message over', () => {
    let t = 100; const q: string[] = [];
    const h = createSteeringHandoff(() => q, () => true, () => t);
    expect(h.lastTakenAt()).toBe(0);
    expect(h.take()).toEqual([]); expect(h.lastTakenAt()).toBe(0);
    q.push('synthetic note'); t = 200;
    expect(h.take()).toEqual(['synthetic note']); expect(h.lastTakenAt()).toBe(200);
    t = 300; h.take(); expect(h.lastTakenAt()).toBe(200);
    q.push('held'); h.beginLane(); t = 400; expect(h.take()).toEqual([]); expect(h.lastTakenAt()).toBe(200); h.releaseLane();
    const off = createSteeringHandoff(() => ['x'], () => false, () => 999);
    expect(off.take()).toEqual([]); expect(off.lastTakenAt()).toBe(0);
  });
  it('neighbour: the default clock and the existing two-argument call still work', () => {
    const q = ['a'];
    const h = createSteeringHandoff(() => q, () => true);
    expect(h.take()).toEqual(['a']);
    expect(h.lastTakenAt()).toBeGreaterThan(0);
  });
  it('the phase line after a pickup: never "final checks"; the rendered app still says it is running', () => {
    const elapsedMs = 15 * 60_000;
    const before = etaPhaseLine({ elapsedMs, finalChecks: finalChecksAfterSteer(1000, 0), appRenderedAt: 0, appExists: true });
    expect(before).toMatch(/running the final checks/);
    expect(etaPhaseLine({ elapsedMs, finalChecks: finalChecksAfterSteer(1000, 2000), appRenderedAt: 0, appExists: true })).toBeNull();
    const rendered = etaPhaseLine({ elapsedMs, finalChecks: finalChecksAfterSteer(1000, 2000), appRenderedAt: 500, appExists: true });
    expect(rendered).not.toMatch(/final checks/);
    expect(rendered).toMatch(/already running in the preview/);
  });
  it('🔒 wiring: both ETA readers go through the helper; the phase is set by epoch at both sites; no boolean flag left', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route.match(/finalChecks: finalChecksAfterSteer\(etaFinalChecksAt, steeringHandoff\.lastTakenAt\(\)\)/g)?.length).toBe(2);
    expect(route.match(/etaFinalChecksAt = Date\.now\(\);/g)?.length).toBe(2);
    expect(route).toContain('let etaFinalChecksAt = 0;');
    expect(route).not.toMatch(/\betaFinalChecks\b/);
    expect(route).not.toMatch(/finalChecks: etaFinal/.source + '(?!ChecksAt)');
    // The steering poll itself is untouched (the team still listens through repair — D3 is BLOCKED, Q-row).
    expect(route).toContain('steerPoll: () => steeringHandoff.take()');
  });
});
