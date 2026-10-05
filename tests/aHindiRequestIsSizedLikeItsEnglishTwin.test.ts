/**
 * Q-104: the complexity sizer, the ETA and the cost estimate could not read Devanagari. Every size signal is
 * written in Latin letters, so a Hindi request that names login, payment, cart and admin panel in Devanagari
 * scored like a small app. The class: signals in one script, a request in another. One glossary
 * (`devanagariTechTerms.ts`) is now applied where a request enters each sizer, and the test of the class is
 * the plainest one there is — a Hindi request is sized exactly like its English twin.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { complexityFromPrompt } from '../src/server/lib/BuildTimeEstimator';
import { megaProjectSignals } from '../src/server/AgentV3/ProjectPlan';
import { analyzeAppScope, namesASmallApp } from '../src/server/lib/appScopeAnalyzer';
import { statesAScope } from '../src/server/AgentV3/complexityRouting';
import { glossDevanagari, withEnglishReading } from '../src/server/lib/devanagariTechTerms';

/** [Hindi, English] — the same request in two scripts. The first two are the measured failures. */
const TWINS: ReadonlyArray<readonly [string, string]> = [
  ['एक ई-कॉमर्स ऐप बनाओ जिसमें लॉगिन, पेमेंट, कार्ट और एडमिन पैनल हो', 'make an ecommerce app with login, payment, cart and admin panel'],
  ['एक चैट ऐप बनाओ जिसमें रियल टाइम मैसेज हों', 'make a chat app with real time messages'],
  ['एक कैलकुलेटर ऐप बनाओ', 'make a calculator app'],
  ['एक टूडू ऐप बनाओ', 'make a todo app'],
  ['एक लैंडिंग पेज बनाओ', 'make a landing page'],
  ['एक बुकिंग वेबसाइट बनाओ जिसमें भुगतान हो', 'make a booking website with payment'],
  ['एक सोशल ऐप बनाओ जिसमें प्रोफाइल, चैट और नोटिफिकेशन हों', 'make a social app with profile, chat and notification'],
  ['एक क्विज़ गेम बनाओ', 'make a quiz game'],
];

const size = (p: string) => {
  const a = analyzeRequest({ prompt: p, buildIntent: 'new_build' } as never) as { taskType: string; complexityScore: number };
  const c = complexityFromPrompt(p);
  return { taskType: a.taskType, score: a.complexityScore, modules: c.moduleCount, features: c.featureCount };
};

describe('a Hindi request is sized like its English twin', () => {
  for (const [hi, en] of TWINS) {
    it(en, () => {
      expect(size(hi)).toEqual(size(en));
    });
  }

  it('the two measured failures now reach the complex tier and the deep ETA', () => {
    expect(size(TWINS[0][0])).toMatchObject({ taskType: 'complex_app', score: 58 });
    expect(size(TWINS[1][0])).toMatchObject({ taskType: 'complex_app', score: 58 });
    expect(complexityFromPrompt(TWINS[0][0]).moduleCount).toBeGreaterThanOrEqual(6);
  });
});

describe('the gates that read the same signals read Hindi too', () => {
  it('big software by name: the project gate and the routing scope', () => {
    const hi = 'स्कूल मैनेजमेंट सिस्टम बनाओ';
    expect(megaProjectSignals(hi).bigNoun).toBe(megaProjectSignals('build a school management system').bigNoun);
    expect(megaProjectSignals(hi).bigNoun).toBe(true);
    expect(statesAScope(hi)).toBe(true);
  });

  it('a small app named in the subject, and the scope analyzer\'s hint', () => {
    expect(namesASmallApp('एक कैलकुलेटर ऐप बनाओ')).toBe(true);
    expect(analyzeAppScope('एक कैलकुलेटर ऐप बनाओ').smallHint).toBe(analyzeAppScope('make a calculator app').smallHint);
    expect(namesASmallApp('एक स्कूल मैनेजमेंट सिस्टम बनाओ')).toBe(false);
  });
});

describe('precision: only what the words mean, and English untouched', () => {
  it('English and Hinglish are byte-identical', () => {
    for (const t of ['make a todo app', 'Mujhe music player bnakar do', 'hi', '']) expect(withEnglishReading(t)).toBe(t);
  });

  it('a glossary word inside a longer Devanagari word is not that word', () => {
    expect(glossDevanagari('कार्टून देखो')).toBe('कार्टून देखो');   // cartoon, not cart
    expect(glossDevanagari('गेमिंग चैनल')).not.toMatch(/\bgame\b/); // gaming, not game
  });

  it('the Devanagari-reading guards still see the original: an invitation card is not an app', () => {
    const card = 'मेरी शादी का निमंत्रण कार्ड बनाओ';
    expect(size(card).taskType).not.toBe('complex_app');
    expect(withEnglishReading(card)).toBe(card); // nothing in it is a software word
  });

  it('a counter reads the gloss alone — a Hindi comma list counts once, like the English one', () => {
    expect(complexityFromPrompt(TWINS[0][0]).featureCount).toBe(complexityFromPrompt(TWINS[0][1]).featureCount);
  });
});

describe('census: every reader of a Latin size signal reads through the glossary', () => {
  const ROOT = join(__dirname, '../src/server');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) files.push(f);
    }
  };
  walk(ROOT);
  // The modules that DEFINE the signals; their callers pass glossed text.
  const DEFINES = new Set(['lib/appComplexitySignals.ts', 'AgentV3/enumeratedFeatures.ts', 'lib/devanagariTechTerms.ts']);
  const READS = /(?:COMPLEX_APP_SIGNAL|BIG_SOFTWARE_NOUN|SIMPLE_APP_SIGNAL|CLEARLY_SMALL)\.test\(|\b(?:isComplexAppPrompt|namesBusinessDomain)\(/;

  it('a NEW reader that skips the glossary fails here', () => {
    const readers = files
      .map((f) => [f.slice(ROOT.length + 1), readFileSync(f, 'utf8')] as const)
      .filter(([rel, src]) => !DEFINES.has(rel) && READS.test(src.replace(/^\s*(?:\/\/|\*).*$/gm, '')));
    expect(readers.length).toBeGreaterThanOrEqual(5);
    for (const [rel, src] of readers) expect(src, rel).toMatch(/from '(?:\.\.\/lib|\.)\/devanagariTechTerms'/);
  });
});
