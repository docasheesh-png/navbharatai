// Two-sided origin/main c072e0eb9 regression gate for BR1974 / #4165.
// Store phrases behave like origin/main, except reviewed App Store presence tails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { withoutMachineText } from '../src/server/lib/machineText';
import {
  requestedCapabilities,
  OPEN_APPS_CORE_SOURCE,
  OPEN_APPS_APP_STORE_OPEN_SOURCE,
  OPEN_APPS_APP_STORE_PRESENCE_TAIL_SOURCE,
  OPEN_APPS_APP_DRAWER_OPEN_SOURCE,
  OPEN_APPS_NAMED_APP_OPEN_SOURCE,
  OPEN_APPS_NAMED_APP_CALLED_SOURCE,
  OPEN_APPS_NAMED_APP_PROPER_NAME_SOURCE,
  openNamedAppCapitalizedTokenAsked,
} from '../src/server/AgentV3/nativeCapabilities';
import {
  BR1974_PROMPT,
  SAME_CLASS_OPEN_APPS,
  OPPOSITE_NOT_OPEN_APPS,
  NAMED_APP_REVIEW_REPROS,
  NAMED_APP_SENTENCE_CASE_PITFALLS,
} from './aWhatsAppNumberIsNotAnOpenAppsRequest.test';

function ids(p: string): string[] {
  return requestedCapabilities(p).map((c) => c.id);
}

/**
 * Snapshot of open-apps.asks at origin/main c072e0eb96ee3390d90e07b91d55f06bc54e6108
 * (pre-BR1974). Used only as a regression gate.
 */
const ORIGIN_MAIN_C072E0EB9_OPEN_APPS = /\b(call\s+(?:karo|kar|kare|kardo|mummy|mom|papa)|make\s+(?:a\s+)?call|whats\s*app|sms|open\s+(?:the\s+)?(?:app|apps)|app\s+khol\w*|khol\s+do)\b/i;

function matchedOnOriginMain(prompt: string): boolean {
  return ORIGIN_MAIN_C072E0EB9_OPEN_APPS.test(withoutMachineText(prompt));
}

function uniquePrompts(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of items) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Side (a) exceptions: origin/main matched these, but BR1974 intentionally does not.
 * Small and justified — WhatsApp identity fields, singular launch-this-app language,
 * and the reviewed App Store presence tails.
 */
export const REVIEWED_MUST_NOT_MATCH = [
  // WhatsApp number / id / phone fields (the BR1974 report class).
  BR1974_PROMPT,
  'Enter Your WhatsApp Mobile Number',
  'WhatsApp number: 7093492611',
  'whatsapp ka number daalo',
  'mera WhatsApp wala number likho',
  'my WhatsApp ID',
  'WhatsApp no.',
  'WhatsApp phone',
  'Enter your WhatsApp mobile no',
  // Singular "open the app" means launch THIS app.
  'when I open the app, show the welcome screen',
  'whenever I open the app',
  'open the app',
  'open the app to see the dashboard',
  'open the app settings',
  'please open the app',
  'I open the app every morning',
  'open the app first',
  // Newline or punctuation after singular open-the-app (sentence-case pitfalls).
  ...NAMED_APP_SENTENCE_CASE_PITFALLS,
  // Reviewed App Store presence tails — the only allowed store exclusion vs main.
  'open the App Store listing',
  'open the App Store screenshots',
  'open the App Store release',
  'open the App Store release notes',
  'open the App Store listing page',
  'please open the App Store listing page',
] as const;

/**
 * Side (b) exceptions: prompts we still match even if origin/main missed them.
 * Main already captures these via `open apps` / `whats app`; they are listed so
 * the gate documents the BR1974 keeps (plural open-apps, and a WhatsApp chat
 * whose later "number" is not an identity field).
 */
