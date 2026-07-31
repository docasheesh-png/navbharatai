import { describe, it, expect } from 'vitest';
import { isViteConfigPath, ensureViteAllowedHosts, ensureViteResolveAlias, ensureViteConfig } from './ViteConfigGuard';

describe('isViteConfigPath', () => {
  it('matches every vite.config extension, in any directory', () => {
    for (const p of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'vite.config.mts', 'app/vite.config.ts', '/home/user/workspace/vite.config.js']) {
      expect(isViteConfigPath(p)).toBe(true);
    }
  });
  it('does not match unrelated files', () => {
    for (const p of ['vite.config.json', 'vitest.config.ts', 'src/vite.ts', 'config.ts', 'my-vite.config.ts.bak']) {
      expect(isViteConfigPath(p)).toBe(false);
    }
  });
});

describe('ensureViteAllowedHosts — the "Blocked request … is not allowed" backstop', () => {
  it('injects a server block into a create-vite default config (the real MODE A gap)', () => {
    const src = `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n})\n`;
    const out = ensureViteAllowedHosts('vite.config.ts', src);
    expect(out).toContain('allowedHosts: true');
    expect(out).toMatch(/defineConfig\(\{ server: \{ host: true, allowedHosts: true \},/);
    expect(out).toContain('plugins: [react()]'); // original content preserved
  });

  it('adds allowedHosts to an EXISTING server block that lacks it', () => {
    const src = `export default defineConfig({\n  server: { host: true, port: 5173 },\n  plugins: [],\n})\n`;
    const out = ensureViteAllowedHosts('vite.config.ts', src);
    expect(out).toMatch(/server:\s*\{\s*allowedHosts: true, host: true, port: 5173 \}/);
  });

  it('patches the admin\'s exact reported case: a port-3000 server block in vite.config.js', () => {
    // "Blocked request. This host ("3000-…e2b.app") is not allowed … add to server.allowedHosts."
    const src = `import { defineConfig } from 'vite';\nexport default defineConfig({\n  server: { host: '0.0.0.0', port: 3000 },\n  plugins: [],\n});\n`;
    const out = ensureViteAllowedHosts('vite.config.js', src);
    expect(out).toContain('allowedHosts: true');
    expect(out).toMatch(/server:\s*\{\s*allowedHosts: true, host: '0\.0\.0\.0', port: 3000 \}/);
    expect(out).toContain('port: 3000'); // the app's own port is preserved
  });

  it('is a NO-OP when allowedHosts is already present (server or preview)', () => {
    const withServer = `export default defineConfig({ server: { allowedHosts: true } })`;
    const withPreview = `export default defineConfig({ preview: { allowedHosts: true } })`;
    expect(ensureViteAllowedHosts('vite.config.ts', withServer)).toBe(withServer);
    expect(ensureViteAllowedHosts('vite.config.ts', withPreview)).toBe(withPreview);
  });

  it('handles a bare `export default { … }` object literal (no defineConfig)', () => {
    const src = `export default {\n  plugins: [],\n}\n`;
    const out = ensureViteAllowedHosts('vite.config.js', src);
    expect(out).toMatch(/export default \{ server: \{ host: true, allowedHosts: true \},/);
  });

  it('leaves non-vite-config files completely untouched', () => {
    const src = `export default defineConfig({ plugins: [] })`;
    expect(ensureViteAllowedHosts('src/App.tsx', src)).toBe(src);
    expect(ensureViteAllowedHosts('vitest.config.ts', src)).toBe(src);
  });

  it('does NOT corrupt an exotic config it cannot safely edit (function form) — leaves it as-is', () => {
    const src = `export default defineConfig(({ mode }) => ({ plugins: [] }))`;
    // No `server: {`, no `defineConfig({`, no `export default {` object anchor → safe no-op.
    expect(ensureViteAllowedHosts('vite.config.ts', src)).toBe(src);
  });
});

describe('ensureViteResolveAlias — dep-free @→/src alias backstop (protects #1305 in Vite)', () => {
  it('injects a resolve.alias mapping @ to /src into a defineConfig object', () => {
    const src = `import { defineConfig } from 'vite';\nexport default defineConfig({\n  plugins: [react()],\n});\n`;
    const out = ensureViteResolveAlias('vite.config.ts', src);
    expect(out).toContain("resolve: { alias: { '@': '/src' } }");
    expect(out).toContain('plugins: [react()]'); // original preserved
  });

  it('handles a bare export-default object literal', () => {
    const out = ensureViteResolveAlias('vite.config.js', `export default {\n  plugins: [],\n}\n`);
    expect(out).toMatch(/export default \{ resolve: \{ alias: \{ '@': '\/src' \} \},/);
  });

  it('is a NO-OP when an @ alias already exists', () => {
    const src = `export default defineConfig({ resolve: { alias: { '@': '/src' } } })`;
    expect(ensureViteResolveAlias('vite.config.ts', src)).toBe(src);
  });

  it('is a NO-OP when a resolve block already exists (never mangle a nested object)', () => {
    const src = `export default defineConfig({ resolve: { dedupe: ['react'] } })`;
    expect(ensureViteResolveAlias('vite.config.ts', src)).toBe(src);
  });

  it('leaves non-vite-config files and function-form configs untouched', () => {
    expect(ensureViteResolveAlias('src/App.tsx', `export default {}`)).toBe(`export default {}`);
    const fn = `export default defineConfig(() => ({ plugins: [] }))`;
    expect(ensureViteResolveAlias('vite.config.ts', fn)).toBe(fn);
  });
});

// First-build-correct (missing-config autopsy 2026-07-31): a build FAILED because the app had `vite` in
// its deps but no vite config at all. ensureViteConfig materializes a correct one, only when it's missing.
describe('ensureViteConfig — a Vite app always has its config', () => {
  const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });

  it('MATERIALIZES vite.config.ts for a TS React app that has none (the exact failure)', () => {
    const out = ensureViteConfig({
      'package.json': pkg({ vite: '^5.0.0', react: '^18.0.0', '@vitejs/plugin-react': '^4.0.0' }),
      'tsconfig.json': '{}',
      'src/App.tsx': 'export default () => null',
    });
    expect(out).not.toBeNull();
    expect(out!.path).toBe('vite.config.ts');
    expect(out!.content).toContain("import react from '@vitejs/plugin-react'");
    expect(out!.content).toContain('plugins: [react()]');
    expect(out!.content).toContain('allowedHosts: true');
  });

  it('uses the SWC plugin import when that is the dependency', () => {
    const out = ensureViteConfig({ 'package.json': pkg({ vite: '^5', react: '^18', '@vitejs/plugin-react-swc': '^3' }), 'src/App.tsx': 'x' });
    expect(out!.content).toContain('@vitejs/plugin-react-swc');
  });

  it('emits vite.config.js (no react plugin) for a plain JS Vite app', () => {
    const out = ensureViteConfig({ 'package.json': pkg({ vite: '^5' }), 'src/main.js': 'x' });
    expect(out!.path).toBe('vite.config.js');
    expect(out!.content).toContain('plugins: []');
    expect(out!.content).not.toContain('@vitejs/plugin-react');
  });

  it('NEVER overwrites an existing config (any extension)', () => {
    for (const cfg of ['vite.config.ts', 'vite.config.js', 'vite.config.mts']) {
      expect(ensureViteConfig({ 'package.json': pkg({ vite: '^5' }), [cfg]: 'export default {}' })).toBeNull();
    }
  });

  it('is null when the app is not a Vite app, or package.json is missing/invalid', () => {
    expect(ensureViteConfig({ 'package.json': pkg({ react: '^18' }) })).toBeNull(); // no vite
    expect(ensureViteConfig({ 'src/App.tsx': 'x' })).toBeNull();                     // no package.json
    expect(ensureViteConfig({ 'package.json': '{ not json' })).toBeNull();           // unparseable
  });
})
