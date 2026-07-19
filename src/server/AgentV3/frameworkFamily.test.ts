import { describe, it, expect } from 'vitest';
import { isReactFamilyFramework } from './frameworkFamily';

describe('isReactFamilyFramework — the React analyzers must NOT run on non-React apps (ShopSphere autopsy)', () => {
  it('non-React frameworks are excluded (their useX composables are not React hooks)', () => {
    for (const fw of ['nuxt', 'vue', 'Nuxt 3', 'sveltekit', 'svelte', 'angular', 'solid', 'qwik', 'astro']) {
      expect(isReactFamilyFramework(fw)).toBe(false);
    }
  });

  it('React-family frameworks are included', () => {
    for (const fw of ['react', 'vite-react', 'nextjs', 'next', 'remix', 'gatsby', 'preact', 'cra']) {
      expect(isReactFamilyFramework(fw)).toBe(true);
    }
  });

  it('unknown / empty defaults to the React family (historical default)', () => {
    expect(isReactFamilyFramework(undefined)).toBe(true);
    expect(isReactFamilyFramework('')).toBe(true);
    expect(isReactFamilyFramework('brand-new-thing')).toBe(true);
  });
});
