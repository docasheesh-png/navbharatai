import { describe, it, expect } from 'vitest';
import { deadTokensFrom } from './PushNotificationService';

describe('deadTokensFrom', () => {
  it('returns tokens FCM reports as not-registered or invalid', () => {
    const tokens = ['t1', 't2', 't3'];
    const responses = [
      { success: true },
      { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      { success: false, error: { code: 'messaging/invalid-registration-token' } },
    ];
    expect(deadTokensFrom(tokens, responses)).toEqual(['t2', 't3']);
  });

  it('does NOT prune a token that failed for a transient reason (e.g. quota, internal error)', () => {
    const tokens = ['t1', 't2'];
    const responses = [
      { success: false, error: { code: 'messaging/internal-error' } },
      { success: false, error: { code: 'messaging/quota-exceeded' } },
    ];
    expect(deadTokensFrom(tokens, responses)).toEqual([]);
  });

  it('returns [] when every send succeeded', () => {
    const tokens = ['t1', 't2'];
    const responses = [{ success: true }, { success: true }];
    expect(deadTokensFrom(tokens, responses)).toEqual([]);
  });

  it('handles a failure with no error code without throwing', () => {
    const tokens = ['t1'];
    const responses = [{ success: false }];
    expect(deadTokensFrom(tokens, responses)).toEqual([]);
  });

  it('is safe against a shorter tokens array than responses (defensive)', () => {
    const tokens = ['t1'];
    const responses = [
      { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      { success: false, error: { code: 'messaging/registration-token-not-registered' } },
    ];
    expect(deadTokensFrom(tokens, responses)).toEqual(['t1']);
  });
});
