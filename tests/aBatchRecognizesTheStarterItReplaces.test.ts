// Batch and single writes must agree about ownership, without changing any write protection.
// Execute the real batch case with in-memory ports; never import the dispatcher/provider graph.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import { isOurStarterFile, starterTemplates } from '../src/server/AgentV3/starterFragment';
import { assessFullRewrite } from '../src/server/AgentV3/rewriteRisk';
import { mapWithConcurrency } from '../src/server/AgentV3/asyncUtils';
import { isNotFoundError } from '../src/server/AgentV3/fsErrors';
import { SANDBOX_WORKSPACE_ROOT, toWorkspaceRelPath } from '../src/server/lib/workspacePath';
import { batchSizeNote } from '../src/server/AgentV3/batchSize';
import { duplicateModuleTarget } from '../src/server/AgentV3/ProjectIntegrityChecks';
import { isDestructiveEmptyOverwrite, emptyOverwriteMessage, wouldEraseUserSecrets, eraseUserSecretsMessage } from '../src/server/AgentV3/CommandGovernance';
import { resolveStringArg, missingArgMessage } from '../src/server/AgentV3/toolArgRepair';
import { injectPreviewBridge } from '../src/server/AgentV3/previewBridge';
import { strictTsconfig } from '../src/server/AgentV3/strictTrial';

