import { describe, it, expect } from 'vitest';
import { TemplateRegistry } from '../src/server/AppMakerLab/generator/templates/TemplateRegistry';

describe('TemplateRegistry', () => {
  const registry = new TemplateRegistry();

  it('getProvider("vite-react") returns a provider with getFiles()', () => {
    const p = registry.getProvider('vite-react');
    expect(typeof p.getFiles).toBe('function');
  });

  it('vite-react provider getFiles includes package.json and src/main.tsx', () => {
    const files = registry.getProvider('vite-react').getFiles([]);
    expect(files).toHaveProperty('package.json');
    expect(files).toHaveProperty('src/main.tsx');
  });

  it('getProvider("vue") returns a Vue provider', () => {
    const p = registry.getProvider('vue');
    expect(typeof p.getFiles).toBe('function');
  });

  it('getProvider("svelte") returns a Svelte provider', () => {
    const p = registry.getProvider('svelte');
    expect(typeof p.getFiles).toBe('function');
  });

  it('getProvider("static") returns a static provider', () => {
    const p = registry.getProvider('static');
    expect(typeof p.getFiles).toBe('function');
  });

  it('getProvider throws for an unsupported framework', () => {
    expect(() => registry.getProvider('angular')).toThrow('angular');
  });
});
