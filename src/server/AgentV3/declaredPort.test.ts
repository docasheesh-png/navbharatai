import { describe, it, expect } from 'vitest';
import { declaredPortFrom, DECLARED_PORT_FILES } from './declaredPort';

describe('the reported failure', () => {
  it('reads 5000 from an Express app that serves on 5000', () => {
    // The admin's Mitrify import: the preview never came up, so no proven-port recipe existed, the door
    // fell through to the common list and offered 3000. The app was never going to be on 3000 — and the
    // engine had already READ this line and written "serves on port 5000" into its own reply.
    const hit = declaredPortFrom({ 'server/index.ts': 'const port = process.env.PORT || 5000;\napp.listen(port, () => {});' });
    expect(hit?.port).toBe(5000);
  });
});

describe('the ranking is the design', () => {
  it('an explicit --port in the dev script beats a literal listen() elsewhere', () => {
    const hit = declaredPortFrom({
      'package.json': JSON.stringify({ scripts: { dev: 'vite --port 4321' } }),
      'server/index.ts': 'app.listen(5000)',
    });
    expect(hit?.port).toBe(4321);
    expect(hit?.rank).toBe(1);
  });

  it('a committed env example beats a source literal', () => {
    const hit = declaredPortFrom({ '.env.example': 'PORT=8080\n', 'index.js': 'app.listen(3000)' });
    expect(hit?.port).toBe(8080);
  });

  it('reads PORT= set inline in the script', () => {
    expect(declaredPortFrom({ 'package.json': JSON.stringify({ scripts: { start: 'PORT=7000 node server.js' } }) })?.port).toBe(7000);
  });

  it('reads a dev-server config port', () => {
    expect(declaredPortFrom({ 'vite.config.ts': 'export default { server: { host: true, port: 5199 } }' })?.port).toBe(5199);
  });
});

describe('"we do not know" is a real answer', () => {
  it('is null when the app says nothing about a port', () => {
    // The caller must treat null as unknown, NEVER as a default — inventing one here would be the same
    // guess this module exists to replace.
    expect(declaredPortFrom({ 'src/App.tsx': 'export default function App(){ return null }' })).toBeNull();
    expect(declaredPortFrom({})).toBeNull();
  });

  it('ignores ports that cannot be an app dev server', () => {
    expect(declaredPortFrom({ 'index.js': 'app.listen(80)' })).toBeNull();
    expect(declaredPortFrom({ 'index.js': 'app.listen(99999)' })).toBeNull();
  });

  it('never throws on junk', () => {
    expect(declaredPortFrom({ 'package.json': '{ not json' })).toBeNull();
    expect(declaredPortFrom({ 'x.ts': undefined })).toBeNull();
  });
});

describe('the file list is bounded and covers the shapes we actually import', () => {
  it('includes package.json, an env example, a server entry and a vite config', () => {
    expect(DECLARED_PORT_FILES).toContain('package.json');
    expect(DECLARED_PORT_FILES).toContain('.env.example');
    expect(DECLARED_PORT_FILES).toContain('server/index.ts');
    expect(DECLARED_PORT_FILES).toContain('vite.config.ts');
  });

  it('stays small — every entry is a bounded sandbox read on the build path', () => {
    expect(DECLARED_PORT_FILES.length).toBeLessThanOrEqual(16);
  });
});