export const REVIEWED_MUST_MATCH = [
  'open apps like YouTube',
  'please open apps',
  'open the apps',
  'open apps installed on phone',
  'please open the apps',
  'users should be able to open apps from this screen',
  'open WhatsApp chat with this number',
] as const;

const SIX_LOST_ORIGIN_MAIN_REPROS = [
  'Add a button to open the App Store after the app is published on the App Store',
  'After the app is published on the App Store, add a button to open the App Store',
  'open the App Store to see the book we published last year on the App Store',
  'open the App Store to see the exclusive special edition we published on the App Store',
  'open the App Store to read the blog post on the editorial page we published on the App Store',
  'open the App Store after it is released on the Play Store',
] as const;

const PLAY_STORE_REVIEW_REPROS = [
  'open the Play Store version of our game',
  'open the Play Store developer page',
  'open the Play Store agreement',
  'open the Play Store review guidelines',
  'open the Play Store data safety form',
  'open the Play Store promo campaign',
  'open the Play Store Connect dashboard',
  'open the Play Store for my developer account',
  'Open the Play Store',
  'button to open Play Store',
  'redirect to app store',
  'link to play store page',
  'launch the app store',
  'redirect to the Play Store',
  'play store kholo',
  'app store kholo',
  'play store kholna hai',
  'play store khol ke dekho',
  'app store mein kholo',
  'go to the play store',
  'open play store page',
  'open the play store and submit karna',
  'go to the play store and publish my app',
] as const;

function wholeRegressionCorpus(): string[] {
  return uniquePrompts([
    ...SAME_CLASS_OPEN_APPS,
    ...OPPOSITE_NOT_OPEN_APPS,
    ...REVIEWED_MUST_NOT_MATCH,
    ...REVIEWED_MUST_MATCH,
    ...SIX_LOST_ORIGIN_MAIN_REPROS,
    ...PLAY_STORE_REVIEW_REPROS,
    ...NAMED_APP_REVIEW_REPROS,
    ...NAMED_APP_SENTENCE_CASE_PITFALLS,
    BR1974_PROMPT,
    'open the App Store after it is released in the Play Store',
    'open the App Store version of our game',
    'see other apps we published',
    'khol do play store listing',
    'open other apps',
    'open another app',
  ]);
}

describe('open-apps: exported sources', () => {
  it('locks the origin/main-shaped core, explicit App Store, presence tails, and drawer', () => {
    expect(OPEN_APPS_CORE_SOURCE).toContain('whats\\s*app(?!');
    expect(OPEN_APPS_CORE_SOURCE).toContain('open\\s+(?:the\\s+)?apps');
    expect(OPEN_APPS_CORE_SOURCE).not.toContain('open\\s+(?:the\\s+)?(?:app|apps)');
    expect(OPEN_APPS_CORE_SOURCE).not.toContain('other\\s+apps');
    expect(OPEN_APPS_APP_STORE_OPEN_SOURCE).toBe('open\\s+(?:the\\s+)?app[\\s-]+store\\b');
    expect(OPEN_APPS_APP_STORE_OPEN_SOURCE).not.toContain('play');
    expect(OPEN_APPS_APP_STORE_PRESENCE_TAIL_SOURCE).toContain('listing\\s+pages?');
    expect(OPEN_APPS_APP_STORE_PRESENCE_TAIL_SOURCE).toContain('listings?');
    expect(OPEN_APPS_APP_STORE_PRESENCE_TAIL_SOURCE).toContain('screenshots?');
    expect(OPEN_APPS_APP_STORE_PRESENCE_TAIL_SOURCE).toContain('release\\s+notes');
    expect(OPEN_APPS_APP_STORE_PRESENCE_TAIL_SOURCE).toContain('releases?');
    expect(OPEN_APPS_APP_DRAWER_OPEN_SOURCE).toBe('open\\s+(?:the\\s+)?app[\\s-]+drawer\\b');
    expect(OPEN_APPS_NAMED_APP_OPEN_SOURCE).toBe('open(?:\\s+the)?\\s+app');
    expect(OPEN_APPS_NAMED_APP_CALLED_SOURCE).toContain('called');
    expect(OPEN_APPS_NAMED_APP_CALLED_SOURCE).toContain('named');
    expect(OPEN_APPS_NAMED_APP_CALLED_SOURCE).toContain('[ \\t]+');
    expect(OPEN_APPS_NAMED_APP_PROPER_NAME_SOURCE).toBe('[A-Z][A-Za-z0-9]*');
    const namedSrc = readFileSync(join(__dirname, '..', 'src/server/AgentV3/nativeCapabilities.ts'), 'utf8');
    expect(namedSrc).toContain("new RegExp('^' + OPEN_APPS_NAMED_APP_PROPER_NAME_SOURCE + String.raw`\\b`)");
    expect(namedSrc).not.toMatch(/OPEN_APPS_NAMED_APP_PROPER_NAME_SOURCE \+ String\.raw`\\b`, 'i'/);
    expect(namedSrc).toContain('const AFTER_APP_HORIZONTAL_WS = /^[ \\t]+/;');
    const here = join(__dirname, '..');
    expect(readFileSync(join(here, 'src/main.tsx'), 'utf8')).not.toMatch('nativeCapabilities');
    expect(readFileSync(join(here, 'src/App.tsx'), 'utf8')).not.toMatch('nativeCapabilities');
  });
});

