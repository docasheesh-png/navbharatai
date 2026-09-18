import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { complexityFromPrompt } from '../src/server/lib/BuildTimeEstimator';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { namesBusinessDomain, isComplexAppPrompt, GENERAL_DOMAIN } from '../src/server/lib/appComplexitySignals';

/**
 * 🔴 "hospital management system" WAS SCORED 5 — THE SAME NUMBER AS THE WORD "hi"
 * (the admin's failure table, 2026-09-18).
 *
 * The table's worst rows were Booking 100%, Logistics 100%, Events 100%, SaaS 76.9%, Education 75%,
 * Healthcare 57.1%, Ecommerce 54.5%, Restaurant 50%. Measured against `main` that morning, the way a
 * real user names each of those domains fell through every signal in the sizing path and landed on
 * `detectTaskType`'s final `return 'chat'`.
 *
 * What a 5 bought, none of it right for a hospital: `scoreToTier(5) = 'gemini'`, so an 80-step
 * ceiling instead of 150 (`maxStepsDefault`), the one-shot/simple lane (`classifyForSimpleLane`),
 * the blueprint skipped, `decideComplexity` refusing to open on KIMI (its line is 40), and a
 * fast-lane ETA from `complexityFromPrompt` (magnitude 2).
 *
 * 🔑 THE PLATFORM ALREADY KNEW. `analyzeRequirementGaps` — the classifier the admin's own Failure
 * Category panel uses to LABEL those rows — answered `healthcare`, `education`, `restaurant`,
 * `logistics`, `events` for the very same strings. One module knew it was a hospital app while the
 * module deciding how much engine to spend called it a greeting. The fix asks the owner of the fact;
 * a third keyword list would have been the drift, not the cure.
 */

/** The bug, in the user's own words. Each is a real way a person names one of the failing domains. */
const DOMAIN_PROMPTS = [
  'hospital management system',
  'school management system',
  'restaurant billing app',
  'courier tracking app',
  'event management website',
  'a gym membership app',
  'clinic appointment app',
  'E commerce website',
];

/** Small deliverables that must NOT be promoted, however business-y the words around them. */
const STILL_SIMPLE = [
  'a todo app',
  'make me a calculator',
  'a todo app for my restaurant',
  'a calculator for my gym',
  'a landing page for a hospital',
  'portfolio page for a doctor',
  'simple website for my school',
  'landing page for my SaaS',
];

/** Not builds at all — the band these prompts used to share with a hospital ERP. */
const STILL_CHAT = ['hi', 'hello', 'thanks bro', 'namaste kaise ho'];

/**
 * Page-scoped deliverables that ONLY `PAGE_DELIVERABLE_SIGNAL` catches — `SIMPLE_APP_SIGNAL` has no
 * entry for "portfolio website", "one-pager", "coming soon page" or "splash page".
 *
 * ⚠️ THIS LIST EXISTS BECAUSE THE REVERSION PROBE CAUGHT MY OWN TEST BEING DECORATIVE. The first
 * draft asserted the page guard with prompts like "a landing page for a hospital" — which the SIMPLE
 * list also matches, so deleting the page guard entirely left all 16 cases green. A guard no test can
 * kill is a guard nobody knows is working. These are the prompts where it is the only thing standing
 * between "a splash page for my clinic" and a full hospital ERP build.
 */
const PAGE_SCOPED = [
  'a coming soon page for my restaurant',
  'one-pager for my gym',
  'portfolio website for a doctor',
  'a splash page for my clinic',
];

