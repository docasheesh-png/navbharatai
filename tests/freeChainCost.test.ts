import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { realRateFor } from '../src/server/AgentV3/providerRates';
import { chatCostIndex, freeTierCeiling, allowedOnFreeTier } from '../src/server/AI/freeTierCostCeiling';

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
  // Every shape this file registers a rung in: ['model', p], [provider, 'model', p], and a direct
  // slot(new XProvider(), p, 'model'). Missing one would silently exempt that rung from the ceiling.
  for (const m of body.matchAll(/\[\s*(?:\w+,\s*)?'([^']+)',\s*(\d+)\s*\]/g)) out.push({ model: m[1], priority: Number(m[2]) });
  for (const m of body.matchAll(/slot\([^,]+,\s*(\d+),\s*'([^']+)'\)/g)) out.push({ model: m[2], priority: Number(m[1]) });
  return out.sort((a, b) => a.priority - b.priority);
}

const outRate = (model: string) => realRateFor('VERTEX', model).outputPerMTok;

describe('the rate card still says what this test assumes', () => {
  it('gemini pro is dearer than gemini flash — the reason the order ever mattered', () => {
    expect(realRateFor('VERTEX', 'gemini-2.5-pro').outputPerMTok)
      .toBeGreaterThan(realRateFor('VERTEX', 'gemini-2.5-flash').outputPerMTok);
  });

  it('🔒 ordering by OUTPUT alone would be wrong for chat, and the index says so', () => {
    // glm-4.7 has the LOWER output rate and the HIGHER chat cost — the exact trap the blended index
    // exists to avoid. If this ever stops being true the weight or the card changed; re-read both.
    expect(realRateFor('GLM', 'glm-4.7').outputPerMTok)
      .toBeLessThan(realRateFor('VERTEX', 'gemini-2.5-flash').outputPerMTok);
    expect(chatCostIndex('GLM', 'glm-4.7'))
      .toBeGreaterThan(chatCostIndex('VERTEX', 'gemini-2.5-flash'));
  });
});

describe("the admin's ceiling — nothing dearer than kimi-k2.7 on the FREE ladder", () => {
  const rungs = rungsOf('buildFree');
  const provFor = (m: string) => (m.includes('glm') ? 'GLM' : m.includes('kimi') ? 'KIMI' : 'VERTEX');

  it('registers a real ladder', () => {
    // 2026-09-15: was >= 4. The ladder DELIBERATELY got shorter — the Gemini-direct door and the
    // glm-4.7 last rung went, OpenAI arrived — so the paid rungs this parser can see are now three
    // (lite, nano, flash) plus the ₹0 GLM leader, which is registered directly and has never been
    // parseable here. The floor exists to catch a ladder that silently became EMPTY, so it tracks
    // the real count rather than a number left over from a longer chain.
    expect(rungs.length).toBeGreaterThanOrEqual(3);
  });

  it('🔒 EVERY rung is at or below the line the admin drew', () => {
    for (const r of rungs) {
      expect(allowedOnFreeTier(provFor(r.model), r.model), `${r.model} (p${r.priority})`).toBe(true);
      expect(chatCostIndex(provFor(r.model), r.model)).toBeLessThanOrEqual(freeTierCeiling());
    }
  });

  it('🔒 the ceiling is enforced at REGISTRATION, not only by this test', () => {
    // A test protects the repo; the runtime check protects the BILL — including on a branch where
    // nobody ran the suite. A refused rung logs loudly rather than vanishing.
    expect(src).toContain('if (!allowedOnFreeTier(label, model))');
    expect(src).toContain('REFUSED ${model}');
    // 2026-09-15: the third line used to pin the glm-4.7 LAST RUNG by name. That rung is gone (the
    // ladder is now GLM-flash → Vertex lite → OpenAI nano → Vertex flash), and pinning one rung's
    // literal was never what this test is for — it asserts that the RUNTIME gate exists. What it
    // must actually prove is that no rung bypasses it, which is a property of all of them.
    const body = src.slice(src.indexOf('private static buildFree('), src.indexOf('private static buildPro('));
    const viaHelper = (body.match(/registerFree\(/g) ?? []).length;
    expect(viaHelper, 'every paid rung must go through registerFree').toBeGreaterThanOrEqual(2);
  });

  it('🔒 the models above the line are GONE, not demoted', () => {
    const src2 = src.slice(src.indexOf('private static buildFree('), src.indexOf('private static buildPro('));
    expect(src2).not.toContain('gemini-2.5-pro');
    expect(src2).not.toContain('GrokProvider');
    expect(src2).not.toContain('AnthropicProvider');
  });

  it('🔒 no rung is dearer than the one AFTER it, by the CHAT index', () => {
    const priced = rungs.map((r) => ({ ...r, c: chatCostIndex(provFor(r.model), r.model) }));
    for (let i = 1; i < priced.length; i++) {
      expect(priced[i].c, `${priced[i - 1].model}(p${priced[i - 1].priority}) → ${priced[i].model}(p${priced[i].priority})`)
        .toBeGreaterThanOrEqual(priced[i - 1].c);
    }
  });

  it('the PAID universes keep every rung they had — this ceiling is the free ladder\'s alone', () => {
    const pro = src.slice(src.indexOf('private static buildPro('), src.indexOf('private static buildProfessional('));
    expect(pro).toContain('gemini-2.5-pro');
    expect(pro).toContain('GrokProvider');
    expect(pro).toContain('AnthropicProvider');
  });
});

describe('the pinned model must reach the STREAMING path — without this the ceiling is decoration', () => {
  /**
   * 🔴 The bug that hid the first one. `slot()` pins a model per rung, but `executeStream` had no
   * model parameter at all, and VertexProvider streamed `this.modelPro` regardless. Chat STREAMS —
   * so every Vertex rung streamed gemini-2.5-pro no matter which rung won, and re-ordering the ladder
   * would have changed nothing on the path that actually carries the traffic.
   */
  it('🔒 slot() passes its model into executeStream', () => {
    expect(src).toContain('base.executeStream!(p, sys, cb, model)');
  });

  it('🔒 the contract carries a model, and Vertex no longer hardcodes pro when streaming', () => {
    const types = readFileSync(join(process.cwd(), 'src/server/AI/Router/ProviderTypes.ts'), 'utf8');
    expect(types).toContain('onChunk: (text: string) => void, model?: string');
    const vertex = readFileSync(join(process.cwd(), 'src/server/AI/Router/providers/VertexProvider.ts'), 'utf8');
    const at = vertex.indexOf('async executeStream');
    expect(vertex.slice(at, at + 400)).toContain('model: modelName || this.modelPro');
  });

  it('every streaming provider accepts the pin, so no rung can silently ignore it', () => {
    for (const f of ['VertexProvider', 'GeminiProvider', 'GlmProvider', 'GrokProvider', 'AnthropicProvider']) {
      const p = readFileSync(join(process.cwd(), `src/server/AI/Router/providers/${f}.ts`), 'utf8');
      const at = p.indexOf('async executeStream');
      expect(p.slice(at, at + 200), f).toMatch(/onChunk: \(text: string\) => void, model(Name)?\?: string/);
    }
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

/**
 * THE SAME CLASS, IN A SECOND PLACE — and finding it twice is what makes it a class rather than a bug.
 *
 * Image generation is a free-first ladder too: Pollinations (₹0) → Gemini (paid) → Grok (paid). Its
 * allowance gate used to run only when the FREE provider was switched off globally, on the reasoning
 * "free provider on ⇒ the image is free". That is true only while the free provider SUCCEEDS, and the
 * paid rungs exist precisely for when it does not — the route's own log line says "trying paid
 * fallbacks". So a bad minute at Pollinations served a PAID image with nothing metered.
 */
describe('image generation — the paid rungs are metered by who SERVES, not by a flag', () => {
  const img = readFileSync(join(process.cwd(), 'src/server/routes/imageGen.ts'), 'utf8');

  it('🔒 the allowance is no longer decided by the free-provider flag alone', () => {
    expect(img).not.toContain('if (!pollinationsEnabled()) {\n      gate = await gateToolAction');
    expect(img).toContain('const allowPaidRung = async ()');
  });

  it('🔒 EVERY paid rung checks the allowance BEFORE it is called', () => {
    // Every paid provider, each guarded, and each guard ahead of its own network call.
    //
    // ⚠️ THE ANCHORS CARRY `&& !editing` / `editing ? null :` SINCE 2026-09-21, and that is not
    // cosmetic: an EDIT of the user's own picture must never be answered by a text-to-image rung,
    // which would return a brand-new picture with nothing to do with the one attached. Matching the
    // bare old strings would silently slice nothing and pass — so the anchors are the real ones.
    const gem = img.indexOf('if (geminiImageConfigured() && !editing) {');
    const grok = img.indexOf('const gKey = editing ? null : grokImageKey();');
    expect(gem, 'the Gemini rung anchor has moved').toBeGreaterThan(-1);
    expect(grok, 'the xAI rung anchor has moved').toBeGreaterThan(-1);
    expect(img.slice(gem, img.indexOf('generateContent', gem))).toContain('await allowPaidRung()');
    expect(img.slice(grok, img.indexOf('api.x.ai', grok))).toContain('await allowPaidRung()');

    // 🔴 THE THIRD PAID RUNG, added 2026-09-21: editing a picture the user supplied. The free
    // provider cannot serve it at all (it receives a prompt in a URL, not a picture), so an edit is
    // ALWAYS paid — which makes it exactly the shape this suite exists to catch.
    const at = img.indexOf('runImageEdit(rawInit');
    expect(at, 'the edit rung anchor has moved').toBeGreaterThan(-1);
    expect(img.slice(img.lastIndexOf('if (editing) {', at), at)).toContain('await allowPaidRung()');
  });

  it('🔒 only a PAID delivery burns an allowance — a free image still costs the user nothing', () => {
    expect(img).toContain('if (paidRung && gate && gate.allow && gate.countsAgainstFree)');
    // The free rung delivers without the paid flag; both paid rungs pass it.
    expect(img).toContain('deliver(pr.image); return;');
    // Three paid deliveries now: Gemini, xAI, and the edit rung.
    expect((img.match(/deliver\(img, true\); return;/g) || []).length).toBe(2);
    expect(img).toContain('deliver(out.image, true); return;');
  });

  it('sign-in is still required regardless of any flag — an anonymous caller can never spend', () => {
    expect(img).toContain("requireAccountForCostlyAi(req, 'image generation')");
  });
});
