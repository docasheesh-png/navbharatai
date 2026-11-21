// Q-2732 / Q-2242 (failedbr #1577, #1565, #1561, #1544, #1540): the browser said a project module lacked an export the
// file on disk has; the repair pass spent its attempt proving the code fine. The claim is now checked against the file.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileExportsName, missingExportClaims, staleExportClaims } from '../src/server/AgentV3/staleModuleExport';

// Verbatim console lines from the reports.
const CONSOLE = [
  "The requested module '/src/game/core/meta.ts?t=1792462459867' does not provide an export named 'combo'",
  "The requested module '/src/lib/icons.tsx' does not provide an export named 'Save'",
  "The requested module '/src/App.tsx?t=1792463857396' does not provide an export named 'default'",
  "The requested module '/node_modules/.vite/deps/react.js?v=1' does not provide an export named 'useFoo'",
];

describe('a missing-export claim the file disproves is a stale server, not a code bug', () => {
  it('reads project-file claims (never a package dep) and drops the ?t= stamp', () => {
    expect(missingExportClaims(CONSOLE)).toEqual([
      { path: 'src/game/core/meta.ts', name: 'combo' },
      { path: 'src/lib/icons.tsx', name: 'Save' },
      { path: 'src/App.tsx', name: 'default' },
    ]);
  });

  it.each([
    ['export function combo() {}', 'combo'],
    ['export const combo = { n: 0 };', 'combo'],
    ['function startMeta() {}\nexport { startMeta, other };', 'startMeta'],
    ['const s = () => null;\nexport { s as Save };', 'Save'],
    ['export default function App() { return null; }', 'default'],
    ['function App() {}\nexport { App as default };', 'default'],
  ])('exports: %s', (src, name) => {
    expect(fileExportsName(src, name)).toBe(true);
  });

  it.each([
    ['// export function combo() {}\nfunction combo() {}', 'combo'],
    ['export const comboCount = 1;', 'combo'],
    ['export function App() {}', 'default'],
  ])('does not export: %s', (src, name) => {
    expect(fileExportsName(src, name)).toBe(false);
  });

  it('stale only when EVERY claim is disproved by its file', () => {
    const files: Record<string, string> = { 'src/game/core/meta.ts': 'export const combo = 1;', 'src/lib/icons.tsx': 'export const Edit = 1;' };
    const read = (p: string) => files[p] ?? null;
    expect(staleExportClaims([{ path: 'src/game/core/meta.ts', name: 'combo' }], read)).toHaveLength(1);
    expect(staleExportClaims([{ path: 'src/game/core/meta.ts', name: 'combo' }, { path: 'src/lib/icons.tsx', name: 'Save' }], read)).toEqual([]);
    expect(staleExportClaims([{ path: 'src/gone.ts', name: 'x' }], read)).toEqual([]);
  });

  it('the preview loop restarts the server with the cache cleared before any repair, once', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toMatch(/code: 'PREVIEW_STALE_MODULE_RESTARTED'/);
    expect(route).toMatch(/!staleModuleRestarted && staleClaims\.length > 0/);
    expect(route).toMatch(/rm -rf node_modules\/\.vite/);
  });
});
