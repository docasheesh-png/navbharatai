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
import ts from 'typescript';

type Verdict =
  | 'landed'       // saves only what landed: `writtenFiles` (set after a write succeeds) or a sandbox scan
  | 'after-write'  // in the same try, right after `actuator.writeFile`, whose freeze refusal throws first
  | 'gated'        // only after `writeUnlessFrozen(...)` returned true
  | 'pre-latch'    // runs before this build can be green (reopen heal, turn-start reconcile, seeds, imports)
  | 'other-key'    // writes a different record (green snapshot, attempt copy, route fingerprint)
  | 'user-asked';  // the user's own explicit edit or revert route, not a build pass

const VERDICT: Record<string, [Verdict, number]> = {
  // Shared automatic restore: applySnapshotRestore passes only successful sandbox writes to persist.
  'mergeWorkspaceFiles | workspaceId, files': ['landed', 1],
  'mergeWorkspaceFiles | workspaceId, Object.fromEntries(writtenFiles)': ['landed', 3],
  'mergeWorkspaceFiles | workspaceId, files as Record<string, string>': ['user-asked', 1],
  'mergeWorkspaceFiles | workspaceId, foundation.files': ['pre-latch', 1],
  'mergeWorkspaceFiles | workspaceId, importedFiles': ['pre-latch', 1],
  'mergeWorkspaceFiles | workspaceId, seededScaffold': ['pre-latch', 1],
  'mergeWorkspaceFiles | workspaceId, ts.patch': ['pre-latch', 1],
  "mergeWorkspaceFiles | workspaceId, { 'package.json': finalPkg }": ['pre-latch', 1],
  'mergeWorkspaceFiles | workspaceId, { [filePath]: newSource }': ['user-asked', 1],
  'mergeWorkspaceFiles | workspaceId, { [patch.path]: patch.content }': ['gated', 2],
  'saveWorkspaceFiles | attemptWorkspaceKey(workspaceId), toSave': ['other-key', 1],
  'saveWorkspaceFiles | fpKey, encodeFingerprint(buildFingerprint(routeChecks, Date.now()))': ['other-key', 1],
  'saveWorkspaceFiles | greenKey, toSave, { mode: \'replace\' }': ['other-key', 1],
  'saveWorkspaceFiles | greenWorkspaceKey(workspaceId), files, { mode: \'replace\' }': ['other-key', 1],
  'saveWorkspaceFiles | newWorkspaceId, files': ['user-asked', 1],
  // The version restore (Q-128): the user's own "go back", refused while a build runs, so no freeze is live.
  "saveWorkspaceFiles | workspaceId, plan.target, { mode: 'replace' }": ['user-asked', 1],
  'saveWorkspaceFiles | workspaceId, Object.fromEntries(scaffolded.map((p) => [p, writtenFiles.get(p) as string]))': ['landed', 1],
  'saveWorkspaceFiles | workspaceId, Object.fromEntries(writtenFiles)': ['landed', 6],
  'saveWorkspaceFiles | workspaceId, attempt': ['landed', 1],
  'saveWorkspaceFiles | workspaceId, changed': ['pre-latch', 1], // dep prune: skipped when isGreenLatched
  'saveWorkspaceFiles | workspaceId, goldenFiles': ['pre-latch', 1],
  'saveWorkspaceFiles | workspaceId, savedDefaults': ['landed', 1],
  'saveWorkspaceFiles | workspaceId, savedSweep': ['landed', 1],
  // Final save starts with toSave and is reconciled to the applied tree after any partial restore.
  'saveWorkspaceFiles | workspaceId, persisted': ['landed', 1],
  'saveWorkspaceFiles | workspaceId, toSave': ['landed', 2],
  "saveWorkspaceFiles | workspaceId, { 'index.html': doc }": ['pre-latch', 1],
  "saveWorkspaceFiles | workspaceId, { 'index.html': inlined }": ['after-write', 1],
  'saveWorkspaceFiles | workspaceId, { [cfg.path]: cfg.content }': ['after-write', 1],
  'saveWorkspaceFiles | workspaceId, { [entryResolved]: deduped }': ['after-write', 1],
  'saveWorkspaceFiles | workspaceId, { [file]: fixed }': ['after-write', 1],
  'saveWorkspaceFiles | workspaceId, { [htmlKey]: fixed }': ['after-write', 1],
  'saveWorkspaceFiles | workspaceId, { [p]: deduped }': ['gated', 1],
};

const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

function durableWrites(text = route): Map<string, number> {
  const out = new Map<string, number>();
  const source = ts.createSourceFile('agentv3.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
      if (name === 'saveWorkspaceFiles' || name === 'mergeWorkspaceFiles') {
        const key = `${name} | ${node.arguments.map((arg) => arg.getText(source).trim()).join(', ')}`;
        out.set(key, (out.get(key) ?? 0) + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
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

  it('classifies raw and nested tracked calls by their own arguments, preserving nested payload parentheses', () => {
    const calls = durableWrites(`
      saveWorkspaceFiles(workspaceId, toSave);
      sourcePublication.track(saveWorkspaceFiles(workspaceId, toSave)).catch(() => {});
      sourcePublication.issue(() => saveWorkspaceFiles(workspaceId, toSave)).catch(() => {});
      saveWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles));
      sourcePublication.track(saveWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles))).catch(() => {});
      sourcePublication.issue(() => saveWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles))).catch(() => {});
      // saveWorkspaceFiles(workspaceId, commentOnly);
      const explanation = 'saveWorkspaceFiles(workspaceId, stringOnly)';
    `);
    expect([...calls]).toEqual([
      ['saveWorkspaceFiles | workspaceId, toSave', 3],
      ['saveWorkspaceFiles | workspaceId, Object.fromEntries(writtenFiles)', 3],
    ]);
  });

  it('a duplicated classified write in the actual route still fails the original multiplicity audit', () => {
    const calls = durableWrites(`${route}\nsourcePublication.track(saveWorkspaceFiles(workspaceId, persisted));`);
    const changed = [...calls.entries()].filter(([key, count]) => VERDICT[key] && VERDICT[key][1] !== count)
      .map(([key, count]) => `${key} ×${count}`);
    expect(changed).toEqual(['saveWorkspaceFiles | workspaceId, persisted ×2']);
  });

  it('a genuinely new save in the actual route still requires its own green-freeze verdict', () => {
    const calls = durableWrites(`${route}\nsourcePublication.issue(() => saveWorkspaceFiles(workspaceId, newUnreviewedPayload));`);
    expect([...calls.keys()].filter((key) => !(key in VERDICT)))
      .toEqual(['saveWorkspaceFiles | workspaceId, newUnreviewedPayload']);
  });
  it('the final save follows applied restore outcomes rather than the planned snapshot', () => {
    const start = route.indexOf("} else if (decision.action === 'restore')");
    const end = route.indexOf('const finalSave =', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const restore = route.slice(start, end);
    expect(restore).toContain('const outcome = await applyGreenSnapshotRestore(plan)');
    expect(restore).toContain('persisted = snapshotRestoredFiles(toSave, plan, outcome)');
    expect(route.slice(end, route.indexOf('\n', end))).toContain('saveWorkspaceFiles(workspaceId, persisted)');
  });
});
