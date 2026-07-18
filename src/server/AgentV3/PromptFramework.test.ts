import { describe, it, expect } from 'vitest';
import { detectFrameworkFromPrompt } from './PromptFramework';

describe('detectFrameworkFromPrompt (framework-honoring scaffold — MelodyBox deep-test root cause)', () => {
  it('THE regression: the exact MelodyBox prompt resolves to Vue, not React', () => {
    const prompt = 'Build "MelodyBox" — a Vue 3 + Vite music player app (frontend-only). Audio player, playlists, favorites…';
    expect(detectFrameworkFromPrompt(prompt)).toBe('vue');
  });

  it('a plain React prompt returns null (React stays the default — no behaviour change)', () => {
    expect(detectFrameworkFromPrompt('Build a React todo app with hooks and a dashboard')).toBeNull();
    expect(detectFrameworkFromPrompt('Make a task manager with a sidebar and charts')).toBeNull();
  });

  it('detects Vue via keyword variants (vue, vue.js, vue3, Pinia, Vue Router)', () => {
    expect(detectFrameworkFromPrompt('a vue.js dashboard')).toBe('vue');
    expect(detectFrameworkFromPrompt('build with vue3')).toBe('vue');
    expect(detectFrameworkFromPrompt('use Pinia for state')).toBe('vue');
    expect(detectFrameworkFromPrompt('with vue-router navigation')).toBe('vue');
  });

  it('Nuxt is picked over Vue (meta-framework before its base)', () => {
    expect(detectFrameworkFromPrompt('a Nuxt e-commerce site with Vue components')).toBe('nuxt');
  });

  it('SvelteKit is picked over Svelte', () => {
    expect(detectFrameworkFromPrompt('a SvelteKit blog')).toBe('sveltekit');
    expect(detectFrameworkFromPrompt('build a svelte counter')).toBe('svelte');
  });

  it('Next.js requires the "js" — a bare "next" in a sentence never false-positives to React→Next', () => {
    expect(detectFrameworkFromPrompt('a Next.js marketing site')).toBe('nextjs');
    expect(detectFrameworkFromPrompt('a nextjs app')).toBe('nextjs');
    expect(detectFrameworkFromPrompt('add a button, then the next screen shows results')).toBeNull();
  });

  it('detects Angular and Astro', () => {
    expect(detectFrameworkFromPrompt('an Angular admin panel')).toBe('angular');
    expect(detectFrameworkFromPrompt('a fast Astro content site')).toBe('astro');
  });

  it('does not false-positive on English words containing the letters (value, avenue, view)', () => {
    expect(detectFrameworkFromPrompt('show the total value on the avenue map view')).toBeNull();
  });

  it('empty / non-string input is safe', () => {
    expect(detectFrameworkFromPrompt('')).toBeNull();
    expect(detectFrameworkFromPrompt('   ')).toBeNull();
    // @ts-expect-error intentional bad input
    expect(detectFrameworkFromPrompt(null)).toBeNull();
  });

  it('every returned id is a real scaffold framework (does not invent a template key)', () => {
    // The registry keys these must stay within (TemplateRegistry.ts).
    const REGISTRY = new Set(['vite-react', 'nextjs', 'remix', 'vue', 'nuxt', 'svelte', 'sveltekit', 'angular', 'astro', 'vanilla', 'static']);
    for (const p of ['vue app', 'svelte app', 'sveltekit app', 'nuxt app', 'next.js app', 'angular app', 'astro app', 'remix app']) {
      const id = detectFrameworkFromPrompt(p);
      expect(id).not.toBeNull();
      expect(REGISTRY.has(id as string)).toBe(true);
    }
  });
});
