// "kimi ko bade aur complex task dedo… starting me bhi" + "code se pata na lage to gptnano se puchwa lo"
// (admin 2026-09-17). These cases pin BOTH halves, and — more importantly — the two things that keep
// the feature honest: it never spends a model call it cannot act on, and it can never break a build.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMPLEX_SCORE_LINE, BORDERLINE_MARGIN, complexityFromScore, needsSecondOpinion,
  parseComplexityAnswer, complexityPrompt, decideComplexity, startLadderForComplexity,
  complexityWouldReroute, complexityRoutingEnabled, scorerCouldNotRead,
} from '../src/server/AgentV3/complexityRouting';
import { TIER_LADDERS, healLadder } from '../src/server/AgentV3/tierLadder';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';

const seq = (rungs: readonly { provider: string; model: string }[]): string[] => rungs.map((r) => `${r.provider}:${r.model}`);

describe('the line is RequestAnalyser\'s own, not a second invented threshold', () => {
  it('40 is the boundary, and the margin matches isNearBoundary', () => {
    expect(COMPLEX_SCORE_LINE).toBe(40);
    expect(BORDERLINE_MARGIN).toBe(3);
  });

  it('scores map the way the analyser already tiers them', () => {
    expect(complexityFromScore(15)).toBe('simple');   // simple_app base, capped ≤20
    expect(complexityFromScore(30)).toBe('simple');   // coding
    expect(complexityFromScore(40)).toBe('simple');   // exactly ON the line stays cheap
    expect(complexityFromScore(45)).toBe('complex');  // debugging
    expect(complexityFromScore(58)).toBe('complex');  // complex_app
    expect(complexityFromScore(80)).toBe('complex');  // architecture
  });

  it('a nonsense score is simple, never complex — doubt never spends the dearer rung', () => {
    for (const bad of [NaN, Infinity, -Infinity]) expect(complexityFromScore(bad as number)).toBe('simple');
  });
});

describe('💸 a model call is only bought when its answer could change the outcome', () => {
  it('borderline is the 40 line ONLY — not the analyser\'s other boundary at 20', () => {
    expect(needsSecondOpinion(40)).toBe(true);
    expect(needsSecondOpinion(37)).toBe(true);
    expect(needsSecondOpinion(43)).toBe(true);
    expect(needsSecondOpinion(36)).toBe(false);
    expect(needsSecondOpinion(44)).toBe(false);
    // 20 is a boundary for RequestAnalyser's three tiers but not for THIS binary decision: both sides
    // of it are 'simple', so a call there would move the verdict from simple to simple.
    expect(needsSecondOpinion(20)).toBe(false);
    expect(needsSecondOpinion(18)).toBe(false);
  });

  it('a clear-cut request never calls the model at all', async () => {
    let calls = 0;
    const llm = async (): Promise<string> => { calls += 1; return 'complex'; };
    const simple = await decideComplexity({ prompt: 'make a calculator', score: 15 }, llm);
    const complex = await decideComplexity({ prompt: 'build a social network', score: 58 }, llm);
    expect(calls).toBe(0);
    expect(simple.verdict).toBe('simple');
    expect(complex.verdict).toBe('complex');
    expect(simple.source).toBe('deterministic');
    expect(complex.source).toBe('deterministic');
  });

  it('a borderline request calls it exactly once and takes its answer', async () => {
    let calls = 0;
    const llm = async (): Promise<string> => { calls += 1; return 'complex'; };
    const d = await decideComplexity({ prompt: 'a booking site for my clinic', score: 41 }, llm);
    expect(calls).toBe(1);
    expect(d.verdict).toBe('complex');
    expect(d.source).toBe('model');
  });
});

