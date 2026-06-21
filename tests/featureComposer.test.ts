import { describe, it, expect } from 'vitest';
import { FeatureComposer } from '../src/server/BuildEngine/FeatureComposer';

describe('FeatureComposer.compose', () => {
  const fc = new FeatureComposer();

  it('always includes ui-atoms', () => {
    const features = fc.compose('Build a clock widget');
    const ids = features.map(f => f.id);
    expect(ids).toContain('ui-atoms');
  });

  it('includes data-persistence and api-routes for a management request', () => {
    const features = fc.compose('Build a project management tool');
    const ids = features.map(f => f.id);
    expect(ids).toContain('data-persistence');
    expect(ids).toContain('api-routes');
  });

  it('includes data-persistence and api-routes for a CRM request', () => {
    const features = fc.compose('Build a CRM system');
    const ids = features.map(f => f.id);
    expect(ids).toContain('data-persistence');
    expect(ids).toContain('api-routes');
  });

  it('does NOT include data-persistence for a simple front-end request', () => {
    const features = fc.compose('Build a calculator UI');
    const ids = features.map(f => f.id);
    expect(ids).not.toContain('data-persistence');
    expect(ids).not.toContain('api-routes');
  });

  it('ui-atoms exposes Button and Input in its components', () => {
    const features = fc.compose('any');
    const atoms = features.find(f => f.id === 'ui-atoms');
    expect(atoms?.components).toContain('Button');
    expect(atoms?.components).toContain('Input');
  });
});
