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
  OPEN_APPS_STORE_PARTICLES_SOURCE,
  OPEN_APPS_KHOL_SOURCE,
  OPEN_APPS_BARE_STORE,
  OPEN_APPS_BARE_DRAWER,
  OPEN_APPS_HINGLISH_PUBLISH_DAAL_SOURCE,
  OPEN_APPS_HINGLISH_PUBLISH_PARTICLE_SOURCE,
  enclosingClause,
  clauseHasOwnListingLanguage,
  isDeepPrefixedLink,
} from '../src/server/AgentV3/nativeCapabilities';

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

const GENUINE_OPEN_REQUESTS = [
  ...REVIEWER_GENUINE_OPEN_STORE,
  ...EARLIER_GENUINE_OPEN_REQUESTS,
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
  // Publish particles are pe/par/me/mein (not ko/se): store + particle + daalna/daalo/daal dena/daal do.
  for (const p of ['pe', 'mein', 'me', 'par']) {
    nomatch.push(`play store ${p} khol ke daal dena`);
    nomatch.push(`play store ${p} khol ke daalna hai`);
    nomatch.push(`play store ${p} khol ke daal do`);
    nomatch.push(`app store ${p} khol ke daalo`);
  }
  return { match, nomatch };
}

/**
 * Pair a genuine open with a store-publish idiom in the same clause.
 * Decision: the publish idiom wins (do not capture via the store alternative).
 * Justification: a single clause that both asks to open the store and names a
 * store-publish idiom is typically about this app's store presence (listing,
 * console, shipping). Capturing it would reintroduce the @capacitor/app-launcher
 * side-effect on publish language (t311u). Split across sentences, the open
 * clause still matches. Bare tokens (submit a review, screenshots carousel,
 * published, admin/music console, daal makhani) are not idioms, so those
 * genuine opens still match.
 */
const PUBLISH_IDIOM_WITH_OPEN_PAIRS: { prompt: string; matches: boolean; reason: string }[] = [
  { prompt: 'open the App Store and submit to the Play Store', matches: false, reason: 'submit to the store' },
  { prompt: 'open the App Store and publish to the Play Store', matches: false, reason: 'publish to the store' },
  { prompt: 'open the App Store and upload to the Play Store', matches: false, reason: 'upload to the store' },
  { prompt: 'open the App Store and update the Play Store listing', matches: false, reason: 'store listing' },
  { prompt: 'open the App Store next to the listing page', matches: false, reason: 'listing page' },
  { prompt: 'open the App Store and edit the app listing', matches: false, reason: 'app listing' },
  { prompt: 'open the App Store and the Play Console', matches: false, reason: 'Play Console' },
  { prompt: 'open the App Store then add screenshots for the Play Store', matches: false, reason: 'screenshots for the store' },
  { prompt: 'open the App Store after the app store release', matches: false, reason: 'store release' },
  { prompt: 'play store pe kholo aur daal dena', matches: false, reason: 'store pe + daal dena' },
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
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('submit(?:s|ting)?\\s+(?:to|on)');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('publish(?:es|ing)?\\s+(?:to|on)');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).not.toContain('publish\\w*');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('upload(?:s|ing)?\\s+to');
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
    expect(OPEN_APPS_STORE_PARTICLES_SOURCE).toContain('mein');
    expect(OPEN_APPS_KHOL_SOURCE).toBe('khol\\w*');
    expect(OPEN_APPS_BARE_STORE).toBe(false);
    expect(OPEN_APPS_BARE_DRAWER).toBe(false);
    const here = join(__dirname, '..');
    expect(readFileSync(join(here, 'src/main.tsx'), 'utf8')).not.toMatch('nativeCapabilities');
    expect(readFileSync(join(here, 'src/App.tsx'), 'utf8')).not.toMatch('nativeCapabilities');
  });
});

describe('open-apps store rules: origin/main c072e0eb9 regression gate', () => {
  it('every genuine open that origin/main captured still matches at this head', () => {
    const regressions = GENUINE_OPEN_REQUESTS.filter((p) => matchedOnOriginMain(p));
    expect(regressions.length).toBeGreaterThan(10);
    for (const p of regressions) {
      expect(ids(p), `origin/main c072e0eb9 matched this genuine open: ${p}`).toContain('open-apps');
    }
  });

  it('every listed genuine open-store and open-apps prompt matches at this head', () => {
    for (const p of GENUINE_OPEN_REQUESTS) {
      expect(ids(p), p).toContain('open-apps');
    }
  });

  it('does not recapture origin/main hits that were not genuine opens', () => {
    expect(matchedOnOriginMain('Enter Your WhatsApp Mobile Number')).toBe(true);
    expect(matchedOnOriginMain('when I open the app')).toBe(true);
    expect(ids('Enter Your WhatsApp Mobile Number')).not.toContain('open-apps');
    expect(ids('when I open the app')).not.toContain('open-apps');
    expect(ids('open the app')).not.toContain('open-apps');
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
  it('matches store+khol with particles unless the clause also has pe/par/me + daalna', () => {
    const { match, nomatch } = fuzzHinglishParticlePhrases();
    for (const p of match) expect(ids(p), p).toContain('open-apps');
    for (const p of nomatch) expect(ids(p), p).not.toContain('open-apps');
    expect(ids('play store pe khol ke dekho')).toContain('open-apps');
    expect(ids('play store kholo')).toContain('open-apps');
    expect(ids('play store pe khol ke daal dena')).not.toContain('open-apps');
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
  it('publish idiom wins in the same clause; bare tokens do not', () => {
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
});
