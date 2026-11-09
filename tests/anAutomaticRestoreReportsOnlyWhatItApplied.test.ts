import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { restoreMutations } from './helpers/restoreMutationCensus';
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

type RestoreCensusFile = { path: string; mutations: ReturnType<typeof restoreMutations> };

/** Fail closed if the child omitted a file, stopped early, or returned incomplete evidence. */
function decodeRestoreCensusOutput(stdout: string, paths: readonly string[]): RestoreCensusFile[] {
  const payload: unknown = JSON.parse(stdout);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid restore census response');
  const result = payload as Record<string, unknown>;
  if (result.version !== 1 || result.completed !== true || !Array.isArray(result.files)
    || result.files.length !== paths.length) throw new Error('Incomplete restore census response');
  for (let i = 0; i < paths.length; i++) {
    const value: unknown = result.files[i];
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid restore census file ${i}`);
    const file = value as Record<string, unknown>;
    if (file.path !== paths[i] || !Array.isArray(file.mutations)) throw new Error(`Restore census inventory mismatch at ${i}`);
    for (const value of file.mutations) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid restore mutation in ${paths[i]}`);
      const mutation = value as Record<string, unknown>;
      if (typeof mutation.key !== 'string' || !mutation.key.startsWith(`${paths[i]}#`)
        || typeof mutation.body !== 'string') throw new Error(`Incomplete restore mutation in ${paths[i]}`);
    }
  }
  return result.files as RestoreCensusFile[];
}

