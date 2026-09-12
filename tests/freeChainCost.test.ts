import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { realRateFor } from '../src/server/AgentV3/providerRates';

/**
 * A FREE USER'S FALLBACK MUST CLIMB CHEAPEST-FIRST — because nobody is billed for it.
 *
 * Free chat is not wallet-charged: every rupee it spends is NavBharatAI's. The paid rungs used to be
 * registered dearest-first — `gemini-2.5-pro` ($10/MTok out) above `gemini-2.5-flash` ($2.50) — so the
 * moment the free GLM leader rate-limited, every free turn cost 4× what the rung beneath it would have.
 *
 * The policy was already written down in this very file, for the professional free tier:
 *   "Vertex (cheap Gemini on Google), NEVER Grok / direct Gemini / Claude … so a free user can never
 *    trigger the pricier paid providers. gemini-2.5-flash primary → -flash-lite (cheaper) fallback."
 * The bug was that the twin universe every ordinary user hits did not follow it.
 *
 * These tests read the ORDER out of the source and price it with the platform's OWN rate card, so they
 * fail if either the order or a price changes in a way that puts an expensive model in front of a cheap
 * one. Nothing here asserts a hardcoded position — only the money relationship.
 */

const src = readFileSync(join(process.cwd(), 'src/server/AI/AIRouterManager.ts'), 'utf8');

/** The [model, priority] pairs registered inside one builder, in source order. */
function rungsOf(builder: string): Array<{ model: string; priority: number }> {
  const at = src.indexOf(`private static ${builder}(`);
  expect(at, builder).toBeGreaterThan(-1);
  const end = src.indexOf('\n  }', src.indexOf('return router;', at));
  const body = src.slice(at, end);
  const out: Array<{ model: string; priority: number }> = [];
  // Matches both tuple shapes in this file: ['model', priority] and [provider, 'model', priority].
  for (const m of body.matchAll(/\[\s*(?:\w+,\s*)?'([^']+)',\s*(\d+)\s*\]/g)) out.push({ model: m[1], priority: Number(m[2]) });
  return out.sort((a, b) => a.priority - b.priority);
}

const outRate = (model: string) => realRateFor('VERTEX', model).outputPerMTok;

describe('the rate card still says what this test assumes', () => {
  it('gemini pro is dearer than gemini flash — the whole reason the order matters', () => {
    expect(outRate('gemini-2.5-pro')).toBeGreaterThan(outRate('gemini-2.5-flash'));
  });

  it('grok is the dearest rung in the card', () => {
    expect(realRateFor('GROK').outputPerMTok).toBeGreaterThan(outRate('gemini-2.5-pro'));
  });
});

describe('buildFree — the paid rungs climb cheapest-first', () => {
  const rungs = rungsOf('buildFree');

  it('registers a real ladder', () => {
    expect(rungs.length).toBeGreaterThanOrEqual(3);
  });

  it('🔒 no rung is dearer than the one AFTER it — an expensive model is never tried first', () => {
    const priced = rungs.map((r) => ({ ...r, out: outRate(r.model) }));
    for (let i = 1; i < priced.length; i++) {
      expect(
        priced[i].out,
        `${priced[i - 1].model}(p${priced[i - 1].priority}) → ${priced[i].model}(p${priced[i].priority})`,
      ).toBeGreaterThanOrEqual(priced[i - 1].out);
    }
  });

  it('🔒 gemini-2.5-pro is NOT the first paid fallback — that was the bug, at 4× the price', () => {
    const first = rungs[0];
    expect(first.model).not.toBe('gemini-2.5-pro');
    const pro = rungs.find((r) => r.model === 'gemini-2.5-pro');
    const flash = rungs.find((r) => r.model === 'gemini-2.5-flash');
    expect(pro && flash && pro.priority > flash.priority).toBe(true);
  });

  it('🔒 grok stays the LAST resort — it is dearer than every Claude tier', () => {
    const at = src.indexOf('private static buildFree(');
    const body = src.slice(at, src.indexOf('return router;', at));
    const grokPriority = Number(/grok\.priority = (\d+)/.exec(body)?.[1]);
    expect(grokPriority).toBeGreaterThan(Math.max(...rungs.map((r) => r.priority)));
  });

  it('nothing was REMOVED — every model that could answer before still can', () => {
    const models = rungs.map((r) => r.model);
    for (const m of ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
      expect(models, m).toContain(m);
    }
    expect(src.slice(src.indexOf('private static buildFree('))).toContain('new GrokProvider()');
  });
});

describe('the free professional fallback — the universe that already had it right', () => {
  it('still contains only the cheap Vertex rungs, and no pricier provider', () => {
    const at = src.indexOf('private static buildProfessionalFreeFallback(');
    const body = src.slice(at, src.indexOf('return router;', at));
    expect(body).toContain('gemini-2.5-flash');
    expect(body).not.toContain('GrokProvider');
    expect(body).not.toContain('AnthropicProvider');
    expect(body).not.toContain('gemini-2.5-pro');
  });
});
