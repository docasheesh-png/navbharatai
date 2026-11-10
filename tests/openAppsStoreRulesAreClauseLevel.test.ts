// Generated fuzz-style corpus for the #4165 store/link rules (deep-link, store-publish
// idioms, Hinglish particles) plus the origin/main c072e0eb9 regression gate.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { withoutMachineText } from '../src/server/lib/machineText';
import {
  requestedCapabilities,
  OPEN_APPS_CORE_SOURCE,
  OPEN_APPS_STORE_TOKEN_SOURCE,
  OPEN_APPS_OWN_LISTING_SOURCE,
  OPEN_APPS_DEEP_BEFORE_LINK_SOURCE,
  OPEN_APPS_STORE_OPEN_VERBS_SOURCE,
  OPEN_APPS_LAUNCH_BEFORE_STORE_SOURCE,
  OPEN_APPS_EXPLICIT_OPEN_BEFORE_STORE_SOURCE,
  OPEN_APPS_STORE_PRESENCE_TAIL_SOURCE,
  OPEN_APPS_BARE_PUBLISH_AT_END_SOURCE,
  OPEN_APPS_STORE_PARTICLES_SOURCE,
  OPEN_APPS_KHOL_SOURCE,
  OPEN_APPS_BARE_STORE,
  OPEN_APPS_BARE_DRAWER,
  OPEN_APPS_HINGLISH_PUBLISH_DAAL_SOURCE,
  OPEN_APPS_HINGLISH_PUBLISH_PARTICLE_SOURCE,
  OPEN_APPS_HINGLISH_PUBLISH_KAR_SOURCE,
  OPEN_APPS_PUBLISH_VERB_GAP_SOURCE,
  enclosingClause,
  clauseHasOwnListingLanguage,
  clauseHasBarePublishAtEnd,
  isDeepPrefixedLink,
} from '../src/server/AgentV3/nativeCapabilities';
import {
  BR1974_PROMPT,
  SAME_CLASS_OPEN_APPS,
  OPPOSITE_NOT_OPEN_APPS,
} from './aWhatsAppNumberIsNotAnOpenAppsRequest.test';

function ids(p: string): string[] {
  return requestedCapabilities(p).map((c) => c.id);
}

/**
 * Snapshot of open-apps.asks at origin/main c072e0eb96ee3390d90e07b91d55f06bc54e6108
 * (pre-BR1974). Used only as a regression gate — genuine opens that this matched
 * must still match at the new head.
 */
const ORIGIN_MAIN_C072E0EB9_OPEN_APPS = /\b(call\s+(?:karo|kar|kare|kardo|mummy|mom|papa)|make\s+(?:a\s+)?call|whats\s*app|sms|open\s+(?:the\s+)?(?:app|apps)|app\s+khol\w*|khol\s+do)\b/i;

function matchedOnOriginMain(prompt: string): boolean {
  return ORIGIN_MAIN_C072E0EB9_OPEN_APPS.test(withoutMachineText(prompt));
}

const SIX_LOST_ORIGIN_MAIN_REPROS = [
  'Add a button to open the App Store after the app is published on the App Store',
  'After the app is published on the App Store, add a button to open the App Store',
  'open the App Store to see the book we published last year on the App Store',
  'open the App Store to see the exclusive special edition we published on the App Store',
  'open the App Store to read the blog post on the editorial page we published on the App Store',
  'open the App Store after it is released on the Play Store',
] as const;

const REVIEWER_GENUINE_OPEN_STORE = [
  'open the app store so the user can submit a review',
  'Add a button to open the App Store, and a screenshots carousel on the home page',
  'After we release, a button should open the App Store',
  'open the App Store from the admin console',
  'open the App Store to see if a new release is available',
  'Add an Open App Store button so users can see other apps we published',
  'Build a music console with a button to open the App Store',
  'open the play store so the user can submit a review',
  'Add a button to open the Play Store, and a screenshots carousel on the home page',
  'After we release, a button should open the Play Store',
  'open the Play Store from the admin console',
  'open the Play Store to see if a new release is available',
  'Add an Open Play Store button so users can see other apps we published',
  'Build a music console with a button to open the Play Store',
  'play store kholo aur daal makhani recipe dikhao',
] as const;

