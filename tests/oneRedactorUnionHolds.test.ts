/**
 * Locked plan item 5 (weakness audit P1-6, adapted): Pro Chain V2's error redactor was a private copy with its own short
 * pattern list. A JWT, an AWS/GitHub/Google key or a password inside a URL was masked by the shared redactor
 * (SecretRedactor.ts) and NOT by it, and our own gateway keys were masked ONLY by it. Now the shared one runs first
 * inside it, the gateway keys are in the shared list, and the error line keeps the useful tail (1200, was 600).
 * The source-aware SourceSecretRedactor is unchanged: it already wraps the shared one by design.
 */
import { describe, expect, it } from 'vitest';
import { redactSecrets as shared } from '../src/server/AgentV3/SecretRedactor';
import { redactSecrets as proChain, ERROR_LINE_MAX } from '../src/server/AgentV3/proChainV2/redact';

// One row per secret shape, from both lists. A row that the old Pro Chain copy left in the clear proves the union.
const ROWS: Array<[string, string]> = [
  ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
  ['aws', 'AKIAIOSFODNN7EXAMPLE'],
  ['github', `ghp_${'a'.repeat(36)}`],
  ['google', `AIza${'b'.repeat(35)}`],
  ['url password', 'postgres://admin:hunter2pass@db.example.com/app'],
  ['anthropic-shaped', `sk-ant-${'c'.repeat(30)}`],
  ['gateway', `qbx_${'d'.repeat(24)}`],
  ['gateway mtf', `mtf_live_${'e'.repeat(24)}`],
];

describe('🔴 every shape is masked by BOTH redactors', () => {
  for (const [name, secret] of ROWS) {
    it(name, () => {
      expect(proChain(`provider said: ${secret} failed`)).not.toContain(secret);
      expect(shared(`provider said: ${secret} failed`)).not.toContain(secret);
    });
  }
});

describe('neighbours: no over-masking, and the line keeps its tail', () => {
  it('an ordinary identifier with a gateway-like prefix stays', () => {
    expect(shared('qbx_config = load()')).toContain('qbx_config');
  });
  it('a configured exact secret is still removed first', () => {
    expect(proChain('token abcdef123456 rejected', ['abcdef123456'])).not.toContain('abcdef123456');
  });
  it('a long provider error keeps up to ERROR_LINE_MAX, marked when cut', () => {
    const long = `HTTP 400: ${'x '.repeat(1000)}the real reason is here`;
    const out = proChain(long);
    expect(out.length).toBeLessThanOrEqual(ERROR_LINE_MAX);
    expect(out.endsWith('…')).toBe(true);
    expect(ERROR_LINE_MAX).toBeGreaterThan(600);
  });
});
