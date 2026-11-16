import { describe, expect, it } from 'vitest';
import { ALWAYS_ON_MAX_COOLDOWN_MS, mitrifySwitchOn, qubaxSwitchOn } from '../src/server/lib/alwaysOnSuppliers';
import { DEFAULT_ORDER } from '../src/server/AI/FreeChain/config';
import { prioritizeChatSuppliers } from '../src/server/AI/fixedTextChain';
import { qubaxRequestCeilingNanoUsd } from '../src/server/lib/qubaxMarket';

// Owner t357u + t359u (2026-11-16): Mitrify, Qubax and CheaperInference always on; one Chat order.
describe('always-on suppliers', () => {
  it('Qubax and Mitrify are ON when their switch is unset, empty or unrecognised', () => {
    for (const raw of [undefined, '', 'yes', 'on', '1', 'whatever']) {
      expect(qubaxSwitchOn({ QUBAX_ENABLED: raw })).toBe(true);
      expect(mitrifySwitchOn({ MITRIFY_CHAIN_ENABLED: raw })).toBe(true);
    }
  });
  it('only an explicit off value is the emergency kill switch', () => {
    for (const raw of ['off', 'false', '0', 'no', 'OFF']) {
      expect(qubaxSwitchOn({ QUBAX_ENABLED: raw })).toBe(false);
      expect(mitrifySwitchOn({ MITRIFY_CHAIN_ENABLED: raw })).toBe(false);
    }
  });
  it('a missing key still means nothing to call (no invented supplier)', () => {
    expect(qubaxRequestCeilingNanoUsd({})).toBeNull();
    expect(qubaxRequestCeilingNanoUsd({ QUBAX_API_KEY: 'k' })).toBeGreaterThan(0);
  });
  it('a failure benches an always-on supplier for at most 30 seconds', () => {
    expect(ALWAYS_ON_MAX_COOLDOWN_MS).toBe(30_000);
  });
  it('Chat order is exactly the owner-approved sequence', () => {
    const base = [...DEFAULT_ORDER] as string[];
    const at = base.indexOf('openrouter') + 1;
    const order = prioritizeChatSuppliers([...base.slice(0, at), 'mitrify', 'qubax', ...base.slice(at)], 'chat');
    expect(order).toEqual(['mitrify', 'qubax', 'glm45', 'glm47', 'groq', 'cloudflare', 'openrouter', 'cheapinf',
      'llama8b', 'dsv4flash', 'gpt5nano', 'glmflashx', 'geminipaid']);
  });
});