const EARLIER_GENUINE_OPEN_REQUESTS = [
  'mujhe jarwis chahiye jo mujhe yaad dilaye, bolkar command le, aur whatsapp khole',
  'open WhatsApp',
  'send a WhatsApp message',
  'contact me on WhatsApp',
  'whatsapp kholo',
  'make a call',
  'call mummy',
  'open other apps',
  'open another app',
  'open the apps',
  'app kholo',
  'open apps like YouTube',
  'please open apps',
  'open the app store',
  'Open the Play Store',
  'button to open Play Store',
  'redirect to app store',
  'link to play store page',
  'launch the app store',
  'redirect to the Play Store',
  'open WhatsApp chat with this number',
  'open the app drawer',
  'open apps installed on phone',
  'please open the apps',
  'users should be able to open apps from this screen',
  'play store kholo',
  'app store kholo',
  'play store kholna hai',
  'play store khol ke dekho',
  'app store mein kholo',
  'go to the play store',
  'khol do',
  'open play store page',
  'open the play store and then check the browser console',
  'open the play store, then edit the listing',
  'play store kholo aur daal banao',
] as const;

const MORE_RULE_A_GENUINE_OPENS = [
  ...SIX_LOST_ORIGIN_MAIN_REPROS,
  'open the App Store after it is released in the Play Store',
  // Explicit Rule A open. Informal "submit karna" without a store+particle is acceptable.
  'open the play store and submit karna',
  'open the App Store and publish karna',
  'go to the play store and then check the browser console',
  'go to the play store, then edit the listing',
] as const;

const GENUINE_OPEN_REQUESTS = [
  ...REVIEWER_GENUINE_OPEN_STORE,
  ...EARLIER_GENUINE_OPEN_REQUESTS,
  ...MORE_RULE_A_GENUINE_OPENS,
  ...SAME_CLASS_OPEN_APPS,
] as const;

function fuzzDeepLinkPhrases(): string[] {
  const out: string[] = [];
  for (const deep of ['deep', 'Deep', 'DEEP']) {
    for (const sep of [' ', '  ', '   ', '-', '']) {
      for (const link of ['link', 'Link']) {
        out.push(`${deep}${sep}${link} to the play store`);
        out.push(`${deep}${sep}${link} to the app store`);
      }
    }
  }
  out.push('deeply link to the play store');
  out.push('Deeply  Link to the App Store');
  return out;
}

function fuzzListingDeterminerPhrases(): string[] {
  const out: string[] = [];
  for (const det of ['our', 'the', 'this', 'my']) {
    for (const prep of ['for', 'of']) {
      out.push(`link to play store page ${prep} ${det} app listing`);
      out.push(`open the play store page ${prep} ${det} app listing`);
      out.push(`open the play store page ${prep} ${det} own app listing`);
    }
  }
  return out;
}

function fuzzHinglishParticlePhrases(): { match: string[]; nomatch: string[] } {
  const match: string[] = [];
  const nomatch: string[] = [];
  for (const p of ['pe', 'mein', 'me', 'ko', 'par', 'se']) {
    match.push(`play store ${p} kholo`);
    match.push(`play store ${p} khol ke dekho`);
    match.push(`app store ${p} kholo`);
    match.push(`Play Store ${p} Kholo`);
  }
  // Publish particles are pe/par/me/mein/ko/se: store + particle + daal* or publish/upload/submit kar*.
  for (const p of ['pe', 'mein', 'me', 'par', 'ko', 'se']) {
    nomatch.push(`play store ${p} khol ke daal dena`);
    nomatch.push(`play store ${p} khol ke daalna hai`);
    nomatch.push(`play store ${p} khol ke daal do`);
    nomatch.push(`app store ${p} khol ke daalo`);
    for (const verb of ['publish', 'upload', 'submit']) {
      for (const kar of ['karna', 'karo', 'kar do', 'kardo', 'kar dena', 'kar de']) {
        nomatch.push(`play store ${p} khol ke ${verb} ${kar}`);
      }
    }
  }
  return { match, nomatch };
}

