import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  declaredAppPort, portFromPackageScripts, portFromDevServerConfig,
  portFromEnvFiles, portFromServerEntry,
} from '../src/server/lib/declaredAppPort';

/**
 * WHICH PORT DOES AN IMPORTED APP RUN ON? (admin 2026-09-04: *"jab github se koi repo import karta
 * hai, to kis port par run karna hai yeh confuse ho jata hai."*)
 *
 * ROOT CAUSE was a SCATTERED check, not a missing one: three readers each saw a different narrow slice
 * (package.json scripts / a fixed list of server entries / a module-private vite reader), and each
 * caller picked its own subset. An app WE scaffold declares its port in a script, so the gap never
 * showed; an IMPORTED repo declares it in vite.config, a .env, or a server entry outside that list —
 * none of which the preview or import path could see. Discovery fell through to a framework guess,
 * visited the wrong port, and reported "not running" about an app that was serving perfectly.
 */
const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('portFromPackageScripts — an explicit flag', () => {
  it('reads --port, -p and PORT= from dev/start/serve', () => {
    expect(portFromPackageScripts(JSON.stringify({ scripts: { dev: 'vite --port 4000' } }))?.port).toBe(4000);
    expect(portFromPackageScripts(JSON.stringify({ scripts: { dev: 'next dev -p 3001' } }))?.port).toBe(3001);
    expect(portFromPackageScripts(JSON.stringify({ scripts: { start: 'PORT=8080 node server.js' } }))?.port).toBe(8080);
  });

  it('says nothing when the script declares nothing, and never throws on junk', () => {
    expect(portFromPackageScripts(JSON.stringify({ scripts: { dev: 'vite' } }))).toBeNull();
    expect(portFromPackageScripts('{not json')).toBeNull();
    expect(portFromPackageScripts(null)).toBeNull();
  });
});

describe('portFromDevServerConfig — how a frontend repo pins its port', () => {
  it('🔒 reads vite.config server.port — the reader that existed but was unreachable', () => {
    // `clientVitePort` was module-private to fullstackBootHint, so the preview path that most needed
    // it could not call it at all. This is the most common way an imported frontend pins a port.
    const files = { 'vite.config.ts': 'export default defineConfig({ server: { port: 4321, open: true } })' };
    expect(portFromDevServerConfig(files)).toEqual({ port: 4321, source: 'vite-config', evidence: 'vite.config.ts' });
  });

  it('handles the other configs an imported repo realistically uses', () => {
    expect(portFromDevServerConfig({ 'webpack.config.js': 'module.exports={devServer:{port:9000}}' })?.port).toBe(9000);
    expect(portFromDevServerConfig({ 'angular.json': '{"options": { "port": 4200 }}' })?.port).toBe(4200);
    expect(portFromDevServerConfig({ 'vite.config.js': 'export default { server: { port: 5175 } }' })?.port).toBe(5175);
  });

  it('a config in a subfolder still counts, a non-config file never does', () => {
    expect(portFromDevServerConfig({ 'client/vite.config.ts': 'server:{port:7000}' })?.port).toBe(7000);
    expect(portFromDevServerConfig({ 'README.md': 'we use server: { port: 1234 }' })).toBeNull();
  });
});

describe('portFromEnvFiles — how a backend repo pins its port', () => {
  it('🔒 reads PORT from .env — the case nothing read, and the one that broke imports', () => {
    // An imported Express app says `app.listen(process.env.PORT)` with NO literal fallback, so the
    // code reader finds nothing and the real number lives here. Before this it booted on 8080 while
    // the preview waited on 3000 and then told the user their app was not running.
    expect(portFromEnvFiles({ '.env': 'DB_URL=x\nPORT=8080\n' })).toEqual({ port: 8080, source: 'env-file', evidence: '.env' });
    expect(portFromEnvFiles({ '.env': 'VITE_PORT=5180' })?.port).toBe(5180);
    expect(portFromEnvFiles({ '.env': 'export PORT="9090"' })?.port).toBe(9090);
  });

  it('a development env beats a generic one', () => {
    expect(portFromEnvFiles({ '.env': 'PORT=1111', '.env.development': 'PORT=2222' })?.port).toBe(2222);
  });

  it('🔒 a commented-out line is not a declaration', () => {
    expect(portFromEnvFiles({ '.env': '# PORT=8080\nDB=1' })).toBeNull();
  });
});

