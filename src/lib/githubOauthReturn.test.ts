import { describe, it, expect } from 'vitest';
import { tokenFromDeepLink, resumeOutcome, GITHUB_DEEP_LINK_PREFIX } from './githubOauthReturn';

describe('tokenFromDeepLink — reading the token off the app\'s own callback', () => {
  it('reads the token out of the fragment the server sends', () => {
    expect(tokenFromDeepLink(`${GITHUB_DEEP_LINK_PREFIX}#gh_token=gho_abc123`)).toBe('gho_abc123');
  });

  it('accepts the query form too, since a redirect chain can move it', () => {
    expect(tokenFromDeepLink(`${GITHUB_DEEP_LINK_PREFIX}?gh_token=gho_abc123`)).toBe('gho_abc123');
  });

  it('decodes a token that had to be escaped', () => {
    expect(tokenFromDeepLink(`${GITHUB_DEEP_LINK_PREFIX}#gh_token=a%20b%26c`)).toBe('a b&c');
  });

  it('ignores every deep link that is not ours — this runs on all of them', () => {
    expect(tokenFromDeepLink('com.navbharat.ai://something-else')).toBeNull();
    expect(tokenFromDeepLink('https://navbharatai.com/build')).toBeNull();
    expect(tokenFromDeepLink('')).toBeNull();
    expect(tokenFromDeepLink(null)).toBeNull();
    expect(tokenFromDeepLink(undefined)).toBeNull();
  });

  it('treats an empty or blank token as absent rather than connecting with nothing', () => {
    expect(tokenFromDeepLink(`${GITHUB_DEEP_LINK_PREFIX}#gh_token=`)).toBeNull();
    expect(tokenFromDeepLink(`${GITHUB_DEEP_LINK_PREFIX}#gh_token=%20`)).toBeNull();
  });
});

describe('resumeOutcome — what coming back to the app means', () => {
  it('says cancelled only when the screen is still waiting AND nothing arrived', () => {
    expect(resumeOutcome({ stillWaiting: true, hasToken: false })).toBe('cancelled');
  });

  it('NEVER overwrites a success that the deep link already handled', () => {
    // The ordering is the whole subtlety: a successful return fires both the deep link and the resume,
    // on some platforms in an unhelpful order. Telling somebody their working sign-in was cancelled is
    // worse than saying nothing at all.
    expect(resumeOutcome({ stillWaiting: true, hasToken: true })).toBe('ignore');
    expect(resumeOutcome({ stillWaiting: false, hasToken: true })).toBe('ignore');
  });

  it('does nothing when no sign-in was in flight', () => {
    expect(resumeOutcome({ stillWaiting: false, hasToken: false })).toBe('ignore');
  });
});