function fuzzEnglishTensePhrases(): { match: string[]; nomatch: string[] } {
  return {
    match: [
      'Add an Open App Store button so users can see other apps we published',
      'After we release, a button should open the App Store',
      'open the App Store so the user can submit a review',
      'publish this then go to the Play Store',
      'open the App Store and publish our app to the Play Store',
      'open the App Store after it is submitted to the Play Store',
      'open the App Store after it is released on the Play Store',
      'open the App Store after it is uploaded to the Play Store',
      'open the App Store while publishing on the app store',
      'open the Play Store and publish our new android app to the App Store',
      'open the App Store and publish our brand new updated android application to the Play Store',
      'open the App Store and uploaded the apk to the Play Store',
      ...SIX_LOST_ORIGIN_MAIN_REPROS,
    ],
    nomatch: [
      'go to the play store after publishing our app to the Play Store',
      'go to the play store and publish',
      'go to the play store and publish my app',
      'redirect to the play store and publish our app',
      'link to the play store and publish my app',
      'go to the play store and upload my app',
      'go to the play store and submit my app',
      'go to the play store and submit karna',
      'link to the play store and upload the apk',
    ],
  };
}

/**
 * Pair a store mention with publish/listing language.
 * Rule A (explicit open/launch + store, or store + khol): the explicit open
 * always wins, so origin/main `open the App Store …` captures cannot regress.
 * Rule B (link/redirect/go): the clause-level publish idiom still wins, and
 * so does bare `publish` at the end of the clause.
 * Hinglish khol + daal/publish-kar in the same short phrase is not Rule A.
 */
const PUBLISH_IDIOM_WITH_OPEN_PAIRS: { prompt: string; matches: boolean; reason: string }[] = [
  { prompt: 'open the App Store and submit to the Play Store', matches: true, reason: 'Rule A explicit open' },
  { prompt: 'open the App Store and publish to the Play Store', matches: true, reason: 'Rule A explicit open' },
  { prompt: 'open the App Store and upload to the Play Store', matches: true, reason: 'Rule A explicit open' },
  { prompt: 'open the App Store and update the Play Store listing', matches: true, reason: 'Rule A explicit open' },
  { prompt: 'open the App Store next to the listing page', matches: true, reason: 'Rule A explicit open' },
  { prompt: 'open the App Store and edit the app listing', matches: true, reason: 'Rule A explicit open' },
  { prompt: 'open the App Store and the Play Console', matches: true, reason: 'Rule A explicit open' },
  { prompt: 'open the App Store then add screenshots for the Play Store', matches: true, reason: 'Rule A explicit open' },
  { prompt: 'open the App Store after the app store release', matches: true, reason: 'Rule A explicit open' },
  { prompt: 'play store pe kholo aur daal dena', matches: false, reason: 'store pe + daal dena' },
  { prompt: 'play store ko khol ke daal do', matches: false, reason: 'store ko + daal do' },
  { prompt: 'play store pe khol ke publish karna', matches: false, reason: 'store pe + publish karna' },
  { prompt: 'play store pe khol ke upload karna', matches: false, reason: 'store pe + upload karna' },
  { prompt: 'play store pe khol ke submit karo', matches: false, reason: 'store pe + submit karo' },
  { prompt: 'play store ko khol ke publish kar do', matches: false, reason: 'store ko + publish kar do' },
  { prompt: 'open the App Store and publish our app to the Play Store', matches: true, reason: 'Rule A explicit open' },
  { prompt: 'open the App Store after it is submitted to the Play Store', matches: true, reason: 'Rule A explicit open' },
  { prompt: 'open the App Store after it is released on the Play Store', matches: true, reason: 'Rule A unlocked released-on' },
  { prompt: 'open the App Store after it is uploaded to the Play Store', matches: true, reason: 'Rule A explicit open' },
  { prompt: 'open the App Store while publishing on the app store', matches: true, reason: 'Rule A explicit open' },
  { prompt: 'go to the play store and publish', matches: false, reason: 'Rule B + bare publish at end' },
  { prompt: 'go to the play store and publish my app', matches: false, reason: 'Rule B + bare publish my app' },
  { prompt: 'redirect to the play store and publish our app', matches: false, reason: 'Rule B + bare publish our app' },
  { prompt: 'link to the play store and publish my app', matches: false, reason: 'Rule B + bare publish' },
  { prompt: 'go to the play store and upload my app', matches: false, reason: 'Rule B + bare upload my app' },
  { prompt: 'go to the play store and submit my app', matches: false, reason: 'Rule B + submit my app, not a review' },
  { prompt: 'go to the play store and submit karna', matches: false, reason: 'Rule B + submit karna' },
  { prompt: 'link to the play store and upload the apk', matches: false, reason: 'Rule B + upload the apk' },
  { prompt: 'go to the play store after publishing our app to the Play Store', matches: false, reason: 'Rule B + publish to store idiom' },
  { prompt: 'go to the play store and edit the app listing', matches: false, reason: 'Rule B + app listing' },
  { prompt: 'go to the play store then edit the Play Console', matches: false, reason: 'Rule B + Play Console' },
  { prompt: 'go to the play store and then the app store console', matches: false, reason: 'Rule B + store console' },
  { prompt: 'go to the play store and then check the browser console', matches: true, reason: 'Rule B + bare browser console' },
  { prompt: 'go to the play store, then edit the listing', matches: true, reason: 'Rule B + bare listing' },
  { prompt: 'open the App Store so the user can submit a review', matches: true, reason: 'bare submit, not submit to/on the store' },
  { prompt: 'Add a button to open the App Store, and a screenshots carousel on the home page', matches: true, reason: 'bare screenshots' },
  { prompt: 'After we release, a button should open the App Store', matches: true, reason: 'bare release' },
  { prompt: 'open the App Store from the admin console', matches: true, reason: 'admin console is not Play/developer/store console' },
  { prompt: 'open the App Store to see if a new release is available', matches: true, reason: 'new release is not store release' },
  { prompt: 'Add an Open App Store button so users can see other apps we published', matches: true, reason: 'published is not a publish idiom' },
  { prompt: 'Build a music console with a button to open the App Store', matches: true, reason: 'music console is not Play Console' },
  { prompt: 'play store kholo aur daal makhani recipe dikhao', matches: true, reason: 'daal makhani is not daalna/daalo/daal dena/daal do' },
];

