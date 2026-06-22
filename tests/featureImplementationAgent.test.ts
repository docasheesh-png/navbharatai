import { describe, it, expect } from 'vitest';
import { FeatureImplementationAgent } from '../src/server/AI/FeatureImplementationAgent';

describe('FeatureImplementationAgent', () => {
  it('implementFeature returns a result with the correct featureName', async () => {
    const agent = new FeatureImplementationAgent();
    const result = await agent.implementFeature('auth system', {});
    expect(result.featureName).toBe('auth system');
  });

  it('result indicates files were modified and created', async () => {
    const agent = new FeatureImplementationAgent();
    const result = await agent.implementFeature('dashboard', {});
    expect(result.filesModified).toBeGreaterThan(0);
    expect(result.filesCreated).toBeGreaterThan(0);
  });

  it('result indicates all system layers were covered', async () => {
    const agent = new FeatureImplementationAgent();
    const result = await agent.implementFeature('payment flow', {});
    expect(result.databaseUpdated).toBe(true);
    expect(result.apiCreated).toBe(true);
    expect(result.frontendCreated).toBe(true);
    expect(result.verificationPassed).toBe(true);
  });

  it('works with an empty context object', async () => {
    const agent = new FeatureImplementationAgent();
    const result = await agent.implementFeature('empty-context-test', {});
    expect(result).toBeDefined();
    expect(result.featureName).toBe('empty-context-test');
  });
});
