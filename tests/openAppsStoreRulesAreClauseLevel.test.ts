// Generated fuzz-style corpus for the #4165 store/link rules (deep-link, own-listing
// clause exclusion, Hinglish particles). Behaviour is asserted through requestedCapabilities.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
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
  enclosingClause,
  clauseHasOwnListingLanguage,
  isDeepPrefixedLink,
} from '../src/server/AgentV3/nativeCapabilities';

function ids(p: string): string[] {
  return requestedCapabilities(p).map((c) => c.id);
}

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
    nomatch.push(`play store ${p} khol ke daal dena`);
    nomatch.push(`play store ${p} khol ke daalna hai`);
    nomatch.push(`play store ${p} khol ke publish karna`);
    nomatch.push(`app store ${p} khol ke upload karna`);
  }
  return { match, nomatch };
}

describe('open-apps store rules: exported sources', () => {
  it('locks the clause, deep-prefix, particle and no-bare-store rules', () => {
    expect(OPEN_APPS_CORE_SOURCE).toContain('|apps');
    expect(OPEN_APPS_STORE_TOKEN_SOURCE).toBe('\\b(?:app|play)[\\s-]*store\\b');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('listings?');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('daal\\w*');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('publish\\w*');
    expect(OPEN_APPS_OWN_LISTING_SOURCE).toContain('developer\\s+accounts?');
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
  it('blocks our/the/this/my and of/for listing language in the same clause', () => {
    expect(clauseHasOwnListingLanguage('link to play store page for our app listing')).toBe(true);
    expect(clauseHasOwnListingLanguage('open play store page')).toBe(false);
    expect(enclosingClause('Go. link to play store page for our app listing. Done.', 8)).toMatch(/listing/i);
    for (const p of fuzzListingDeterminerPhrases()) {
      expect(ids(p), p).not.toContain('open-apps');
    }
    expect(ids('open play store page')).toContain('open-apps');
    expect(ids('link to play store page')).toContain('open-apps');
  });
});

describe('open-apps store rules: generated Hinglish particle fuzz', () => {
  it('matches store+khol with particles unless the clause also has daal/publish/upload', () => {
    const { match, nomatch } = fuzzHinglishParticlePhrases();
    for (const p of match) expect(ids(p), p).toContain('open-apps');
    for (const p of nomatch) expect(ids(p), p).not.toContain('open-apps');
    expect(ids('play store pe khol ke dekho')).toContain('open-apps');
    expect(ids('play store kholo')).toContain('open-apps');
    expect(ids('play store pe khol ke daal dena')).not.toContain('open-apps');
  });
});

describe('open-apps store rules: khol do vs store listing', () => {
  it('plain khol do matches; khol do play store listing does not', () => {
    expect(ids('khol do')).toContain('open-apps');
    expect(ids('khol do play store listing')).not.toContain('open-apps');
    expect(ids('khol do play store')).toContain('open-apps');
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

  it('clause rule conservatively skips a store-open that also names listing language', () => {
    expect(ids('open the play store and then check the browser console')).not.toContain('open-apps');
    expect(ids('open the play store, then edit the listing')).not.toContain('open-apps');
    expect(ids('play store kholo aur daal banao')).not.toContain('open-apps');
  });
});
