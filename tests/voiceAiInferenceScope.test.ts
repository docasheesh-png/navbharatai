import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertLegacyInferenceAllowed, runWithInferenceScope, runWithSurplusBuild,
  strictFreeRequired, StrictFreeCapabilityError, SurplusLegacyFallbackError,
} from '../src/server/AI/inferencePolicy';
import { InferenceGatewayTerminalError, runWithGatewaySelection } from '../src/server/AI/InferenceGateway/dispatchBoundary';
import { CanaryReservationStore, CanarySpendBlocked, runWithCanarySpendGuard } from '../src/server/AgentV3/reliability/canarySpendGuard';

beforeEach(() => { vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'true'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('paid voice uses its own server-owned inference scope', () => {
  it('strict-free blocks the free route scope, but permits the admitted paid voice scope', () => {
    runWithInferenceScope('free-modules', () => {
      expect(strictFreeRequired()).toBe(true);
      expect(() => assertLegacyInferenceAllowed('text-to-speech')).toThrow(StrictFreeCapabilityError);
      runWithInferenceScope('paid-voice', () => {
        expect(strictFreeRequired()).toBe(false);
        expect(() => assertLegacyInferenceAllowed('text-to-speech')).not.toThrow();
      });
      expect(strictFreeRequired()).toBe(true);
      expect(() => assertLegacyInferenceAllowed('text-to-speech')).toThrow(StrictFreeCapabilityError);
    });
  });

  it('paid voice never relaxes concurrent free-module requests across asynchronous work', async () => {
    await Promise.all([
      runWithInferenceScope('paid-voice', async () => {
        await Promise.resolve();
        expect(strictFreeRequired()).toBe(false);
        expect(() => assertLegacyInferenceAllowed('text-to-speech')).not.toThrow();
      }),
      runWithInferenceScope('free-modules', async () => {
        await Promise.resolve();
        expect(strictFreeRequired()).toBe(true);
        expect(() => assertLegacyInferenceAllowed('text-to-speech')).toThrow(StrictFreeCapabilityError);
        expect(() => assertLegacyInferenceAllowed('direct-text-provider')).toThrow(StrictFreeCapabilityError);
      }),
    ]);
  });

  it('a rejected or cancelled paid callback restores the enclosing free-module boundary', async () => {
    await runWithInferenceScope('free-modules', async () => {
      await expect(runWithInferenceScope('paid-voice', async () => {
        await Promise.resolve();
        throw new Error('cancelled');
      })).rejects.toThrow('cancelled');
      expect(strictFreeRequired()).toBe(true);
      expect(() => assertLegacyInferenceAllowed('text-to-speech')).toThrow(StrictFreeCapabilityError);
    });
  });

  it('does not override a selected gateway dispatch restriction', () => {
    expect(() => runWithGatewaySelection(true, () => runWithInferenceScope('paid-voice', () =>
      assertLegacyInferenceAllowed('text-to-speech')))).toThrow(InferenceGatewayTerminalError);
  });

  it('does not override the discounted-build no-paid-fallback guard', () => {
    expect(() => runWithSurplusBuild(true, () => runWithInferenceScope('paid-voice', () =>
      assertLegacyInferenceAllowed('text-to-speech')))).toThrow(SurplusLegacyFallbackError);
  });

  it('does not authorize voice calls inside a restricted canary scope', () => {
    // No reservation is attempted: the existing canary capability guard rejects first.
    const store = new CanaryReservationStore({} as never);
    const binding = { uid: 'synthetic-user', requestId: 'synthetic-request', fixtureHash: '0'.repeat(64), tier: 'weak' as const };
    expect(() => runWithCanarySpendGuard('synthetic-voice-test', binding, store, () =>
      runWithInferenceScope('paid-voice', () => assertLegacyInferenceAllowed('text-to-speech')))).toThrow(CanarySpendBlocked);
  });
});
