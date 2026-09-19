import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { declaredPortsFrom, declaredPortFrom, DECLARED_PORT_FILES } from '../src/server/AgentV3/declaredPort';
import { decideSupersede } from '../src/server/AgentV3/previewSupersede';

/**
 * AUTOPSY 1a7f4a58 (2026-09-18) — the platform killed the app's own frontend and previewed its API.
 *
 * "Qiikr", a full-stack classifieds marketplace: a Vite frontend on 5173 and an Express API on 3001.
 * Both are the app's own. The agent restarted the backend alone while diagnosing the database, the
 * health check said "your app is running on port 3001", `update_preview :3001` followed, and the
 * supersede logic freed 5173 — the web app — and retired the recipe pointing at it.
 *
 * The preview then served `Cannot GET /`, because that Express app only serves static files under
 * `NODE_ENV=production`. Minutes 18–31 of a 36-minute build went on chasing it, and the build ran out
 * of budget one `update_preview` call short of the fix.
 */

/** The REAL package.json from the report (its own `cat package.json | head -50` output). */
const QIIKR_PKG = JSON.stringify({
  name: 'qiikr',
  private: true,
  version: '1.0.0',
  type: 'module',
  scripts: {
    dev: 'concurrently "npm run dev:server" "npm run dev:client"',
    'dev:client': 'vite --host 0.0.0.0 --port 5173',
    'dev:server': 'tsx watch server/src/index.ts',
    build: 'tsc && vite build',
    preview: 'vite preview',
    'db:studio': 'prisma studio',
  },
});

/** The app's committed env example — the report's grep shows PORT among its keys. */
const QIIKR_ENV = 'DATABASE_URL=postgresql://localhost:5432/qiikr\nPORT=3001\nCLIENT_URL=http://localhost:5173\n';

describe('🔴 REPLAYS THE REPORT: a delegating dev script hid the port the app really declares', () => {
  it('the strongest signal lives one `npm run` hop away, and used to be invisible', () => {
    // `--port 5173` is explicit, and it is in `dev:client`. Reading only `dev` found NOTHING.
    const ports = declaredPortsFrom({ 'package.json': QIIKR_PKG }).map((d) => d.port);
    expect(ports).toContain(5173);
  });

  it('🔒 THE LOAD-BEARING CASE: both of the app\'s own ports are now declared, not just the winner', () => {
    const ports = declaredPortsFrom({ 'package.json': QIIKR_PKG, '.env.example': QIIKR_ENV }).map((d) => d.port);
    expect(ports).toContain(5173); // the frontend — the one that was killed
    expect(ports).toContain(3001); // the API — the one the singular veto happened to protect
  });

  it('the singular answer was the BACKEND, which is why the veto protected the wrong process', () => {
    // Recorded as measured rather than asserted as desirable: with the indirection followed, the
    // rank-1 flag now wins over the rank-2 env example, so the strongest single answer flips to the
    // frontend. The point of the fix is that this ordering no longer decides who survives.
    expect(declaredPortFrom({ '.env.example': QIIKR_ENV })?.port).toBe(3001);
    expect(declaredPortFrom({ 'package.json': QIIKR_PKG, '.env.example': QIIKR_ENV })?.port).toBe(5173);
  });

  it('🔒 the frontend is no longer freed, and its recipe is no longer retired', () => {
    const declared = declaredPortsFrom({ 'package.json': QIIKR_PKG, '.env.example': QIIKR_ENV }).map((d) => d.port);
    const after = decideSupersede({
      newPort: 3001,
      recipe: { port: 5173 } as never,
      sourceDeclaredPorts: declared,
    });
    expect(after.staleports).toEqual([]);
    expect(after.retireRecipe).toBe(false);
    expect(after.note).toBe('');
  });

  /**
   * ⚠️ HONEST NOTE ON WHAT EACH HALF OF THE FIX ACTUALLY BUYS, because the reversion proof said so.
   *
   * For THIS app the indirection fix alone is sufficient: once `--port 5173` is found in `dev:client`
   * it is rank 1, so even the SINGULAR veto would have protected the frontend. Reverting the plural
   * veto on its own therefore breaks no Qiikr case — only the source guard below.
   *
   * The plural veto is still the DNA fix, and the case below is why: the singular version's
   * correctness depends entirely on which of the app's two ports happens to rank higher, and the
   * ranking was designed to answer a different question ("which one port is the app on?"). Any app
   * that states its frontend port somewhere weak and its API port somewhere strong reproduces the
   * original bug exactly — and `vite.config.ts` + `.env.example` is the commonest such shape there is.
   */
  it('🔒 THE CLASS, not the instance: a weaker-ranked frontend port is still the app\'s own', () => {
    const files = {
      'vite.config.ts': 'export default { server: { host: true, port: 5173 } }', // rank 4
      '.env.example': 'PORT=3001\n',                                             // rank 2 — wins
      'server/src/index.ts': 'app.listen(process.env.PORT || 3001)',
    };
    // The single strongest answer is the API, so the singular veto protects the API…
    expect(declaredPortFrom(files)?.port).toBe(3001);
    const singular = decideSupersede({ newPort: 3001, recipe: { port: 5173 } as never, sourceDeclaredPort: 3001 });
    expect(singular.staleports).toEqual([5173]); // …and kills the frontend. The original bug, again.

    // The set holds both, so neither is ever the "previous app".
    const plural = decideSupersede({
      newPort: 3001,
      recipe: { port: 5173 } as never,
      sourceDeclaredPorts: declaredPortsFrom(files).map((d) => d.port),
    });
    expect(plural.staleports).toEqual([]);
    expect(plural.retireRecipe).toBe(false);
  });

  it('and this is exactly what it did before — the bug, pinned', () => {
    // The singular veto, handed the backend's port, killed the frontend and retired its recipe.
    const before = decideSupersede({ newPort: 3001, recipe: { port: 5173 } as never, sourceDeclaredPort: 3001 });
    expect(before.staleports).toEqual([5173]);
    expect(before.retireRecipe).toBe(true);
  });
});