describe('open-apps: two-sided origin/main c072e0eb9 regression gate', () => {
  it('(a) every corpus prompt that origin/main captured still matches, except the reviewed must-not-match list', () => {
    const mustNot = new Set<string>(REVIEWED_MUST_NOT_MATCH);
    const corpus = wholeRegressionCorpus();
    expect(corpus.length).toBeGreaterThan(40);
    const mainHits = corpus.filter((p) => matchedOnOriginMain(p));
    expect(mainHits.length).toBeGreaterThan(15);
    const required = mainHits.filter((p) => !mustNot.has(p));
    expect(required.length).toBeGreaterThan(10);
    for (const p of SIX_LOST_ORIGIN_MAIN_REPROS) {
      expect(matchedOnOriginMain(p), `origin/main should have captured: ${p}`).toBe(true);
      expect(mustNot.has(p), `lost App Store repro must not be on the must-not-match list: ${p}`).toBe(false);
    }
    for (const p of required) {
      expect(ids(p), `origin/main matched this and it is not a reviewed must-not-match: ${p}`).toContain('open-apps');
    }
  });

  it('(b) every corpus prompt that origin/main missed still does not match, except the reviewed must-match list', () => {
    const mustMatch = new Set<string>(REVIEWED_MUST_MATCH);
    const corpus = wholeRegressionCorpus();
    const mainMisses = corpus.filter((p) => !matchedOnOriginMain(p));
    expect(mainMisses.length).toBeGreaterThan(10);
    const requiredOut = mainMisses.filter((p) => !mustMatch.has(p));
    for (const p of PLAY_STORE_REVIEW_REPROS) {
      expect(matchedOnOriginMain(p), `origin/main should have missed Play Store / go-to / kholo / launch form: ${p}`).toBe(false);
      expect(mustMatch.has(p), `Q-2649 form must not be on the must-match list: ${p}`).toBe(false);
    }
    for (const p of requiredOut) {
      expect(ids(p), `origin/main missed this and it is not a reviewed must-match: ${p}`).not.toContain('open-apps');
    }
  });

  it('the reviewed exception lists themselves hold', () => {
    for (const p of REVIEWED_MUST_NOT_MATCH) {
      expect(matchedOnOriginMain(p), `must-not-match list is only for origin/main hits: ${p}`).toBe(true);
      expect(ids(p), p).not.toContain('open-apps');
    }
    for (const p of REVIEWED_MUST_MATCH) {
      expect(ids(p), p).toContain('open-apps');
    }
  });

  it('every listed same-class prompt matches at this head', () => {
    for (const p of SAME_CLASS_OPEN_APPS) {
      expect(ids(p), p).toContain('open-apps');
    }
  });
});