describe('open-apps store rules: exported sources', () => {
  it('locks idiom-level listing language, deep-prefix, and no bare store', () => {
    expect(OPEN_APPS_CORE_SOURCE).toContain('|apps');
    expect(OPEN_APPS_STORE_TOKEN_SOURCE).toBe('\\b(?:app|play)[\\s-]*store\\b');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('submit(?:s|ted|ting)?');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('publish(?:es|ed|ing)?');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).not.toContain('publish\\w*');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('upload(?:s|ed|ing)?');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('release(?:s|d|ing)?');
    expect(OPEN_APPS_PUBLISH_VERB_GAP_SOURCE).toContain('{0,8}');
    expect(OPEN_APPS_HINGLISH_PUBLISH_KAR_SOURCE).toContain('publish|upload|submit');
    expect(OPEN_APPS_HINGLISH_PUBLISH_PARTICLE_SOURCE).toContain('ko');
    expect(OPEN_APPS_HINGLISH_PUBLISH_PARTICLE_SOURCE).toContain('se');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('developer\\s+accounts?');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('(?:play|developer)\\s+console');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('app\\s+listings?');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('listing\\s+pages?');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).not.toContain('daal\\w*');
    expect(OPEN_APPS_HINGLISH_PUBLISH_DAAL_SOURCE).toContain('daalna');
    expect(OPEN_APPS_HINGLISH_PUBLISH_DAAL_SOURCE).not.toContain('daal\\w*');
    expect(OPEN_APPS_HINGLISH_PUBLISH_PARTICLE_SOURCE).toContain('pe');
    expect(OPEN_APPS_DEEP_BEFORE_LINK_SOURCE).toBe('deep(?:ly)?[\\s-]*$');
    expect(OPEN_APPS_DEEP_BEFORE_LINK_SOURCE).not.toContain('(?<');
    expect(OPEN_APPS_STORE_OPEN_VERBS_SOURCE).toContain('go(?:es|ing)?');
    expect(OPEN_APPS_LAUNCH_BEFORE_STORE_SOURCE).toContain('launch(?:es|ing)?');
    expect(OPEN_APPS_LAUNCH_BEFORE_STORE_SOURCE).not.toMatch(/to\|on\|in/);
    expect(OPEN_APPS_EXPLICIT_OPEN_BEFORE_STORE_SOURCE).toContain('open(?:s|ing)?');
    expect(OPEN_APPS_STORE_PRESENCE_TAIL_SOURCE).toContain('listings?');
    expect(OPEN_APPS_STORE_PRESENCE_TAIL_SOURCE).toContain('developer\\s+accounts?');
    expect(OPEN_APPS_STORE_PRESENCE_TAIL_SOURCE).toContain('page\\s+(?:for|of)');
    expect(OPEN_APPS_BARE_PUBLISH_AT_END_SOURCE).toContain('publish');
    expect(OPEN_APPS_STORE_PARTICLES_SOURCE).toContain('mein');
    expect(OPEN_APPS_STORE_PARTICLES_SOURCE).toContain('ko');
    expect(OPEN_APPS_KHOL_SOURCE).toBe('khol\\w*');
    expect(OPEN_APPS_BARE_STORE).toBe(false);
    expect(OPEN_APPS_BARE_DRAWER).toBe(false);
    const here = join(__dirname, '..');
    expect(readFileSync(join(here, 'src/main.tsx'), 'utf8')).not.toMatch('nativeCapabilities');
    expect(readFileSync(join(here, 'src/App.tsx'), 'utf8')).not.toMatch('nativeCapabilities');
  });
});

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
 * Explicit, reviewed must-not-match list. Origin/main may match some of these
 * (WhatsApp number fields, singular "open the app", "khol do play store listing");
 * those intentional exclusions are listed here so the regression gate does not
 * demand them back. Everything else that origin/main matched must still match.
 */
