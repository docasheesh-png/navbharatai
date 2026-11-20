// 🔴 THE INSTALL STAMP MUST NEVER CREATE A FILE NAMED node_modules (failedbr #2224, 2026-11-20).
//
// A static site has no dependencies, so `npm install` made no node_modules directory and the stamp `touch node_modules`
// made an empty FILE. Every `[ ! -d node_modules ]` then read the project as never installed: the health check
// reinstalled before every start and `npm run dev` took 115 s (the report's `ls -la` shows `-rw-r--r-- 0 node_modules`).
// Reversion: set STAMP_NODE_MODULES back to 'touch node_modules' and the first two tests fail; put a bare
// `touch node_modules` back at any install site and the census fails.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, statSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { STAMP_NODE_MODULES, recipeInstallCommand } from '../src/server/AgentV3/tscCommand';

const run = (cwd: string) => execFileSync('bash', ['-c', STAMP_NODE_MODULES], { cwd });

describe('the stamp, run for real', () => {
  it('a project with no node_modules gets a directory, never a file', () => {
    const d = mkdtempSync(join(tmpdir(), 'stamp-'));
    run(d);
    expect(statSync(join(d, 'node_modules')).isDirectory()).toBe(true);
  });
  it("#2224's stray 0-byte FILE is replaced by the directory", () => {
    const d = mkdtempSync(join(tmpdir(), 'stamp-'));
    writeFileSync(join(d, 'node_modules'), '');
    run(d);
    expect(statSync(join(d, 'node_modules')).isDirectory()).toBe(true);
  });
  it('a real node_modules keeps its contents and is stamped newer than package.json', () => {
    const d = mkdtempSync(join(tmpdir(), 'stamp-'));
    mkdirSync(join(d, 'node_modules', 'react'), { recursive: true });
    writeFileSync(join(d, 'node_modules', 'react', 'index.js'), 'x');
    writeFileSync(join(d, 'package.json'), '{}');
    execFileSync('bash', ['-c', 'touch -d "2 minutes ago" node_modules'], { cwd: d });
    run(d);
    expect(existsSync(join(d, 'node_modules', 'react', 'index.js'))).toBe(true);
    const fresh = execFileSync('bash', ['-c', '[ package.json -nt node_modules ] && echo STALE || echo FRESH'], { cwd: d }).toString().trim();
    expect(fresh).toBe('FRESH');
  });
});

describe('every install site uses it', () => {
  it('the recipe install ends with the shared stamp', () => {
    expect(recipeInstallCommand([{ name: 'three', version: '0.170.0', dev: false }])).toContain(STAMP_NODE_MODULES);
  });
  it('census: no source runs a bare `touch node_modules` outside the shared constant', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
        if (!/\.(ts|mjs|js)$/.test(e.name) || /\.test\./.test(e.name)) continue;
        const lines = readFileSync(p, 'utf8').split('\n');
        lines.forEach((l, i) => {
          if (/\/\/|^\s*\*/.test(l.trim().slice(0, 3))) return;
          if (/(?:^|[;&|`'"{(]\s*)touch\s+(?:'|")?(?:\$\{[^}]*\}\/)?node_modules\b/.test(l) && !l.includes('STAMP_NODE_MODULES =')) offenders.push(`${p}:${i + 1}`);
        });
      }
    };
    walk('src/server');
    expect(offenders).toEqual([]);
  });
});

// …and the same report's launch: `npx http-server . -p 3000` got `-- --host 0.0.0.0` (a Vite flag) appended.
import { ensureHostBinding } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
describe('a static file server keeps its own host binding (failedbr #2224)', () => {
  it("the report's script: nothing appended", () => {
    expect(ensureHostBinding('npm run dev', undefined, 'npx http-server . -p 3000 -c-1 --cors -o')).toBe('npm run dev');
    expect(ensureHostBinding('npx serve dist')).toBe('npx serve dist');
    expect(ensureHostBinding('python3 -m http.server 8000')).toBe('python3 -m http.server 8000');
  });
  it('a Vite dev script still gets its host', () => {
    expect(ensureHostBinding('npm run dev', 'vite', 'vite')).toContain('--host 0.0.0.0');
  });
});
