import { describe, it, expect } from 'vitest';
import { ManifestMapper } from '../src/server/AppMakerLab/ManifestMapper';
import type { InternalRequirementDTO, InternalPlanDTO } from '../src/server/AppMakerLab/types';

function req(prompt: string): InternalRequirementDTO {
  return { id: 'r1', prompt, timestamp: Date.now(), metadata: {} };
}

const emptyPlan: InternalPlanDTO = {
  id: 'p1', requirementId: 'r1', steps: [],
  manifest: { projectType: 'react-spa', features: [], components: [], logicHandlers: [], filesToGenerate: [], dependencies: [] },
};

describe('ManifestMapper.map', () => {
  it('always includes src/App.tsx in filesToGenerate', () => {
    const m = ManifestMapper.map(req('Build a landing page'), emptyPlan);
    expect(m.filesToGenerate).toContain('src/App.tsx');
  });

  it('projectType is always "react-spa"', () => {
    const m = ManifestMapper.map(req('any request'), emptyPlan);
    expect(m.projectType).toBe('react-spa');
  });

  it('adds Calculator.tsx and calculator-ui feature for a calculator prompt', () => {
    const m = ManifestMapper.map(req('Build a scientific calculator'), emptyPlan);
    expect(m.filesToGenerate).toContain('src/components/Calculator.tsx');
    expect(m.components).toContain('Calculator');
    expect(m.features).toContain('calculator-ui');
    expect(m.dependencies).toContain('lucide-react');
  });

  it('does not add calculator files for a non-calculator prompt', () => {
    const m = ManifestMapper.map(req('Build a todo app'), emptyPlan);
    expect(m.filesToGenerate).not.toContain('src/components/Calculator.tsx');
    expect(m.components).not.toContain('Calculator');
  });

  it('returns only the base file for a plain prompt with no matching keywords', () => {
    const m = ManifestMapper.map(req('Build a greeting page'), emptyPlan);
    expect(m.filesToGenerate).toHaveLength(1);
    expect(m.features).toHaveLength(0);
  });
});
