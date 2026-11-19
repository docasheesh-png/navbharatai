// 🔴 failedbr #2431 (21d59838): "this time is not counted against it", every minute of a 10-minute key popup — and then the
// 25-minute watchdog stopped the build, which had waited 12.4 min for the user and worked 12.7. It also reopened the SAME
// key popup and waited into its deadline. Locked here:
//   1. one credited wait (capped below Cloud Run's 3600 s request ceiling) read by every clock that decides whether the
//      build may go on — the hard deadline, the runner's own clock, the route's budget checks;
//   2. a key the user did not give is never asked for again in the same build.
// Reversion: drop `pausedMs` from AgentRunner's timeout check, the route's `workElapsed`, the deadline re-arm, or
// `unansweredOnly` from request_secrets, and the matching block fails.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { waitCreditMs, workElapsedMs, hardDeadlineRemainingMs, CLOUD_RUN_REQUEST_CEILING_MS, CEILING_MARGIN_MS } from '../src/server/AgentV3/workClock';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { unansweredOnly } from '../src/server/AgentV3/secretRequest';

const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

describe('the working clock', () => {
  it('the #2431 numbers: 12.4 min waited is fully credited on a 25-min window', () => {
    const budget = 25 * 60_000, waited = 742_727;
    expect(waitCreditMs(waited, budget)).toBe(waited);
    expect(workElapsedMs(1_500_000, 0, waitCreditMs(waited, budget))).toBe(1_500_000 - waited);
  });
  it('never past the request ceiling: a 58-min paid window gets no credit beyond 55 min total', () => {
    const budget = 58 * 60_000;
    expect(waitCreditMs(30 * 60_000, budget)).toBe(0);
    expect(waitCreditMs(30 * 60_000, 50 * 60_000)).toBe(CLOUD_RUN_REQUEST_CEILING_MS - CEILING_MARGIN_MS - 50 * 60_000);
  });
  it('no deadline ⇒ all of it; nonsense ⇒ none', () => {
    expect(waitCreditMs(5000, 0)).toBe(5000);
    expect(waitCreditMs(NaN, 1000)).toBe(0);
  });
  it('the hard deadline moves by exactly the credit', () => {
    expect(hardDeadlineRemainingMs(1000 + 600_000, 1000, 1_500_000, 600_000)).toBe(1_500_000);
    expect(hardDeadlineRemainingMs(10_000_000, 0, 1000, 0)).toBe(1);
  });
});

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

describe("the runner's own clock skips the user wait", () => {
  const turn = (i: number) => ({ content: [{ type: 'tool_use', id: `w${i}`, name: 'write_file', input: { path: `src/f${i}.ts`, content: `export const v${i} = ${i};\n` } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } });
  const run = async (pausedMs?: () => number) => {
    let i = 0, paused = 0;
    // The first model call stands in for a key popup the user sat in for 1.5 s; every later call is instant work.
    const client: MessagesCreateClient = { messages: { create: async () => { if (i === 0) { await new Promise((r) => setTimeout(r, 1500)); paused += 1500; } return (i < 3 ? turn(i++) : { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' }) as never; } } };
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const runner = new AgentRunner({ client: new ClaudeClient(client), dispatcher: new ToolDispatcher(new FakeActuator(), 'ws-2431', state, stream), state, events: stream, model: 'test', system: 's', tools: defaultToolCatalog(), maxBuildMs: 1200, expectsArtifacts: true, ...(pausedMs ? { pausedMs: () => (pausedMs(), paused) } : {}) });
    return runner.run('build');
  };
  it('with the credit, a 1.5 s wait does not eat a 1.2 s budget', async () => {
    const r = await run(() => 0);
    expect(r.summary).not.toMatch(/stopped after about/i);
  });
  it('without it (wall time), the same run is stopped by the clock — the #2431 shape', async () => {
    const r = await run();
    expect(r.summary).toMatch(/stopped after about|to avoid an endless loop/i);
  });
});

describe('the route reads one working clock', () => {
  it('no budget check computes elapsed time on its own any more (census)', () => {
    expect(route).not.toMatch(/effectiveBuildSeconds \* 1000 - \(Date\.now\(\) - buildStartedAt\)/);
    expect(route).not.toMatch(/Date\.now\(\) - buildStartedAt < effectiveBuildSeconds \* 1000/);
    expect(route).not.toMatch(/Date\.now\(\) - buildStartedAt > effectiveBuildSeconds \* 1000/);
    expect(route).not.toMatch(/generationBudgetMs\(effectiveBuildSeconds \* 1000, Date\.now\(\) - buildStartedAt\)/);
  });
  it('the hard deadline is pushed back when a wait ends, and only while it is the hard one', () => {
    expect(route).toMatch(/try \{ onWaitCredited\?\.\(\); \}/);
    expect(route).toMatch(/hardDeadlineRemainingMs\(Date\.now\(\), deadlineArmedAt, deadlineMs, creditedWaitMs\(\)\)/);
    expect(route).toMatch(/deadlineIsHard = false;/);
  });
  it('every runner gets the credit', () => {
    expect(route).toMatch(/const baseRunnerOpts = \{[\s\S]{0,200}pausedMs: creditedWaitMs,/);
  });
});

describe('a key the user did not give is not asked for again', () => {
  it('splits fresh from already-unanswered', () => {
    expect(unansweredOnly([{ name: 'RAZORPAY_KEY_ID' }, { name: 'OTHER' }], new Set(['RAZORPAY_KEY_ID']))).toEqual({ fresh: [{ name: 'OTHER' }], repeated: ['RAZORPAY_KEY_ID'] });
  });

  it('end to end: the second request_secrets for the same keys never opens the popup', async () => {
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(new FakeActuator(), 'ws-2431b', new WorkspaceState(stream), stream);
    let popups = 0;
    d.setSecretRequestHandler(async () => { popups++; return 'timed-out'; });
    const ask = { secrets: [{ name: 'RAZORPAY_KEY_ID', why: 'payments' }, { name: 'RAZORPAY_KEY_SECRET', why: 'payments' }] };
    const dispatch = (input: Record<string, unknown>) => (d as unknown as { dispatch: (c: { id: string; name: string; input: Record<string, unknown> }) => Promise<{ content: string }> }).dispatch({ id: `s${Math.random()}`, name: 'request_secrets', input });
    await dispatch(ask);
    const second = await dispatch(ask);
    expect(popups).toBe(1);
    expect(second.content).toMatch(/Already asked for RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET/);
  });
});
