import { describe, it, expect } from 'vitest';
import { BlueprintInferenceEngine } from '../src/server/AppMakerLab/BlueprintInferenceEngine';
import type { InternalRequirementDTO } from '../src/server/AppMakerLab/types';

function req(prompt: string): InternalRequirementDTO {
  return { id: 'req-1', prompt, timestamp: Date.now(), metadata: {} };
}

describe('BlueprintInferenceEngine.infer', () => {
  it('returns a blueprint with version "V3"', () => {
    const bp = BlueprintInferenceEngine.infer(req('build a todo app'));
    expect(bp.version).toBe('V3');
  });

  it('id is prefixed with "bp_" + requirement id', () => {
    const r = req('test');
    const bp = BlueprintInferenceEngine.infer(r);
    expect(bp.id).toBe(`bp_${r.id}`);
  });

  it('links requirementId to the input requirement', () => {
    const bp = BlueprintInferenceEngine.infer(req('test'));
    expect(bp.requirementId).toBe('req-1');
  });

  it('infers "Game" type for game prompt', () => {
    const bp = BlueprintInferenceEngine.infer(req('build a game'));
    expect(bp.type).toBe('Game');
  });

  it('infers "Website" type for website prompt', () => {
    const bp = BlueprintInferenceEngine.infer(req('create a blog website'));
    expect(bp.type).toBe('Website');
  });

  it('infers "App" type for generic prompt', () => {
    const bp = BlueprintInferenceEngine.infer(req('build a calculator'));
    expect(bp.type).toBe('App');
  });

  it('populates roles from the template', () => {
    const bp = BlueprintInferenceEngine.infer(req('build an app'));
    expect(bp.roles.length).toBeGreaterThan(0);
  });

  it('populates apiEndpoints from the template', () => {
    const bp = BlueprintInferenceEngine.infer(req('build an app'));
    expect(bp.apiEndpoints.length).toBeGreaterThan(0);
  });
});
