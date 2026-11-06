import { describe, expect, it } from 'vitest';
import { mitrifyBotError } from './mitrifyBotError';

describe('Mitrify phone diagnostics', () => {
  it('distinguishes configuration, authorization and gateway response failures', () => {
    expect(mitrifyBotError(401, { code: 'MITRIFY_CONFIGURATION' })).toContain('server configuration');
    expect(mitrifyBotError(403, { code: 'MITRIFY_BOT_FORBIDDEN' })).toContain('selected verified account');
    expect(mitrifyBotError(503, { code: 'MITRIFY_NETWORK' })).toContain('could not reach');
    expect(mitrifyBotError(503, { code: 'MITRIFY_INVALID_RESPONSE' })).toContain('unreadable or empty');
  });
  it('never renders arbitrary error fields, prototype names, or malformed status', () => {
    const privateText = 'untrusted private response';
    for (const code of [privateText, '__proto__', 'constructor', ['MITRIFY_CONFIGURATION'], null]) {
      const result = mitrifyBotError(NaN, { code, error: privateText, message: privateText });
      expect(result).not.toContain(privateText);
      expect(result).toBe('Mitrify could not complete the reply. No other provider was used.');
    }
  });
  it('preserves actionable HTTP status even when the response is not JSON', () => {
    expect(mitrifyBotError(429, null)).toContain('rate limited. Try again later. (HTTP 429)');
    expect(mitrifyBotError(502, '<html>private response</html>')).toBe('Mitrify could not complete the reply. (HTTP 502) No other provider was used.');
    expect(mitrifyBotError(200, null)).not.toContain('HTTP 200');
  });
});
