import { describe, it, expect } from 'vitest';
import { EngineerAgentLoop } from '../src/server/EngineerAI/EngineerAgentLoop';
import type { AIRouter } from '../src/server/AI/Router/AIRouter';
import type { IEngineerActuator } from '../src/server/EngineerAI/actuators/IEngineerActuator';
import type { EngineerAgentEvent } from '../src/server/EngineerAI/EngineerAITypes';

// Router fake: replays a scripted queue of model responses, one per route() call.
function fakeRouter(responses: string[]): AIRouter {
  let i = 0;
  return {
    route: async () => {
      const content = responses[Math.min(i, responses.length - 1)];
      i++;
      return { response: { content, latencyMs: 0, provider: 'TEST', model: 'test' }, telemetry: { success: true } as any };
    },
    hasHealthyProvider: async () => true,
  } as unknown as AIRouter;
}

// In-memory actuator: a Map-backed workspace, build success driven by a flag.
function fakeActuator(opts: { buildOk?: boolean } = {}): IEngineerActuator & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async ensureWorkspace() {},
    async writeFile(_w, p, c) { files.set(p, c); },
    async readFile(_w, p) { const v = files.get(p); if (v === undefined) throw new Error('not found'); return v; },
    async listFiles() { return [...files.keys()]; },
    async build() { return { success: opts.buildOk !== false, logs: opts.buildOk === false ? 'build error' : 'ok' }; },
    async runCommand() { return { exitCode: 0, stdout: 'ran', stderr: '' }; },
    async browseUrl() { return { html: '<html></html>' }; },
  };
}

async function collect(loop: EngineerAgentLoop, signal?: AbortSignal): Promise<EngineerAgentEvent[]> {
  const events: EngineerAgentEvent[] = [];
  for await (const e of loop.run({ workspaceId: 'w1', instruction: 'do it' }, signal)) events.push(e);
  return events;
}

describe('EngineerAgentLoop', () => {
  it('runs edit_file then done, emitting file content and completing on a clean build', async () => {
    // Phase 7: first route() call is the PlannerAgent; subsequent calls drive the ReAct loop.
    const router = fakeRouter([
      // PlannerAgent response — structured step objects
      JSON.stringify({ steps: [{ description: 'write app.js', focusHint: 'create the app.js file' }] }),
      JSON.stringify({ thought: 'write it', action: 'edit_file', args: { path: 'app.js', content: 'console.log(1)' } }),
      JSON.stringify({ thought: 'finished', action: 'done', args: { summary: 'wrote app.js' } }),
    ]);
    const actuator = fakeActuator({ buildOk: true });
    const events = await collect(new EngineerAgentLoop(router, actuator));

    // PlannerAgent emits a plan event + step progress events.
    const plan = events.find(e => e.type === 'plan') as any;
    expect(plan.steps).toEqual(['write app.js']);
    expect(events.some(e => e.type === 'plan_step_start' && (e as any).stepIndex === 0)).toBe(true);
    const changed = events.find(e => e.type === 'files_changed') as any;
    expect(changed.files[0]).toEqual({ path: 'app.js', content: 'console.log(1)' });
    expect(actuator.files.get('app.js')).toBe('console.log(1)');
    expect(events.some(e => e.type === 'plan_step_done' && (e as any).stepIndex === 0)).toBe(true);
    expect(events.some(e => e.type === 'complete')).toBe(true);
  });

  it('recovers from a malformed response instead of aborting the run', async () => {
    const router = fakeRouter([
      // PlannerAgent returns conversational → planSteps=[] → single unscoped loop.
      JSON.stringify({ conversational: true }),
      'sorry, here is some prose not json',
      JSON.stringify({ thought: 'now valid', action: 'done', args: { summary: 'ok' } }),
    ]);
    const events = await collect(new EngineerAgentLoop(router, fakeActuator({ buildOk: true })));

    // It should NOT emit a fatal error, and should still complete after retrying.
    expect(events.some(e => e.type === 'error')).toBe(false);
    expect(events.some(e => e.type === 'complete')).toBe(true);
  });

  it('does not complete when the build fails on done', async () => {
    const router = fakeRouter([
      // PlannerAgent returns conversational → single unscoped loop, no plan displayed.
      JSON.stringify({ conversational: true }),
      JSON.stringify({ thought: 'done?', action: 'done', args: { summary: 'x' } }),
    ]);
    const events = await collect(new EngineerAgentLoop(router, fakeActuator({ buildOk: false })));

    const build = events.find(e => e.type === 'build_result') as any;
    expect(build.success).toBe(false);
    expect(events.some(e => e.type === 'complete')).toBe(false);
  });

  it('stops promptly when aborted before it starts', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const events = await collect(new EngineerAgentLoop(fakeRouter(['{}']), fakeActuator()), ctrl.signal);
    // provider-check status → workspace-init status → aborted on first loop check
    expect(events).toEqual([
      { type: 'status', message: 'Checking AI provider…' },
      { type: 'status', message: 'Initializing workspace…' },
      { type: 'aborted' },
    ]);
  });
});
