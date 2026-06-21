import { describe, it, expect } from 'vitest';
import { BlueprintInferenceEngine } from '../src/server/AppMakerLab/BlueprintInferenceEngine';
import { inferType } from '../src/server/AppMakerLab/BlueprintPrompts';

describe('inferType', () => {
  it('returns Game for game prompts', () => {
    expect(inferType('build a card game')).toBe('Game');
  });

  it('returns Website for website/blog prompts', () => {
    expect(inferType('create a blog website')).toBe('Website');
  });

  it('returns App as default', () => {
    expect(inferType('build a crm tool')).toBe('App');
  });
});

describe('BlueprintInferenceEngine.infer', () => {
  const makeReq = (id: string, prompt: string) => ({ id, prompt, timestamp: Date.now(), metadata: {} });

  it('returns a blueprint with version V3', () => {
    const bp = BlueprintInferenceEngine.infer(makeReq('r1', 'build anything'));
    expect(bp.version).toBe('V3');
  });

  it('sets requirementId from the req id', () => {
    const bp = BlueprintInferenceEngine.infer(makeReq('req-42', 'build something'));
    expect(bp.requirementId).toBe('req-42');
  });

  it('infers Game type for game prompt', () => {
    const bp = BlueprintInferenceEngine.infer(makeReq('r1', 'build a game'));
    expect(bp.type).toBe('Game');
    expect(bp.roles.some(r => r.name === 'Player')).toBe(true);
  });

  it('infers Website type for website prompt', () => {
    const bp = BlueprintInferenceEngine.infer(makeReq('r1', 'create a blog website'));
    expect(bp.type).toBe('Website');
    expect(bp.pages.some(p => p.path === '/about')).toBe(true);
  });

  it('infers App type by default', () => {
    const bp = BlueprintInferenceEngine.infer(makeReq('r1', 'build an app'));
    expect(bp.type).toBe('App');
  });
});