describe('portFromServerEntry — wider than the old fixed list', () => {
  it('🔒 finds the layouts an imported repo actually uses', () => {
    // The old reader had a hardcoded candidate list; these three are exactly what it missed.
    expect(portFromServerEntry({ 'backend/server.js': 'app.listen(7777)' })?.port).toBe(7777);
    expect(portFromServerEntry({ 'api/index.js': 'const PORT = 6060' })?.port).toBe(6060);
    expect(portFromServerEntry({ 'src/main.ts': 'app.listen(process.env.PORT || 4444)' })?.port).toBe(4444);
  });

  it('🔒 a real server entry is read BEFORE a generic index', () => {
    // A project with both almost always means server.js is the API and index.js the frontend entry —
    // reading the frontend's port here is the original failure wearing a new costume.
    const files = { 'index.js': 'app.listen(3000)', 'server.js': 'app.listen(5000)' };
    expect(portFromServerEntry(files)?.port).toBe(5000);
  });

  it('never reads a test file', () => {
    expect(portFromServerEntry({ 'server.test.js': 'app.listen(1234)' })).toBeNull();
  });
});

describe('declaredAppPort — one answer, documented precedence', () => {
  it('🔒 an explicit script flag beats every config and the code', () => {
    // A flag is a deliberate override of whatever anything else defaults to.
    const files = {
      'package.json': JSON.stringify({ scripts: { dev: 'vite --port 4000' } }),
      'vite.config.ts': 'server:{port:5173}',
      '.env': 'PORT=8080',
      'server.js': 'app.listen(9000)',
    };
    expect(declaredAppPort(files)).toEqual({ port: 4000, source: 'script', evidence: 'package.json → scripts.dev' });
  });

  it('config beats env, env beats code — each only fills the silence above it', () => {
    const base = { 'package.json': JSON.stringify({ scripts: { dev: 'vite' } }) };
    expect(declaredAppPort({ ...base, 'vite.config.ts': 'server:{port:5173}', '.env': 'PORT=8080' })?.port).toBe(5173);
    expect(declaredAppPort({ ...base, '.env': 'PORT=8080', 'server.js': 'app.listen(9000)' })?.port).toBe(8080);
    expect(declaredAppPort({ ...base, 'server.js': 'app.listen(9000)' })?.port).toBe(9000);
  });

  it('🔒 NULL when the app declares nothing — and null must stay a real answer', () => {
    // The caller then keeps its evidence-first listening-port sweep, which is strictly better than any
    // guess this function could invent. Returning a made-up port here would REPLACE real evidence.
    expect(declaredAppPort({ 'package.json': JSON.stringify({ scripts: { dev: 'vite' } }) })).toBeNull();
    expect(declaredAppPort({})).toBeNull();
  });

  it('🔒 never returns an INFRASTRUCTURE port as the app\'s', () => {
    // A provisioned Postgres listens in the very sandboxes this runs in; publishing 5432 as "the app"
    // would be worse than finding nothing.
    expect(declaredAppPort({ '.env': 'PORT=5432' })).toBeNull();
  });

  it('carries WHERE it came from, so a diagnostic can say why', () => {
    expect(declaredAppPort({ '.env': 'PORT=8080' })).toEqual({ port: 8080, source: 'env-file', evidence: '.env' });
  });
});

describe('🔒 both callers use the ONE resolver — no fourth narrow subset', () => {
  const route = src('src/server/routes/agentv3.ts');

  it('the preview path resolves from every declaration site', () => {
    expect(route).toContain('codePort = declaredAppPort(src, pkgRaw)?.port ?? null');
  });

  it('🔒 the IMPORT path does too — that is where the admin hit it', () => {
    // It had the narrowest reader of all: package.json scripts, then a framework GUESS.
    expect(route).toContain('const declared = declaredAppPort(importedFiles)?.port ?? null;');
    expect(route).toContain('let bootPort = port ?? declared ?? oneShotDevPort(framework);');
  });

  it('the boot log still outranks everything — the app saying where it landed', () => {
    // `port` (parsed from the dev server's own output) must stay first: it is observation, not
    // declaration, and an app that MOVED (port already in use) is only correct there.
    const at = route.indexOf('let bootPort = port ?? declared');
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 60)).toMatch(/port \?\? declared/);
  });

  it('the flip ranks what the app declares, not just a script flag', () => {
    expect(route).toContain('rankPortCandidates({ parsed: port, scriptPort: declared,');
  });
});
