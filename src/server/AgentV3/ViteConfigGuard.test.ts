import { describe, it, expect } from 'vitest';
import { isViteConfigPath, ensureViteAllowedHosts } from './ViteConfigGuard';

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
