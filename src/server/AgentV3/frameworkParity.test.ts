import { describe, it, expect } from 'vitest';
import { TemplateRegistry } from './sandbox/AppMakerLab/generator/templates/TemplateRegistry';
import { detectFrameworkFromPrompt, detectBackendOnlyFramework, resolveFrameworkSelection, DETECTABLE_FRAMEWORK_IDS } from './PromptFramework';
import { frameworkRunsInBrowser, serverFrameworkLabel } from '../../lib/frameworkDetect';
import { FRAMEWORK_OPTION_IDS } from '../../components/agentv3/frameworkOptions';

// The admin sync law (2026-07-20): the three sources of truth for "which framework" — the client picker,
// the server scaffold registry, and the chat detector — must never drift apart. A picker option with no
// scaffold is a dead button; a detector id with no scaffold crashes the build; a scaffold with no picker
// entry is an invisible capability. These tests fail CI the moment any of the three drift.
describe('framework parity — picker ↔ registry ↔ detector never drift (admin sync law 2026-07-20)', () => {
  const registryIds = new Set(new TemplateRegistry().listFrameworks());

  it('EVERY picker option maps to a real registry scaffold (no dead buttons)', () => {
    const orphans = FRAMEWORK_OPTION_IDS.filter((id) => !registryIds.has(id));
    expect(orphans).toEqual([]);
  });

  it('EVERY chat-detectable id maps to a real registry scaffold (chat can never pick an unbuildable framework)', () => {
    const orphans = DETECTABLE_FRAMEWORK_IDS.filter((id) => !registryIds.has(id));
    expect(orphans).toEqual([]);
  });

  it('EVERY chat-detectable framework is also offered in the picker (both paths reach the same set)', () => {
    const pickerIds = new Set(FRAMEWORK_OPTION_IDS);
    const missingFromPicker = DETECTABLE_FRAMEWORK_IDS.filter((id) => !pickerIds.has(id));
    expect(missingFromPicker).toEqual([]);
  });

  it('the picker offers the 5 frameworks that used to be registry-only (solid, preact, lit, alpine, hono)', () => {
    for (const id of ['solid', 'preact', 'lit', 'alpine', 'hono']) {
      expect(FRAMEWORK_OPTION_IDS).toContain(id);
    }
  });
});

describe('bidirectional selection — chat naming a framework picks it (both paths, admin 2026-07-20)', () => {
  it('front-end / meta frameworks are detected from chat (unchanged)', () => {
    expect(detectFrameworkFromPrompt('build a Next.js dashboard')).toBe('nextjs');
    expect(detectFrameworkFromPrompt('a Nuxt 3 storefront')).toBe('nuxt');
    expect(detectFrameworkFromPrompt('SvelteKit blog')).toBe('sveltekit');
    expect(detectFrameworkFromPrompt('an Angular admin panel')).toBe('angular');
  });

  it('a pure BACK-END request now picks its backend scaffold from chat (the new half)', () => {
    expect(detectFrameworkFromPrompt('build a Django REST API for orders')).toBe('django');
    expect(detectFrameworkFromPrompt('a FastAPI microservice for payments')).toBe('python-fastapi');
    expect(detectFrameworkFromPrompt('an Express server exposing a JSON API')).toBe('node-express');
    expect(detectFrameworkFromPrompt('a Flask backend with SQLAlchemy')).toBe('flask');
    expect(detectFrameworkFromPrompt('a NestJS API with dependency injection')).toBe('nestjs');
    expect(detectFrameworkFromPrompt('a Spring Boot REST service')).toBe('spring-boot');
    expect(detectFrameworkFromPrompt('a Hono edge API')).toBe('hono');
    expect(detectFrameworkFromPrompt('a Go backend using net/http')).toBe('go');
  });

  it('a FULL-STACK web app keeps the front-end-first default — backend detection must NOT regress it', () => {
    // A UI signal is present → the app is front-end-first; the builder adds the Express/Django backend.
    expect(detectFrameworkFromPrompt('a React dashboard with an Express backend')).toBeNull();
    expect(detectFrameworkFromPrompt('a web app UI backed by a Django API')).toBeNull();
    expect(detectFrameworkFromPrompt('a responsive website with a Flask backend')).toBeNull();
    // Vue/Svelte win as their own front-end scaffold, never the backend.
    expect(detectFrameworkFromPrompt('a Vue app talking to a FastAPI service')).toBe('vue');
  });

  it('the bare word "go" never false-triggers the Go backend', () => {
    expect(detectBackendOnlyFramework('let the user go back to the previous screen')).toBeNull();
    expect(detectBackendOnlyFramework('a go-kart racing leaderboard')).toBeNull();
  });

  it('a plain app request with no framework named stays null (React default)', () => {
    expect(detectFrameworkFromPrompt('build a todo list app')).toBeNull();
    expect(detectFrameworkFromPrompt('')).toBeNull();
  });
});

