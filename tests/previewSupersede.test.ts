import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decideSupersede } from '../src/server/AgentV3/previewSupersede';
import { findUnresolvedLocalImports } from '../src/server/AgentV3/ProjectImport';
import { scanHardcodedUrls } from '../src/server/AgentV3/HardcodedUrlAnalysis';

/**
 * THE PIANO INSTEAD OF THE UPI API (admin 2026-08-25, build report as evidence).
 *
 * A UPI Payment API (Express, port 3000) was built CORRECTLY in a workspace that had previously held
 * a piano app (Vite, 5173). The report proves the build: framework node-express, endpoints
 * curl-tested, PREVIEW_PUBLISHED at 3000-….e2b.app. The preview showed the piano at 5173 — because
 * the piano's dev server was STILL RUNNING in the resumed sandbox, the stored recipe still said 5173
 * (it is only rewritten by a browser-verified render, which a JSON API never earns), and a live
 * listener wins every honest probe. The engine did not ignore the prompt; the old app never left.
 *
 * These tests pin the three root causes that conspired.
 */

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('decideSupersede — the old app must actually leave', () => {
  const recipe = (port: number) => ({ devCommand: 'npm run dev', port, provenAt: 1 }) as never;

  it('🔒 the reported case: recipe says 5173, the new app verified on 3000', () => {
    const d = decideSupersede({ newPort: 3000, recipe: recipe(5173), declaredPort: 5173 });
    expect(d.staleports).toEqual([5173]);
    expect(d.retireRecipe).toBe(true);
    expect(d.note).toContain('5173');
    expect(d.note).toContain('3000');
  });

  it('same app, same port ⇒ nothing to do, and NO note', () => {
    const d = decideSupersede({ newPort: 3000, recipe: recipe(3000), declaredPort: 3000 });
    expect(d.staleports).toEqual([]);
    expect(d.retireRecipe).toBe(false);
    expect(d.note).toBe('');
  });

  it('no prior records ⇒ nothing to free (a fresh workspace must not run kill commands)', () => {
    const d = decideSupersede({ newPort: 3000, recipe: null, declaredPort: null });
    expect(d.staleports).toEqual([]);
    expect(d.retireRecipe).toBe(false);
  });

  it('🔒 database ports are NEVER freed — a Postgres is not "the old app"', () => {
    const d = decideSupersede({ newPort: 3000, recipe: recipe(5432), declaredPort: 6379 });
    expect(d.staleports).toEqual([]);
    // The recipe still describes another port, so it is still retired — only the KILL is withheld.
    expect(d.retireRecipe).toBe(true);
  });

  it('recipe and declaredPort naming the same stale port are freed once, not twice', () => {
    const d = decideSupersede({ newPort: 3000, recipe: recipe(5173), declaredPort: 5173 });
    expect(d.staleports).toEqual([5173]);
  });

  it('🔒 only RECORD-named ports — garbage numbers never become kill targets', () => {
    const d = decideSupersede({ newPort: 3000, recipe: recipe(0), declaredPort: 70000 });
    expect(d.staleports).toEqual([]);
  });

  it('the wiring: update_preview supersedes at the verified-UP moment', () => {
    const dispatcher = src('src/server/AgentV3/ToolDispatcher.ts');
    const at = dispatcher.indexOf("case 'update_preview'");
    const block = dispatcher.slice(at, dispatcher.indexOf('injectAppSignatureIntoIndexHtml', at));
    expect(block).toContain('decideSupersede({ newPort: port');
    expect(block).toContain('buildPreKillPortCommand(decision.staleports)');
    expect(block).toContain('sandboxStore.supersedeRecipe(this.workspaceId, port)');
  });
});

describe('TS-ESM extension substitution — a correct import is not a missing file', () => {
  it('🔒 the reported case: server/index.ts imports "./routes/upi.js", the file is upi.ts', () => {
    // Under "module": "nodenext" this import is REQUIRED to be written exactly this way. The scanner
    // called it missing, and the repair then CREATED a literal upi.js stub — which Node resolves in
    // preference to the real upi.ts, so the false alarm actively broke a working app.
    const missing = findUnresolvedLocalImports({
      'server/index.ts': "import { upiRouter } from './routes/upi.js';\n",
      'server/routes/upi.ts': 'export const upiRouter = 1;\n',
    });
    expect(missing).toEqual([]);
  });

  it('the whole tsc mapping: .mjs→.mts, .cjs→.cts, .jsx→.tsx', () => {
    expect(findUnresolvedLocalImports({
      'a.ts': "import x from './b.mjs';\nimport y from './c.cjs';\nimport z from './d.jsx';\n",
      'b.mts': '', 'c.cts': '', 'd.tsx': '',
    })).toEqual([]);
  });

  it('🔒 a .js import with NO twin anywhere is still honestly missing', () => {
    const missing = findUnresolvedLocalImports({
      'server/index.ts': "import { r } from './routes/gone.js';\n",
    });
    expect(missing).toHaveLength(1);
    expect(missing[0].missing).toContain('gone.js');
  });

  it('an OVER-RELATIVE .js import finds its .ts twin by tail (fix the path, not a duplicate)', () => {
    // The Kanban mispath shape (a path that escaped its folder) with the TS-ESM twist: the tail
    // match must see through the .js↔.ts substitution, or the repair writes a second copy. A
    // wrong-DIRECTORY full path is deliberately NOT matched — tail matching a bare filename would be
    // a guess, and this function's contract is "exactly one match, never a guess".
    const missing = findUnresolvedLocalImports({
      'index.ts': "import { r } from './routes/upi.js';\n",
      'server/routes/upi.ts': 'export const r = 1;\n',
    });
    expect(missing).toHaveLength(1);
    expect(missing[0].existsAt).toBe('server/routes/upi.ts');
  });

  it('🔒 a missing stylesheet does NOT "match" an unrelated .ts file of the same name', () => {
    // Stripping .css in the tail-match would let the mispath autofix rewrite a stylesheet import to
    // point at TypeScript — worse than the miss it fixes.
    const missing = findUnresolvedLocalImports({
      'src/App.tsx': "import './theme.css';\n",
      'src/theme.ts': 'export {};\n',
    });
    expect(missing).toHaveLength(1);
    expect(missing[0].existsAt).toBeUndefined();
  });
});

describe('hardcoded-localhost scan — a printed URL is not a network call', () => {
  it('🔒 the universal Express boilerplate is not flagged', () => {
    const code = "app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));\n";
    expect(scanHardcodedUrls('server/index.ts', code)).toEqual([]);
  });

  it('logger variants too', () => {
    expect(scanHardcodedUrls('a.ts', "logger.info('listening on http://localhost:3000');\n")).toEqual([]);
  });

  it('🔒 a localhost the app actually CALLS is still flagged — that is the real signal', () => {
    const issues = scanHardcodedUrls('src/api.ts', "const r = await fetch('http://localhost:3000/api/items');\n");
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('localhost');
  });

  it('a hardcoded WebSocket is still flagged (the gap the wss match closed)', () => {
    expect(scanHardcodedUrls('src/live.ts', "const ws = new WebSocket('ws://localhost:8080');\n")).toHaveLength(1);
  });
});
