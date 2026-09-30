// AUTOPSY 4541f1cf + 6e646503 (admin's "old build report", 2026-09-30).
//
// Two builds on one workspace. The first built a Gita reader from our golden template; the second was a
// QUESTION typed in romanized Gujarati — "Ibahart app ni jaherat karvi chhe kai rite bolvu a janavo"
// ("I want to advertise the Ibahart app; tell me how to word it"). It was read as an order to build,
// turned into an EDIT of the Gita reader, and answered after two minutes of checks — in English, about a
// "diary app" nobody mentioned. Locked here, one class per block:
//   1. a question in romanized Gujarati/Marathi reads as a question, and a slow reader cannot undo that;
//   2. the reply language: the detector names Gujarati, and the Latin line never calls it English;
//   3. no markup rule reads a comment (every one of the 40 templates carried two false findings);
//   4. the admin report names the REAL reason money was absorbed, and whether the reader ran;
//   5. the builder is told the user's own word for a feature, not our category name.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readsAsQuestion, classifyIntentSmartDetailed, classifyIntentWithConfidence, readerlessIntent, describeReaderOutcome,
} from '../src/server/AgentV3/IntentClassifier';
import { detectLanguageHint, appLanguageInstruction, LATIN_REQUEST_LANGUAGE_LINE } from '../src/server/AgentV3/LanguageDetect';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';
import { lintBuiltApp } from '../src/server/AgentV3/buildQualityLint';
import { scanMarkup } from '../src/server/AgentV3/jsxTags';
import { stripCommentsForMarkup } from '../src/server/AgentV3/stripCodeComments';
import { scanAccessibility } from '../src/server/AgentV3/AccessibilityAnalysis';
import { lintA11y } from '../src/server/AppMakerLab/intelligence/A11yLinter';
import { absorbedWorkDetail } from '../src/server/AgentV3/unbilledTurns';
import { PHASE_POST_BUILD_REVIEW } from '../src/server/AgentV3/billingPhase';
import { renderRequestedFeatureContract, usersWordFor, requestedFeatureLabels } from '../src/server/AgentV3/RequirementCoverage';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

// The report's message, verbatim.
const GUJARATI = 'Ibahart app ni jaherat karvi chhe kai rite bolvu a janavo';
const MARATHI = 'amhala app chi jahirat kashi karaychi te sanga';

describe('1 · a question in romanized Gujarati or Marathi is a question', () => {
  it('🔴 the report message reads as a question', () => {
    expect(readsAsQuestion(GUJARATI.toLowerCase())).toBe(true);
    expect(readsAsQuestion(MARATHI.toLowerCase())).toBe(true);
  });
  it('🔴 when the reader cannot answer, it is answered, not built', async () => {
    const failing = async () => { throw new Error('reader down'); };
    for (const m of [GUJARATI, MARATHI]) {
      const r = await classifyIntentSmartDetailed(m, failing, { projectExists: true });
      expect(r.intent, m).toBe('chat');
      expect(r.readerOutcome).toBe('failed');
    }
  });
  it('🔴 the route\'s own timeout takes the same readerless fallback (it used to keep the keyword verdict)', () => {
    const route = read('src/server/routes/agentv3.ts');
    const at = route.indexOf("readerOutcome = 'failed';");
    expect(at).toBeGreaterThan(0);
    expect(route.slice(at, at + 400)).toContain('intent = readerlessIntent(prompt)');
    expect(readerlessIntent(GUJARATI)).toBe('chat');
  });
  it('🔒 an order is still an order, in these languages and in the old ones', () => {
    for (const m of ['mane ek notes app banavi aapo', 'build a notes app', 'ek billing app banao', 'do it again']) {
      expect(readsAsQuestion(m), m).toBe(false);
    }
    expect(classifyIntentWithConfidence('build a notes app').intent).toBe('new_build');
    expect(readerlessIntent('mane ek notes app banavi aapo')).toBe('new_build');
  });
  it('the report says what happened to the reader instead of "did not run"', () => {
    expect(describeReaderOutcome('failed')).toMatch(/asked and failed or timed out/);
    expect(describeReaderOutcome('unclear')).toMatch(/said "unclear"/);
    expect(describeReaderOutcome('not-asked')).toMatch(/not asked/);
    const route = read('src/server/routes/agentv3.ts');
    expect(route).not.toContain("'answered' : 'did not run'");
    expect(route).toContain('describeReaderOutcome(readerOutcome)');
  });
});

