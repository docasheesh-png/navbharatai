import { describe, expect, it } from 'vitest';
import { gatewayRetryAfterUntil } from './retryAfter';
const now = Date.UTC(2026, 9, 23);
describe('bounded authenticated Retry-After interpretation', () => {
  it.each([undefined, null, '', 'not a date', '-1', '12cats'])('ignores missing or malformed %s', value => {
    expect(gatewayRetryAfterUntil(value, now)).toBeUndefined();
  });
  it('accepts seconds and HTTP date without shortening a longer valid delay', () => {
    expect(gatewayRetryAfterUntil('3600', now)).toBe(now + 3600000);
    expect(gatewayRetryAfterUntil(new Date(now + 86400000).toUTCString(), now)).toBe(now + 86400000);
    expect(gatewayRetryAfterUntil('0.01', now)).toBe(now + 10);
  });
  it('reports excessive valid delay distinctly so no retry proof is minted', () => {
    expect(gatewayRetryAfterUntil('604800', now)).toBe(now + 7 * 86400000);
    expect(gatewayRetryAfterUntil('604801', now)).toBeNull();
    expect(gatewayRetryAfterUntil('9'.repeat(100), now)).toBeNull();
  });
  it('treats a past HTTP date as elapsed, leaving the default cooldown to the issuer', () => {
    expect(gatewayRetryAfterUntil(new Date(now - 86400000).toUTCString(), now)).toBe(now);
  });
});
