import { describe, expect, it } from 'vitest';
import { runWithSurplusBuild, runWithInferenceScope, assertLegacyInferenceAllowed, activateSurplusBuildForCurrentRequest } from '../inferencePolicy';
describe('discount builder scope isolation', () => {
  it('blocks legacy paid text/tools only in opted-in build, without context leakage', async () => {
    await Promise.all([
      runWithSurplusBuild(true, async () => { await Promise.resolve(); expect(() => assertLegacyInferenceAllowed('builder-claude')).toThrow('No paid fallback'); }),
      runWithSurplusBuild(false, async () => { await Promise.resolve(); expect(() => assertLegacyInferenceAllowed('builder-claude')).not.toThrow(); }),
      runWithInferenceScope('paid-professional', async () => { await Promise.resolve(); expect(() => assertLegacyInferenceAllowed('direct-text-provider')).not.toThrow(); }),
    ]);
    expect(() => assertLegacyInferenceAllowed('builder-claude')).not.toThrow();
  });
  it('keeps images and vision under their existing policy', () => {
    for (const capability of ['image-generation', 'image-edit', 'image-enhancement', 'vision', 'vision-description'])
      runWithSurplusBuild(true, () => expect(() => assertLegacyInferenceAllowed(capability)).not.toThrow());
  });
  it('does not activate free chat until the server identifies an actual build', async () => {
    await runWithSurplusBuild(false, async () => {
      expect(() => assertLegacyInferenceAllowed('direct-text-provider')).not.toThrow();
      activateSurplusBuildForCurrentRequest(); await Promise.resolve();
      expect(() => assertLegacyInferenceAllowed('direct-text-provider')).toThrow();
    });
    expect(() => activateSurplusBuildForCurrentRequest()).toThrow('Missing');
  });
  it('preserves the boundary through abort and does not leak it after rejection', async () => {
    await expect(runWithSurplusBuild(true, async () => { await Promise.resolve(); throw new Error('stopped'); })).rejects.toThrow('stopped');
    expect(() => assertLegacyInferenceAllowed('direct-text-provider')).not.toThrow();
  });
});
