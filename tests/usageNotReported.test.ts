import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseOpenAiCompletion } from '../src/server/AgentV3/providers/OpenAiToolAdapter';
import { OpenAiStreamAccumulator } from '../src/server/AgentV3/providers/openAiStream';

/**
 * "WE DO NOT KNOW" MUST NEVER BE WRITTEN AS "ZERO".
 *
 * 🔴 The class this locks, and it has already cost this repo once. Autopsy f04421ef: a build report
 * printed `GLM: 54 call(s) · 0 in · 0 out` for a ledger that had simply not settled, and the zeros were
 * read — in an autopsy handed to the admin — as a MEASURED zero. The renderer was fixed to say "tokens
 * not recorded".
 *
 * A STREAMED turn reopens the identical hole through a different door: token counts ride the final
 * chunk only when the provider honours `stream_options.include_usage`, and whether Z.ai and Moonshot
 * do is a fact no session can settle without a real call. `AGENTV3_STREAM_BUILD_CALLS` is live, so this
 * is not hypothetical.
 *
 * 🔒 The flag never moves a bill — the ONE-WALLET LAW forbids inventing tokens, so an unmeasured turn
 * stays free to the user. What it protects is the ADMIN's own cost figure, which otherwise under-states
 * itself silently on the exact panel used to judge provider spend.
 */

const completionWith = (usage: unknown): Parameters<typeof parseOpenAiCompletion>[0] => ({
  choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
  ...(usage === undefined ? {} : { usage }),
}) as Parameters<typeof parseOpenAiCompletion>[0];

describe('parseOpenAiCompletion — a missing usage is UNMEASURED, never a measured zero', () => {
  it('marks measured:false when the provider sent no usage object at all', () => {
    const r = parseOpenAiCompletion(completionWith(undefined));
    expect(r.usage.measured).toBe(false);
    // The zeros are still zeros — nothing is invented to fill the gap.
    expect(r.usage.inputTokens).toBe(0);
    expect(r.usage.outputTokens).toBe(0);
  });

  it('marks measured:false for an EMPTY usage object — a shape with no counts is no measurement', () => {
    expect(parseOpenAiCompletion(completionWith({})).usage.measured).toBe(false);
  });

  it('🔒 a genuine zero stays a MEASUREMENT — the flag must not fire on a real reported 0', () => {
    const r = parseOpenAiCompletion(completionWith({ prompt_tokens: 0, completion_tokens: 0 }));
    expect(r.usage.measured).not.toBe(false);
    expect(r.usage.inputTokens).toBe(0);
  });

  it('leaves the field ABSENT on a normal measured turn, so every existing reader is unchanged', () => {
    const r = parseOpenAiCompletion(completionWith({ prompt_tokens: 120, completion_tokens: 30 }));
    expect(r.usage.measured).toBeUndefined();
    expect(r.usage.inputTokens).toBe(120);
    expect(r.usage.outputTokens).toBe(30);
  });

  it('one count alone is still a measurement', () => {
    expect(parseOpenAiCompletion(completionWith({ completion_tokens: 7 })).usage.measured).not.toBe(false);
  });
});

describe('the STREAMED path — the case that made this necessary', () => {
  /** Drive the accumulator the way readStream does, then translate it exactly as the runner does. */
  const streamed = (chunks: Array<Record<string, unknown>>) => {
    const acc = new OpenAiStreamAccumulator();
    for (const c of chunks) acc.push(c);
    return parseOpenAiCompletion(acc.toCompletion('complete'));
  };

  it('a stream whose provider never sent a usage chunk is UNMEASURED', () => {
    const r = streamed([
      { choices: [{ delta: { content: 'const a' } }] },
      { choices: [{ delta: { content: ' = 1;' }, finish_reason: 'stop' }] },
    ]);
    expect(r.text).toBe('const a = 1;');
    expect(r.usage.measured).toBe(false);
  });

  it('a stream that DOES honour include_usage is measured, and the counts survive', () => {
    const r = streamed([
      { choices: [{ delta: { content: 'x' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 40 } },
    ]);
    expect(r.usage.measured).toBeUndefined();
    expect(r.usage.inputTokens).toBe(900);
    expect(r.usage.outputTokens).toBe(40);
  });

  it('🔑 a STALLED stream keeps its partial answer AND stays honest about the missing usage', () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push({ choices: [{ delta: { content: 'half a file' } }] });
    const r = parseOpenAiCompletion(acc.toCompletion('idle'));
    expect(r.text).toBe('half a file');
    expect(r.truncated).toBe(true); // the recoverable shape the engine already handles
    expect(r.usage.measured).toBe(false);
  });
});

describe('the wiring — the fact must REACH the report, or the flag is decoration', () => {
  const runner = readFileSync('src/server/AgentV3/providers/MultiProviderTurnRunner.ts', 'utf8');
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('the turn runner forwards measured:false to the usage callback', () => {
    const at = runner.indexOf('opts.onTurnComplete?.(');
    expect(at).toBeGreaterThan(0);
    expect(runner.slice(at, at + 600)).toContain("measured: false");
  });

  it('captureTurnUsage records USAGE_NOT_REPORTED — the choke point every build and heal turn passes', () => {
    const start = route.indexOf('const captureTurnUsage =');
    expect(start).toBeGreaterThan(0);
    const end = route.indexOf('const recordProviderFallback =', start);
    expect(end).toBeGreaterThan(start);
    const body = route.slice(start, end);
    expect(body).toContain('USAGE_NOT_REPORTED');
    expect(body).toContain('usage.measured === false');
  });

  it('🔒 it fires at most once per build, like the cost ceiling beside it', () => {
    expect(route).toContain('let usageUnreportedFired = false;');
    const start = route.indexOf('const captureTurnUsage =');
    const body = route.slice(start, route.indexOf('const recordProviderFallback =', start));
    expect(body).toContain('!usageUnreportedFired');
    expect(body).toContain('usageUnreportedFired = true;');
  });

  it('🔒 a diagnostics throw can never disturb a build', () => {
    const start = route.indexOf('if (usage.measured === false && !usageUnreportedFired)');
    expect(start).toBeGreaterThan(0);
    const block = route.slice(start, start + 1600);
    expect(block).toMatch(/try\s*\{/);
    expect(block).toMatch(/\}\s*catch\s*\{/);
  });

  it('the notice names the flag to unset, so the admin can act without reading code', () => {
    const start = route.indexOf('USAGE_NOT_REPORTED');
    expect(route.slice(start, start + 1400)).toContain('AGENTV3_STREAM_BUILD_CALLS');
  });
});
