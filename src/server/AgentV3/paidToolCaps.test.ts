import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToolDispatcher, type BuildToolBudget, webSearchMaxLimit } from './ToolDispatcher';
import type { ActuatorPort } from './ToolDispatcher';

/**
 * TD-16 caps only (no metering). web_search limit is clamped; consensus / second_opinion
 * share one BuildToolBudget across parent and child dispatchers.
 */
const act: ActuatorPort = {
  async readFile() { return ''; },
  async writeFile() { /* unused */ },
  async listFiles() { return []; },
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; },
};

const ENV_KEYS = [
  'AGENTV3_WEB_SEARCH_MAX_LIMIT',
  'AGENTV3_MAX_CONSENSUS_PER_BUILD',
  'AGENTV3_MAX_SECOND_OPINION_PER_BUILD',
] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function dispatcher(opts: {
  webSearch?: (query: string, limit: number) => Promise<string>;
  consensus?: (question: string) => Promise<string>;
  secondOpinion?: (prompt: string) => Promise<string>;
  budget?: BuildToolBudget;
} = {}): ToolDispatcher {
  return new ToolDispatcher(
    act, 'ws-caps', undefined, undefined, undefined, undefined,
    opts.secondOpinion, opts.consensus, opts.webSearch,
    undefined, undefined, undefined, undefined, opts.budget,
  );
}

const call = (name: string, input: Record<string, unknown>, id = 't') => ({ id, name, input });

describe('per-build paid tool caps', () => {
  it('web_search { limit: 500 } passes limit ≤ 10 to the search client', async () => {
    delete process.env.AGENTV3_WEB_SEARCH_MAX_LIMIT;
    let seen = -1;
    const d = dispatcher({
      webSearch: async (_query, limit) => { seen = limit; return 'ok'; },
    });
    const res = await d.dispatch(call('web_search', { query: 'x', limit: 500 }));
    expect(res.is_error).toBe(false);
    expect(seen).toBeLessThanOrEqual(10);
    expect(seen).toBe(webSearchMaxLimit());
  });

  it('an invalid web-search cap falls back to 10', () => {
    expect(webSearchMaxLimit({ AGENTV3_WEB_SEARCH_MAX_LIMIT: 'nope' } as NodeJS.ProcessEnv)).toBe(10);
    expect(webSearchMaxLimit({} as NodeJS.ProcessEnv)).toBe(10);
  });

  it('a 4th consensus returns is_error', async () => {
    delete process.env.AGENTV3_MAX_CONSENSUS_PER_BUILD;
    const d = dispatcher({ consensus: async () => 'panel' });
    for (let i = 0; i < 3; i++) {
      const ok = await d.dispatch(call('consensus', { question: 'q' }, `c${i}`));
      expect(ok.is_error).toBe(false);
    }
    const fourth = await d.dispatch(call('consensus', { question: 'q' }, 'c4'));
    expect(fourth.is_error).toBe(true);
    expect(fourth.content).toBe('This build has used its 3 consensus calls — continue without it.');
    expect(d.toolBudget.consensus).toBe(3);
  });

  it('a 6th second_opinion returns is_error', async () => {
    delete process.env.AGENTV3_MAX_SECOND_OPINION_PER_BUILD;
    const d = dispatcher({ secondOpinion: async () => 'review' });
    for (let i = 0; i < 5; i++) {
      const ok = await d.dispatch(call('second_opinion', { prompt: 'p' }, `s${i}`));
      expect(ok.is_error).toBe(false);
    }
    const sixth = await d.dispatch(call('second_opinion', { prompt: 'p' }, 's6'));
    expect(sixth.is_error).toBe(true);
    expect(sixth.content).toBe('This build has used its 5 second_opinion calls — continue without it.');
  });

  it('a child dispatcher shares the parent count', async () => {
    delete process.env.AGENTV3_MAX_CONSENSUS_PER_BUILD;
    const parent = dispatcher({ consensus: async () => 'panel' });
    for (let i = 0; i < 3; i++) {
      await parent.dispatch(call('consensus', { question: 'q' }, `p${i}`));
    }
    const child = dispatcher({ consensus: async () => 'panel', budget: parent.toolBudget });
    const res = await child.dispatch(call('consensus', { question: 'q' }, 'child'));
    expect(res.is_error).toBe(true);
    expect(res.content).toBe('This build has used its 3 consensus calls — continue without it.');
    expect(child.toolBudget).toBe(parent.toolBudget);
  });

  it('the task-tool child dispatcher receives this.toolBudget', () => {
    const sub = readFileSync(resolve(__dirname, 'SubAgent.ts'), 'utf8');
    const route = readFileSync(resolve(__dirname, '../routes/agentv3.ts'), 'utf8');
    expect(sub).toContain('deps.toolBudget?.()');
    expect(sub).toContain('sharedBudget, // this.toolBudget');
    expect(route).toContain('toolBudget: () => dispatcherForSubAgents?.toolBudget');
    expect(route).toContain('d.shareToolBudget(dispatcher.toolBudget)');
  });
});
