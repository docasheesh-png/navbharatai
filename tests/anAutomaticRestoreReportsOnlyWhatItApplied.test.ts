import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { ALL_ABORT_CAUSES, abortBuild } from '../src/server/AgentV3/buildAbortCause';
import { buildRemoveCommand } from '../src/server/AgentV3/GreenGuard';
import { applySnapshotRestore, snapshotRestoreComplete, snapshotRestoredFiles, snapshotRestoreStopped, type SnapshotRestoreDeps, type SnapshotRestorePlan } from '../src/server/AgentV3/snapshotRestore';
import { verifyAfterFix } from '../src/server/AgentV3/verifyAfterFix';
import { isAppFinding, PROCESS_ONLY_CODES } from '../src/server/AgentV3/BuildDiagnostics';

function pending() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

const RESTORE_NAME = /restore|revert|rollback/i;

function mayNameRestore(text: string): boolean {
  if (RESTORE_NAME.test(text)) return true;
  if (!text.includes('\\')) return false;
  // Encoded characters (including malformed possible encodings) always need the AST. Remaining
  // escapes can only retain their next character, insert a control character or continue a line:
  // removing the slash/continuation overincludes those names instead of hiding an identity escape.
  if (/\\(?:[ux]|[0-7])/i.test(text)) return true;
  return RESTORE_NAME.test(text.replace(/\\(?:\r\n|[\r\n\u2028\u2029])/g, '').replace(/\\/g, ''));
}