describe('following `npm run` delegation — bounded, cycle-safe, and never inventing a script', () => {
  const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });

  it('resolves npm / pnpm / yarn / bun `run` forms', () => {
    for (const cmd of ['npm run web', 'pnpm run web', 'yarn run web', 'bun run web']) {
      const ports = declaredPortsFrom({ 'package.json': pkg({ dev: cmd, web: 'vite --port 4321' }) }).map((d) => d.port);
      expect(ports).toContain(4321);
    }
  });

  it('resolves npm-run-all / run-p positional script names', () => {
    const ports = declaredPortsFrom({
      'package.json': pkg({ dev: 'run-p api web', api: 'tsx server.ts --port 8080', web: 'vite --port 4321' }),
    }).map((d) => d.port);
    expect(ports).toEqual(expect.arrayContaining([8080, 4321]));
  });

  it('🔒 a bare `yarn <word>` is NOT a delegation — inventing one would answer about something else', () => {
    // `yarn add express` must not be read as a script called "add".
    const ports = declaredPortsFrom({ 'package.json': pkg({ dev: 'yarn add express && vite', add: 'echo --port 9999' }) });
    expect(ports.map((d) => d.port)).not.toContain(9999);
  });

  it('a self-referencing script cannot loop', () => {
    expect(() => declaredPortsFrom({ 'package.json': pkg({ dev: 'npm run dev' }) })).not.toThrow();
    expect(declaredPortsFrom({ 'package.json': pkg({ dev: 'npm run dev' }) })).toEqual([]);
  });

  it('a mutual cycle cannot loop', () => {
    const files = { 'package.json': pkg({ dev: 'npm run a', a: 'npm run b', b: 'npm run a' }) };
    expect(() => declaredPortsFrom(files)).not.toThrow();
  });

  it('depth is bounded — a chain longer than the limit stops rather than walking forever', () => {
    const deep = pkg({ dev: 'npm run a', a: 'npm run b', b: 'npm run c', c: 'npm run d', d: 'vite --port 4321' });
    // Four hops from `dev` is past MAX_SCRIPT_DEPTH; the bound is what matters, not this port.
    expect(declaredPortsFrom({ 'package.json': deep }).map((d) => d.port)).not.toContain(4321);
  });
});

