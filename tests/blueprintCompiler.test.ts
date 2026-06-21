import { describe, it, expect } from 'vitest';
import { BlueprintCompiler } from '../src/server/AppMakerLab/intelligence/BlueprintCompiler';

describe('BlueprintCompiler.compile', () => {
  const compiler = new BlueprintCompiler();

  it('returns a blueprint with technologyRequirements array', () => {
    const bp = compiler.compile('build a simple app');
    expect(Array.isArray(bp.technologyRequirements)).toBe(true);
  });

  it('always includes "typescript" in technologyRequirements', () => {
    const bp = compiler.compile('build a calculator');
    expect(bp.technologyRequirements).toContain('typescript');
  });

  it('includes "react" for a web app (non-mobile prompt)', () => {
    // Use a prompt that doesn't trigger any feature with a BACKEND dependency
    const bp = compiler.compile('build a todo app');
    expect(bp.technologyRequirements).toContain('react');
  });

  it('includes "react-native" for a mobile app prompt', () => {
    const bp = compiler.compile('build a mobile application');
    expect(bp.technologyRequirements).toContain('react-native');
  });

  it('includes backend stack for erp domain', () => {
    // "erp" triggers the intent extractor's erp domain → adds node + express to tech stack
    const bp = compiler.compile('build an erp system');
    expect(bp.technologyRequirements).toContain('node');
  });

  it('includes next.js for ecommerce domain (>3 features)', () => {
    // ecommerce with billing triggers next.js (domain=ecommerce)
    const bp = compiler.compile('ecommerce store with billing and inventory');
    expect(bp.technologyRequirements).toContain('next.js');
  });

  it('returns features array from the prompt', () => {
    const bp = compiler.compile('build a todo app');
    expect(Array.isArray(bp.features)).toBe(true);
  });

  it('returns modules object containing DATABASE', () => {
    const bp = compiler.compile('build a billing system');
    expect(bp.modules).toHaveProperty('DATABASE');
  });
});
