import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import OpenAI from 'openai';
import ts from 'typescript';
import { composeJudgeChain, describeJudgeAttempts, type JudgeCandidate } from '../src/server/AgentV3/judgeChain';

const args = { model: 'caller-model', system: 'review', messages: [], maxTokens: 100 };
const balance = '429 account suspended due to insufficient balance';
const candidate = (runTurn: JudgeCandidate['runTurn'], modelId = 'glm-test'): JudgeCandidate => ({ kind: 'glm', modelId, runTurn });
const healthy = () => vi.fn(async () => ({ text: 'review delivered' }));

function judgeSdkRetries(): number {
  const route = ts.createSourceFile('agentv3.ts', readFileSync('src/server/routes/agentv3.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const factory = route.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'openAiJudgeCandidate');
  let value: number | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && node.expression.getText(route) === 'OpenAI') {
      const options = node.arguments?.[0];
      if (options && ts.isObjectLiteralExpression(options)) {
        const retries = options.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(route) === 'maxRetries');
        if (retries && ts.isNumericLiteral(retries.initializer)) value = Number(retries.initializer.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  if (factory) visit(factory);
  expect(value, 'the judge factory must declare its SDK retry budget explicitly').toBeDefined();
  return value!;
}

describe('a judge account that cannot answer is not re-probed on re-review', () => {
  it.each([balance, 'authentication_error: invalid API key', '404 model not found'])('remembers permanent candidate failure: %s', async (message) => {
    const failed = vi.fn(async () => { throw new Error(message); });
    const working = healthy();
    const chain = composeJudgeChain([candidate(failed), { kind: 'grok', modelId: 'grok-test', runTurn: working }]);
    expect(chain.plannedKind()).toBe('glm');
    await chain.runTurn(args);
    await chain.runTurn(args);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(working).toHaveBeenCalledTimes(2);
    expect(chain.attempts()[0]).toMatchObject({ kind: 'glm', ok: false, skipped: true });
    expect(chain.attempts()[0].reason).toContain(message);
    const note = describeJudgeAttempts(chain.attempts(), (kind) => kind.toUpperCase());
    expect(note).toContain('GLM (glm-test) skipped');
    expect(note).not.toContain('GLM (glm-test) failed');
    expect(chain.servedBy()).toBe('grok');
    expect(chain.plannedKind()).toBe('grok');
  });

  it.each(['429 tokens per minute rate limit', '503 temporarily overloaded', 'Request timed out.'])('leaves transient failure retryable: %s', async (message) => {
    const first = vi.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValue({ text: 'recovered' });
    const fallback = healthy();
    const chain = composeJudgeChain([candidate(first), { kind: 'grok', modelId: 'grok-test', runTurn: fallback }]);
    await chain.runTurn(args);
    expect((await chain.runTurn(args)).text).toBe('recovered');
    expect(first).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(chain.attempts()).toHaveLength(1);
    expect(chain.attempts()[0]).toMatchObject({ ok: true });
  });

  it('keeps an independent credential for the same judge family and model available', async () => {
    const failed = vi.fn(async () => { throw new Error(balance); });
    const funded = healthy();
    const chain = composeJudgeChain([candidate(failed), candidate(funded)]);
    await chain.runTurn(args);
    await chain.runTurn(args);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(funded).toHaveBeenCalledTimes(2);
  });

  it('starts with fresh retirement memory in a new review chain', async () => {
    const failed = vi.fn(async () => { throw new Error(balance); });
    const rungs = [candidate(failed), candidate(healthy(), 'funded-model')];
    await composeJudgeChain(rungs).runTurn(args);
    await composeJudgeChain(rungs).runTurn(args);
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it('retains the actual permanent failure when every candidate is retired', async () => {
    const failure = new Error(balance);
    const failed = vi.fn(async () => { throw failure; });
    const chain = composeJudgeChain([candidate(failed)]);
    await expect(chain.runTurn(args)).rejects.toBe(failure);
    await expect(chain.runTurn(args)).rejects.toBe(failure);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(chain.attempts()[0]).toMatchObject({ skipped: true, ok: false });
    expect(chain.servedBy()).toBeNull();
    expect(chain.plannedKind()).toBeNull();
  });

  it('keeps servedBy as the most recent successful judge when a later review fails', async () => {
    const first = vi.fn().mockResolvedValueOnce({ text: 'review delivered' }).mockRejectedValue(new Error('503 temporarily overloaded'));
    const chain = composeJudgeChain([candidate(first)]);
    await chain.runTurn(args);
    await expect(chain.runTurn(args)).rejects.toThrow('503');
    expect(chain.servedBy()).toBe('glm');
    expect(chain.attempts()).toEqual([{ kind: 'glm', modelId: 'glm-test', ok: false, reason: '503 temporarily overloaded' }]);
  });
});

describe('the composed judge chain owns its fallback attempts', () => {
  afterEach(() => vi.useRealTimers());

  it('does not let the SDK retry the same account-balance 429 behind the chain', async () => {
    vi.useFakeTimers();
    let began!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    const fetch = vi.fn(async () => {
      began();
      return new Response(JSON.stringify({ error: { message: balance } }), {
        status: 429, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
      });
    });
    const sdk = new OpenAI({ apiKey: 'test-only', baseURL: 'https://unused.invalid', maxRetries: judgeSdkRetries(), fetch });
    const ended = sdk.chat.completions.create({ model: 'glm-test', messages: [] }).catch((error) => error);
    await started;
    await vi.runAllTimersAsync();
    expect((await ended).message).toContain('insufficient balance');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('every OpenAI-compatible judge uses explicit zero SDK retries', () => {
    expect(judgeSdkRetries()).toBe(0);
  });
});