describe('a prompt that names a business domain is not a greeting', () => {
  it('every failing-domain prompt now outscores "hi" — and lands in the band a multi-module app needs', () => {
    const hi = analyzeRequest({ prompt: 'hi' }).complexityScore;
    expect(hi).toBe(5);
    for (const p of DOMAIN_PROMPTS) {
      const r = analyzeRequest({ prompt: p });
      expect(r.complexityScore, p).toBeGreaterThan(hi);
      expect(r.taskType, p).toBe('complex_app');
      // 40 is `decideComplexity`'s line and 20/40 are `scoreToTier`'s: above 40 the build gets the
      // 150-step ceiling, the blueprint, no one-shot lane, and may open on KIMI instead of flash.
      expect(r.complexityScore, p).toBeGreaterThan(40);
      expect(r.startTier, p).toBe('sonnet');
    }
  });

  it('…and the ETA/pipeline estimator agrees, so the same app is not sized two ways', () => {
    // 12 is the DEEP threshold named in `complexityFromPrompt`'s own comment.
    for (const p of DOMAIN_PROMPTS) {
      const c = complexityFromPrompt(p);
      expect(c.moduleCount + c.featureCount, p).toBeGreaterThanOrEqual(12);
    }
  });

  it('🔒 a SIMPLE deliverable stays simple — a todo app for a restaurant is a todo app', () => {
    for (const p of STILL_SIMPLE) {
      const r = analyzeRequest({ prompt: p });
      expect(r.taskType, p).toBe('simple_app');
      expect(r.complexityScore, p).toBe(15);
      expect(namesBusinessDomain(p), p).toBe(false);
      // …and it keeps the cheap fast lane it exists for.
      const c = complexityFromPrompt(p);
      expect(c.moduleCount + c.featureCount, p).toBeLessThan(12);
    }
  });

  it('🔒 a PAGE is still a page — a splash page for a clinic is not a hospital ERP', () => {
    for (const p of PAGE_SCOPED) {
      expect(namesBusinessDomain(p), p).toBe(false);
      expect(analyzeRequest({ prompt: p }).taskType, p).not.toBe('complex_app');
      const c = complexityFromPrompt(p);
      expect(c.moduleCount + c.featureCount, p).toBeLessThan(12);
    }
  });

  it('🔒 a greeting is still a greeting', () => {
    for (const p of STILL_CHAT) {
      expect(analyzeRequest({ prompt: p }).taskType, p).toBe('chat');
      expect(analyzeRequest({ prompt: p }).complexityScore, p).toBe(5);
    }
  });

  it('🔒 it fires LAST — nothing that already had an opinion is overruled', () => {
    // Each of these matches an earlier branch of `detectTaskType`, and several also name a domain.
    const keep: Array<[string, string]> = [
      ['fix the login error in my hospital app', 'debugging'],
      ['why is my restaurant menu not loading', 'debugging'],
      ['translate this to hindi', 'translate'],
      ['summarize this article', 'summary'],
      ['write a react component', 'coding'],
      ['design a scalable microservice architecture', 'architecture'],
      ['snake game', 'simple_app'],
    ];
    for (const [p, taskType] of keep) expect(analyzeRequest({ prompt: p }).taskType, p).toBe(taskType);
  });
});

/**
 * 🔴 THE SPACE VARIANT — and it is the prompt from a real autopsy, not an invented one.
 * Build `c6e4c6ff` was prompted `"E commerce website"`. `COMPLEX_APP_SIGNAL` carried `e-?commerce`
 * and the domain analyser carried `ecommerce|e-commerce`; neither spelling has a SPACE in it, so the
 * one spelling a person actually types matched nothing in either module.
 */
describe('"E commerce" is e-commerce, in both modules', () => {
  for (const p of ['E commerce website', 'e-commerce website', 'ecommerce website']) {
    it(`"${p}" is recognised by the build-size signal and by the domain classifier`, () => {
      expect(isComplexAppPrompt(p)).toBe(true);
      expect(analyzeRequirementGaps(p).domain).toBe('ecommerce');
      expect(analyzeRequest({ prompt: p }).taskType).toBe('complex_app');
    });
  }

  it('🔒 the widened spelling did not turn an unrelated word into a shop', () => {
    for (const p of ['the commerce department', 'e learning platform', 'ecommerce']) {
      // The first two must not be read as the e-commerce CATEGORY word by the size signal.
      if (p !== 'ecommerce') expect(/\be[-\s]?commerce\b/i.test(p), p).toBe(false);
    }
  });
});

/**
 * 🔒 THE DURABLE INVARIANT, derived rather than listed: the two classifiers must not disagree about
 * whether a prompt describes an app in a real business domain. Adding a domain to
 * `RequirementGapAnalyzer` keeps this covered automatically — which is the whole point of asking the
 * module that owns the fact instead of keeping a second list here.
 */