describe('🔒 nothing that worked before behaves differently', () => {
  it('an app that declares NOTHING is byte-identical to today', () => {
    const recipe = { port: 5000 } as never;
    const before = decideSupersede({ newPort: 3000, recipe });
    expect(decideSupersede({ newPort: 3000, recipe, sourceDeclaredPorts: [] })).toEqual(before);
    expect(decideSupersede({ newPort: 3000, recipe, sourceDeclaredPorts: null })).toEqual(before);
    expect(before.staleports).toEqual([5000]);
  });

  it('the singular field alone still vetoes exactly as it did', () => {
    const d = decideSupersede({ newPort: 3000, recipe: { port: 5000 } as never, sourceDeclaredPort: 5000 });
    expect(d.staleports).toEqual([]);
    expect(d.retireRecipe).toBe(false);
  });

  it('🔒 THE PIANO CASE STILL WORKS — a genuinely previous app is still evicted', () => {
    // 2026-08-25: a piano app left on 5173 while the new app is an Express API on 3000. The new app
    // declares 3000 and nothing else, so 5173 is not its own and is still freed. A wider veto must not
    // become "never evict anything".
    const d = decideSupersede({ newPort: 3000, recipe: { port: 5173 } as never, sourceDeclaredPorts: [3000] });
    expect(d.staleports).toEqual([5173]);
    expect(d.retireRecipe).toBe(true);
  });

  it('a database port is still never freed', () => {
    const d = decideSupersede({ newPort: 3000, recipe: { port: 5432 } as never, sourceDeclaredPorts: [] });
    expect(d.staleports).toEqual([]);
  });

  it('the ranking still holds for the single strongest answer', () => {
    expect(declaredPortFrom({ 'package.json': JSON.stringify({ scripts: { dev: 'vite --port 4321' } }), 'server/index.ts': 'app.listen(5000)' })?.rank).toBe(1);
    expect(declaredPortFrom({ '.env.example': 'PORT=8080\n', 'index.js': 'app.listen(3000)' })?.port).toBe(8080);
    expect(declaredPortFrom({})).toBeNull();
  });
});

describe('the file the API actually lived in', () => {
  it('🔒 server/src/index.ts is read — the report\'s Express entry point was at exactly that path', () => {
    // The list held `server/index.ts` and `src/server/index.ts` but not the combination, so the one
    // file stating the API's own port was never opened.
    expect(DECLARED_PORT_FILES).toContain('server/src/index.ts');
    expect(DECLARED_PORT_FILES).toContain('server/index.ts');
    expect(DECLARED_PORT_FILES).toContain('src/server/index.ts');
  });
});

describe('🔒 the wiring — a veto nobody passes is not a veto', () => {
  // Comments are stripped before every scan: a needle that matches the fix's own explanatory prose is
  // a test that cannot fail for the right reason. This repo has paid for that twice.
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const dispatcher = stripComments(readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8'));

  it('update_preview reads EVERY declared port before superseding', () => {
    const at = dispatcher.indexOf('const decision = decideSupersede(');
    expect(at).toBeGreaterThan(-1);
    const before = dispatcher.slice(Math.max(0, at - 2000), at);
    // ⚠️ The needle moved from `declaredPortsFrom` to `appPortsFrom` on 2026-09-18: the derivation was
    // CENTRALIZED so the service graph and this veto cannot disagree (admin: "ab yeh nahi ana
    // chahiye"). `appPortsFrom` returns the union of the graph's ports and the declared ones, so this
    // is the same read, from one place. The intent of the assertion is unchanged.
    expect(before).toContain('appPortsFrom(portFiles)');
    expect(before).toContain('DECLARED_PORT_FILES');
  });

  it('and passes the whole set into the decision', () => {
    expect(dispatcher).toContain('sourceDeclaredPorts');
    const at = dispatcher.indexOf('const decision = decideSupersede(');
    const call = dispatcher.slice(at, at + 200);
    expect(call).toContain('sourceDeclaredPorts');
  });

  it('🔒 REVERSION GUARD: the veto is checked against the SET, not one port', () => {
    const supersede = stripComments(readFileSync(join(process.cwd(), 'src/server/AgentV3/previewSupersede.ts'), 'utf8'));
    expect(supersede).toContain('!declaredSet.has(p)');
    // The old singular comparison must not come back alongside it.
    expect(supersede).not.toContain('&& p !== declared;');
  });
});