describe('resolveFrameworkSelection — settings pick vs chat text, CONFLICT confirms first (admin 2026-07-20)', () => {
  it('picked A + text names a DIFFERENT B → conflict (do NOT silently build)', () => {
    const r = resolveFrameworkSelection({ picked: 'vite-react', explicit: true, prompt: 'build a Next.js dashboard' });
    expect(r).toEqual({ status: 'conflict', picked: 'vite-react', detected: 'nextjs' });
  });

  it('once the user has confirmed (resolved), the pick is honoured — no re-prompt', () => {
    const r = resolveFrameworkSelection({ picked: 'nextjs', explicit: true, prompt: 'build a Next.js dashboard', resolved: true });
    expect(r).toEqual({ status: 'ok', framework: 'nextjs' });
  });

  it('an explicit pick that MATCHES the text is no conflict', () => {
    expect(resolveFrameworkSelection({ picked: 'nextjs', explicit: true, prompt: 'a Next.js app' })).toEqual({ status: 'ok', framework: 'nextjs' });
  });

  it('an explicit pick with no framework in the text just uses the pick', () => {
    expect(resolveFrameworkSelection({ picked: 'vue', explicit: true, prompt: 'a todo app' })).toEqual({ status: 'ok', framework: 'vue' });
  });

  it('NOT explicit (bare default) → chat text auto-selects the framework', () => {
    expect(resolveFrameworkSelection({ picked: 'vite-react', explicit: false, prompt: 'a Django REST API' })).toEqual({ status: 'ok', framework: 'django' });
    expect(resolveFrameworkSelection({ picked: 'vite-react', explicit: false, prompt: 'a plain app' })).toEqual({ status: 'ok', framework: 'vite-react' });
  });

  it('defaults picked to vite-react when absent', () => {
    expect(resolveFrameworkSelection({ picked: undefined, explicit: false, prompt: 'a Nuxt storefront' })).toEqual({ status: 'ok', framework: 'nuxt' });
  });
});

describe('frameworkRunsInBrowser — in-browser preview is framework-aware (CrewHub screenshots 2026-07-20)', () => {
  it('SSR / meta frameworks and backends do NOT run in-browser (they need the Live server)', () => {
    for (const id of ['nextjs', 'nuxt', 'sveltekit', 'remix', 'angular', 'astro', 'node-express', 'hono', 'nestjs', 'fastify', 'python-fastapi', 'django', 'flask', 'spring-boot', 'go']) {
      expect(frameworkRunsInBrowser(id)).toBe(false);
    }
  });
  it('client SPA frameworks DO run in-browser', () => {
    for (const id of ['vite-react', 'vue', 'svelte', 'solid', 'preact', 'lit', 'alpine', 'vanilla', 'static']) {
      expect(frameworkRunsInBrowser(id)).toBe(true);
    }
    expect(frameworkRunsInBrowser(undefined)).toBe(true); // unknown → the SPA default
  });
  it('serverFrameworkLabel gives a friendly name for the honest panel', () => {
    expect(serverFrameworkLabel('nextjs')).toBe('Next.js');
    expect(serverFrameworkLabel('spring-boot')).toBe('Spring Boot');
    expect(serverFrameworkLabel('vite-react')).toBe('This'); // not a server framework → generic
  });
});