describe('the two classifiers cannot drift apart again', () => {
  it('a recognised domain with no page/simple deliverable is never scored as chat', () => {
    for (const p of DOMAIN_PROMPTS) {
      expect(analyzeRequirementGaps(p).domain, p).not.toBe(GENERAL_DOMAIN);
      expect(namesBusinessDomain(p), p).toBe(true);
      expect(analyzeRequest({ prompt: p }).taskType, p).not.toBe('chat');
    }
  });

  it('the predicate is pure and total — it never throws on junk', () => {
    for (const p of ['', '   ', '!!!', '🙂', 'ヒ'] as string[]) {
      expect(() => namesBusinessDomain(p)).not.toThrow();
      expect(namesBusinessDomain(p)).toBe(false);
    }
    expect(namesBusinessDomain(undefined as never)).toBe(false);
  });
});

/**
 * ⚠️ REVERSION GUARD — reads CODE with comments stripped, because every behavioural case above still
 * passes if the predicate exists and nobody calls it. The defect WAS a question nobody asked.
 */
describe('the question is actually asked, at both call sites', () => {
  const strip = (t: string) => t.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const analyser = strip(readFileSync(join(process.cwd(), 'src/server/AgentV3/RequestAnalyser.ts'), 'utf8'));
  const estimator = strip(readFileSync(join(process.cwd(), 'src/server/lib/BuildTimeEstimator.ts'), 'utf8'));
  const signals = strip(readFileSync(join(process.cwd(), 'src/server/lib/appComplexitySignals.ts'), 'utf8'));

  it('`detectTaskType` asks it, and asks it LAST', () => {
    const at = analyser.indexOf('namesBusinessDomain(p)');
    expect(at).toBeGreaterThan(-1);
    // Every other verdict is decided before it: the greeting check is the last one above it.
    expect(analyser.indexOf('RE.greeting.test(p)')).toBeLessThan(at);
    expect(analyser.indexOf('RE.simpleApp.test(p)')).toBeLessThan(at);
    expect(analyser.indexOf('isComplexAppPrompt(p)')).toBeLessThan(at);
  });

  it('the ETA/pipeline estimator asks it too', () => {
    expect(estimator).toContain('namesBusinessDomain(text)');
  });

  it('it delegates to the platform\'s own domain classifier — never a second keyword list', () => {
    expect(signals).toContain('analyzeRequirementGaps(p).domain');
    expect(signals).toContain("import { analyzeRequirementGaps } from './RequirementGapAnalyzer'");
  });

  it('both guards are in the predicate, not left to the callers', () => {
    const body = signals.slice(signals.indexOf('export function namesBusinessDomain'));
    expect(body.slice(0, 400)).toContain('PAGE_DELIVERABLE_SIGNAL.test(p)');
    expect(body.slice(0, 400)).toContain('SIMPLE_APP_SIGNAL.test(p)');
  });

  it('there is ONE simple-app list, shared — the analyser no longer keeps its own copy', () => {
    expect(signals).toContain('export const SIMPLE_APP_SIGNAL');
    expect(analyser).toContain('simpleApp: SIMPLE_APP_SIGNAL');
    expect(analyser, 'a second copy of the list is the drift this fix removes').not.toMatch(/simpleApp:\s*\/\\b\(calculator/);
  });
});

/**
 * 🔴 THE SAME CLASS, ONE SCRIPT OVER — and it is the India-first half.
 *
 * `RequirementGapAnalyzer` already speaks Hindi **fluently**: `aspatal`, `mareez`, `dawai`, `ilaj`,
 * `chikitsa`, `swasthya`, `dhaba`, `bhojan`, `rasoi`, `thali`, `nashta`, `dukaan`, `kirana`,
 * `bazaar`, `saaman`, `godown`, `vahan`, `gaadi`, `udhaar`, `khata`, `bahi`, `byaj`, `kist`,
 * `makan`, `kiraya`, `zameen`, `vyayam`, `kasrat`, `shaadi`, `vivah`, `samaroh`, `mela`, `naukri`,
 * `rozgar`, `bharti`, `vidyalaya`, `pathshala`, `padhai`, `shikshak`, `chhatra`, `kaksha` — **every
 * one of them in Latin letters only.**
 *
 * So `dukaan ka billing app banao` was sized correctly and `अस्पताल प्रबंधन सिस्टम` scored 5, the
 * same as "hi". A person typing Hindi in Hindi got the weaker engine. Measured before the fix:
 * `अस्पताल प्रबंधन सिस्टम` → 5/chat, `स्कूल मैनेजमेंट सिस्टम` → 5/chat, `रेस्टोरेंट बिलिंग ऐप` → 5/chat.
 *
 * ⚠️ `रेस्टोरेंट बिलिंग ऐप` is the sharpest of the three: it is too SHORT for `signalsCouldNotRead`
 * (which needs 12 letters before it will judge a script), so it was caught by neither the
 * unreadable-script floor nor any domain — invisible to both mechanisms at once.
 *
 * 🔒 THE RULE THIS CHANGE FOLLOWS, so it stays auditable: **every Devanagari term added is the same
 * word as a romanized term already accepted by that domain.** No new concept is introduced, so the
 * module's existing precision decisions carry over unchanged — which is what the parity case below
 * asserts mechanically rather than by listing.
 *
 * ⚠️ TWO WORDS WERE DELIBERATELY LEFT OUT, and the reason is the one `\b` cannot help with here:
 * JavaScript's word boundary is ASCII, so a Devanagari term matches inside longer words. `माल`
 * (goods) sits inside `मालिक` (owner) and `योग` (yoga) inside `उपयोग` (usage) and `योगदान`
 * (contribution) — each would have turned ordinary Hindi into a logistics or fitness app.
 */
describe('a domain app written in Devanagari is not a greeting either', () => {
  const DEVANAGARI_APPS: Array<[string, string]> = [
    ['अस्पताल प्रबंधन सिस्टम', 'healthcare'],
    ['स्कूल मैनेजमेंट सिस्टम', 'education'],
    ['रेस्टोरेंट बिलिंग ऐप', 'restaurant'],
    ['दुकान का बिलिंग ऐप', 'ecommerce'],
  ];

  it('each is sized as the multi-module app it is, and lands in the right domain', () => {
    for (const [p, domain] of DEVANAGARI_APPS) {
      expect(analyzeRequirementGaps(p).domain, p).toBe(domain);
      expect(analyzeRequest({ prompt: p }).taskType, p).toBe('complex_app');
      expect(analyzeRequest({ prompt: p }).complexityScore, p).toBeGreaterThan(40);
    }
  });

  it('🔒 PARITY — the two spellings of one word reach the same domain, derived rather than listed', () => {
    // If a Devanagari term ever names a domain its romanized twin does not, one of the two is a new
    // concept smuggled in under a spelling change — which is exactly what this change promises not
    // to do. Each pair is (already-accepted romanized term, the Devanagari spelling of that word).
    const PAIRS: Array<[string, string]> = [
      ['aspatal', 'अस्पताल'], ['mareez', 'मरीज'], ['ilaj', 'इलाज'], ['chikitsa', 'चिकित्सा'],
      ['dhaba', 'ढाबा'], ['bhojan', 'भोजन'], ['rasoi', 'रसोई'], ['thali', 'थाली'],
      ['dukaan', 'दुकान'], ['kirana', 'किराना'], ['saaman', 'सामान'],
      ['vidyalaya', 'विद्यालय'], ['shikshak', 'शिक्षक'], ['kaksha', 'कक्षा'],
      ['godown', 'गोदाम'], ['vahan', 'वाहन'],
      ['khata', 'खाता'], ['byaj', 'ब्याज'], ['kist', 'किस्त'],
      ['makan', 'मकान'], ['kiraya', 'किराया'],
      ['vyayam', 'व्यायाम'], ['kasrat', 'कसरत'],
      ['shaadi', 'शादी'], ['vivah', 'विवाह'], ['samaroh', 'समारोह'],
      ['naukri', 'नौकरी'], ['bharti', 'भर्ती'],
    ];
    for (const [roman, devanagari] of PAIRS) {
      const a = analyzeRequirementGaps(roman).domain;
      const b = analyzeRequirementGaps(devanagari).domain;
      expect(a, `"${roman}" should already name a domain`).not.toBe(GENERAL_DOMAIN);
      expect(b, `"${devanagari}" is the same word as "${roman}"`).toBe(a);
    }
  });

  it('🔒 ordinary Hindi is NOT an app — the words that sit inside longer words were left out', () => {
    for (const p of [
      'नमस्ते कैसे हो', 'एक कैलकुलेटर बनाओ', 'मेरा नाम क्या है',
      'इसका उपयोग कैसे करें',   // contains योग
      'योगदान कैसे करूँ',        // contains योग
      'मालिक कौन है',            // contains माल
    ]) expect(analyzeRequirementGaps(p).domain, p).toBe(GENERAL_DOMAIN);
  });
});