const SOURCE = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
const AST = ts.createSourceFile('ToolDispatcher.ts', SOURCE, ts.ScriptTarget.Latest, true);
function findNode(predicate: (node: ts.Node) => boolean): ts.Node {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(AST);
  if (found.length !== 1) throw new Error(`Expected one production node, found ${found.length}`);
  return found[0];
}
const BATCH = findNode((n) => ts.isCaseClause(n) && ts.isStringLiteral(n.expression) && n.expression.text === 'write_files_batch').getText(AST);
const helper = (name: string) => findNode((n) => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(AST).replace(/^export\s+/, '');
const EXECUTABLE = transformSync(`
  ${helper('reqStr')}
  ${helper('topoSortBatch')}
  ${helper('batchRefusalText')}
  return async function(input) { const agent = 'architect'; switch ('write_files_batch') { ${BATCH} } };
`, { loader: 'ts' }).code;
const template = starterTemplates().find((t) => typeof t['src/App.tsx'] === 'string')!;
const OLD = template['src/App.tsx'];
const NEW = 'export default function App(){return <main>New app</main>}';
const USER = 'export const userOwned = true;\n' + '/* important user logic */\n'.repeat(60);
type Row = { path: string; content: string };
type Options = {
  first?: Record<string, string | Error>;
  final?: Record<string, string | null>;
  reject?: Record<string, string>;
  protectedPath?: string;
  ownershipThrows?: boolean;
  known?: string[];
};

async function run(files: Row[], options: Options = {}) {
  const calls: Array<{ path: string; content: string; opts: unknown }> = [];
  const changes: unknown[] = [];
  const diffs: unknown[] = [];
  const indexed: unknown[] = [];
  const embeddings: unknown[] = [];
  const checkpoints: string[] = [];
  const steering: unknown[] = [];
  const twins: string[] = [];
  const audits: string[] = [];
  const memory = { graph: () => ({ files: options.known ?? [] }), recordAudit: (s: string) => audits.push(s), indexFile: (...a: unknown[]) => indexed.push(a) };
  const deps = {
    resolveStringArg, missingArgMessage, mapWithConcurrency, isNotFoundError,
    isDestructiveEmptyOverwrite, emptyOverwriteMessage, wouldEraseUserSecrets, eraseUserSecretsMessage,
    isOurStarterFile: (...args: Parameters<typeof isOurStarterFile>) => {
      if (options.ownershipThrows) throw new Error('synthetic ownership lookup failure');
      return isOurStarterFile(...args);
    },
    starterTemplates, assessFullRewrite, toWorkspaceRelPath, SANDBOX_WORKSPACE_ROOT,
    duplicateModuleTarget, batchSizeNote,
    getWorkspaceMemory: () => memory,
    getEmbeddingStore: () => ({ addFile: async (...a: unknown[]) => { embeddings.push(a); } }),
    boundedWholeFileDiff: (before: string, after: string) => JSON.stringify({ before, after }),
    refuse: (message: string) => { throw new Error(message); },
  };
  const context = {
    workspaceId: 'synthetic-workspace',
    assertWritable: (path: string) => { if (path === options.protectedPath) throw new Error('protected path'); },
    assertTextWritable: () => {},
    actuator: { readFile: async (_: string, path: string) => {
      const value = options.first?.[path];
      if (value instanceof Error) throw value;
      if (typeof value === 'string') return value;
      throw Object.assign(new Error('missing file'), { code: 'ENOENT' });
    } },
    duplicateModuleRefusal: () => null,
    guardedWrite: async (path: string, content: string, opts: unknown) => {
      calls.push({ path, content, opts });
      if (options.reject?.[path]) throw new Error(options.reject[path]);
      const final = options.final && Object.hasOwn(options.final, path) ? options.final[path] : options.first?.[path];
      return { kind: typeof final === 'string' ? 'modify' : 'create', existingContent: typeof final === 'string' ? final : '', content, kitNote: '|kit|' };
    },
    state: { recordFileChange: (...a: unknown[]) => changes.push(a) },
    events: { emit: (event: unknown) => diffs.push(event) },
    scheduleCheckpoint: (s: string) => checkpoints.push(s),
    writeSteeringNotes: async (record: unknown) => { steering.push(record); return '|steering|'; },
    removeShadowTwins: async (path: string) => { twins.push(path); return '|twin|'; },
  };
  const dispatch = new Function(...Object.keys(deps), EXECUTABLE)(...Object.values(deps));
  let text = '', error = '';
  try { text = await dispatch.call(context, { files }); } catch (e) { error = (e as Error).message; }
  return { text, error, calls, changes, diffs, indexed, embeddings, checkpoints, steering, twins, audits };
}

describe('batch warnings use the same proven starter ownership as single writes', () => {
  it('keeps the whole-rewrite caller census explicit so a new door requires a parity review', () => {
    const callers: string[] = [];
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { scan(path); continue; }
        if (!/\.tsx?$/.test(path) || /\.(test|d)\.tsx?$/.test(path)) continue;
        const source = readFileSync(path, 'utf8');
        if (!source.includes('assessFullRewrite')) continue;
        const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'assessFullRewrite') callers.push(path);
          ts.forEachChild(node, visit);
        };
        visit(ast);
      }
    };
    scan('src/server');
    expect(callers.sort()).toEqual(['src/server/AgentV3/ToolDispatcher.ts', 'src/server/AgentV3/ToolDispatcher.ts']);
  });
  it('replaces an untouched starter without claiming user-code loss, retaining every success hook', async () => {
    const r = await run([{ path: 'src/App.tsx', content: NEW }], { first: { 'src/App.tsx': OLD } });
    expect(r.error).toBe('');
    expect(r.text).not.toMatch(/FULL-REWRITE WARNING|LIKELY CONTENT LOSS/);
    expect(r.text).toContain('Wrote 1 file(s)');
    expect(r.text).toContain('|steering||kit||twin|');
    expect(r.calls).toEqual([{ path: 'src/App.tsx', content: NEW, opts: { agent: 'architect', source: 'write_files_batch', allowOverwrite: true } }]);
    expect(r.changes).toEqual([[{ path: 'src/App.tsx', kind: 'modify' }, 'architect']]);
    expect(r.diffs).toMatchObject([{ diff: { path: 'src/App.tsx', patch: JSON.stringify({ before: OLD, after: NEW }) } }]);
    expect(r.indexed).toEqual([['src/App.tsx', NEW]]);
    expect(r.embeddings).toEqual([['src/App.tsx', NEW]]);
    expect(r.checkpoints).toHaveLength(1);
    expect(r.steering).toEqual([{ 'src/App.tsx': NEW }]);
    expect(r.twins).toEqual(['src/App.tsx']);
  });
  it.each(['./src/App.tsx', `${SANDBOX_WORKSPACE_ROOT}/src/App.tsx`])('recognizes canonical guarded path %s', async (path) => {
    const r = await run([{ path, content: NEW }], { first: { [path]: OLD } });
    expect(r.error).toBe('');
    expect(r.text).not.toMatch(/FULL-REWRITE WARNING|LIKELY CONTENT LOSS/);
  });
  it('recognizes a known historical starter through the same existing predicate', async () => {
    const oldCss = gunzipSync(readFileSync('tests/fixtures/designKitBeforeThemeSwitch.css.gz')).toString('utf8');
    expect(isOurStarterFile('src/index.css', oldCss, starterTemplates())).toBe(true);
    const r = await run([{ path: 'src/index.css', content: '.app{color:red}' }], { first: { 'src/index.css': oldCss } });
    expect(r.error).toBe('');
    expect(r.text).not.toMatch(/FULL-REWRITE WARNING|LIKELY CONTENT LOSS/);
  });
  it.each([
    { label: 'line endings and outer whitespace', path: 'src/App.tsx', before: `\n${OLD.replace(/\n/g, '\r\n')}\n` },
    { label: 'injected preview bridge', path: 'index.html', before: injectPreviewBridge(template['index.html']) },
    { label: 'strict starter tsconfig', path: 'tsconfig.json', before: strictTsconfig(template['tsconfig.json']) },
  ])('retains the existing ownership normalization: $label', async ({ path, before }) => {
    expect(isOurStarterFile(path, before, starterTemplates())).toBe(true);
    const r = await run([{ path, content: 'new nonempty content' }], { first: { [path]: before } });
    expect(r.error).toBe('');
    expect(r.text).not.toMatch(/FULL-REWRITE WARNING|LIKELY CONTENT LOSS/);
  });
  it.each([['edited starter', OLD + '\n// user edit'.repeat(60)], ['user code', USER]])('still warns on %s', async (_label, previous) => {
    expect(assessFullRewrite(previous, NEW).level).toBe('shrink');
    expect(isOurStarterFile('src/App.tsx', previous, starterTemplates())).toBe(false);
    const r = await run([{ path: 'src/App.tsx', content: NEW }], { first: { 'src/App.tsx': previous } });
    expect(r.text).toContain('FULL-REWRITE WARNING');
    expect(r.text).toContain('LIKELY CONTENT LOSS');
  });
  it('does not infer ownership from matching bytes at an unknown path', async () => {
    const r = await run([{ path: 'src/User.tsx', content: NEW }], { first: { 'src/User.tsx': OLD } });
    expect(r.text).toContain('FULL-REWRITE WARNING');
  });
  it.each([
    { first: OLD, final: USER, warn: true },
    { first: USER, final: OLD, warn: false },
  ])('uses guardedWrite preimage, never stale preliminary content ($warn)', async ({ first, final, warn }) => {
    const r = await run([{ path: 'src/App.tsx', content: NEW }], { first: { 'src/App.tsx': first }, final: { 'src/App.tsx': final } });
    expect(r.error).toBe('');
    expect(r.text.includes('FULL-REWRITE WARNING')).toBe(warn);
    expect(r.text.includes('LIKELY CONTENT LOSS')).toBe(warn);
  });
  it('preserves genuine non-shrinking full-rewrite warnings without escalating them', async () => {
    const r = await run([{ path: 'src/User.tsx', content: USER + '\n// extended' }], { first: { 'src/User.tsx': USER } });
    expect(r.text).toContain('FULL-REWRITE WARNING');
    expect(r.text).not.toContain('LIKELY CONTENT LOSS');
  });
  it('uses guarded create/modify status when the first probe differs', async () => {
    const appeared = await run([{ path: 'src/App.tsx', content: NEW }], { final: { 'src/App.tsx': USER } });
    expect(appeared.text).toContain('LIKELY CONTENT LOSS');
    expect(appeared.changes).toEqual([[{ path: 'src/App.tsx', kind: 'modify' }, 'architect']]);
    const disappeared = await run([{ path: 'src/App.tsx', content: NEW }], { first: { 'src/App.tsx': USER }, final: { 'src/App.tsx': null } });
    expect(disappeared.text).not.toMatch(/FULL-REWRITE WARNING|LIKELY CONTENT LOSS/);
    expect(disappeared.changes).toEqual([[{ path: 'src/App.tsx', kind: 'create' }, 'architect']]);
  });
  it('does not warn for a newly created file', async () => {
    const r = await run([{ path: 'src/New.tsx', content: NEW }]);
    expect(r.error).toBe('');
    expect(r.text).not.toMatch(/FULL-REWRITE WARNING|LIKELY CONTENT LOSS/);
    expect(r.changes).toEqual([[{ path: 'src/New.tsx', kind: 'create' }, 'architect']]);
  });
  it('keeps unproven ownership warnings if only the advisory lookup throws', async () => {
    const r = await run([{ path: 'src/App.tsx', content: NEW }], { first: { 'src/App.tsx': USER }, ownershipThrows: true });
    expect(r.error).toBe('');
    expect(r.text).toContain('FULL-REWRITE WARNING');
    expect(r.text).toContain('LIKELY CONTENT LOSS');
    expect(r.indexed).toHaveLength(1);
  });
  it('counts only user-code modifications in a mixed batch and checkpoints once', async () => {
    const r = await run([
      { path: 'src/App.tsx', content: NEW }, { path: 'src/User.tsx', content: NEW }, { path: 'src/New.tsx', content: NEW },
    ], { first: { 'src/App.tsx': OLD, 'src/User.tsx': USER } });
    expect(r.text).toContain('Wrote 3 file(s)');
    expect(r.text).toContain('FULL-REWRITE WARNING: 1');
    expect(r.text).toContain('LIKELY CONTENT LOSS: 1');
    expect(r.text).toMatch(/REPLACED wholesale \(src\/User.tsx\)/);
    expect(r.checkpoints).toHaveLength(1);
    expect(r.changes).toHaveLength(3);
  });
});

