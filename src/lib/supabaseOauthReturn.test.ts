import { describe, it, expect } from 'vitest';
import { nonceFromSupabaseDeepLink, errorFromSupabaseDeepLink } from './supabaseOauthReturn';

// Regression lock for the 2026-09-14 fix: connecting Supabase from the native (Capacitor) app ended on
// "Please sign in first." because the flow used a full-page web redirect that leaves the app's own
// origin. The native fix returns through a deep link instead; this pins how that link is parsed.

describe('nonceFromSupabaseDeepLink', () => {
  it('reads the nonce out of our own deep link', () => {
    expect(nonceFromSupabaseDeepLink('com.navbharat.ai://supabase-callback?nonce=abc123')).toBe('abc123');
  });

  it('reads the nonce alongside other params, in any order', () => {
    expect(nonceFromSupabaseDeepLink('com.navbharat.ai://supabase-callback?foo=bar&nonce=xyz')).toBe('xyz');
  });

  it('returns null for a GitHub deep link, or anything that is not ours', () => {
    expect(nonceFromSupabaseDeepLink('com.navbharat.ai://github-callback?nonce=abc123')).toBeNull();
    expect(nonceFromSupabaseDeepLink('https://navbharatai.com/?sbconnect=abc123')).toBeNull();
  });

  it('returns null for empty, missing, or blank nonce', () => {
    expect(nonceFromSupabaseDeepLink(null)).toBeNull();
    expect(nonceFromSupabaseDeepLink(undefined)).toBeNull();
    expect(nonceFromSupabaseDeepLink('com.navbharat.ai://supabase-callback')).toBeNull();
    expect(nonceFromSupabaseDeepLink('com.navbharat.ai://supabase-callback?nonce=')).toBeNull();
    expect(nonceFromSupabaseDeepLink('com.navbharat.ai://supabase-callback?nonce=%20')).toBeNull();
  });
});

describe('errorFromSupabaseDeepLink', () => {
  it('reads the error out of our own deep link', () => {
    expect(errorFromSupabaseDeepLink('com.navbharat.ai://supabase-callback?error=That%20link%20expired.'))
      .toBe('That link expired.');
  });

  it('returns null when there is no error, or it is not our link', () => {
    expect(errorFromSupabaseDeepLink('com.navbharat.ai://supabase-callback?nonce=abc')).toBeNull();
    expect(errorFromSupabaseDeepLink('com.navbharat.ai://github-callback?error=x')).toBeNull();
    expect(errorFromSupabaseDeepLink(null)).toBeNull();
  });
});