function readRestoreCensus(paths: readonly string[], snapshots: Record<string, string> = {}): RestoreCensusFile[] {
  // Only this test's source parser runs outside Vitest's precise-coverage instrumentation. No app
  // module executes in the child. Every source file and full function body returns for assertions.
  // Keep the managed environment unchanged; never remove NODE_OPTIONS or coverage settings.
  const child = spawnSync(process.execPath, [
    '--experimental-strip-types', join(__dirname, 'helpers/restoreMutationCensusProcess.mjs'),
  ], {
    cwd: join(__dirname, '..'),
    env: process.env,
    input: JSON.stringify({ paths, snapshots }),
    encoding: 'utf8',
    shell: false,
    timeout: 15_000,
    killSignal: 'SIGKILL',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.error) throw new Error(`Restore census child failed: ${child.error.message}`);
  if (child.status !== 0 || child.signal !== null) {
    throw new Error(`Restore census child exited ${child.status}, signal ${child.signal}: ${child.stderr}`);
  }
  return decodeRestoreCensusOutput(child.stdout, paths);
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
    const parented = ts.createSourceFile('escaped.ts', escaped, ts.ScriptTarget.Latest, true);
    expect(restoreMutations('escaped.ts', escaped)).toEqual(restoreMutations('escaped.ts', escaped, parented));
  });
  it('still classifies nested restorers after an outer mutation and finds a late mutation', () => {
    const fixture = `
      async function restoreOuter() {
        await io.writeFile('first', 'green');
        async function revertNested() { await io.removeFile('extra'); }
        const rollbackNested = async () => { await io.runCommand('undo'); };
      }
      async function restoreLate() { inspect(); if (ready) await io.writeFile('late', 'green'); }
      async function restoreReadOnly() { inspect(); }
    `;
    expect(restoreMutations('nested.ts', fixture).map((entry) => entry.key)).toEqual([
      'nested.ts#restoreOuter', 'nested.ts#revertNested', 'nested.ts#rollbackNested', 'nested.ts#restoreLate',
    ]);
    const parented = ts.createSourceFile('nested.ts', fixture, ts.ScriptTarget.Latest, true);
    expect(restoreMutations('nested.ts', fixture)).toEqual(restoreMutations('nested.ts', fixture, parented));
  });

  it.each([
    ['expressions.ts', "const restoreArrow = async () => io.write('a'); const revertExpression = async function () { await io.remove('b'); }; const other = function rollbackNamed() { io.run('c'); };"],
    ['properties.ts', "const h = { restore: async () => io.write('a'), revert: async function () { await io.remove('b'); }, async rollback() { await io.run('c'); }, ['restoreComputed']: () => io.write('d'), [choose('revertDynamic')]: () => io.write('e') };"],
    ['class.ts', "class H { async restore() { await io.write('a'); } rollback = () => io.remove('b'); get revert() { return () => io.run('undo'); } }"],
    ['templates.ts', "const template = `value: ${function restoreTemplate() { io.write('a'); }}`; const h = { [`revertTemplate`]: () => io.remove('b') };"],
    ['view.tsx', "const view = <button onClick={function restoreClick() { io.write('a'); }}>{(() => { const rollbackChild = () => io.remove('b'); return 'x'; })()}</button>;"],
    ['recovered.ts', "const h = { ['restoreRecovered']: async () => { if (ready) io.write('a'); } ; async function rollbackOther() { io.run('b'); }"],
  ])('carried parents match TypeScript parent links for every result and body in %s', (path, fixture) => {
    const parented = ts.createSourceFile(path, fixture, ts.ScriptTarget.Latest, true);
    expect(restoreMutations(path, fixture)).toEqual(restoreMutations(path, fixture, parented));
  });

  it('the fresh process returns the same complete bodies as the parented detector for every fixture', () => {
    const fixtures: Array<[string, string]> = [
      ['src/server/routes/agentv3.ts', "async function restoreSnapshotOnly() { await io.write('snapshot'); }"],
      ['fixtures/empty.ts', 'export const value = 1;'],
      ['fixtures/nested.ts', "async function restoreOuter() { await io.write('a'); const revertNested = async () => io.remove('b'); async function rollbackNested() { await io.run('c'); } }"],
      ['fixtures/properties.ts', "const h = { restore: async function () { await io.write('a'); }, ['revertComputed']: () => io.remove('b'), [choose('rollbackDynamic')]: () => io.run('c') };"],
      ['fixtures/unicode.ts', String.raw`async function res\u0074oreEscaped() { await io.write('a'); }`],
      ['fixtures/hex.ts', String.raw`const h = { 're\x76ertHex': async () => io.remove('a') };`],
      ['fixtures/computed.ts', String.raw`const h = { ['roll\u0062ackComputed']: async () => io.run('a') };`],
      ['fixtures/identity.ts', String.raw`const h = { 'rest\oreIdentity': async () => io.write('a') };`],
      ['fixtures/octal.ts', String.raw`const h = { 'res\164oreOctal': async () => io.write('a') };`],
      ['fixtures/continued.ts', "const h = { 're\\\nvertContinued': async () => io.write('a') };"],
      ['fixtures/template.ts', "const value = `x: ${function restoreTemplate() { io.write('a'); }}`; const h = { [`revertTemplate`]: () => io.remove('b') };"],
      ['fixtures/view.tsx', "const view = <button onClick={function restoreClick() { io.write('a'); }}>{(() => { const rollbackChild = () => io.remove('b'); return 'x'; })()}</button>;"],
      ['fixtures/recovered.ts', "const h = { ['restoreRecovered']: () => { io.write('a'); } ; function rollbackOther() { io.run('b'); }"],
    ];
    const paths = fixtures.map(([path]) => path);
    const expected = fixtures.map(([path, text]) => ({
      path,
      mutations: restoreMutations(path, text, ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)),
    }));
    expect(expected[0].mutations.map(({ key }) => key)).toEqual(['src/server/routes/agentv3.ts#restoreSnapshotOnly']);
    expect(expected[1].mutations).toEqual([]);
    expect(readRestoreCensus(paths, Object.fromEntries(fixtures))).toEqual(expected);
  });

  it('rejects incomplete, reordered, corrupt or truncated child evidence', () => {
    const paths = ['fixtures/a.ts', 'fixtures/b.ts'];
    const first = { path: paths[0], mutations: [{ key: `${paths[0]}#restore`, body: "function restore() { io.write('a'); }" }] };
    const second = { path: paths[1], mutations: [] };
    const complete = { version: 1, completed: true, files: [first, second] };
    expect(decodeRestoreCensusOutput(JSON.stringify(complete), paths)).toEqual(complete.files);
    for (const invalid of [
      null,
      { ...complete, version: 2 },
      { ...complete, completed: false },
      { ...complete, files: [first] },
      { ...complete, files: [second, first] },
      { ...complete, files: [first, first] },
      { ...complete, files: [{ ...first, mutations: null }, second] },
      { ...complete, files: [{ ...first, mutations: [{ key: `${paths[0]}#restore` }] }, second] },
      { ...complete, files: [{ ...first, mutations: [{ key: `${paths[1]}#restore`, body: 'wrong path' }] }, second] },
    ]) expect(() => decodeRestoreCensusOutput(JSON.stringify(invalid), paths)).toThrow();
    expect(() => decodeRestoreCensusOutput('{"version":1,"completed":true,"files":[', paths)).toThrow();
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
    const paths: string[] = [];
    function scan(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { scan(path); continue; }
        if (!/\.[cm]?tsx?$/.test(path) || /\.(?:test|spec)\.[^.]+$/.test(path)) continue;
        paths.push(path);
      }
    }
    scan('src');
    // Preserve the exact enumeration and the same route snapshot used by the other source checks.
    // readRestoreCensus verifies one complete response per path, including files with no matches.
    for (const file of readRestoreCensus(paths, { 'src/server/routes/agentv3.ts': route })) {
      for (const { key, body } of file.mutations) {
        found.add(key);
        expect(policies[key], `Unclassified restore mutation: ${key}`).toBeDefined();
        // The default live gate can be a function parameter, so inspect the whole function.
        for (const required of policies[key] ?? []) expect(body, key).toContain(required);
      }
    }
    expect([...found].sort()).toEqual(Object.keys(policies).sort());
  });
});
