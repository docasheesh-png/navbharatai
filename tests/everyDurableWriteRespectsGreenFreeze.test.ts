// EVERY DIRECT DURABLE WRITE IN THE BUILD ROUTE IS CLASSIFIED AGAINST THE GREEN FREEZE (Q-132, 2026-10-04).
//
// The freeze lives in the actuator's `writeFile`. A pass that ALSO writes the saved copy directly could
// keep a change the freeze refused — the published app would differ from the verified preview (the
// SignBridge leak, fixed with `writeUnlessFrozen`). Q-132 asked for every such call site to be audited.
// It was: every one below is safe for one of the reasons in VERDICT, and this census makes the audit
// permanent — a NEW direct save/merge in the route fails until someone decides which reason applies.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Verdict =
  | 'landed'       // saves only what landed: `writtenFiles` (set after a write succeeds) or a sandbox scan
  | 'after-write'  // in the same try, right after `actuator.writeFile`, whose freeze refusal throws first
  | 'gated'        // only after `writeUnlessFrozen(...)` returned true
  | 'pre-latch'    // runs before this build can be green (reopen heal, turn-start reconcile, seeds, imports)
  | 'other-key'    // writes a different record (green snapshot, attempt copy, route fingerprint)
  | 'user-asked';  // the user's own explicit edit or revert route, not a build pass

const VERDICT: Record<string, [Verdict, number]> = {
  'mergeWorkspaceFiles | workspaceId, Object.fromEntries(verdict.revert.map((f) => [f, beforeHeal[f]]))': ['landed', 1], // restores the pre-heal originals
  'mergeWorkspaceFiles | workspaceId, Object.fromEntries(writtenFiles)': ['landed', 3],
  'mergeWorkspaceFiles | workspaceId, files as Record<string, string>': ['user-asked', 1],
  'mergeWorkspaceFiles | workspaceId, foundation.files': ['pre-latch', 1],
  'mergeWorkspaceFiles | workspaceId, importedFiles': ['pre-latch', 1],
  'mergeWorkspaceFiles | workspaceId, seededScaffold': ['pre-latch', 1],
  'mergeWorkspaceFiles | workspaceId, snap': ['user-asked', 1],
  'mergeWorkspaceFiles | workspaceId, ts.patch': ['pre-latch', 1],
  "mergeWorkspaceFiles | workspaceId, { 'package.json': finalPkg }": ['pre-latch', 1],
  'mergeWorkspaceFiles | workspaceId, { [filePath]: newSource }': ['user-asked', 1],
  'mergeWorkspaceFiles | workspaceId, { [patch.path]: patch.content }': ['gated', 2],
  'saveWorkspaceFiles | attemptWorkspaceKey(workspaceId), toSave': ['other-key', 1],
  'saveWorkspaceFiles | fpKey, encodeFingerprint(buildFingerprint(routeChecks, Date.now()))': ['other-key', 1],
  'saveWorkspaceFiles | greenKey, toSave, { mode: \'replace\' }': ['other-key', 1],
  'saveWorkspaceFiles | greenWorkspaceKey(workspaceId), files, { mode: \'replace\' }': ['other-key', 1],
  'saveWorkspaceFiles | newWorkspaceId, files': ['user-asked', 1],
  'saveWorkspaceFiles | workspaceId, Object.fromEntries(scaffolded.map((p) => [p, writtenFiles.get(p) as string]))': ['landed', 1],
  'saveWorkspaceFiles | workspaceId, Object.fromEntries(writtenFiles)': ['landed', 6],
  'saveWorkspaceFiles | workspaceId, attempt': ['landed', 1],
  'saveWorkspaceFiles | workspaceId, changed': ['pre-latch', 1], // dep prune: skipped when isGreenLatched
  'saveWorkspaceFiles | workspaceId, goldenFiles': ['pre-latch', 1],
  'saveWorkspaceFiles | workspaceId, savedDefaults': ['landed', 1],
  'saveWorkspaceFiles | workspaceId, savedSweep': ['landed', 1],
  'saveWorkspaceFiles | workspaceId, snapshot': ['landed', 1],
  'saveWorkspaceFiles | workspaceId, toSave': ['landed', 3],
  "saveWorkspaceFiles | workspaceId, { 'index.html': doc }": ['pre-latch', 1],
  "saveWorkspaceFiles | workspaceId, { 'index.html': inlined }": ['after-write', 1],
  'saveWorkspaceFiles | workspaceId, { [cfg.path]: cfg.content }': ['after-write', 1],
  'saveWorkspaceFiles | workspaceId, { [entryResolved]: deduped }': ['after-write', 1],
  'saveWorkspaceFiles | workspaceId, { [file]: fixed }': ['after-write', 1],
  'saveWorkspaceFiles | workspaceId, { [htmlKey]: fixed }': ['after-write', 1],
  'saveWorkspaceFiles | workspaceId, { [p]: deduped }': ['gated', 1],
};

const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

function durableWrites(): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of route.matchAll(/\b(saveWorkspaceFiles|mergeWorkspaceFiles)\(([^\n]*)/g)) {
    const arg = m[2].split(/\)\.catch|\);|\)\s*$/)[0].trim();
    const key = `${m[1]} | ${arg}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

describe('Q-132: every direct durable write in the build route has a green-freeze verdict', () => {
  const found = durableWrites();

  it('has no unclassified call site (add it to VERDICT with the reason it cannot keep a refused change)', () => {
    const unclassified = [...found.keys()].filter((k) => !(k in VERDICT));
    expect(unclassified).toEqual([]);
  });

  it('has no new copy of a classified call (a second site needs its own look)', () => {
    const changed = [...found.entries()].filter(([k, n]) => VERDICT[k] && VERDICT[k][1] !== n).map(([k, n]) => `${k} ×${n}`);
    expect(changed).toEqual([]);
  });

  it('keeps no stale verdict', () => {
    expect(Object.keys(VERDICT).filter((k) => !found.has(k))).toEqual([]);
  });

  it('the dep prune — the one writer that goes through npm, not writeFile — stands down once green', () => {
    expect(route).toMatch(/pruneUnusedDepsEnabled\(\)[^\n]*!isGreenLatched\(workspaceId\)/);
  });
});