describe('2 · the reply comes back in the user\'s language', () => {
  it('🔴 the report message is recognised as Gujarati, and the Marathi one as Marathi', () => {
    expect(detectLanguageHint(GUJARATI)?.name).toBe('Gujarati');
    expect(detectLanguageHint(MARATHI)?.name).toBe('Marathi');
  });
  it('🔴 the instruction tells the builder to REPLY in that language, never in English', () => {
    const line = appLanguageInstruction(GUJARATI);
    expect(line).toMatch(/Reply to the user in Gujarati/);
    expect(line).toMatch(/never in English/);
  });
  it('🔴 the Latin line no longer defines a Latin request as English-or-Hindi', () => {
    expect(LATIN_REQUEST_LANGUAGE_LINE).not.toMatch(/English, or Hindi words typed in Roman letters/);
    expect(LATIN_REQUEST_LANGUAGE_LINE).toMatch(/Gujarati/);
    expect(LATIN_REQUEST_LANGUAGE_LINE).toMatch(/not English is never answered in English/);
    expect(LATIN_REQUEST_LANGUAGE_LINE).toMatch(/NEVER switch to Devanagari/);
  });
  it('🔒 English stays English', () => {
    expect(detectLanguageHint('build a notes app with reminders')).toBeNull();
  });
});

describe('3 · no markup rule reads a comment', () => {
  it('🔴 CENSUS: every golden template lints with no finding at all', () => {
    expect(GOLDEN_SCAFFOLDS.length).toBeGreaterThan(30);
    for (const s of GOLDEN_SCAFFOLDS) {
      const q = lintBuiltApp(goldenScaffoldFiles(s));
      expect(q, s.id).not.toBeNull();
      expect(q!.offenders, s.id).toEqual({});
      expect(q!.a11y.score, s.id).toBe(100);
    }
  });
  it('a tag in a JS, CSS or HTML comment is not a tag', () => {
    expect(lintA11y('// data-theme on <html> pins the app\nexport const x = 1;').violations).toEqual([]);
    expect(lintA11y('/* The picture: a real <img>, or an emoji */ .a{}').violations).toEqual([]);
    expect(lintA11y('<!-- <img src="a.png"> --><p>hi</p>').violations).toEqual([]);
    expect(scanMarkup('{/* <input /> */}<p>x</p>').map((t) => t.name)).toEqual(['p']);
    expect(scanAccessibility('src/App.tsx', '// <img src="x.png">\nexport default function A() { return null; }')).toEqual([]);
  });
  it('🔒 a real tag is still seen — including after a URL', () => {
    expect(lintA11y('<img src="//cdn.example.com/a.png">').violations.map((v) => v.type)).toEqual(['img-alt']);
    expect(lintA11y('<a href="https://x.com">x</a><img src="a.png">').violations.map((v) => v.type)).toEqual(['img-alt']);
    expect(lintA11y('<html><body></body></html>').violations.map((v) => v.type)).toEqual(['html-lang']);
    const code = 'const u = "//cdn/x"; <img src={u} />';
    expect(stripCommentsForMarkup(code)).toBe(code);
  });
  it('stripping keeps length and lines, so every reported line is still the user\'s line', () => {
    const src = 'a\n// <img>\n/* x\n y */b';
    const out = stripCommentsForMarkup(src);
    expect(out.length).toBe(src.length);
    expect(out.split('\n').length).toBe(src.split('\n').length);
  });
});

describe('4 · the admin report names the real reason money was absorbed', () => {
  const usage = { inputTokens: 100_000, outputTokens: 500 };
  it('🔴 a barren review is named as the review, not as starved turns', () => {
    const line = absorbedWorkDetail([{ provider: 'KIMI', model: 'kimi-k2.7-code', usage, phase: PHASE_POST_BUILD_REVIEW }], new Set([PHASE_POST_BUILD_REVIEW]));
    expect(line).toMatch(/post-build review delivered no findings/);
    expect(line).not.toMatch(/no text and no tool call/);
  });
  it('a starved turn is named as one', () => {
    const line = absorbedWorkDetail([{ provider: 'GLM', usage, unbilled: { inputTokens: 5_000, outputTokens: 4_000 } }]);
    expect(line).toMatch(/no text and no tool call/);
  });
  it('both report sites read it; the old unconditional sentence is gone', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route.split('absorbedWorkDetail(').length - 1).toBe(2);
    expect(route).not.toContain("detail: 'One or more model turns spent their whole output budget");
  });
});

describe('5 · the builder hears the user\'s word, not our category', () => {
  const PROMPT = 'Build a Bhagavad Gita reader in Hindi … bookmarks saved in the browser, search across the Hindi meaning';
  it('🔴 "bookmarks" is restated as bookmarks', () => {
    expect(requestedFeatureLabels(PROMPT)).toContain('wishlist / favorites');
    expect(usersWordFor('wishlist / favorites', PROMPT)).toBe('bookmarks');
    expect(renderRequestedFeatureContract(['wishlist / favorites'], PROMPT)).toMatch(/they called it "bookmarks"/);
  });
  it('🔒 no note when the label already is their word, or when no request is passed', () => {
    expect(usersWordFor('wishlist / favorites', 'a shop with a wishlist')).toBeNull();
    expect(renderRequestedFeatureContract(['wishlist / favorites'])).not.toMatch(/they called it/);
  });
  it('the route passes the prompt', () => {
    expect(read('src/server/routes/agentv3.ts')).toContain('renderRequestedFeatureContract(confirmedContractLabels(featureLists, featureConfirmation), prompt)');
  });
});
