import { describe, it, expect } from 'vitest';
import { StaticProvider } from '../src/server/AppMakerLab/generator/templates/StaticProvider';
import { NodeExpressProvider } from '../src/server/AppMakerLab/generator/templates/NodeExpressProvider';
import { NextjsProvider } from '../src/server/AppMakerLab/generator/templates/NextjsProvider';
import { SvelteProvider } from '../src/server/AppMakerLab/generator/templates/SvelteProvider';
import { VueProvider } from '../src/server/AppMakerLab/generator/templates/VueProvider';
import { PythonFastapiProvider } from '../src/server/AppMakerLab/generator/templates/PythonFastapiProvider';
import { TemplateRegistry } from '../src/server/AppMakerLab/generator/templates/TemplateRegistry';
import { NextjsProvider as LiveNextjsProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/NextjsProvider';
import { NuxtProvider as LiveNuxtProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/NuxtProvider';
import { SvelteKitProvider as LiveSvelteKitProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/SvelteKitProvider';
import { RemixProvider as LiveRemixProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/RemixProvider';
import { VueProvider as LiveVueProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/VueProvider';
import { AstroProvider as LiveAstroProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/AstroProvider';
import { SpringBootProvider as LiveSpringBootProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/SpringBootProvider';
import { GoProvider as LiveGoProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/GoProvider';
import { TemplateRegistry as LiveTemplateRegistry } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/TemplateRegistry';

describe('StaticProvider', () => {
  const provider = new StaticProvider();

  it('getFiles returns index.html, style.css, script.js', () => {
    const files = provider.getFiles([]);
    expect(files['index.html']).toBeDefined();
    expect(files['style.css']).toBeDefined();
    expect(files['script.js']).toBeDefined();
  });

  it('index.html contains <html>', () => {
    const files = provider.getFiles([]);
    expect(files['index.html']).toContain('<html');
  });
});

describe('NodeExpressProvider', () => {
  const provider = new NodeExpressProvider();

  it('getFiles returns package.json', () => {
    const files = provider.getFiles([]);
    expect(files['package.json']).toBeDefined();
  });

  it('package.json includes express dependency', () => {
    const files = provider.getFiles([]);
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.dependencies['express']).toBeDefined();
  });

  it('returns a src/index.ts entry file', () => {
    const files = provider.getFiles([]);
    expect(files['src/index.ts']).toBeDefined();
  });
});

describe('NextjsProvider', () => {
  const provider = new NextjsProvider();

  it('getFiles returns package.json with next dependency', () => {
    const files = provider.getFiles([]);
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.dependencies['next']).toBeDefined();
  });

  it('returns an app directory entry file', () => {
    const files = provider.getFiles([]);
    const keys = Object.keys(files);
    expect(keys.some(k => k.includes('page'))).toBe(true);
  });

  it('P-CGE.12: ships the App Router special files (loading / error / not-found) + globals', () => {
    const files = provider.getFiles([]);
    expect(files['app/layout.tsx']).toBeDefined();
    expect(files['app/page.tsx']).toBeDefined();
    expect(files['app/loading.tsx']).toBeDefined();
    expect(files['app/error.tsx']).toBeDefined();
    expect(files['app/not-found.tsx']).toBeDefined();
    expect(files['app/globals.css']).toBeDefined();
  });

  it('error.tsx is a valid Client Component with a reset handler', () => {
    const files = provider.getFiles([]);
    expect(files['app/error.tsx']).toContain("'use client'");
    expect(files['app/error.tsx']).toContain('reset');
  });

  it('layout imports globals.css', () => {
    const files = provider.getFiles([]);
    expect(files['app/layout.tsx']).toContain("import './globals.css'");
  });
});

describe('SvelteProvider', () => {
  const provider = new SvelteProvider();

  it('getFiles returns package.json with svelte dependency', () => {
    const files = provider.getFiles([]);
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.dependencies['svelte']).toBeDefined();
  });

  it('returns src/App.svelte', () => {
    const files = provider.getFiles([]);
    expect(files['src/App.svelte']).toBeDefined();
  });

  it('index.html mounts to #app', () => {
    const files = provider.getFiles([]);
    expect(files['index.html']).toContain('id="app"');
  });
});

describe('VueProvider', () => {
  const provider = new VueProvider();

  it('getFiles returns package.json with vue dependency', () => {
    const files = provider.getFiles([]);
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.dependencies['vue']).toBeDefined();
  });

  it('returns src/App.vue', () => {
    const files = provider.getFiles([]);
    expect(files['src/App.vue']).toBeDefined();
  });

  it('returns tsconfig.json', () => {
    const files = provider.getFiles([]);
    expect(files['tsconfig.json']).toBeDefined();
  });
});

describe('PythonFastapiProvider', () => {
  const provider = new PythonFastapiProvider();

  it('getFiles returns requirements.txt', () => {
    const files = provider.getFiles([]);
    expect(files['requirements.txt']).toBeDefined();
  });

  it('requirements.txt includes fastapi', () => {
    const files = provider.getFiles([]);
    expect(files['requirements.txt']).toContain('fastapi');
  });

  it('returns main.py with FastAPI app', () => {
    const files = provider.getFiles([]);
    expect(files['main.py']).toContain('FastAPI');
  });
});

describe('TemplateRegistry', () => {
  const registry = new TemplateRegistry();

  it('returns ViteReactProvider for "vite-react"', () => {
    const provider = registry.getProvider('vite-react');
    const files = provider.getFiles([]);
    expect(files['package.json']).toBeDefined();
  });

  it('returns SvelteProvider for "svelte"', () => {
    const provider = registry.getProvider('svelte');
    const files = provider.getFiles([]);
    expect(files['src/App.svelte']).toBeDefined();
  });

  it('throws for unknown framework', () => {
    expect(() => registry.getProvider('unknown-framework')).toThrow();
  });
});

// The LIVE v5.0 flow uses its OWN isolated copy of the sandbox substrate (E2BActuator/ToolDispatcher →
// AgentV3/sandbox/.../TemplateRegistry). Protect the enriched Next.js scaffold on the copy that actually
// runs, so the two copies can never silently drift back to the minimal page+layout output.
describe('NextjsProvider (LIVE v5.0 sandbox copy)', () => {
  const provider = new LiveNextjsProvider();

  it('ships the full App Router scaffold (loading / error / not-found)', () => {
    const files = provider.getFiles([]);
    expect(files['app/loading.tsx']).toBeDefined();
    expect(files['app/error.tsx']).toContain("'use client'");
    expect(files['app/not-found.tsx']).toBeDefined();
    expect(files['app/globals.css']).toBeDefined();
  });

  it('keeps the E2B-preview host binding in its dev script', () => {
    const pkg = JSON.parse(provider.getFiles([])['package.json']);
    expect(pkg.scripts.dev).toContain('--hostname 0.0.0.0');
  });
});

// LIVE v5.0 framework scaffolds must ship a real error boundary (parallel to the Next.js error.tsx) so an
// unhandled route error renders a page instead of a blank screen. Guards the enriched sandbox copies.
describe('LIVE framework scaffolds — error boundaries', () => {
  it('Nuxt ships error.vue with clearError', () => {
    const files = new LiveNuxtProvider().getFiles([]);
    expect(files['error.vue']).toBeDefined();
    expect(files['error.vue']).toContain('clearError');
  });

  it('SvelteKit ships +error.svelte, +layout.svelte and app.d.ts', () => {
    const files = new LiveSvelteKitProvider().getFiles([]);
    expect(files['src/routes/+error.svelte']).toContain('$page');
    expect(files['src/routes/+layout.svelte']).toBeDefined();
    expect(files['src/app.d.ts']).toBeDefined();
  });

  it('Remix root.tsx exports an ErrorBoundary using useRouteError', () => {
    const files = new LiveRemixProvider().getFiles([]);
    expect(files['app/root.tsx']).toContain('export function ErrorBoundary');
    expect(files['app/root.tsx']).toContain('useRouteError');
  });

  it('Vue registers a global errorHandler in main.ts', () => {
    const files = new LiveVueProvider().getFiles([]);
    expect(files['src/main.ts']).toContain('app.config.errorHandler');
  });

  it('Astro ships a canonical 404 page', () => {
    const files = new LiveAstroProvider().getFiles([]);
    expect(files['src/pages/404.astro']).toBeDefined();
    expect(files['src/pages/404.astro']).toContain('404');
  });
});

// P-CGE / AB-1: Java (Spring Boot) + Go backend providers — run on the fullstack E2B template.
// These are the LIVE sandbox providers (E2BActuator/ToolDispatcher → sandbox TemplateRegistry).
describe('SpringBootProvider (LIVE, fullstack)', () => {
  const files = new LiveSpringBootProvider().getFiles([]);
  it('ships a Maven pom with spring-boot-starter-web (Java 17)', () => {
    expect(files['pom.xml']).toContain('spring-boot-starter-web');
    expect(files['pom.xml']).toContain('<java.version>17</java.version>');
  });
  it('has a @SpringBootApplication main and a @RestController', () => {
    expect(files['src/main/java/com/example/demo/Application.java']).toContain('@SpringBootApplication');
    expect(files['src/main/java/com/example/demo/HelloController.java']).toContain('@RestController');
  });
  it('binds 0.0.0.0 and $PORT for the E2B preview', () => {
    const props = files['src/main/resources/application.properties'];
    expect(props).toContain('server.address=0.0.0.0');
    expect(props).toContain('${PORT:8080}'); // literal — Spring resolves it at runtime
  });
});

describe('GoProvider (LIVE, fullstack)', () => {
  const files = new LiveGoProvider().getFiles([]);
  it('ships go.mod (go 1.23) and main.go', () => {
    expect(files['go.mod']).toContain('go 1.23');
    expect(files['main.go']).toContain('package main');
  });
  it('serves an http handler bound to 0.0.0.0:$PORT', () => {
    expect(files['main.go']).toContain('http.ListenAndServe');
    expect(files['main.go']).toContain('"0.0.0.0:"');
    expect(files['main.go']).toContain('os.Getenv("PORT")');
  });
});

describe('LIVE TemplateRegistry registers spring-boot + go', () => {
  const reg = new LiveTemplateRegistry();
  it('resolves the new backend frameworks', () => {
    expect(reg.getProvider('spring-boot').getFiles([])['pom.xml']).toBeDefined();
    expect(reg.getProvider('go').getFiles([])['main.go']).toBeDefined();
    expect(reg.listFrameworks()).toEqual(expect.arrayContaining(['spring-boot', 'go']));
  });
});