// "jo language hamara code nahi samajh paye" (admin 2026-09-17). The scorer's signals are ALL ASCII, so
// a request in an Indian script is not merely mis-scored — it is unread, and the score-based ask above
// cannot catch that: such a request used to score 5, and 5 is nowhere near the 40 line. It is floored
// on script-neutral evidence now (`scriptNeutralFloor`, later the same day) and still lands well
// below the line for anything short of a big spec, so reading the SCRIPT is what buys the call.
describe('🔴 a request the scorer could not READ is asked about, whatever it scored', () => {
  /**
   * ⚠️ THIS CASE ASSERTED THE HOLE, AND THAT ASSERTION WAS ITSELF THE BUG — corrected the same day,
   * with the reason kept here rather than silently deleted. It read
   * `expect(a.complexityScore).toBeLessThan(20)`, i.e. it pinned the scorer's claim that a
   * multi-feature hospital app was smaller than a calculator. That was an accurate description of
   * the code on the morning it was written and the wrong thing to hold still: the second opinion
   * this file buys is the better ANSWER, and `analyzeRequest` flooring the request on script-neutral
   * evidence (`scriptNeutralFloor`) is what makes the answer we already had HONEST — needed exactly
   * when no classifier is available, which is the case this file's own fallback covers.
   *
   * What the case really exists to prove is unchanged and is still asserted below: the SCORE alone
   * would never buy a second opinion for a request in this script, and reading the prompt does.
   */
  /**
   * ⚠️ THE FIXTURE MOVED ON 2026-09-18, AND THE CASE'S CLAIM DID NOT — the third correction to this
   * one test, kept here for the same reason the two above it are.
   *
   * It used to use a Devanagari HOSPITAL prompt, chosen when nothing in the sizing path could read a
   * word of it. That is no longer true: `RequirementGapAnalyzer` now carries the Devanagari spellings
   * of the Hindi words it already accepted in Latin letters (`अस्पताल` is the same word as the
   * `aspatal` that was always in its healthcare list), so that prompt is now READ — `complex_app`,
   * score 58. Pinned as a positive fact in the case below rather than deleted.
   *
   * ⚠️ AND THE OLD ASSERTION MUST NOT SIMPLY BE RELAXED TO MATCH. What this case exists to prove is
   * about a request the scorer genuinely CANNOT read, so the fixture has to be one: a drawing app
   * names no business domain in any script. It satisfies every original assertion unchanged — a
   * fallthrough `chat`, `unreadable`, a score floored above 20 by script-neutral evidence (six
   * enumerated parts), and an ask that the score alone would never buy.
   */
  it('the score alone never asks about an unread request — reading the prompt is what does', () => {
    const hindi = 'एक ड्रॉइंग ऐप बनाओ जिसमें रंग, ब्रश, मिटाने वाला, परतें, ज़ूम और सेव करने की सुविधा हो';
    const a = analyzeRequest({ prompt: hindi });
    expect(a.taskType).toBe('chat');                 // a FALLTHROUGH, not a classification
    expect(a.unreadable).toBe(true);                 // …and the scorer now SAYS so
    expect(a.complexityScore).toBeGreaterThan(20);   // floored on script-neutral evidence, not a 5
    expect(needsSecondOpinion(a.complexityScore)).toBe(false);   // the score alone would NEVER ask
    expect(needsSecondOpinion(a.complexityScore, hindi)).toBe(true); // reading the prompt does
  });

  it('…and a Devanagari prompt that DOES name a domain is now read, not floored', () => {
    // The fixture this case used to hold. It needed the script-neutral floor because nothing could
    // read it; it does not any more, and a build sized `complex_app` never depended on the ask above.
    const hindi = 'एक अस्पताल प्रबंधन ऐप बनाओ जिसमें डॉक्टर लॉगिन, मरीज़ रिकॉर्ड, अपॉइंटमेंट बुकिंग, बिलिंग और रिपोर्ट हों';
    const a = analyzeRequest({ prompt: hindi });
    expect(a.taskType).toBe('complex_app');
    expect(a.complexityScore).toBeGreaterThan(40);
    // Still honestly marked unread — the SIGNALS in `RE` cannot read it; the DOMAIN classifier can.
    expect(a.unreadable).toBe(true);
  });

  it('is script-agnostic — India is not one script', () => {
    for (const p of [
      'একটি হাসপাতাল ব্যবস্থাপনা অ্যাপ তৈরি করুন',      // Bengali
      'ஒரு மருத்துவமனை மேலாண்மை செயலியை உருவாக்கவும்',   // Tamil
      'ఒక ఆసుపత్రి నిర్వహణ యాప్‌ను రూపొందించండి',        // Telugu
      'ایک ہسپتال مینجمنٹ ایپ بنائیں',                  // Urdu
    ]) expect(scorerCouldNotRead(p), p).toBe(true);
  });

  it('romanized Hinglish is NOT unread — the signals really do read it', () => {
    // The one real Hinglish build report in evidence (58f110de) landed mid-pack on every measure.
    expect(scorerCouldNotRead('Text to image generator app banao asli .')).toBe(false);
    expect(scorerCouldNotRead('ek todo app banao jisme login ho')).toBe(false);
    expect(scorerCouldNotRead('build me a hospital management app with billing')).toBe(false);
  });

  it('one foreign word inside an English sentence is not an unread request', () => {
    expect(scorerCouldNotRead('build a todo app, call it मेरा ऐप')).toBe(false);
  });

  it('💸 a scrap too short to classify never buys a call', async () => {
    expect(scorerCouldNotRead('ऐप')).toBe(false);
    expect(scorerCouldNotRead('')).toBe(false);
    expect(scorerCouldNotRead('🎨🎨🎨🎨🎨🎨🎨🎨')).toBe(false);   // emoji are not letters
    let calls = 0;
    await decideComplexity({ prompt: 'ऐप', score: 5 }, async () => { calls += 1; return 'complex'; });
    expect(calls).toBe(0);
  });

  it('end to end: the unread request reaches the second opinion and is rerouted to KIMI', async () => {
    const hindi = 'एक अस्पताल प्रबंधन ऐप बनाओ जिसमें डॉक्टर लॉगिन, मरीज़ रिकॉर्ड और बिलिंग हो';
    let asked = '';
    const d = await decideComplexity(
      { prompt: hindi, score: analyzeRequest({ prompt: hindi }).complexityScore },
      async (p) => { asked = p; return 'complex'; },
    );
    expect(asked).toContain(hindi.slice(0, 20));     // the prompt is PASSED, never translated first
    expect(d.verdict).toBe('complex');
    expect(d.source).toBe('model');
    expect(seq(startLadderForComplexity(TIER_LADDERS.weak, d.verdict))[0]).toBe('KIMI:kimi-k2.7-code');
  });

  it('🔒 an unread request the model cannot answer stays on TODAY\'s behaviour — never a guess', async () => {
    const d = await decideComplexity({ prompt: 'एक अस्पताल प्रबंधन ऐप बनाओ जिसमें बिलिंग हो', score: 5 },
      async () => { throw new Error('down'); });
    expect(d.verdict).toBe('simple');                // the cheap rung, exactly as before this change
    expect(d.source).toBe('model-unavailable');
    expect(d.reason).toContain('script');            // and the report says WHY it could not be sure
  });

  it('🔒 the reason line still names no vendor', async () => {
    const d = await decideComplexity({ prompt: 'एक अस्पताल प्रबंधन ऐप बनाओ जिसमें बिलिंग हो', score: 5 },
      async () => 'complex');
    expect(d.reason).not.toMatch(/glm|kimi|claude|anthropic|openai|gpt|nano|sonnet|opus|gemini|grok/i);
  });
});

