import { describe, it, expect } from 'vitest';
import { HonoProvider } from './HonoProvider';
import { TemplateRegistry } from './TemplateRegistry';
import { FRAMEWORKS } from '../../../../FrameworkRegistry';
import { extractEntities } from '../../../../EntityExtractor';

describe('HonoProvider — a real, boot-clean Hono + Node API scaffold', () => {
  const files = new HonoProvider().getFiles([]);

  it('emits a Hono API that binds 0.0.0.0:$PORT so the sandbox preview can reach it', () => {
    expect(Object.keys(files).sort()).toEqual(['package.json', 'src/index.ts', 'tsconfig.json'].sort());
    const idx = files['src/index.ts'];
    expect(idx).toContain("import { Hono } from 'hono'");
    expect(idx).toContain("import { serve } from '@hono/node-server'");
    expect(idx).toContain('new Hono()');
    expect(idx).toContain("hostname: '0.0.0.0'");
    expect(idx).toContain('Number(process.env.PORT) || 3000');
    expect(idx).toContain("app.get('/health'"); // health endpoint for the preview probe
  });

  it('declares the Hono deps + an ESM tsx/esbuild toolchain', () => {
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.type).toBe('module');
    expect(pkg.dependencies.hono).toBeDefined();
    expect(pkg.dependencies['@hono/node-server']).toBeDefined();
    expect(pkg.devDependencies.tsx).toBeDefined();
  });
});

describe('Hono is wired (registry + entity recognition + framework registry)', () => {
  it('TemplateRegistry resolves the "hono" key to a HonoProvider', () => {
    expect(new TemplateRegistry().getProvider('hono')).toBeInstanceOf(HonoProvider);
  });

  it('EntityExtractor recognizes a named "Hono" request', () => {
    const ents = extractEntities('build a REST API with Hono and Postgres');
    expect(ents.some((e) => e.name === 'Hono' && e.slot === 'framework')).toBe(true);
  });

  it('appears in the FrameworkRegistry as a backend', () => {
    const hono = FRAMEWORKS.find((f) => f.id === 'hono');
    expect(hono).toBeDefined();
    expect(hono?.category).toBe('backend');
  });
});
