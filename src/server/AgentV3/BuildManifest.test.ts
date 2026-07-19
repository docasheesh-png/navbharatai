import { describe, it, expect } from 'vitest';
import {
  buildBuildManifest,
  canonicalizeManifest,
  deliveredModelId,
  signManifest,
  verifyManifestSignature,
  manifestSummaryLine,
  BUILD_MANIFEST_SCHEMA,
  type BuildManifestInput,
} from './BuildManifest';

const base = (over: Partial<BuildManifestInput> = {}): BuildManifestInput => ({
  buildId: 'b1',
  promptHash: 'ph1',
  model: 'glm-5.2',
  effort: 'medium',
  powerLevel: 'medium',
  providerLadder: ['GLM', 'KIMI', 'CLAUDE'],
  framework: 'vite-react',
  createdAt: '2026-07-14T10:00:00.000Z',
  files: { 'src/App.tsx': 'export default 1', 'src/index.css': 'body{}' },
  gates: { tsc: 'pass', lint: 'pass' },
  ...over,
});

const SECRET = 'test-secret-key';

describe('buildBuildManifest', () => {
  it('records schema, routing inputs, and a sha256 hash per written file', () => {
    const m = buildBuildManifest(base());
    expect(m.schema).toBe(BUILD_MANIFEST_SCHEMA);
    expect(m.model).toBe('glm-5.2');
    expect(m.providerLadder).toEqual(['GLM', 'KIMI', 'CLAUDE']);
    expect(Object.keys(m.fileHashes).sort()).toEqual(['src/App.tsx', 'src/index.css']);
    expect(m.fileHashes['src/App.tsx']).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
  it('omits empty optional fields', () => {
    const m = buildBuildManifest({ buildId: 'b', promptHash: 'p', model: 'x', createdAt: 't', files: {} });
    expect(m.effort).toBeUndefined();
    expect(m.providerLadder).toBeUndefined();
    expect(m.gates).toBeUndefined();
  });
});

describe('canonicalize + sign + verify', () => {
  it('identical inputs → identical canonical form AND identical signature', () => {
    const a = signManifest(buildBuildManifest(base()), SECRET);
    const b = signManifest(buildBuildManifest(base()), SECRET);
    expect(canonicalizeManifest(a)).toBe(canonicalizeManifest(b));
    expect(a.signature).toBe(b.signature);
    expect(a.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a changed file changes the hash AND the signature', () => {
    const a = signManifest(buildBuildManifest(base()), SECRET);
    const b = signManifest(buildBuildManifest(base({ files: { 'src/App.tsx': 'export default 2', 'src/index.css': 'body{}' } })), SECRET);
    expect(b.fileHashes['src/App.tsx']).not.toBe(a.fileHashes['src/App.tsx']);
    expect(b.signature).not.toBe(a.signature);
  });

  it('a valid signature verifies; a tampered manifest fails verification', () => {
    const m = signManifest(buildBuildManifest(base()), SECRET);
    expect(verifyManifestSignature(m, SECRET)).toBe(true);
    // Tamper with a hashed file after signing.
    const tampered = { ...m, fileHashes: { ...m.fileHashes, 'src/App.tsx': 'deadbeef' } };
    expect(verifyManifestSignature(tampered, SECRET)).toBe(false);
    // Wrong key fails too.
    expect(verifyManifestSignature(m, 'other-key')).toBe(false);
  });

  it('field order never affects the canonical form (stable key sort)', () => {
    const m = buildBuildManifest(base());
    const reordered = { schema: m.schema, fileHashes: m.fileHashes, model: m.model, buildId: m.buildId, promptHash: m.promptHash, createdAt: m.createdAt } as typeof m;
    // Same logical content in a different declaration order → same canonical string (signature excluded).
    expect(canonicalizeManifest({ ...m, signature: 'zzz' })).toBe(canonicalizeManifest(m));
    expect(canonicalizeManifest(reordered)).toContain('"model":"glm-5.2"');
  });

  it('no secret → no signature, honest unsigned state, never throws', () => {
    const m = buildBuildManifest(base());
    expect(signManifest(m, undefined).signature).toBeUndefined();
    expect(signManifest(m, '').signature).toBeUndefined();
    expect(verifyManifestSignature(m, SECRET)).toBe(false); // unsigned → not verifiable
    expect(verifyManifestSignature(signManifest(m, undefined), undefined)).toBe(false);
  });
});

describe('deliveredModelId — the model that ACTUALLY built (ShopSphere autopsy: no nominal-Claude lie)', () => {
  it('returns the highest-output model of the dominant provider', () => {
    // A weak GLM build: flash did most of the output → THAT is the delivered model, never the nominal Claude.
    const entries = [
      { provider: 'GLM', model: 'glm-4.7-flash', usage: { inputTokens: 100, outputTokens: 5000 } },
      { provider: 'GLM', model: 'glm-4.7', usage: { inputTokens: 50, outputTokens: 900 } },
    ];
    expect(deliveredModelId(entries, 'GLM')).toBe('glm-4.7-flash');
  });

  it('prefers the dominant provider even if another provider had more output', () => {
    const entries = [
      { provider: 'CLAUDE', model: 'claude-sonnet-4-6', usage: { inputTokens: 10, outputTokens: 9000 } },
      { provider: 'GLM', model: 'glm-4.7', usage: { inputTokens: 10, outputTokens: 800 } },
    ];
    expect(deliveredModelId(entries, 'GLM')).toBe('glm-4.7');
  });

  it('falls back to the global max when the dominant provider has no model-tagged slice', () => {
    const entries = [
      { provider: 'GLM', usage: { inputTokens: 10, outputTokens: 5000 } }, // no model id
      { provider: 'KIMI', model: 'kimi-k2.6', usage: { inputTokens: 10, outputTokens: 800 } },
    ];
    expect(deliveredModelId(entries, 'GLM')).toBe('kimi-k2.6');
  });

  it('returns undefined when no slice carries a model id (keep the nominal model)', () => {
    expect(deliveredModelId([{ provider: 'GLM', usage: { outputTokens: 100 } }], 'GLM')).toBeUndefined();
    expect(deliveredModelId([], 'GLM')).toBeUndefined();
  });

  it('the manifest records the delivered model + provider, NOT the nominal Claude fallback', () => {
    const entries = [{ provider: 'GLM', model: 'glm-4.7-flash', usage: { inputTokens: 1, outputTokens: 9 } }];
    const delivered = deliveredModelId(entries, 'GLM');
    const m = buildBuildManifest(base({ model: delivered || 'claude-sonnet-4-6', deliveredVia: 'GLM' }));
    expect(m.model).toBe('glm-4.7-flash');
    expect(m.deliveredVia).toBe('GLM');
    expect(manifestSummaryLine(m)).toContain('model=glm-4.7-flash');
  });
});

describe('manifestSummaryLine', () => {
  it('renders file count, model, and signed/unsigned honestly', () => {
    const signed = signManifest(buildBuildManifest(base()), SECRET);
    expect(manifestSummaryLine(signed)).toContain('2 file hash(es)');
    expect(manifestSummaryLine(signed)).toContain('signed(');
    expect(manifestSummaryLine(buildBuildManifest(base()))).toContain('unsigned');
  });
});
