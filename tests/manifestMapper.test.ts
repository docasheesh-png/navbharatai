import { describe, it, expect } from 'vitest';
import { ManifestMapper } from '../src/server/AppMakerLab/ManifestMapper';
import type { InternalRequirementDTO, InternalPlanDTO } from '../src/server/AppMakerLab/types';

function makeReq(prompt: string): InternalRequirementDTO {
  return { id: 'req-1', prompt, timestamp: Date.now(), metadata: {} };
}

function makePlan(): InternalPlanDTO {
  return { id: 'plan-1', requirementId: 'req-1', steps: [], manifest: {} as any };
}

describe('ManifestMapper', () => {
  it('always includes src/App.tsx in filesToGenerate', () => {
    const manifest = ManifestMapper.map(makeReq('build anything'), makePlan());
    expect(manifest.filesToGenerate).toContain('src/App.tsx');
  });

  it('sets projectType to react-spa', () => {
    const manifest = ManifestMapper.map(makeReq('anything'), makePlan());
    expect(manifest.projectType).toBe('react-spa');
  });

  it('adds Calculator component for calculator prompt', () => {
    const manifest = ManifestMapper.map(makeReq('build a calculator app'), makePlan());
    expect(manifest.components).toContain('Calculator');
    expect(manifest.filesToGenerate).toContain('src/components/Calculator.tsx');
    expect(manifest.dependencies).toContain('lucide-react');
  });

  it('returns empty components for non-calculator prompt', () => {
    const manifest = ManifestMapper.map(makeReq('build a todo list'), makePlan());
    expect(manifest.components).toHaveLength(0);
  });
});
