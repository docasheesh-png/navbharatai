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
  it('fresh build uses ONE from-scratch call when it delivers (no 504 call-storm)', async () => {
    // Single strong call returns multi-file edits → returned directly, no plan/batch.
    const callModel = vi.fn(async () => '[{"op":"write","path":"index.html","content":"<div id=root></div>"},{"op":"write","path":"src/App.jsx","content":"export default ()=>null"}]');
    const { generate } = makeAiEditGenerator(callModel);
    const edits = await generate('a kanban board', VirtualFileSystem.fromRecord({}));
    expect(callModel).toHaveBeenCalledTimes(1);                 // fast path = ONE call
    expect(callModel.mock.calls[0][1]).toContain('from scratch');
    expect(edits.filter(e => e.op === 'write').length).toBeGreaterThanOrEqual(2);
  });

  it('treats the TypeScript scaffold (src/App.tsx) as a fresh build, not an edit', async () => {
    // Regression: a vite-react-ts scaffold must take the from-scratch path
    // ("from scratch" wording), NOT the surgical "minimal edit" path.
    const callModel = vi.fn(async () => '[{"op":"write","path":"src/App.tsx","content":"export default ()=>null"},{"op":"write","path":"src/pages/Login.tsx","content":"export default ()=>null"}]');
    const { generate } = makeAiEditGenerator(callModel);
    const tsScaffold = VirtualFileSystem.fromRecord({
      'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
      'src/main.tsx': "import App from './App';",
      'src/App.tsx': 'export default function App() {\n  return <h1>Hello from App</h1>;\n}',
      'tsconfig.json': '{}',
    });
    await generate('a typescript react app with auth', tsScaffold);
    expect(callModel.mock.calls[0][1]).toContain('from scratch');   // fresh path, not edit
    expect(callModel.mock.calls[0][1]).not.toContain('minimal correct set of edits');
  });

  it('falls back to plan→batch only when the single shot under-delivers', async () => {
    const callModel = vi.fn()
      .mockResolvedValueOnce('no json here')   // single shot → 0 edits
      .mockResolvedValueOnce('{"entry":"index.html","files":[{"path":"index.html","purpose":"e"},{"path":"src/App.jsx","purpose":"r"}]}') // plan (architect)
      .mockResolvedValue('[{"op":"write","path":"index.html","content":"<div id=root></div>"},{"op":"write","path":"src/App.jsx","content":"export default ()=>null"}]');
    const { generate } = makeAiEditGenerator(callModel);
    const edits = await generate('a kanban board', VirtualFileSystem.fromRecord({}));
    expect(callModel.mock.calls[0][1]).toContain('from scratch'); // tried single shot first
    expect(callModel.mock.calls[1][0]).toContain('architect');    // then plan fallback
    expect(edits.filter(e => e.op === 'write').length).toBeGreaterThanOrEqual(2);
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