describe('open-apps: App Store presence tails and recovered main compounds', () => {
  it('excludes only the reviewed App Store presence tails', () => {
    for (const p of [
      'open the App Store listing',
      'open the App Store screenshots',
      'open the App Store release',
      'open the App Store release notes',
      'open the App Store listing page',
      'please open the App Store listing page',
    ]) {
      expect(matchedOnOriginMain(p), p).toBe(true);
      expect(ids(p), p).not.toContain('open-apps');
    }
  });

  it('still matches App Store opens that origin/main captured, including the six lost repros', () => {
    for (const p of SIX_LOST_ORIGIN_MAIN_REPROS) {
      expect(ids(p), p).toContain('open-apps');
    }
    expect(ids('open the app store')).toContain('open-apps');
    expect(ids('open the App Store after it is released in the Play Store')).toContain('open-apps');
    expect(ids('open the App Store version of our game')).toContain('open-apps');
    expect(ids('Add an Open App Store button so users can see other apps we published')).toContain('open-apps');
    expect(ids('After we release, a button should open the App Store')).toContain('open-apps');
    expect(ids('open the App Store so the user can submit a review')).toContain('open-apps');
  });

  it('recovers open-the-app-drawer so dropping singular open-the-app does not lose a main capture', () => {
    expect(matchedOnOriginMain('open the app drawer')).toBe(true);
    expect(ids('open the app drawer')).toContain('open-apps');
    expect(ids('add an app drawer')).not.toContain('open-apps');
  });
});

describe('open-apps: Q-2649 store forms stay unmatched', () => {
  it('does not newly capture Play Store / go-to / link / redirect / kholo / launch store opens', () => {
    for (const p of PLAY_STORE_REVIEW_REPROS) {
      expect(ids(p), p).not.toContain('open-apps');
    }
  });
});

describe('open-apps: named-app recovery vs sentence-case pitfalls', () => {
  it('matches the reviewed named-app repros that origin/main captured', () => {
    const mustNot = new Set<string>(REVIEWED_MUST_NOT_MATCH);
    for (const p of NAMED_APP_REVIEW_REPROS) {
      expect(matchedOnOriginMain(p), `origin/main should have captured: ${p}`).toBe(true);
      expect(mustNot.has(p), `named-app repro must not be on the must-not-match list: ${p}`).toBe(false);
      expect(ids(p), p).toContain('open-apps');
    }
  });

  it('does not match sentence-case pitfalls where a newline or punctuation follows app', () => {
    for (const p of NAMED_APP_SENTENCE_CASE_PITFALLS) {
      expect(ids(p), JSON.stringify(p)).not.toContain('open-apps');
    }
    expect(ids('open the app')).not.toContain('open-apps');
    expect(ids('open the app settings')).not.toContain('open-apps');
    expect(ids('open the app to see the dashboard')).not.toContain('open-apps');
    expect(ids('open the app first')).not.toContain('open-apps');
    expect(ids('when I open the app, show the welcome screen')).not.toContain('open-apps');
    expect(ids('whenever I open the app')).not.toContain('open-apps');
    expect(ids('I open the app every morning')).not.toContain('open-apps');
    expect(ids(BR1974_PROMPT)).not.toContain('open-apps');
  });

  it('any capitalized-token capture is a subset of what origin/main captured', () => {
    const corpus = wholeRegressionCorpus();
    let capHits = 0;
    for (const p of corpus) {
      if (openNamedAppCapitalizedTokenAsked(withoutMachineText(p))) {
        capHits += 1;
        expect(matchedOnOriginMain(p), `capitalized-token capture must be an origin/main hit: ${p}`).toBe(true);
      }
    }
    expect(capHits).toBeGreaterThan(5);
  });
});
