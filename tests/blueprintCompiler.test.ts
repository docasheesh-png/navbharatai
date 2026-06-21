import { describe, it, expect } from 'vitest';
import { BlueprintCompiler } from '../src/server/AppMakerLab/intelligence/BlueprintCompiler';

describe('BlueprintCompiler', () => {
  const compiler = new BlueprintCompiler();

  it('compiles a simple prompt into a blueprint', () => {
    const bp = compiler.compile('build a todo app');
    expect(bp).toBeDefined();
    expect(Array.isArray(bp.features)).toBe(true);
    expect(Array.isArray(bp.technologyRequirements)).toBe(true);
  });

  it('includes typescript in every blueprint', () => {
    const bp = compiler.compile('any app');
    expect(bp.technologyRequirements).toContain('typescript');
  });

  it('adds react for authentication-only webapp', () => {
    // 'auth' feature has no deps — passes validator
    const bp = compiler.compile('build an app with authentication login');
    expect(bp.technologyRequirements).toContain('react');
  });

  it('adds react-native for mobile applications', () => {
    // 'auth' feature has no deps — passes validator
    const bp = compiler.compile('build a mobile application with authentication');
    expect(bp.technologyRequirements).toContain('react-native');
  });

  it('adds node+express for billing/crm features', () => {
    // billing → BACKEND module added by ModuleClassifier; satisfies dependency chain
    const bp = compiler.compile('build a billing crm system');
    expect(bp.technologyRequirements).toContain('node');
    expect(bp.technologyRequirements).toContain('express');
  });

  it('adds express for ERP domain', () => {
    const bp = compiler.compile('build an ERP billing system');
    expect(bp.technologyRequirements).toContain('express');
  });
});
