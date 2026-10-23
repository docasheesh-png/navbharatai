import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertLegacyInferenceAllowed, runWithInferenceScope } from '../inferencePolicy';
import { InferenceGatewayTerminalError, runWithGatewaySelection } from './dispatchBoundary';
afterEach(() => vi.unstubAllEnvs());
describe('selected gateway direct-dispatch boundary', () => {
  it.each(['direct-text-provider', 'paid-web-search', 'embedding', 'builder-file-embeddings', 'vision', 'builder-claude'])('blocks unclaimed %s even when strict-free OFF', capability => {
    expect(() => runWithGatewaySelection(true, () => assertLegacyInferenceAllowed(capability))).toThrow(InferenceGatewayTerminalError);
  });
  it('cannot be weakened by an unselected async descendant', async () => {
    await expect(runWithGatewaySelection(true, async () => { await Promise.resolve(); return runWithGatewaySelection(false, async () => assertLegacyInferenceAllowed('embedding')); })).rejects.toThrow(InferenceGatewayTerminalError);
  });
  it('does not block unrelated concurrent legacy requests', async () => {
    await Promise.all([runWithGatewaySelection(true, async () => { await Promise.resolve(); expect(() => assertLegacyInferenceAllowed('direct-text-provider')).toThrow(); }),
      runWithGatewaySelection(false, async () => { await Promise.resolve(); expect(() => assertLegacyInferenceAllowed('direct-text-provider')).not.toThrow(); })]);
  });
  it('preserves image generation and enhancement dependencies outside their existing strict rule', () => {
    for (const capability of ['image-generation', 'image-edit', 'image-enhancement']) expect(() => runWithGatewaySelection(true, () => assertLegacyInferenceAllowed(capability))).not.toThrow();
  });
  it('does not weaken existing strict-free legacy rejection', () => {
    vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'on');
    expect(() => runWithInferenceScope('free-modules', () => runWithGatewaySelection(false, () => assertLegacyInferenceAllowed('direct-text-provider')))).toThrow();
  });
});
