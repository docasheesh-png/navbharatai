/**
 * Smoke tests for the simple AI agent classes in src/server/AI/.
 * These agents return static or near-static responses — we verify
 * they resolve without throwing and return the expected shape.
 */
import { describe, it, expect } from 'vitest';
import { PlanningAgent } from '../src/server/AI/PlanningAgent';
import { ProjectStructureAgent } from '../src/server/AI/ProjectStructureAgent';
import { RequirementsAgent } from '../src/server/AI/RequirementsAgent';

describe('PlanningAgent', () => {
  it('planArchitecture resolves to a non-empty string', async () => {
    const agent = new PlanningAgent();
    const result = await agent.planArchitecture({ applicationType: 'full-stack-app' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('result contains Architecture Approved marker', async () => {
    const agent = new PlanningAgent();
    const result = await agent.planArchitecture({});
    expect(result).toContain('Architecture Approved');
  });
});

describe('ProjectStructureAgent', () => {
  it('generateProjectStructure resolves with filesGenerated and foldersGenerated', async () => {
    const agent = new ProjectStructureAgent();
    const result = await agent.generateProjectStructure({ applicationType: 'web-app' });
    expect(result.filesGenerated).toBeGreaterThan(0);
    expect(result.foldersGenerated).toBeGreaterThan(0);
  });

  it('uses applicationType from input when provided', async () => {
    const agent = new ProjectStructureAgent();
    const result = await agent.generateProjectStructure({ applicationType: 'Microservices' });
    expect(result.architecture).toBe('Microservices');
  });

  it('falls back to Modular Monolith when applicationType is missing', async () => {
    const agent = new ProjectStructureAgent();
    const result = await agent.generateProjectStructure({});
    expect(result.architecture).toBe('Modular Monolith');
  });

  it('status indicates ready for implementation', async () => {
    const agent = new ProjectStructureAgent();
    const result = await agent.generateProjectStructure({});
    expect(result.status).toContain('Ready');
  });
});

describe('RequirementsAgent', () => {
  it('analyzeRequest resolves to a non-empty string', async () => {
    const agent = new RequirementsAgent();
    const result = await agent.analyzeRequest('Build a todo app');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('result contains Analysis Complete marker', async () => {
    const agent = new RequirementsAgent();
    const result = await agent.analyzeRequest('e-commerce platform');
    expect(result).toContain('Analysis Complete');
  });
});