describe('🔒 it can never break, hang or mislead a build', () => {
  it('a thrown call falls back to the score, not to a guess', async () => {
    const d = await decideComplexity({ prompt: 'x', score: 41 }, async () => { throw new Error('down'); });
    expect(d.verdict).toBe('complex');           // 41 > 40 → the score's own answer
    expect(d.source).toBe('model-unavailable');
  });

  it('a hanging call is raced and the score still decides', async () => {
    const never = (): Promise<string> => new Promise(() => { /* never settles */ });
    const started = Date.now();
    const d = await decideComplexity({ prompt: 'x', score: 39 }, never, { timeoutMs: 500 });
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(d.verdict).toBe('simple');            // 39 ≤ 40
    expect(d.source).toBe('model-unavailable');
  });

  it('an unparseable answer is "no answer", never a coin toss', async () => {
    for (const junk of ['', '   ', 'maybe', 'I think it depends on…', 'null', '42']) {
      const d = await decideComplexity({ prompt: 'x', score: 41 }, async () => junk);
      expect(d.source, junk).toBe('model-unavailable');
      expect(d.verdict, junk).toBe('complex');   // the deterministic verdict for 41
    }
  });

  it('reads a real one-word answer in the shapes a small model actually returns', () => {
    expect(parseComplexityAnswer('complex')).toBe('complex');
    expect(parseComplexityAnswer('Complex.')).toBe('complex');
    expect(parseComplexityAnswer('  SIMPLE\n')).toBe('simple');
    expect(parseComplexityAnswer('simple — one screen')).toBe('simple');
    expect(parseComplexityAnswer('big')).toBe('complex');
    expect(parseComplexityAnswer('small')).toBe('simple');
    expect(parseComplexityAnswer(null)).toBeNull();
  });

  it('the kill switch restores the old behaviour exactly — every build opens on rung 1', async () => {
    const env = { AGENTV3_COMPLEX_TO_KIMI: 'off' } as NodeJS.ProcessEnv;
    expect(complexityRoutingEnabled(env)).toBe(false);
    let calls = 0;
    const d = await decideComplexity(
      { prompt: 'build a full social network with auth and payments', score: 80 },
      async () => { calls += 1; return 'complex'; },
      { env },
    );
    expect(d.verdict).toBe('simple');   // 'simple' == "do not reroute"
    expect(d.source).toBe('disabled');
    expect(calls).toBe(0);              // and it costs nothing while off
    expect(seq(startLadderForComplexity(TIER_LADDERS.weak, d.verdict))).toEqual(seq(TIER_LADDERS.weak));
  });

  it('is ON unless explicitly switched off', () => {
    expect(complexityRoutingEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(complexityRoutingEnabled({ AGENTV3_COMPLEX_TO_KIMI: 'on' } as NodeJS.ProcessEnv)).toBe(true);
    expect(complexityRoutingEnabled({ AGENTV3_COMPLEX_TO_KIMI: ' OFF ' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('a complex build starts on KIMI — "starting me bhi", literally', () => {
  it('Weak: the cheap flash opener is skipped, so Kimi sees it first', () => {
    expect(seq(startLadderForComplexity(TIER_LADDERS.weak, 'complex'))[0]).toBe('KIMI:kimi-k2.7-code');
    expect(seq(startLadderForComplexity(TIER_LADDERS.weak, 'complex'))).toEqual(seq(TIER_LADDERS.weak).slice(1));
  });

  it('Normal: same, on its own Kimi rung', () => {
    expect(seq(startLadderForComplexity(TIER_LADDERS.off, 'complex'))[0]).toBe('KIMI:kimi-k2.7-code-highspeed');
  });

  it('Strong is untouched — it has no cheap opener to skip', () => {
    expect(seq(startLadderForComplexity(TIER_LADDERS.mini, 'complex'))).toEqual(seq(TIER_LADDERS.mini));
    expect(complexityWouldReroute(TIER_LADDERS.mini)).toBe(false);
    expect(complexityWouldReroute(TIER_LADDERS.weak)).toBe(true);
    expect(complexityWouldReroute(TIER_LADDERS.off)).toBe(true);
  });

  it('a simple verdict reorders nothing, on any tier', () => {
    for (const tier of ['weak', 'off', 'mini'] as const) {
      expect(seq(startLadderForComplexity(TIER_LADDERS[tier], 'simple'))).toEqual(seq(TIER_LADDERS[tier]));
    }
  });

  it('🔒 it never empties a ladder, however short', () => {
    const one = [{ provider: 'GLM' as const, model: 'glm-4.7-flashx' }];
    expect(seq(startLadderForComplexity(one, 'complex'))).toEqual(['GLM:glm-4.7-flashx']);
  });

  it('🔒 rerouting never puts Sonnet or Opus in front of a WEAK build', () => {
    for (const r of startLadderForComplexity(TIER_LADDERS.weak, 'complex')) {
      expect(['CLAUDE', 'CLAUDE_OPUS']).not.toContain(r.provider);
    }
  });

  it('shares ONE definition of "the cheap opener" with healLadder — they cannot drift', () => {
    // Same rung, same rule, same function. If a future edit gives either its own regex, this fails.
    for (const tier of ['weak', 'off', 'mini'] as const) {
      expect(seq(startLadderForComplexity(TIER_LADDERS[tier], 'complex'))).toEqual(seq(healLadder(TIER_LADDERS[tier])));
    }
  });
});

describe('the classifier prompt asks for a label, not an essay', () => {
  it('names both answers, bounds the input, and stays short', () => {
    const p = complexityPrompt('build me a shop');
    expect(p).toContain('simple');
    expect(p).toContain('complex');
    expect(p).toContain('ONE word');
    expect(p.length).toBeLessThan(900);          // it is billed per token
  });

  it('a hostile 50k prompt cannot inflate the call', () => {
    expect(complexityPrompt('x'.repeat(50_000)).length).toBeLessThan(1_500);
  });

  it('🔒 carries no vendor name — the reason lines reach the admin report', async () => {
    const d = await decideComplexity({ prompt: 'x', score: 41 }, async () => 'complex');
    expect(d.reason).not.toMatch(/glm|kimi|claude|anthropic|openai|gpt|nano|sonnet|opus|gemini|grok/i);
  });
});

// ⚠️ THE WIRING, NOT JUST THE LOGIC. A pure module that nothing calls is the failure mode this repo
// has paid for repeatedly (AGENTV3_CACHE_PREFIX's dropped re-apply line, EmbeddingSearch's unread
// index, and RequestAnalyser's own `ambiguous` flag — designed, shipped, read by nobody for months).
// These read the real route source, so deleting the wiring fails here rather than going quiet.
describe('🔌 the decision is actually wired into the build chain', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('the route decides complexity and hands it to the runner', () => {
    expect(route).toContain('decideComplexity(');
    expect(route).toContain('complex: buildIsComplex');
  });

  it('buildTurnRunner accepts the flag and applies the SHARED skip — not its own regex', () => {
    expect(route).toMatch(/complex\?: boolean/);
    expect(route).toContain('(opts.heal || opts.complex) ? withoutCheapFlashLead(parsed.rungs)');
    // The old per-call healLadder() in the chain builder is gone; one function serves both flags.
    expect(route).not.toContain('opts.heal ? healLadder(parsed.rungs)');
  });

  it('the decision is AWAITED before the chain is built — a promise would route every build as simple', () => {
    expect(route).toContain('await decideComplexity(');
  });
});
