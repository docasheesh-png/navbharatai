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
    // ⚠️ THIS GUARD USED A FIXED 700-CHARACTER WINDOW AND BROKE ON CORRECT CODE (2026-09-17) — the
    // seventh brittle fixed-window guard to do so in this repo in one day. Adding the `stalled` field
    // to the SAME object pushed `usageMeasured: false` past character 700, so a guard about HONEST
    // TOKEN REPORTING failed over an unrelated field's byte offset. A guard must measure the claim it
    // is named for; `usageMeasured` lives in this object however many fields the object grows, so the
    // OBJECT is what to read. Same reasoning `tests/helpers/sourceSlice.ts` exists for.
    const at = chat.indexOf('streamed: true');
    expect(at).toBeGreaterThan(-1);
    const row = objectLiteralAround(chat, at);
    expect(row).toContain('usageMeasured: false');
    expect(row).not.toContain('inputTokens: 0');
  });

  it('🔴 a STALL is logged under its own field, never as a failureReason', () => {
    // #3035 introduced `reason: 'stalled'` on a turn that ANSWERED (ok: true, real text on screen).
    // This line used to write every reason into `failureReason`, so a successful turn would have been
    // filed as a failure by any reader that trusts the field's name.
    expect(chat).toContain("outcome?.reason === 'stalled'");
    expect(chat).toContain('{ stalled: true }');
    expect(chat).not.toMatch(/\.\.\.\(outcome\?\.reason \? \{ failureReason/);
    // …and a genuine failure reason still lands in the field that means failure.
    expect(chat).toContain('{ failureReason: outcome.reason }');
  });
});

describe('🔴 a truncated answer must not be presented as a complete one', () => {
  const chatSrc = readFileSync(join(__dirname, '../src/server/routes/chat.ts'), 'utf8');
  const chatCode = chatSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('a stalled stream tells the user it stopped short, before [DONE]', () => {
    // Without this, the reply just stops mid-sentence and `[DONE]` follows: the user cannot tell
    // whether the assistant finished or whether to ask again.
    expect(chatCode).toContain("outcome?.reason === 'stalled'");
    expect(chatCode).toContain('went quiet before finishing this answer');
    const notice = chatCode.indexOf('went quiet before finishing this answer');
    const done = chatCode.indexOf("data: [DONE]", notice);
    expect(notice).toBeGreaterThan(-1);
    expect(done).toBeGreaterThan(notice); // the notice must precede the close, or nobody sees it
  });

  it('🔒 it names NO provider — the White-Label Law applies to a caveat too', () => {
    const at = chatSrc.indexOf('went quiet before finishing');
    expect(at).toBeGreaterThan(-1); // ⚠️ or the slice below is junk and every assertion is vacuous
    const line = chatSrc.slice(at - 200, at + 200);
    for (const vendor of ['GLM', 'Z.ai', 'Kimi', 'Moonshot', 'Claude', 'Anthropic', 'Gemini', 'Vertex', 'Grok', 'OpenAI']) {
      expect(line).not.toContain(vendor);
    }
    expect(line).toContain('NavBharatAI');
  });

  it('a CLEAN finish carries no caveat — the notice is gated on the stall alone', () => {
    // The guard that matters: if this were unconditional, every successful answer would end with an
    // apology for something that did not happen.
    const at = chatCode.indexOf('went quiet before finishing');
    // ⚠️ ASSERT THE ANCHOR FIRST. Without this, `at` is -1, `slice(0, -1)` is the whole file, and the
    // assertion below passes or fails for reasons that have nothing to do with the claim. THREE of
    // the guards in this describe block were written that way and passed with the code REVERTED —
    // the third time in one session that "a test that cannot fail is not a test" had to be paid for.
    expect(at).toBeGreaterThan(-1);
    const before = chatCode.slice(Math.max(0, at - 400), at);
    expect(before).toContain("outcome?.reason === 'stalled'");
  });

  it('is professional ENGLISH, per the 2026-09-14 language standard', () => {
    const at = chatSrc.indexOf('went quiet before finishing');
    expect(at).toBeGreaterThan(-1); // ⚠️ a `not.toMatch` on an empty slice is the emptiest guard there is
    const line = chatSrc.slice(at - 300, at + 300);
    // Devanagari in a client-facing string is what the admin caught on the voice-consent popup:
    // "south india wale kaise padhenge isko??"
    expect(line).not.toMatch(/[\u0900-\u097F]/);
  });
});

/**
 * The `{ … }` object literal that CONTAINS `from` — brace-matched, so it is the whole row however
 * many fields it grows. Replaces a fixed character window, which measures formatting rather than the
 * claim under test.
 */
function objectLiteralAround(src: string, from: number): string {
  let open = src.lastIndexOf('{', from);
  // Walk back past any nested literal that closed before `from` (a spread's `{ latencyMs: … }`).
  while (open > 0) {
    const between = src.slice(open, from);
    if ((between.match(/\}/g) ?? []).length <= (between.match(/\{/g) ?? []).length - 1) break;
    open = src.lastIndexOf('{', open - 1);
  }
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}