function reviewedMustNotMatchList(): string[] {
  const { nomatch: hinglishNo } = fuzzHinglishParticlePhrases();
  const { nomatch: tenseNo } = fuzzEnglishTensePhrases();
  return uniquePrompts([
    ...OPPOSITE_NOT_OPEN_APPS,
    ...fuzzDeepLinkPhrases(),
    ...fuzzListingDeterminerPhrases(),
    ...hinglishNo,
    ...tenseNo,
    ...PUBLISH_IDIOM_WITH_OPEN_PAIRS.filter((row) => !row.matches).map((row) => row.prompt),
    BR1974_PROMPT,
    'a hyperlink to the play store',
    'deeplink to Play Store',
    'deep-link to the App Store',
    'khol do play store listing',
    'The app will undergo the Play Store review process',
    'open the play storefront',
    'go to the play store and publish',
    'go to the play store and publish my app',
    'go to the play store and upload my app',
    'go to the play store and submit my app',
    'go to the play store and submit karna',
    'link to the play store and upload the apk',
    'open the App Store listing',
    'open the App Store screenshots',
    'open the App Store release',
    'please open the App Store listing page',
    'open the Play Store console',
  ]);
}

function wholeRegressionCorpus(): string[] {
  const { match: hinglishYes, nomatch: hinglishNo } = fuzzHinglishParticlePhrases();
  const { match: tenseYes, nomatch: tenseNo } = fuzzEnglishTensePhrases();
  return uniquePrompts([
    ...GENUINE_OPEN_REQUESTS,
    ...OPPOSITE_NOT_OPEN_APPS,
    ...SIX_LOST_ORIGIN_MAIN_REPROS,
    ...fuzzDeepLinkPhrases(),
    ...fuzzListingDeterminerPhrases(),
    ...hinglishYes,
    ...hinglishNo,
    ...tenseYes,
    ...tenseNo,
    ...PUBLISH_IDIOM_WITH_OPEN_PAIRS.map((row) => row.prompt),
    BR1974_PROMPT,
    'a hyperlink to the play store',
    'deeplink to Play Store',
    'deep-link to the App Store',
    'see other apps we published',
    'open the App Store after it is released in the Play Store',
    'open the play store and submit karna',
    'go to the play store and publish',
    'go to the play store and publish my app',
    'go to the play store and upload my app',
    'go to the play store and submit my app',
    'go to the play store and submit karna',
    'link to the play store and upload the apk',
    'open the App Store listing',
    'open the App Store screenshots',
    'open the App Store release',
    'please open the App Store listing page',
    'open the Play Store console',
    'go to the play store and then check the browser console',
    'go to the play store, then edit the listing',
  ]);
}

