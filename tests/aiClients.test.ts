import { describe, it, expect, afterEach, vi } from 'vitest';
import { isPlaceholder, resolveApiKey, hasKey } from '../src/server/lib/aiClients';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isPlaceholder', () => {
  it('returns true for undefined', () => {
    expect(isPlaceholder(undefined)).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(isPlaceholder('')).toBe(true);
  });

  it('returns true for key starting with "MY_"', () => {
    expect(isPlaceholder('MY_GEMINI_KEY')).toBe(true);
  });

  it('returns true for literal "undefined"', () => {
    expect(isPlaceholder('undefined')).toBe(true);
  });

  it('returns true for literal "null"', () => {
    expect(isPlaceholder('null')).toBe(true);
  });

  it('returns true for "YOUR_API_KEY"', () => {
    expect(isPlaceholder('YOUR_API_KEY')).toBe(true);
  });

  it('returns true for gemini key not starting with "AIza"', () => {
    expect(isPlaceholder('a'.repeat(30), true, 'gemini')).toBe(true);
  });

  it('returns true for gemini key shorter than 20 chars', () => {
    expect(isPlaceholder('AIzaShort', true, 'gemini')).toBe(true);
  });

  it('returns true for non-gemini key shorter than 10 chars', () => {
    expect(isPlaceholder('short', true)).toBe(true);
  });

  it('returns false for a valid non-gemini key >= 10 chars in strict mode', () => {
    expect(isPlaceholder('validkey12345', true)).toBe(false);
  });

  it('returns false for a valid gemini key (AIza + 20+ chars)', () => {
    expect(isPlaceholder('AIza' + 'x'.repeat(30), true, 'gemini')).toBe(false);
  });
});

describe('resolveApiKey', () => {
  it('returns NONE when no user key and no env key', () => {
    const result = resolveApiKey('unknownprovider999');
    expect(result.source).toBe('NONE');
    expect(result.key).toBeNull();
  });

  it('returns USER when a valid user key is provided', () => {
    const result = resolveApiKey('groq', 'gsk_valid_user_key_abcdefghijk');
    expect(result.source).toBe('USER');
  });

  it('returns SYSTEM when a valid system env key is set', () => {
    vi.stubEnv('TESTPROVIDER_API_KEY', 'system_env_key_abcdefghijk');
    const result = resolveApiKey('TESTPROVIDER');
    expect(result.source).toBe('SYSTEM');
  });

  it('prefers user key over system env key', () => {
    vi.stubEnv('GROQ_API_KEY', 'system_groq_key_abcdefghijk');
    const result = resolveApiKey('groq', 'user_groq_key_abcdefghijk');
    expect(result.source).toBe('USER');
  });
});

describe('hasKey', () => {
  it('returns false when no key is available', () => {
    expect(hasKey('unknownproviderxyz')).toBe(false);
  });

  it('returns true when a valid user key is provided', () => {
    expect(hasKey('groq', 'gsk_valid_user_key_abcdefghijk')).toBe(true);
  });
});
