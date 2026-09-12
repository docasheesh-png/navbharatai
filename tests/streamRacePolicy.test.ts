import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shouldRaceStreams } from '../src/server/AI/Router/streamRacePolicy';

/**
 * A RACE COSTS TWO MODELS AND BUYS ONE SECOND — so it belongs where someone is paying.
 *
 * `routeStream` starts the top two providers concurrently and serves whichever speaks first. The
 * loser's answer is discarded; its invoice is not. On the FREE universe, whose leader is ₹0 and whose
 * second rung was `gemini-2.5-pro` at $10/MTok, that meant EVERY turn — not every failure, every turn
 * — also paid for a gemini-2.5-pro call. Nobody chose that: the race was written for the paid path and
 * the free path inherited it silently.
 */

describe('shouldRaceStreams — speed is bought only where it is paid for', () => {
  const env = (v?: string) => (v === undefined ? {} : { AI_STREAM_RACE: v }) as NodeJS.ProcessEnv;

  it('🔒 FREE does not race — the second model would be a duplicate bill on a tier that earns nothing', () => {
    expect(shouldRaceStreams('free', env())).toBe(false);
  });

  it('paid universes still race — those users bought the product, and speed is part of it', () => {
    expect(shouldRaceStreams('pro', env())).toBe(true);
    expect(shouldRaceStreams('professional', env())).toBe(true);
  });

  it('🔒 an UNRECOGNISED universe does not race — the safe side is the one that cannot double a bill', () => {
    expect(shouldRaceStreams('default', env())).toBe(false);
    expect(shouldRaceStreams('', env())).toBe(false);
    expect(shouldRaceStreams(undefined as never, env())).toBe(false);
  });

  it('reverts without a deploy, in both directions', () => {
    expect(shouldRaceStreams('free', env('all'))).toBe(true);      // the old behaviour, everywhere
    expect(shouldRaceStreams('pro', env('off'))).toBe(false);      // off everywhere, including paid
    expect(shouldRaceStreams('pro', env(' ALL '))).toBe(true);     // as an operator would type it
  });

  it('an unreadable value falls back to the RULE, never to racing everywhere', () => {
    expect(shouldRaceStreams('free', env('yes'))).toBe(false);
    expect(shouldRaceStreams('free', env('true'))).toBe(false);
  });
});

describe('wiring — the policy actually governs the router, and the outcome reaches the log', () => {
  const router = readFileSync(join(process.cwd(), 'src/server/AI/Router/AIRouter.ts'), 'utf8');
  const chat = readFileSync(join(process.cwd(), 'src/server/routes/chat.ts'), 'utf8');

  it('🔒 routeStream consults the policy before it starts a second provider', () => {
    expect(router).toContain('if (!p2 || !shouldRaceStreams(this.universe))');
    // And the non-racing path is a real ladder walk, not a single attempt.
    expect(router).toContain('private async streamSequential(');
    expect(router).toContain('return await this.streamSequential(allProviders,');
  });

  it('the 12-second no-commit fallback reuses the SAME walker — one behaviour, one implementation', () => {
    expect(router).toContain('return await this.streamSequential(rest,');
  });

  it('🔒 routeStream reports who served — it used to return Promise<void> and say nothing', () => {
    expect(router).toContain('): Promise<StreamOutcome> {');
    expect(router).toContain('provider: winner.name, model: winner.pinnedModel');
    expect(router).not.toContain('async routeStream(\n    prompt: string,\n    systemPrompt: string | undefined,\n    onChunk: (text: string) => void,\n    signal?: AbortSignal,\n  ): Promise<void>');
  });

  it('🔒 the STREAMING chat turn now writes a usage row — it wrote none at all before', () => {
    const at = chat.indexOf('aiRouter.routeStream(');
    expect(at).toBeGreaterThan(-1);
    const after = chat.slice(at, chat.indexOf('} else {', at));
    expect(after).toContain("addDoc(collection(getDb() as any, 'ai_usage_logs')");
    expect(after).toContain('streamed: true');
    expect(after).toContain('raced: outcome.raced');
  });

  it('🔒 it says "we do not know" about tokens rather than writing a zero', () => {
    const at = chat.indexOf('streamed: true');
    expect(chat.slice(at, at + 700)).toContain('usageMeasured: false');
    expect(chat.slice(at, at + 700)).not.toContain('inputTokens: 0');
  });
});