describe('open-apps store rules: origin/main c072e0eb9 regression gate', () => {
  it('every corpus prompt that origin/main captured, except reviewed must-not-matches, still matches', () => {
    const mustNot = new Set(reviewedMustNotMatchList());
    const corpus = wholeRegressionCorpus();
    expect(corpus.length).toBeGreaterThan(40);
    const mainHits = corpus.filter((p) => matchedOnOriginMain(p));
    expect(mainHits.length).toBeGreaterThan(15);
    const required = mainHits.filter((p) => !mustNot.has(p));
    expect(required.length).toBeGreaterThan(10);
    for (const p of SIX_LOST_ORIGIN_MAIN_REPROS) {
      expect(matchedOnOriginMain(p), `origin/main should have captured: ${p}`).toBe(true);
      expect(mustNot.has(p), `lost repro must not be on the reviewed must-not-match list: ${p}`).toBe(false);
    }
    for (const p of required) {
      expect(ids(p), `origin/main c072e0eb9 matched this prompt and it is not a reviewed must-not-match: ${p}`).toContain('open-apps');
    }
  });

  it('every listed genuine open-store and open-apps prompt matches at this head', () => {
    for (const p of GENUINE_OPEN_REQUESTS) {
      expect(ids(p), p).toContain('open-apps');
    }
  });

  it('the reviewed must-not-match set stays uncaptured', () => {
    for (const p of reviewedMustNotMatchList()) {
      expect(ids(p), p).not.toContain('open-apps');
    }
  });

  it('does not recapture origin/main hits that were not genuine opens', () => {
    expect(matchedOnOriginMain('Enter Your WhatsApp Mobile Number')).toBe(true);
    expect(matchedOnOriginMain('when I open the app')).toBe(true);
    expect(matchedOnOriginMain('khol do play store listing')).toBe(true);
    expect(ids('Enter Your WhatsApp Mobile Number')).not.toContain('open-apps');
    expect(ids('when I open the app')).not.toContain('open-apps');
    expect(ids('open the app')).not.toContain('open-apps');
    expect(ids('khol do play store listing')).not.toContain('open-apps');
  });
});

describe('open-apps store rules: generated deep-link fuzz', () => {
  it('never counts deep-link separators or "deeply link" as the link verb', () => {
    expect(isDeepPrefixedLink('deep link', 5)).toBe(true);
    expect(isDeepPrefixedLink('deep  link', 6)).toBe(true);
    expect(isDeepPrefixedLink('deep-link', 5)).toBe(true);
    expect(isDeepPrefixedLink('deeplink', 4)).toBe(true);
    expect(isDeepPrefixedLink('deeply link', 7)).toBe(true);
    expect(isDeepPrefixedLink('link to the play store', 0)).toBe(false);
    for (const p of fuzzDeepLinkPhrases()) {
      expect(ids(p), p).not.toContain('open-apps');
    }
  });
});

describe('open-apps store rules: generated listing-determiner fuzz', () => {
  it('blocks our/the/this/my and of/for app-listing language in the same clause', () => {
    expect(clauseHasOwnListingLanguage('link to play store page for our app listing')).toBe(true);
    expect(clauseHasOwnListingLanguage('open play store page')).toBe(false);
    expect(clauseHasOwnListingLanguage('open the app store so the user can submit a review')).toBe(false);
    expect(enclosingClause('Go. link to play store page for our app listing. Done.', 8)).toMatch(/listing/i);
    for (const p of fuzzListingDeterminerPhrases()) {
      expect(ids(p), p).not.toContain('open-apps');
    }
    expect(ids('open play store page')).toContain('open-apps');
    expect(ids('link to play store page')).toContain('open-apps');
  });
});

describe('open-apps store rules: generated Hinglish particle fuzz', () => {
  it('matches store+khol with particles unless khol is followed by daal/publish-kar in the short phrase', () => {
    const { match, nomatch } = fuzzHinglishParticlePhrases();
    for (const p of match) expect(ids(p), p).toContain('open-apps');
    for (const p of nomatch) expect(ids(p), p).not.toContain('open-apps');
    expect(ids('play store pe khol ke dekho')).toContain('open-apps');
    expect(ids('play store kholo')).toContain('open-apps');
    expect(ids('play store pe khol ke daal dena')).not.toContain('open-apps');
    expect(ids('play store ko khol ke daal do')).not.toContain('open-apps');
    expect(ids('play store pe khol ke publish karna')).not.toContain('open-apps');
    expect(ids('play store pe khol ke upload karna')).not.toContain('open-apps');
    expect(ids('play store se khol ke daal do')).not.toContain('open-apps');
    expect(ids('play store pe khol ke publish kar dena')).not.toContain('open-apps');
    expect(ids('play store kholo aur daal makhani recipe dikhao')).toContain('open-apps');
  });
});

