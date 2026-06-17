import { describe, it, expect, vi } from 'vitest';
import { parseFileEdits, makeAiEditGenerator } from '../src/server/project/aiEdits';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

describe('parseFileEdits', () => {
  it('parses a bare JSON array', () => {
    const edits = parseFileEdits('[{"op":"write","path":"a.ts","content":"x"}]');
    expect(edits).toEqual([{ op: 'write', path: 'a.ts', content: 'x' }]);
  });

  it('strips ```json fences and surrounding prose', () => {
    const raw = 'Sure! Here are the edits:\n```json\n[{"op":"delete","path":"old.ts"}]\n```\nDone.';
    expect(parseFileEdits(raw)).toEqual([{ op: 'delete', path: 'old.ts' }]);
  });

  it('accepts an {edits:[...]} wrapper object', () => {
    const edits = parseFileEdits('{"edits":[{"op":"rename","path":"a","to":"b"}]}');
    expect(edits).toEqual([{ op: 'rename', path: 'a', to: 'b' }]);
  });

  it('drops malformed ops but keeps valid ones', () => {
    const raw = JSON.stringify([
      { op: 'write', path: 'good.ts', content: 'ok' },
      { op: 'write', path: 'nocontent.ts' },          // invalid: missing content
      { op: 'bogus', path: 'x' },                      // invalid op
      { op: 'patch', path: 'p.ts', find: 'a', replace: 'b' },
    ]);
    expect(parseFileEdits(raw)).toEqual([
      { op: 'write', path: 'good.ts', content: 'ok' },
      { op: 'patch', path: 'p.ts', find: 'a', replace: 'b', count: undefined },
    ]);
  });

  it('returns [] for junk', () => {
    expect(parseFileEdits('no json here')).toEqual([]);
    expect(parseFileEdits('')).toEqual([]);
  });
});

describe('makeAiEditGenerator', () => {
  it('treats the TypeScript scaffold (src/App.tsx) as a fresh build, not an edit', async () => {
    // Regression: a vite-react-ts scaffold must take the plan→batch from-scratch
    // path (spec/architect calls), NOT the single-shot "minimal edit" path.
    const callModel = vi.fn()
      .mockResolvedValueOnce('{"appType":"app","modules":["auth"],"pages":["Login"],"entities":["User"]}')
      .mockResolvedValueOnce('{"entry":"index.html","files":[{"path":"src/App.tsx","purpose":"root"},{"path":"src/pages/Login.tsx","purpose":"login"}]}')
      .mockResolvedValue('[{"op":"write","path":"src/App.tsx","content":"export default ()=>null"},{"op":"write","path":"src/pages/Login.tsx","content":"export default ()=>null"}]');
    const { generate } = makeAiEditGenerator(callModel);
    const tsScaffold = VirtualFileSystem.fromRecord({
      'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
      'src/main.tsx': "import App from './App';",
      'src/App.tsx': 'export default function App() {\n  return <h1>Hello from App</h1>;\n}',
      'tsconfig.json': '{}',
    });
    await generate('a typescript react app with auth', tsScaffold);
    // Took the from-scratch path: first call is the requirements analyst (spec).
    expect(callModel.mock.calls[0][0]).toContain('analyst');
    expect(callModel.mock.calls[1][0]).toContain('architect');
  });

  it('fresh build extracts a spec, plans the file tree, then generates in batches', async () => {
    // 1st call = requirement spec; 2nd = file plan; subsequent = batch write ops.
    const callModel = vi.fn()
      .mockResolvedValueOnce('{"appType":"board","modules":["tasks"],"pages":["Board"],"entities":["Task"]}')
      .mockResolvedValueOnce('{"entry":"index.html","files":[{"path":"index.html","purpose":"entry"},{"path":"src/App.jsx","purpose":"root"}]}')
      .mockResolvedValue('[{"op":"write","path":"index.html","content":"<div id=root></div>"},{"op":"write","path":"src/App.jsx","content":"export default ()=>null"}]');
    const { generate } = makeAiEditGenerator(callModel);
    const edits = await generate('a kanban board', VirtualFileSystem.fromRecord({}));
    // spec call first (analyst), then the architect plan call — both see the request
    expect(callModel.mock.calls[0][0]).toContain('analyst');
    expect(callModel.mock.calls[1][0]).toContain('architect');
    expect(callModel.mock.calls.some(c => String(c[1]).includes('a kanban board'))).toBe(true);
    // produced multiple files
    expect(edits.filter(e => e.op === 'write').length).toBeGreaterThanOrEqual(2);
    expect(edits.some(e => e.path === 'src/App.jsx')).toBe(true);
  });

  it('falls back to single-shot when the plan is not multi-file', async () => {
    // spec junk + plan junk → no usable plan → single-shot fresh build path
    const callModel = vi.fn()
      .mockResolvedValueOnce('no json here')   // spec
      .mockResolvedValueOnce('no json here')   // plan
      .mockResolvedValue('[{"op":"write","path":"index.html","content":"<h1>hi</h1>"}]');
    const { generate } = makeAiEditGenerator(callModel);
    const edits = await generate('make a page', VirtualFileSystem.fromRecord({}));
    expect(edits).toEqual([{ op: 'write', path: 'index.html', content: '<h1>hi</h1>' }]);
    // the single-shot call uses the from-scratch wording
    const lastUser = callModel.mock.calls[callModel.mock.calls.length - 1][1];
    expect(lastUser).toContain('from scratch');
  });

  it('generate includes existing file CONTENTS (not just paths) for edits', async () => {
    const callModel = vi.fn(async () => '[]');
    const { generate } = makeAiEditGenerator(callModel);
    // real (non-scaffold) project → surgical edit path, single call with contents
    const vfs = VirtualFileSystem.fromRecord({ 'index.html': '<h1>SENTINEL_CONTENT</h1>' });
    await generate('change the heading', vfs);
    expect(callModel.mock.calls[0][1]).toContain('SENTINEL_CONTENT');
  });

  it('fix returns [] when there are no issues (no model call)', async () => {
    const callModel = vi.fn(async () => '[]');
    const { fix } = makeAiEditGenerator(callModel);
    expect(await fix([], VirtualFileSystem.fromRecord({}))).toEqual([]);
    expect(callModel).not.toHaveBeenCalled();
  });
});
