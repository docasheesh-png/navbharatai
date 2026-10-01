// Autopsy 1219c639 (2026-10-01) — "Create a chart app … ChatGPT & Perplexity … ek Bharat AI bnao".
//
// Build 1 asked for a PERPLEXITY_API_KEY mid-build and sat in the key popup. The user did not have one and
// pressed Stop. The wait for the popup did not listen to Stop, so build 1's code lived on, while Stop had
// already freed the app for the next build. A banner then offered "Continue building" ("usually a server
// restart"); build 2 started in the same app beside build 1. When the popup's ten minutes ran out, build 1
// said "Skipped for now", ran `npm install express cors dotenv openai tsx concurrently` into the app build 2
// was writing (build 2 then found package.json saved differently from what ran), told the user at ERROR
// level "I made your change, but I could not open your app", and logged six "unused package" warnings.
// Through the ten-minute wait the live line said "~3 min to go", and the ETA verdict scored the wait as
// build time. Build 2's fast lane announced "Building 10 file(s)" after its contract call had handed off,
// and the plan it handed over said "NOT written yet" about files the workspace already held.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { awaitApproval, awaitApprovalOutcome, resolveApproval, pendingApprovalCount } from '../src/server/AgentV3/Approvals';
import { secretRequestResult, isAiModelKey, keylessAiNote } from '../src/server/AgentV3/secretRequest';
import { stoppedBuildGate, waitForBuildExit, markBuildExited, STOP_DRAIN_MAX_MS, type StoppingBuild } from '../src/server/AgentV3/stoppingBuild';
import { waitingForUserLine } from '../src/server/AgentV3/userWait';
import { etaAccuracy, BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { historyFromRecords, isTeachableBuild, workingMs } from '../src/server/AgentV3/etaHistory';
import { planHandoffText } from '../src/server/AgentV3/planHandoff';
import { greenGuardShouldTellUnverified } from '../src/server/AgentV3/GreenGuard';
import { WorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { GATEWAY_AI_RULE } from '../src/server/AgentV3/systemPrompt';
import { fastLanePhaseSummary } from '../src/server/AgentV3/fastLanePhases';
import { runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import { REASONING_RUNG_HANDOFF_MARKER } from '../src/server/AgentV3/turnDeadline';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

const read = (p: string) => readFileSync(p, 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ROUTE = strip(read('src/server/routes/agentv3.ts'));

describe('1 · a wait for the user ends the moment the build is stopped', () => {
  it('🔴 Stop ends the wait at once, and says it was a stop', async () => {
    const ac = new AbortController();
    const p = awaitApprovalOutcome('stop-1', { signal: ac.signal, timeoutMs: 60_000 });
    ac.abort();
    await expect(p).resolves.toBe('stopped');
    expect(resolveApproval('stop-1', true)).toBe(false); // nothing left registered
  });
  it('a signal that already fired never registers a wait', async () => {
    const ac = new AbortController();
    ac.abort();
    const before = pendingApprovalCount();
    await expect(awaitApprovalOutcome('stop-2', { signal: ac.signal })).resolves.toBe('stopped');
    expect(pendingApprovalCount()).toBe(before);
  });
  it('a timeout, a yes and a no are three different answers', async () => {
    await expect(awaitApprovalOutcome('t-1', { timeoutMs: 5 })).resolves.toBe('timed-out');
    const yes = awaitApprovalOutcome('y-1');
    resolveApproval('y-1', true);
    await expect(yes).resolves.toBe('approved');
    const no = awaitApprovalOutcome('n-1');
    resolveApproval('n-1', false);
    await expect(no).resolves.toBe('denied');
  });
  it('the boolean form keeps its meaning (only a yes is true)', async () => {
    const ac = new AbortController();
    const p = awaitApproval('b-1', 60_000, ac.signal);
    ac.abort();
    await expect(p).resolves.toBe(false);
  });
  it('SOURCE: every wait in the build goes through the one door, which passes the stop signal', () => {
    expect(ROUTE).not.toMatch(/\bawaitApproval\(/);
    expect(ROUTE).toContain('return await awaitApprovalOutcome(requestId, { timeoutMs, signal: abort.signal });');
    expect((ROUTE.match(/await waitForUser\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

describe('2 · the key popup tells the truth about how it ended', () => {
  it('a Stop says nothing (the stop message already does), a timeout says so, a skip is a skip', () => {
    expect(secretRequestResult('stopped', ['PERPLEXITY_API_KEY'])).toBe('');
    const timedOut = secretRequestResult('timed-out', ['STRIPE_SECRET_KEY']);
    expect(timedOut).toMatch(/No answer came in 10 minutes/);
    expect(timedOut).not.toMatch(/Skipped/);
    expect(secretRequestResult('skipped', ['STRIPE_SECRET_KEY'])).toMatch(/^👍 Skipped for now/);
  });

  class App implements ActuatorPort {
    files = new Map<string, string>([['package.json', '{"dependencies":{"react":"^19.0.0"}}'], ['src/App.tsx', 'export default () => null;']]);
    async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT ${p}`); return f; }
    async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
    async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
    async getPortUrl(_w: string, port: number): Promise<string> { return `https://s-${port}.example.dev`; }
  }
  const ask = (names: string[]) => ({ id: 'k1', name: 'request_secrets', input: { secrets: names.map((name) => ({ name, why: 'x' })) } });
  function dispatcher() {
    const stream = new AgentEventStream();
    const lines: string[] = [];
    stream.subscribe((e) => { const ev = e as { type: string; text?: string }; if (ev.type === 'narration' && ev.text) lines.push(ev.text); });
    return { d: new ToolDispatcher(new App(), 'ws-keys', new WorkspaceState(stream), stream), lines };
  }

  it('🔴 a build stopped during the popup does nothing more and tells the user nothing more', async () => {
    const { d, lines } = dispatcher();
    d.setSecretRequestHandler(async () => 'stopped');
    const res = await d.dispatch(ask(['STRIPE_SECRET_KEY']), 'architect');
    expect(res.content).toContain('Do nothing more');
    expect(lines.some((l) => /Skipped/.test(l))).toBe(false);
  });
  it('a popup nobody answered says it timed out', async () => {
    const { d, lines } = dispatcher();
    d.setSecretRequestHandler(async () => 'timed-out');
    await d.dispatch(ask(['STRIPE_SECRET_KEY']), 'architect');
    expect(lines.some((l) => /No answer came in 10 minutes/.test(l))).toBe(true);
    expect(lines.some((l) => /Skipped/.test(l))).toBe(false);
  });
});

describe('3 · an AI model needs no key while the gateway is on', () => {
  it('provider keys are recognised; AI_API_KEY (a server app\'s own setting) is not', () => {
    for (const n of ['PERPLEXITY_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'CHATGPT_KEY']) expect(isAiModelKey(n)).toBe(true);
    for (const n of ['AI_API_KEY', 'STRIPE_SECRET_KEY', 'RAZORPAY_KEY_ID', 'VITE_SUPABASE_URL']) expect(isAiModelKey(n)).toBe(false);
    expect(keylessAiNote(['PERPLEXITY_API_KEY'])).toContain('run_recipe with name "generate_ai"');
  });
  it('🔴 the popup is never opened for one; the builder is pointed at the keyless recipe', async () => {
    const prev = process.env.APP_AI_GATEWAY;
    process.env.APP_AI_GATEWAY = 'on';
    try {
      const stream = new AgentEventStream();
      const d = new ToolDispatcher({
        readFile: async () => { throw new Error('ENOENT'); }, writeFile: async () => {}, listFiles: async () => [],
        runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }), getPortUrl: async () => 'x',
      } as unknown as ActuatorPort, 'ws-ai', new WorkspaceState(stream), stream);
      const handler = vi.fn(async () => null);
      d.setSecretRequestHandler(handler);
      const res = await d.dispatch({ id: 'k2', name: 'request_secrets', input: { secrets: [{ name: 'PERPLEXITY_API_KEY', why: 'x' }, { name: 'OPENAI_API_KEY', why: 'x' }] } }, 'architect');
      expect(handler).not.toHaveBeenCalled();
      expect(res.content).toContain('An AI model needs NO key');
      expect(res.content).toContain('PERPLEXITY_API_KEY, OPENAI_API_KEY');
    } finally {
      if (prev === undefined) delete process.env.APP_AI_GATEWAY; else process.env.APP_AI_GATEWAY = prev;
    }
  });
  it('the builder is told a NAMED provider is not a key to fetch', () => {
    expect(GATEWAY_AI_RULE).toMatch(/A provider the user NAMES \(ChatGPT, Perplexity/);
    expect(GATEWAY_AI_RULE).toMatch(/never stop the build to ask for an AI key/);
  });
});

describe('4 · nothing from a turn runs after Stop', () => {
  it('🔴 the second tool of a turn is not run once the first stopped the build', async () => {
    const ac = new AbortController();
    const ran: string[] = [];
    const client: MessagesCreateClient = {
      messages: {
        create: async () => ({
          content: [
            { type: 'tool_use', id: 'a', name: 'bash', input: { command: 'echo waiting-for-key' } },
            { type: 'tool_use', id: 'b', name: 'bash', input: { command: 'npm install express openai' } },
          ],
          stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
        }) as never,
      },
    };
    const dispatcherStub = {
      dispatch: async (tu: { id: string; input: { command: string } }) => {
        ran.push(tu.input.command);
        if (tu.id === 'a') ac.abort(); // the user pressed Stop during the first step
        return { tool_use_id: tu.id, content: 'ok', is_error: false };
      },
    };
    const stream = new AgentEventStream();
    await new AgentRunner({
      client: new ClaudeClient(client), dispatcher: dispatcherStub as never, state: new WorkspaceState(stream), events: stream,
      model: 'm', system: 's', tools: defaultToolCatalog(), signal: ac.signal,
    }).run('build it');
    expect(ran).toEqual(['echo waiting-for-key']);
  });
});

describe('5 · a stopped build holds the app until it has left', () => {
  it('the gate: proceed once exited, refuse while leaving, reclaim a body stuck past the bound', () => {
    expect(stoppedBuildGate(undefined, 0)).toBe('proceed');
    expect(stoppedBuildGate({ exited: true, stoppedAt: 0 }, 1)).toBe('proceed');
    expect(stoppedBuildGate({ exited: false, stoppedAt: 1_000 }, 5_000)).toBe('refuse');
    expect(stoppedBuildGate({ exited: false, stoppedAt: 1_000 }, 1_000 + STOP_DRAIN_MAX_MS)).toBe('reclaim');
  });
  it('a waiting request wakes the moment the stopped build exits', async () => {
    const b: StoppingBuild = { exited: false, stoppedAt: Date.now() };
    const waiting = waitForBuildExit(b, 10_000);
    markBuildExited(b);
    await expect(waiting).resolves.toBe(true);
    await expect(waitForBuildExit({ exited: false, stoppedAt: 0 }, 5)).resolves.toBe(false);
  });
  it('SOURCE: Stop frees the slot only for an exited build; the new-build gate runs before the lock check', () => {
    // Both routes that stop a build (Stop and Unsend) free the slot through the one helper, never inline.
    for (const route of ["app.post('/api/agentv3/stop'", "app.post('/api/agentv3/unsend'"]) {
      const at = ROUTE.indexOf(route);
      const block = ROUTE.slice(at, ROUTE.indexOf('app.post(', at + 10));
      expect(block).toContain('stopRegisteredBuild(key, rb);');
      expect(block).not.toMatch(/activeBuilds\.delete\(key\);/);
      expect(block).not.toMatch(/abortBuild\(rb\.abort/);
    }
    const gate = ROUTE.indexOf('const gate = stoppedBuildGate(stopping, Date.now());');
    const lock = ROUTE.indexOf('if (activeBuilds.has(buildKey)) {');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(lock);
  });
  it('SOURCE: cleanup releases only the lock it owns, and marks the build exited', () => {
    // After the build has taken its key, no cleanup deletes the key blindly.
    const afterClaim = ROUTE.slice(ROUTE.indexOf('activeBuildOwner.set(buildKey, buildLockToken);'));
    expect(afterClaim).not.toMatch(/^\s*activeBuilds\.delete\(buildKey\);/m);
    expect((ROUTE.match(/releaseBuildLock\(buildKey, buildLockToken\);/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect((ROUTE.match(/markBuildExited\(rb\);/g) ?? []).length).toBe(2);
  });
  it('SOURCE: the cross-instance lease is kept while a stopped build is still leaving', () => {
    expect(ROUTE).toContain('if (buildLeaseRb.exited || (holder !== undefined && holder !== buildLeaseRb)) { releaseBuildLease(); return; }');
  });
});

describe('6 · waiting for the user is not building', () => {
  it('the live line says it is waiting, not how long is left', () => {
    expect(waitingForUserLine(4 * 60_000)).toMatch(/^⏸️ Waiting for your answer above \(4 min so far\)/);
    expect(waitingForUserLine(10_000)).not.toMatch(/to go/);
  });
  it('🔴 the real build, re-scored: a 10-minute popup is not "1.7× and OVER the band"', () => {
    const promise = { estimateMs: 411_474, lowMs: 364_154, highMs: 487_185, evidenced: true };
    const old = etaAccuracy(promise, 1790828148148, 1790828839906, 'OUTCOME_USER_STOPPED');
    expect(old?.line).toMatch(/OVER the band/);
    const now = etaAccuracy(promise, 1790828148148, 1790828839906, 'OUTCOME_USER_STOPPED', 600_000);
    expect(now?.untested).toBe(true);
    expect(now?.line).toMatch(/not counting 10\.0 min spent waiting for the user's answer/);
  });
  it('the report carries the wait, and the ETA history learns from working time', () => {
    const d = new BuildDiagnostics();
    d.addUserWait(600_000);
    expect(d.report().userWaitMs).toBe(600_000);
    const rec = { startedAt: 0, endedAt: 11 * 60_000, ok: true, userWaitMs: 10 * 60_000 };
    expect(workingMs(rec)).toBe(60_000);
    expect(isTeachableBuild(rec)).toBe(true);
    expect(historyFromRecords([rec], 'simple' as never)[0].durationMs).toBe(60_000);
  });
  it('SOURCE: the heartbeat pauses the countdown and the futility breaker while the user is asked', () => {
    const at = ROUTE.indexOf('if (userWait.since !== null) {');
    const futility = ROUTE.indexOf('if (!futilityFired && futilityArmed) {');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(futility);
    expect(ROUTE).toContain('futilityState = initialFutilityState(); // an answer from the user is not "producing nothing"');
    expect(ROUTE).toContain('durationMs: Math.max(0, Date.now() - buildStartedAt - userWait.totalMs),');
  });
});

describe('7 · the fast lane ends at a hand-off during its contract', () => {
  it('🔴 no "Building N file(s)", no file call, and the phase line says it handed off', async () => {
    const logs: string[] = [];
    const generated: string[] = [];
    const sb = await runSimpleBuild({
      prompt: 'Create a chart app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'], shareContract: true,
      log: (m: string) => { logs.push(m); },
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/components/Chart.tsx :: chart\nsrc/components/Chat.tsx :: chat';
        if (user.includes('The complete file list')) throw new Error(`The next engine (kimi-k2.7-code) reasons before every answer; ${REASONING_RUNG_HANDOFF_MARKER} (after GLM).`);
        generated.push(user.slice(0, 40));
        return '';
      },
      writeFiles: async () => {},
    });
    expect(sb.ok).toBe(false);
    expect(generated).toEqual([]);
    expect(logs.some((m) => /^Building \d+ file/.test(m))).toBe(false);
    expect(sb.phases?.contractOutcome).toBe('handed-off');
    expect(fastLanePhaseSummary(sb.phases!)).toContain('handed its plan to the full builder before writing any file');
    expect(fastLanePhaseSummary(sb.phases!)).not.toContain('came back with nothing usable');
    expect(sb.plannedPaths?.length).toBeGreaterThan(0); // the plan still reaches the full builder
  });
});

describe('8 · the plan hand-off names the files that already exist', () => {
  it('🔴 the continue build\'s plan: every file was already in the workspace', () => {
    const planned = ['src/App.tsx', 'src/main.tsx', 'src/index.css', 'package.json', 'vite.config.ts'];
    const text = planHandoffText(planned, new Set(planned));
    expect(text).toMatch(/every file in it is already in the workspace/);
    expect(text).not.toMatch(/NOT written yet|Nothing below has been created/);
    expect(text).toMatch(/read each before you change it/);
  });
  it('a mixed plan lists both, and a fresh one keeps the old wording', () => {
    const mixed = planHandoffText(['src/App.tsx', 'src/Chart.tsx'], new Set(['src/App.tsx']));
    expect(mixed).toMatch(/Not created yet:\n- src\/Chart\.tsx/);
    expect(mixed).toMatch(/Already in the workspace[^\n]*\n- src\/App\.tsx/);
    expect(planHandoffText(['src/Chart.tsx'], new Set())).toMatch(/these files are NOT written yet/);
  });
});

describe('9 · a stopped build does not claim work or flag what the stop prevented', () => {
  it('no "I made your change" after a Stop', () => {
    expect(greenGuardShouldTellUnverified({ hasSnapshot: true, previewGreen: false, filesWrittenThisTurn: 2, stoppedByUser: true })).toBe(false);
    expect(greenGuardShouldTellUnverified({ hasSnapshot: true, previewGreen: false, filesWrittenThisTurn: 2 })).toBe(true);
    expect(ROUTE).toContain("stoppedByUser: abortCauseOf(abort.signal) === 'user-stop'");
  });
  it('SOURCE: packages a stopped build installed are one info line, not a warning each', () => {
    expect(ROUTE).toContain("code: 'UNUSED_DEPS_AFTER_STOP'");
    expect(ROUTE).toContain('if (stoppedFresh.has(u.name)) continue;');
  });
});

describe('10 · a reviewer without a shell is not told to run tsc', () => {
  it('🔴 the stale-tsc line changes with what the reader can do', () => {
    const m = new WorkspaceMemory('ws-review');
    m.markTscClean(1);
    m.indexFile('src/App.tsx', 'x'); // a later write makes the clean check stale
    expect(m.verificationStatus()).toMatch(/run tsc ONCE/);
    const noShell = m.verificationStatus({ canRunCommands: false });
    expect(noShell).not.toMatch(/run tsc ONCE/);
    expect(noShell).toMatch(/You have no shell — do not try to run tsc/);
  });
  it('SOURCE: a sub-agent is told according to its own tools', () => {
    expect(read('src/server/AgentV3/SubAgent.ts')).toContain("mem.verificationStatus({ canRunCommands: (deps.toolsOverride ?? cfg.tools).includes('bash' as ToolName) })");
  });
});
