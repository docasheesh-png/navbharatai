import { describe, it, expect } from 'vitest';
import {
  analyzeFullstackBoot,
  fullstackBootProbeFiles,
  fullstackBootHint,
  renderBootHint,
} from './fullstackBootHint';

// A "rest-express" (Replit-style) single-port server: it serves the client itself via the Vite bridge.
const REST_EXPRESS_SERVER = `
import express from 'express';
import { setupVite, serveStatic } from './vite';
const app = express();
app.use('/api/todos', todosRouter);
const PORT = process.env.PORT || 5000;
if (app.get('env') === 'development') { await setupVite(app, server); } else { serveStatic(app); }
app.listen(PORT, () => console.log('listening on ' + PORT));
`;

const SINGLE_PORT_PKG = JSON.stringify({
  scripts: { dev: 'tsx server/index.ts' },
});

// A two-port app: one dev script boots the Vite client AND the API server concurrently.
const TWO_PORT_SERVER = `
import express from 'express';
const app = express();
app.use('/api/todos', todosRouter);
app.listen(3001);
`;
const TWO_PORT_PKG = JSON.stringify({
  scripts: { dev: 'concurrently "vite" "tsx server/index.ts"' },
});
const VITE_CONFIG = `export default { server: { port: 5174, proxy: { '/api': 'http://localhost:3001' } } };`;

describe('fullstackBootProbeFiles — reads only the handful that matter', () => {
  it('picks package.json, vite config, and the server entry; skips app code + node_modules', () => {
    const probe = fullstackBootProbeFiles([
      'package.json',
      'vite.config.ts',
      'server/index.ts',
      'client/src/App.tsx',
      'client/src/components/TodoList.tsx',
      'node_modules/express/index.js',
    ]);
    expect(probe).toContain('package.json');
    expect(probe).toContain('vite.config.ts');
    expect(probe).toContain('server/index.ts');
    expect(probe).not.toContain('client/src/App.tsx');
    expect(probe.some((p) => p.startsWith('node_modules'))).toBe(false);
  });
});

describe('single-port (server serves the client) — the exact reported failure', () => {
  it('names the SERVER port as the preview, not a framework 5173 guess', () => {
    const found = analyzeFullstackBoot({ 'package.json': SINGLE_PORT_PKG, 'server/index.ts': REST_EXPRESS_SERVER });
    expect(found).toMatchObject({ mode: 'single-port', previewPort: 5000, serverFile: 'server/index.ts' });
  });

  it('the hint tells the model to run ONE dev command and preview the server port — not hand-probe', () => {
    const hint = renderBootHint(analyzeFullstackBoot({ 'package.json': SINGLE_PORT_PKG, 'server/index.ts': REST_EXPRESS_SERVER })!);
    expect(hint).toContain('update_preview');
    expect(hint).toContain('5000');
    expect(hint).toMatch(/do NOT run the server file by hand/i);
    expect(hint).toMatch(/never move the server to a different port/i);
    expect(hint).toMatch(/curl\/sleep/i);
    // Must NOT parrot the 5173 default that caused the "move the server" flail.
    expect(hint).not.toContain('5173');
  });
});

describe('two-port (client dev server + API server) — preview the client', () => {
  it('previews the CLIENT vite port and names both services', () => {
    const found = analyzeFullstackBoot({
      'package.json': TWO_PORT_PKG,
      'server/index.ts': TWO_PORT_SERVER,
      'vite.config.ts': VITE_CONFIG,
    });
    expect(found).toMatchObject({ mode: 'two-port', previewPort: 5174, serverPort: 3001, clientPort: 5174 });
    const hint = renderBootHint(found!);
    expect(hint).toContain('update_preview(5174)');
    expect(hint).toMatch(/proxies \/api/i);
  });

  it('falls back to the Vite default 5173 when the config declares no port', () => {
    const found = analyzeFullstackBoot({
      'package.json': TWO_PORT_PKG,
      'server/index.ts': TWO_PORT_SERVER,
      'vite.config.ts': 'export default { plugins: [] };',
    });
    expect(found?.previewPort).toBe(5173);
  });
});

describe('it stays silent where the hint would be false noise', () => {
  it('a plain Vite client (no server) — already covered by the framework hint', () => {
    expect(analyzeFullstackBoot({
      'package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
      'src/App.tsx': 'export default () => <div/>;',
      'vite.config.ts': VITE_CONFIG,
    })).toBeNull();
  });

  it('a plain Express API (no client served, no concurrent client) — a plain backend', () => {
    expect(analyzeFullstackBoot({
      'package.json': SINGLE_PORT_PKG,
      'server/index.ts': TWO_PORT_SERVER, // express + listen, but serves no client and dev runs only the server
    })).toBeNull();
  });

  it('an Express router module that never listens is not the server', () => {
    expect(analyzeFullstackBoot({
      'package.json': SINGLE_PORT_PKG,
      'server/routes.ts': `import express from 'express'; const r = express.Router(); export default r;`,
    })).toBeNull();
  });

  it('no dev/start/serve script → nothing to boot', () => {
    expect(analyzeFullstackBoot({
      'package.json': JSON.stringify({ scripts: { build: 'tsc' } }),
      'server/index.ts': REST_EXPRESS_SERVER,
    })).toBeNull();
  });
});

describe('survives junk without throwing', () => {
  it('empty / null / malformed inputs', async () => {
    expect(analyzeFullstackBoot({})).toBeNull();
    expect(analyzeFullstackBoot(null as never)).toBeNull();
    expect(analyzeFullstackBoot({ 'package.json': '{ not json' })).toBeNull();
    expect(await fullstackBootHint([], async () => '')).toBeNull();
    expect(await fullstackBootHint(null as never, async () => '')).toBeNull();
  });

  it('the async wrapper reads only probed files and returns the rendered hint', async () => {
    const files: Record<string, string> = { 'package.json': SINGLE_PORT_PKG, 'server/index.ts': REST_EXPRESS_SERVER };
    const read: string[] = [];
    const hint = await fullstackBootHint(Object.keys(files), async (p) => { read.push(p); return files[p] ?? ''; });
    expect(hint).toMatch(/FULLSTACK BOOT/);
    expect(read).toEqual(expect.arrayContaining(['package.json', 'server/index.ts']));
  });
});
