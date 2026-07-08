import { describe, it, expect } from 'vitest';
import { needsFullstackTemplate, resolveTemplateId } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/fullstackRouting';

// AB-1: gated routing of polyglot backends (Spring Boot / Go) onto the fullstack E2B image.
// These functions are pure — no sandbox, no env mutation — so we exercise every branch directly.

describe('needsFullstackTemplate', () => {
  it('is true for the polyglot backend frameworks', () => {
    expect(needsFullstackTemplate('spring-boot')).toBe(true);
    expect(needsFullstackTemplate('go')).toBe(true);
  });

  it('is case/space tolerant (agent-supplied values may vary)', () => {
    expect(needsFullstackTemplate('  Spring-Boot ')).toBe(true);
    expect(needsFullstackTemplate('GO')).toBe(true);
  });

  it('is false for JS/Python frameworks and non-strings', () => {
    expect(needsFullstackTemplate('vite-react')).toBe(false);
    expect(needsFullstackTemplate('nextjs')).toBe(false);
    expect(needsFullstackTemplate('python-fastapi')).toBe(false);
    expect(needsFullstackTemplate(undefined)).toBe(false);
    expect(needsFullstackTemplate(null)).toBe(false);
    expect(needsFullstackTemplate(42)).toBe(false);
  });
});

describe('resolveTemplateId', () => {
  const FULL = 'navbharat-fullstack-builder-id';
  const DEFAULT = 'navbharat-builder-id';

  it('routes a fullstack framework onto FULLSTACK_E2B_TEMPLATE_ID when it is published', () => {
    const env = { FULLSTACK_E2B_TEMPLATE_ID: FULL, E2B_TEMPLATE_ID: DEFAULT } as NodeJS.ProcessEnv;
    expect(resolveTemplateId('spring-boot', env)).toBe(FULL);
    expect(resolveTemplateId('go', env)).toBe(FULL);
  });

  it('falls back to the default template for a fullstack framework when no fullstack template is configured', () => {
    const env = { E2B_TEMPLATE_ID: DEFAULT } as NodeJS.ProcessEnv;
    expect(resolveTemplateId('spring-boot', env)).toBe(DEFAULT);
  });

  it('never routes a non-fullstack framework onto the fullstack template', () => {
    const env = { FULLSTACK_E2B_TEMPLATE_ID: FULL, E2B_TEMPLATE_ID: DEFAULT } as NodeJS.ProcessEnv;
    expect(resolveTemplateId('vite-react', env)).toBe(DEFAULT);
    expect(resolveTemplateId(undefined, env)).toBe(DEFAULT);
  });

  it('returns undefined (E2B default base image) when no template env is set — unchanged current behaviour', () => {
    expect(resolveTemplateId('spring-boot', {} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(resolveTemplateId('vite-react', {} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(resolveTemplateId(undefined, {} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('treats blank/whitespace env values as unset', () => {
    const env = { FULLSTACK_E2B_TEMPLATE_ID: '   ', E2B_TEMPLATE_ID: '  ' } as NodeJS.ProcessEnv;
    expect(resolveTemplateId('go', env)).toBeUndefined();
  });
});