describe('open-apps store rules: khol do vs store listing', () => {
  it('plain khol do matches; khol do play store listing does not', () => {
    expect(ids('khol do')).toContain('open-apps');
    expect(ids('khol do play store listing')).not.toContain('open-apps');
    expect(ids('khol do play store')).toContain('open-apps');
  });
});

describe('open-apps store rules: publish idiom paired with a genuine open', () => {
  it('Rule A explicit opens match; Rule B keeps idiom-wins; Hinglish khol+daal/kar stays out', () => {
    for (const row of PUBLISH_IDIOM_WITH_OPEN_PAIRS) {
      if (row.matches) expect(ids(row.prompt), `${row.reason}: ${row.prompt}`).toContain('open-apps');
      else expect(ids(row.prompt), `${row.reason}: ${row.prompt}`).not.toContain('open-apps');
    }
  });
});

describe('open-apps store rules: self-hunt residuals', () => {
  it('does not treat a hyperlink suffix as the link verb', () => {
    expect(ids('a hyperlink to the play store')).not.toContain('open-apps');
    expect(ids('deeplink to Play Store')).not.toContain('open-apps');
    expect(ids('deep-link to the App Store')).not.toContain('open-apps');
  });

  it('a genuine WhatsApp request is not blocked by a later listing clause', () => {
    expect(ids('open WhatsApp. Then publish to the Play Store listing.')).toContain('open-apps');
  });

  it('launch to/on/in stays a publish idiom across case', () => {
    for (const p of ['Launch To The Play Store', 'LAUNCH ON PLAY STORE', 'launch in the app store']) {
      expect(ids(p), p).not.toContain('open-apps');
    }
    expect(ids('launch the app store')).toContain('open-apps');
  });

  it('does not treat play storefront as a store token', () => {
    expect(ids('open the play storefront')).not.toContain('open-apps');
  });

  it('does not treat undergo-the-play-store as a go-verb', () => {
    expect(ids('The app will undergo the Play Store review process')).not.toContain('open-apps');
  });

  it('bare listing/console/daal no longer block a genuine store-open', () => {
    expect(ids('open the play store and then check the browser console')).toContain('open-apps');
    expect(ids('open the play store, then edit the listing')).toContain('open-apps');
    expect(ids('play store kholo aur daal banao')).toContain('open-apps');
  });

  it('bare published/release/submit still allow a genuine store-open', () => {
    expect(clauseHasOwnListingLanguage('see other apps we published')).toBe(false);
    expect(ids('Add an Open App Store button so users can see other apps we published')).toContain('open-apps');
    expect(ids('After we release, a button should open the App Store')).toContain('open-apps');
    expect(ids('open the App Store so the user can submit a review')).toContain('open-apps');
  });

  it('Rule A recovers the six lost origin/main App Store opens', () => {
    for (const p of SIX_LOST_ORIGIN_MAIN_REPROS) {
      expect(ids(p), p).toContain('open-apps');
    }
    expect(ids('open the App Store after it is released in the Play Store')).toContain('open-apps');
    expect(ids('open the play store and submit karna')).toContain('open-apps');
  });

  it('Rule B excludes go-to-store plus bare publish at the end of the clause', () => {
    expect(clauseHasBarePublishAtEnd('go to the play store and publish my app')).toBe(true);
    expect(clauseHasBarePublishAtEnd('go to the play store and publish')).toBe(true);
    expect(clauseHasBarePublishAtEnd('go to the play store and submit a review')).toBe(false);
    expect(ids('go to the play store and publish my app')).not.toContain('open-apps');
    expect(ids('go to the play store and publish')).not.toContain('open-apps');
    expect(ids('go to the play store and upload my app')).not.toContain('open-apps');
    expect(ids('go to the play store and submit my app')).not.toContain('open-apps');
    expect(ids('go to the play store and submit karna')).not.toContain('open-apps');
    expect(ids('go to the play store and submit a review')).toContain('open-apps');
  });
});

describe('open-apps store rules: generated English tense/gap fuzz', () => {
  it('Rule A keeps explicit opens that name a publish idiom; Rule B still excludes go/link + publish', () => {
    const { match, nomatch } = fuzzEnglishTensePhrases();
    for (const p of match) expect(ids(p), p).toContain('open-apps');
    for (const p of nomatch) expect(ids(p), p).not.toContain('open-apps');
  });
});
