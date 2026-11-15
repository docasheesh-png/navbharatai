/**
 * BR1979 (f6b4a1c4, "ake app  banane jisse free mein I video Bani", succeeded, charged ₹5.15) —
 * retained evidence, not a replay.
 *
 * The build started under SANDBOX_UNAVAILABLE (E2B cap of 20). The workspace held 0 paths. The fast
 * lane still ran, refused 6 of 13 writes on a transient read, then failed verify with TS6053 because
 * the generated tsconfig.json referenced ./tsconfig.node.json and that file was never written.
 * The full builder finished a working Free Video Maker (~17.5 min, 3.0× the ETA midpoint, YELLOW
 * because the headless preview has no camera).
 *
 * Closures already on main, locked here against this report's shape:
 *   • BR1961 F2 (#4146) — sandboxUnavailableNotice does not invite a retry.
 *   • BR1952 (#4124) — a text-only fast lane is not started when setup failed.
 *
 * Production fix in this PR:
 *   • sanitizeTsconfigReferences — drop a dangling tsconfig.node.json project reference when the
 *     tsconfig already includes its own sources, before the fast lane's tsc gate.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { sandboxUnavailableNotice } from '../src/server/routes/agentv3';
import { sanitizeTsconfigReferences } from '../src/server/AgentV3/FrameworkFoundation';
import { tsconfig as officialStarterTsconfig, tsconfigNode } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

/** The compiler options + include + dangling reference this report's fast-lane verify failed on (TS6053). */
const BR1979_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2020',
    useDefineForClassFields: true,
    noEmit: true,
    jsx: 'react-jsx',
    baseUrl: 'src',
    paths: { '@/*': ['*'] },
  },
  include: ['src'],
  references: [{ path: './tsconfig.node.json' }],
}, null, 2);

const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const SIMPLE = readFileSync('src/server/AgentV3/SimpleBuilder.ts', 'utf8');

describe('BR1979 — a busy sandbox is not a goodbye, and the fast lane is not started', () => {
  it('the notice says we are still trying and does not invite a second Start (this report\'s old goodbye is gone)', () => {
    const n = sandboxUnavailableNotice();
    expect(n).toMatch(/temporarily unavailable/i);
    expect(n).toMatch(/still trying|as soon as I can/i);
    expect(n).not.toMatch(/I can't create files right now/i);
    expect(n).not.toMatch(/please try building again in a little while/i);
    expect(n).not.toMatch(/try building again|try again later|please retry/i);
  });

  it('FAST_LANE_SKIPPED_SANDBOX still gates the text-only lane on sandboxUnavailable', () => {
    expect(ROUTE).toMatch(/const fastLaneWouldRun = !sandboxUnavailable &&/);
    expect(ROUTE).toContain("code: 'FAST_LANE_SKIPPED_SANDBOX'");
    expect(ROUTE).toContain('text-only fast lanes cannot run against an unavailable workspace');
  });
});

describe('BR1979 — a dangling tsconfig.node.json reference is stripped before tsc', () => {
  it('this report\'s tsconfig (include: src + references: tsconfig.node.json, sibling absent) is repaired', () => {
    const files = {
      'tsconfig.json': BR1979_TSCONFIG,
      'package.json': '{}',
      'src/App.tsx': 'export default function App(){return null}',
      'src/main.tsx': 'export {}',
      'vite.config.ts': 'export default {}',
    };
    const res = sanitizeTsconfigReferences(files);
    expect(res.fixes).toEqual([{ file: 'tsconfig.json', removed: ['./tsconfig.node.json'] }]);
    const out = JSON.parse(res.patch['tsconfig.json']);
    expect(out.references).toBeUndefined();
    expect(out.include).toEqual(['src']);
    expect(out.compilerOptions.jsx).toBe('react-jsx');
    expect(out.compilerOptions.baseUrl).toBe('src');
  });

  it('neighbour: the same reference is kept when tsconfig.node.json is present (in the batch or on disk)', () => {
    const files = { 'tsconfig.json': BR1979_TSCONFIG, 'tsconfig.node.json': tsconfigNode };
    expect(sanitizeTsconfigReferences(files).fixes).toHaveLength(0);
    expect(sanitizeTsconfigReferences({ 'tsconfig.json': BR1979_TSCONFIG }, ['tsconfig.node.json']).fixes).toHaveLength(0);
  });

  it('neighbour: the official starter tsconfig has include and no project references', () => {
    const official = JSON.parse(officialStarterTsconfig);
    expect(official.include).toEqual(['src']);
    expect(official.references).toBeUndefined();
    expect(sanitizeTsconfigReferences({ 'tsconfig.json': officialStarterTsconfig, 'tsconfig.node.json': tsconfigNode }).fixes).toHaveLength(0);
  });

  it('neighbour: a Vite 5 solution-style tsconfig (files: [] + references only) is left alone', () => {
    const files = {
      'tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }],
      }),
    };
    expect(sanitizeTsconfigReferences(files).fixes).toHaveLength(0);
  });

  it('the fast lane heals the map before write/verify, and the route heals again before tsc and preview', () => {
    expect(SIMPLE).toContain('sanitizeTsconfigReferences(before, deps.scaffoldPaths ?? [])');
    expect(SIMPLE).toContain("AGENTV3_TSCONFIG_SANITIZE !== 'off'");
    expect(ROUTE).toContain('sanitizeTsconfigReferences(Object.fromEntries(writtenFiles), scaffold)');
    expect(ROUTE).toContain("code: 'TSCONFIG_REFERENCES_REPAIRED'");
    expect(ROUTE).toContain('sanitizeTsconfigReferences(saved, Object.keys(saved))');
  });
});