function restoreMutations(path: string, text: string, parsed?: ts.SourceFile): Array<{ key: string; body: string }> {
  if (!mayNameRestore(text)) return [];
  const file = parsed ?? ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: Array<{ key: string; body: string }> = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      const parent = node.parent;
      const named = node.name ?? ((ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) ? parent.name : undefined);
      const literalName = named && ts.isComputedPropertyName(named) ? named.expression : named;
      // Identifier/string .text decodes escaped spellings such as res\u0074ore. Other names retain
      // the previous raw-text check, so this optimisation cannot narrow the existing census.
      const name = literalName && (ts.isIdentifier(literalName) || ts.isStringLiteralLike(literalName))
        ? literalName.text : named?.getText(file);
      if (name && RESTORE_NAME.test(name)) {
        let mutates = false;
        function calls(child: ts.Node) {
          if (ts.isCallExpression(child) && /(?:\.(?:writeFiles?|writeBinaryFile|removeFile|runCommand|write|remove|execInContainer|run|restore|git)|(?:^|\.)apply(?:Green)?SnapshotRestore|writeWorkspaceFiles|mergeWorkspaceFiles|saveWorkspaceFiles|removeWorkspaceFiles|execPromise)$/.test(child.expression.getText(file))) mutates = true;
          ts.forEachChild(child, calls);
        }
        calls(node.body);
        if (mutates) found.push({ key: `${path}#${name}`, body: node.getText(file) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

describe('an automatic restore reports only what it applied', () => {
  it('a real failed rm keeps that file in captured and durable state while other operations land', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'snapshot-restore-'));
    try {
      mkdirSync(join(dir, 'public/sw.js'), { recursive: true }); // rm -f of a directory fails, no mock verdict.
      writeFileSync(join(dir, 'index.html'), 'broken');
      writeFileSync(join(dir, 'extra.js'), 'broken addition');
      const captured: Record<string, string> = { 'index.html': 'broken', 'public/sw.js': 'kept', 'extra.js': 'broken addition' };
      const durable = { ...captured };
      const forgotten: string[][] = [];
      const plan = { write: { 'index.html': 'green' }, remove: ['public/sw.js', 'extra.js'] };
      const outcome = await applySnapshotRestore(plan, {
        stopped: () => false,
        write: async (path, content) => { writeFileSync(join(dir, path), content); },
        remove: async (path) => ({ exitCode: spawnSync('sh', ['-c', buildRemoveCommand([path])], { cwd: dir }).status ?? 1 }),
        captured: (applied) => { Object.assign(captured, applied.write); applied.remove.forEach((p) => { delete captured[p]; }); },
        persist: async (files) => { Object.assign(durable, files); return true; },
        forget: async (paths) => { forgotten.push([...paths]); paths.forEach((p) => { delete durable[p]; }); return true; },
      });
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe('green');
      expect(existsSync(join(dir, 'public/sw.js'))).toBe(true);
      expect(existsSync(join(dir, 'extra.js'))).toBe(false);
      expect(outcome).toEqual({ restored: ['index.html'], removed: ['extra.js'], failed: ['public/sw.js'], stopped: false });
      expect(snapshotRestoreComplete(plan, outcome)).toBe(false);
      expect(forgotten).toEqual([['extra.js']]);
      expect(captured).toEqual({ 'index.html': 'green', 'public/sw.js': 'kept' });
      expect(durable).toEqual(captured);
      expect(snapshotRestoredFiles({ 'index.html': 'broken', 'public/sw.js': 'kept', 'extra.js': 'broken addition' }, plan, outcome)).toEqual(captured);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('Stop during an in-flight restore records the landed write and refuses every later mutation', async () => {
    const started = pending();
    const writing = pending();
    let stopped = false;
    const sandbox: Record<string, string> = { a: 'broken', b: 'broken', extra: 'new' };
    const recorded: SnapshotRestorePlan[] = [];
    const effects: string[] = [];
    const running = applySnapshotRestore({ write: { a: 'green', b: 'green' }, remove: ['extra'] }, {
      stopped: () => stopped,
      write: async (path, content) => { effects.push(`write:${path}`); started.release(); await writing.promise; sandbox[path] = content; },
      remove: async () => { effects.push('remove'); return { exitCode: 0 }; },
      captured: (p) => recorded.push(p),
      persist: async () => { effects.push('persist'); return true; },
      forget: async () => { effects.push('forget'); return true; },
    });
    await started.promise;
    stopped = true;
    writing.release();
    const outcome = await running;
    expect(effects).toEqual(['write:a']);
    expect(sandbox).toEqual({ a: 'green', b: 'broken', extra: 'new' });
    expect(recorded).toEqual([{ write: { a: 'green' }, remove: [] }]);
    expect(outcome.stopped).toBe(true);
    expect(new Set(outcome.failed)).toEqual(new Set(['a', 'b', 'extra']));
  });

  it('Stop during persistence holds the following durable deletion', async () => {
    const started = pending();
    const saving = pending();
    let stopped = false;
    let forgot = false;
    const running = applySnapshotRestore({ write: { a: 'green' }, remove: ['extra'] }, {
      stopped: () => stopped, write: async () => {}, remove: async () => ({ exitCode: 0 }),
      persist: async () => { started.release(); await saving.promise; return true; },
      forget: async () => { forgot = true; return true; },
    });
    await started.promise;
    stopped = true;
    saving.release();
    const outcome = await running;
    expect(forgot).toBe(false);
    expect(outcome).toMatchObject({ restored: ['a'], removed: ['extra'], failed: ['extra'], stopped: true });
  });

  it('a failed durable write cannot certify a complete rollback', async () => {
    const plan = { write: { a: 'green' }, remove: [] };
    const outcome = await applySnapshotRestore(plan, {
      stopped: () => false, write: async () => {}, remove: async () => ({ exitCode: 0 }), persist: async () => false,
    });
    expect(outcome).toMatchObject({ restored: ['a'], failed: ['a'] });
    expect(snapshotRestoreComplete(plan, outcome)).toBe(false);
  });

  it('the verified-repair net reports failed rollback instead of reverted when one write fails', async () => {
    const restoreIo: SnapshotRestoreDeps = { stopped: () => false, write: async () => { throw new Error('read-only file'); }, remove: async () => ({ exitCode: 0 }) };
    const result = await verifyAfterFix({
      snapshot: async () => ({ write: { a: 'green' }, remove: [] }),
      apply: async () => {}, reverify: async () => false,
      revert: async (plan) => { const outcome = await applySnapshotRestore(plan, restoreIo); if (!snapshotRestoreComplete(plan, outcome)) throw new Error('restore incomplete'); },
    });
    expect(result).toEqual({ kept: false, reverted: false, unverified: false });
  });

  it('never reports unsafe or capped-out removals as applied', async () => {
    const calls: string[] = [];
    const plan = { write: {}, remove: ['../outside', ...Array.from({ length: 201 }, (_, i) => `extra${i}`)] };
    const outcome = await applySnapshotRestore(plan, { stopped: () => false, write: async () => {}, remove: async (path) => { calls.push(path); return { exitCode: 0 }; } });
    expect(calls).toHaveLength(200);
    expect(calls).not.toContain('../outside');
    expect(outcome.failed).toEqual(['../outside', 'extra200']);
    expect(snapshotRestoreComplete(plan, outcome)).toBe(false);
  });

  it('allows safety recovery after a budget expires, while every ownership-loss cause holds writes', () => {
    const recoveryBudgets = new Set(['watchdog', 'advisory-cap', 'cost-cap', 'review-budget', 'recheck-budget', 'repair-budget']);
    for (const cause of ALL_ABORT_CAUSES) {
      const abort = new AbortController();
      expect(snapshotRestoreStopped(abort.signal)).toBe(false);
      abortBuild(abort, cause);
      expect(snapshotRestoreStopped(abort.signal), cause).toBe(!recoveryBudgets.has(cause));
    }
  });

  it('keeps rollback-confirmation failures visible as platform diagnostics rather than app blockers', () => {
    for (const code of ['POST_GREEN_ROLLBACK_INCOMPLETE', 'GREEN_GUARD_RESTORE_INCOMPLETE', 'DESIGN_HEAL_RESTORE_INCOMPLETE', 'UNUSED_DEPS_RESTORE_INCOMPLETE', 'DEAD_SALVAGE_RESTORE_INCOMPLETE']) {
      expect(PROCESS_ONLY_CODES.has(code), code).toBe(true);
      for (const phase of ['build', 'preview', 'readiness']) expect(isAppFinding({ phase, code }), `${phase}:${code}`).toBe(false);
    }
  });
});

describe('automatic restore caller census', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const source = ts.createSourceFile('agentv3.ts', route, ts.ScriptTarget.Latest, true);

  it.each([
    ['Unicode identifier', String.raw`async function res\u0074oreEscaped() { await io.writeFile('a', 'green'); }`, 'restoreEscaped'],
    ['hex string property', String.raw`const helpers = { 're\x76ertEscaped': async () => { await io.runCommand('undo'); } };`, 'revertEscaped'],
    ['computed Unicode property', String.raw`const helpers = { ['roll\u0062ackEscaped']: async () => { await io.removeFile('extra'); } };`, 'rollbackEscaped'],
    ['identity escape', String.raw`const helpers = { 'rest\oreIdentity': async () => { await io.writeFile('a', 'green'); } };`, 'restoreIdentity'],
    ['legacy octal escape', String.raw`const helpers = { 'res\164oreOctal': async () => { await io.writeFile('a', 'green'); } };`, 'restoreOctal'],
    ['continued string', String.raw`const helpers = { 're\
vertContinued': async () => { await io.writeFile('a', 'green'); } };`, 'revertContinued'],
  ])('the census still finds a mutation with a %s name', (_label, escaped, name) => {
    expect(restoreMutations('escaped.ts', escaped).map((entry) => entry.key)).toEqual([`escaped.ts#${name}`]);
  });
  it('every route restore planner uses applied outcomes or the explicitly checked version restore', () => {
    let plans = 0;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'restorePlan') {
        plans++;
        let block: ts.Node = node;
        while (block.parent && !ts.isBlock(block)) block = block.parent;
        const body = block.getText(source);
        if (body.includes('applyGreenSnapshotRestore(plan)')) {
          expect(body).toContain('snapshotRestoreComplete(plan, outcome)');
        } else {
          expect(body).toContain("runInPass('version-restore'");
          expect(body).toContain('removed = r.exitCode === 0');
          expect(body).toContain('removable.length === sb.remove.length');
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(plans).toBe(3);
  });

  it('finishing uses the same restore door with a live all-abort gate, and the final save uses the applied tree', () => {
    expect(route).toContain('restore: (plan) => applyGreenSnapshotRestore(plan, () => abort.signal.aborted, noteFinishingWrite)');
    expect(route).toContain('persisted = snapshotRestoredFiles(toSave, plan, outcome)');
    expect(route).toContain('saveWorkspaceFiles(workspaceId, persisted)');
    expect(route).not.toContain('reconcileCapturedWrites(writtenFiles, plan)');
    expect(route).not.toContain('for (const path of plan.remove) writtenFiles.delete(path)');
    expect(route).toContain('reconcileCapturedWrites(writtenFiles, { ...applied, unchanged: 0 })');
  });

  it('the private design-heal undo also checks the applied result before claiming restoration', () => {
    const start = route.indexOf('const verdict = designHealDecision(');
    const end = route.indexOf("await restoreKitRules(", start);
    const undo = route.slice(start, end);
    expect(undo).toContain("applyGreenSnapshotRestore(revertPlan, undefined, undefined, 'design-heal-revert')");
    expect(undo).toContain('snapshotRestoreComplete(revertPlan, outcome)');
    expect(undo).not.toContain('writtenFiles.set(path, original)');
    expect(undo).not.toContain('mergeWorkspaceFiles(');
  });

  it('classifies every I/O-bearing restore, revert and rollback function across src, including private helpers', () => {
    // Exact bodies, not a filename search: rollbackTouched and anonymous `restore` properties were
    // the siblings a search for only restorePlan missed. Non-undo restorers stay explicitly named.
    const policies: Record<string, string[]> = {
      'src/server/AgentV3/EndgameRepair.ts#rollbackTouched': ['applySnapshotRestore', 'snapshotRestoreComplete'],
      'src/server/AgentV3/GitManager.ts#restore': ['return r.exitCode === 0'],
      'src/server/AgentV3/WorkspaceRegistry.ts#restoreSessionDetailed': ['await raw.git.restore(sha)', 'await git.restore(sha)'],
      'src/server/AgentV3/WorkspaceRegistry.ts#restoreSession': ['return session.git.restore(sha)'],
      'src/server/AgentV3/deadSalvage.ts#restore': ['applySnapshotRestore', 'snapshotRestoreComplete'],
      'src/server/AgentV3/unusedDepPrune.ts#restore': ['snapshotRestoreStopped(io.signal)', 'restored.exitCode === 0', 'cmp -s'],
      'src/server/lib/mobileShipRealBuild.ts#restore': ['applySnapshotRestore', 'snapshotRestoreComplete', 'blocked: true'],
      'src/server/AgentV3/snapshotRestore.ts#applySnapshotRestore': ['if (d.stopped()) break', 'result.exitCode !== 0', 'await d.persist(landed)', 'await d.forget(removed)'],
      'src/server/routes/agentv3.ts#applyGreenSnapshotRestore': ['applySnapshotRestore', 'snapshotRestoreStopped(abort.signal)', 'reconcileCapturedWrites(writtenFiles, { ...applied, unchanged: 0 })'],
      'src/server/routes/agentv3.ts#revertToGreenSnapshot': ['applyGreenSnapshotRestore', 'snapshotRestoreComplete'],
      'src/server/routes/agentv3.ts#restore': ['applyGreenSnapshotRestore(plan, () => abort.signal.aborted'],
      // Different domains: checked git/tar restore; fresh-machine refill; deterministic kit repair;
      // and constructing a new, detached VFS. They never claim that a swallowed rollback completed.
      'src/server/AgentV3/sandbox/EngineerAI/actuators/DockerActuator.ts#restore': ['result.exitCode !== 0', 'throw new Error'],
      'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts#restore': ['result.exitCode !== 0', 'throw new Error'],
      'src/server/AgentV3/sandbox/EngineerAI/actuators/LocalActuator.ts#restore': ['await execPromise('],
      'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts#_restoreEmptyManifest': ['pickManifestRestore', 'if (restore) await sandbox.files.write'],
      'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts#_restoreFreshSandbox': ['outcome.restored = landed.written.length', 'restoreFailed(outcome)'],
      'src/server/routes/agentv3.ts#restoreKitRules': ['finishingGuard.writeOrThrow', 'if (!wrote) return'],
      'src/server/project/VersionStore.ts#restore': ['const vfs = new VirtualFileSystem()', 'return vfs'],
    };
    const found = new Set<string>();
    function scan(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { scan(path); continue; }
        if (!/\.[cm]?tsx?$/.test(path) || /\.(?:test|spec)\.[^.]+$/.test(path)) continue;
        const text = path === 'src/server/routes/agentv3.ts' ? route : readFileSync(path, 'utf8');
        for (const { key, body } of restoreMutations(path, text, path === 'src/server/routes/agentv3.ts' ? source : undefined)) {
          found.add(key);
          expect(policies[key], `Unclassified restore mutation: ${key}`).toBeDefined();
          // The default live gate can be a function parameter, so inspect the whole function.
          for (const required of policies[key] ?? []) expect(body, key).toContain(required);
        }
      }
    }
    scan('src');
    expect([...found].sort()).toEqual(Object.keys(policies).sort());
  });
});
