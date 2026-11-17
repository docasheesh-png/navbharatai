import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { HUMAN_PACK, HUMAN_PACK_RIGHTS_REVIEW, HUMAN_PACK_INTEGRATION_REVIEW, needsHumanCharacter, prepareHumanAssets } from './humanPack';
import { validateRecoveredHumanGlb } from './humanPackPolicy';
import { validateGlb } from './assetPolicy';
import type { GameAssetSeedOptions } from './assetSeed';

describe('recovered human pack safety', () => {
  it('cannot be enabled by environment or owner allowlist before both reviews', async () => {
    expect(HUMAN_PACK_RIGHTS_REVIEW).toEqual({ approved: false, evidence: null });
    expect(HUMAN_PACK_INTEGRATION_REVIEW).toEqual({ approved: false, evidence: null });
    expect(Object.isFrozen(HUMAN_PACK_RIGHTS_REVIEW)).toBe(true);
    expect(Object.isFrozen(HUMAN_PACK_INTEGRATION_REVIEW)).toBe(true);
    const touched = vi.fn(() => { throw new Error('disabled pack touched workspace'); });
    const options = { prompt: 'PUBG human character', needsHuman: true, workspaceId: 'test', verifiedOwnerUid: 'owner', signal: new AbortController().signal, env: { AGENTV3_HUMAN_PACK: 'on', AGENTV3_HUMAN_PACK_OWNER_ALLOWLIST: 'owner' }, workspace: new Proxy({}, { get: touched }), persistence: new Proxy({}, { get: touched }) } as unknown as GameAssetSeedOptions;
    expect(await prepareHumanAssets(options)).toBeNull();
    expect(touched).not.toHaveBeenCalled();
  });
  it.each(['human character', 'battle royale', 'PUBG', 'football', 'मानव'])('recognizes bounded human intent: %s', prompt => {
    expect(needsHumanCharacter({ prompt })).toBe(true);
  });
  it.each(['no humans in this battle royale', 'without any characters', 'बिना मानव', 'car racing'])('does not infer humans: %s', prompt => {
    expect(needsHumanCharacter({ prompt })).toBe(false);
  });
  it.each([Buffer.alloc(0), Buffer.alloc(12), Buffer.from('not a glb'), Buffer.alloc(3_000_001)])('rejects unrecognized or over-budget bytes', bytes => {
    expect(() => validateRecoveredHumanGlb(bytes)).toThrow('Unrecognized recovered human bytes');
  });
  it('honors trusted plan override in either direction', () => {
    expect(needsHumanCharacter({ prompt: 'human', needsHuman: false })).toBe(false);
    expect(needsHumanCharacter({ prompt: 'car', needsHuman: true })).toBe(true);
  });
  it.each(HUMAN_PACK)('preserves exact recovered $id bytes and fails closed on unsupported extensions', async model => {
    const bytes = await readFile(`private-game-assets/humans/${model.file}`);
    expect(bytes.length).toBe(model.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(model.sha256);
    const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    expect(document.animations.map((clip: { name: string }) => clip.name)).toEqual(expect.arrayContaining(['Idle', 'Walk']));
    expect(document.extensionsUsed).toContain('KHR_materials_specular');
    // This is a release blocker, not successful render acceptance. Keep the strict policy intact.
    expect(() => validateGlb(bytes)).toThrow('Unsafe GLB: references or extensions');
    if (model.id === 'denim') expect(validateRecoveredHumanGlb(bytes).animations).toEqual(expect.arrayContaining(['Idle', 'Walk']));
    else expect(() => validateRecoveredHumanGlb(bytes)).toThrow('Unsafe GLB: geometry work budget');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(model.sha256);
    const modified = Buffer.from(bytes); modified[modified.length - 1] ^= 1;
    expect(() => validateRecoveredHumanGlb(modified)).toThrow('Unrecognized recovered human bytes');
  });
});
