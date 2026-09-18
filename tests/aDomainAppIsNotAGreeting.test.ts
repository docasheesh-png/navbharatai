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