describe('classification never bypasses existing batch refusal and preservation paths', () => {
  it('retains last-write-wins deduplication', async () => {
    const r = await run([{ path: 'src/App.tsx', content: 'discarded' }, { path: 'src/App.tsx', content: NEW }], { first: { 'src/App.tsx': OLD } });
    expect(r.error).toBe('');
    expect(r.calls.map((c) => c.content)).toEqual([NEW]);
  });
  it('refuses a destructive empty overwrite even when the preimage is ours', async () => {
    const r = await run([{ path: 'src/App.tsx', content: ' ' }], { first: { 'src/App.tsx': OLD } });
    expect(r.error).toMatch(/^Not written/);
    expect(r.calls).toEqual([]);
    expect(r.indexed).toEqual([]);
  });
  it('fails the whole batch before any write when a protected path is present', async () => {
    const r = await run([{ path: 'src/App.tsx', content: NEW }, { path: 'protected.ts', content: NEW }], { protectedPath: 'protected.ts' });
    expect(r.error).toBe('protected path');
    expect(r.calls).toEqual([]);
  });
  it('refuses a non-ENOENT read failure without making a create assumption', async () => {
    const r = await run([{ path: 'src/App.tsx', content: NEW }], { first: { 'src/App.tsx': new Error('connection lost') } });
    expect(r.error).toMatch(/^Not written/);
    expect(r.error).toContain('Could not read');
    expect(r.calls).toEqual([]);
  });
  it.each(['parse guard refused', 'second read failed', 'write failed'])('preserves guardedWrite refusal: %s', async (failure) => {
    const r = await run([{ path: 'src/App.tsx', content: NEW }], { first: { 'src/App.tsx': OLD }, reject: { 'src/App.tsx': failure } });
    expect(r.error).toMatch(/^Not written/);
    expect(r.error).toContain(failure);
    expect(r.changes).toEqual([]);
    expect(r.indexed).toEqual([]);
  });
  it('keeps partial refusal first and successful starter writes visible', async () => {
    const r = await run([{ path: 'src/App.tsx', content: NEW }, { path: 'src/Failed.tsx', content: NEW }], { first: { 'src/App.tsx': OLD }, reject: { 'src/Failed.tsx': 'synthetic refusal' } });
    expect(r.error.split('\n')[0]).toContain('src/Failed.tsx — synthetic refusal');
    expect(r.error).toContain('Written (do not rewrite these): src/App.tsx');
    expect(r.error).not.toMatch(/FULL-REWRITE WARNING|LIKELY CONTENT LOSS/);
    expect(r.changes).toHaveLength(1);
  });
  it('still refuses to erase a secret before reaching the write port', async () => {
    const r = await run([{ path: '.env', content: 'OTHER=value' }], { first: { '.env': 'APP_SECRET=synthetic-fixture-only' } });
    expect(r.error).toMatch(/^Not written/);
    expect(r.calls).toEqual([]);
  });
  it('retains duplicate-module skipping independently of ownership', async () => {
    const r = await run([{ path: 'src/app/Page.tsx', content: NEW }], { known: ['app/Page.tsx'] });
    expect(r.calls).toEqual([]);
    expect(r.text).toContain('DUPLICATE MODULE BLOCKED');
  });
});
