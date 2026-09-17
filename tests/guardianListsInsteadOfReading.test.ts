/**
 * THE 160-SECOND SANDBOX SCAN (autopsy 8682b6b1, 2026-09-17).
 *
 *   SETUP_TIMING: "Project checked in 161s — nothing needed restoring"
 *                 detail: "durable read 73ms · sandbox scan 160493ms"
 *
 * The File Guardian read EVERY file of a resumed project over the network and then asked one question
 * of the result — which saved paths are absent — that reads no contents at all. Two independent
 * reviews agreed on the safe shape: list instead of read (membership-identical by construction), skip
 * binaries by name before any read, layer the sandbox's own package.json/tsconfig over the durable map
 * for the reconcile, and make that reconcile add-only against the live copy before it writes.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectWorkspaceFiles, listWorkspaceFiles, collectWorkspaceConfigFiles } from '../src/server/AgentV3/WorkspaceFiles';
import { planFileGuardian, planFileGuardianFromListing } from '../src/server/AgentV3/FileGuardian';

const TREE: Record<string, string> = {
  'package.json': '{"name":"app","dependencies":{"react":"^18"}}',
  'tsconfig.json': '{"compilerOptions":{}}',
  'tsconfig.node.json': '{}',
  'src/main.tsx': 'import App from "./App";',
  'src/App.tsx': 'export default () => null',
  'src/logo.png': String.fromCharCode(0) + 'PNG',
  'public/hero.jpg': String.fromCharCode(0) + 'JPG',
  'assets/font.woff2': String.fromCharCode(0) + 'WOFF',
  'node_modules/react/index.js': 'module.exports = {}',
  '.env': 'SECRET=1',
  '.env.example': 'SECRET=',
  'icon.svg': '<svg/>',
};

function source() {
  const readFile = vi.fn(async (_ws: string, p: string) => {
    if (!(p in TREE)) throw new Error('ENOENT');
    return TREE[p];
  });
  return { listFiles: async () => Object.keys(TREE), readFile, reads: readFile };
}

describe('Part 2 — a binary is known by its name before it is read', () => {
  it('never reads a .png/.jpg/.woff2, skips it exactly as the NUL check used to, and still reads .svg', async () => {
    const src = source();
    const { files, skipped } = await collectWorkspaceFiles(src, 'ws');
    const readPaths = src.reads.mock.calls.map((c) => c[1]);
    for (const bin of ['src/logo.png', 'public/hero.jpg', 'assets/font.woff2']) {
      expect(readPaths).not.toContain(bin);
      expect(skipped).toContain(bin);
      expect(files[bin]).toBeUndefined();
    }
    expect(readPaths).toContain('icon.svg');
    expect(files['icon.svg']).toBe('<svg/>');
  });
});

describe('Part 1 — the listing partitions exactly as the collector does, with zero reads', () => {
  it('present ∪ skipped === keys(files) ∪ skipped of the read-based collector, and readFile is never called', async () => {
    const listed = source();
    const listing = await listWorkspaceFiles(listed, 'ws');
    expect(listed.reads).not.toHaveBeenCalled();
    const read = source();
    const collected = await collectWorkspaceFiles(read, 'ws');
    const viaListing = [...listing.present, ...listing.skipped].sort();
    const viaReads = [...Object.keys(collected.files), ...collected.skipped].sort();
    expect(viaListing).toEqual(viaReads);
    expect(viaListing).toEqual(Object.keys(TREE).sort());
  });

  it('throws when the listing itself fails — "could not look" is never "nothing is there"', async () => {
    await expect(listWorkspaceFiles({ listFiles: async () => { throw new Error('sandbox gone'); } }, 'ws')).rejects.toThrow('sandbox gone');
  });

  it('planFileGuardianFromListing produces the IDENTICAL plan to the read-based call, in every mode', async () => {
    const saved = { 'src/main.tsx': 'old', 'src/App.tsx': 'old', 'src/lost.ts': 'gone', 'src/gone2.ts': 'gone' };
    const src = source();
    const collected = await collectWorkspaceFiles(src, 'ws');
    const listing = await listWorkspaceFiles(src, 'ws');
    // mode: 'missing' (2 of 4 saved files absent — under the recycle fraction).
    expect(planFileGuardianFromListing(saved, [...listing.present, ...listing.skipped]))
      .toEqual(planFileGuardian(saved, collected.files, collected.skipped));
    // mode: 'none' — every saved file is present (one of them only as a binary the scan never read).
    const allPresent = { 'src/main.tsx': 'x', 'src/logo.png': 'x' };
    const fromListing = planFileGuardianFromListing(allPresent, [...listing.present, ...listing.skipped]);
    expect(fromListing).toEqual(planFileGuardian(allPresent, collected.files, collected.skipped));
    expect(fromListing.mode).toBe('none');
    // mode: 'full' — the sandbox was recycled.
    const recycled = ['package.json'];
    expect(planFileGuardianFromListing(saved, recycled)).toEqual(planFileGuardian(saved, {}, recycled));
    expect(planFileGuardianFromListing(saved, recycled).mode).toBe('full');
  });
});

describe('the config files the reconcile needs are read live, bounded, and nothing else is', () => {
  it('reads only package.json and tsconfig*.json from the listing', async () => {
    const src = source();
    const cfg = await collectWorkspaceConfigFiles(src, 'ws', (await listWorkspaceFiles(src, 'ws')).present);
    expect(Object.keys(cfg).sort()).toEqual(['package.json', 'tsconfig.json', 'tsconfig.node.json']);
    expect(src.reads.mock.calls.map((c) => c[1]).sort()).toEqual(['package.json', 'tsconfig.json', 'tsconfig.node.json']);
  });

  it('a failed read is simply absent — never a throw, never an invented file', async () => {
    const src = { listFiles: async () => ['package.json'], readFile: async () => { throw new Error('boom'); } };
    await expect(collectWorkspaceConfigFiles(src, 'ws', ['package.json'])).resolves.toEqual({});
  });
});

describe('the route wiring — parsed from the CODE, comments stripped', () => {
  const code = readFileSync('src/server/routes/agentv3.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the guardian lists instead of reading, and the failed-listing sentinel is untouched', () => {
    const at = code.indexOf('const existing = await listWorkspaceFiles(actuator, workspaceId).catch(() => {');
    expect(at).toBeGreaterThan(-1);
    expect(code.slice(at, at + 300)).toContain('scanFailed = true;');
    expect(code).not.toContain('const existing = await collectWorkspaceFiles(actuator, workspaceId)');
    expect(code).toContain('const plan = planFileGuardianFromListing(saved, [...existing.present, ...existing.skipped]);');
  });

  it('the union layers the LIVE config over the durable map, and the reconcile is add-only against the live package.json before it writes', () => {
    expect(code).toContain('const union = { ...saved, ...liveConfig, ...plan.restore };');
    const guard = code.indexOf("const guarded = typeof livePkg === 'string' ? restoreDroppedDependencies(reconciled, livePkg)");
    expect(guard).toBeGreaterThan(-1);
    const write = code.indexOf("await writeWorkspaceFiles(actuator, workspaceId, { 'package.json': finalPkg });", guard);
    expect(write).toBeGreaterThan(guard);
    // The phantom prune still runs, after the guard — deliberate removals are not "drops".
    const prune = code.indexOf('const phantoms = phantomAliasDependencies(union);', guard);
    expect(prune).toBeGreaterThan(guard);
    expect(prune).toBeLessThan(write);
  });
});
