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
  it('fresh build plans the file tree then generates files in batches', async () => {
    // 1st call = plan (returns a multi-file plan); subsequent = batch write ops.
    const callModel = vi.fn()
      .mockResolvedValueOnce('{"entry":"index.html","files":[{"path":"index.html","purpose":"entry"},{"path":"src/App.jsx","purpose":"root"}]}')
      .mockResolvedValue('[{"op":"write","path":"index.html","content":"<div id=root></div>"},{"op":"write","path":"src/App.jsx","content":"export default ()=>null"}]');
    const { generate } = makeAiEditGenerator(callModel);
    const edits = await generate('a kanban board', VirtualFileSystem.fromRecord({}));
    // planning call happened first, with the request
    expect(callModel.mock.calls[0][1]).toContain('a kanban board');
    expect(callModel.mock.calls[0][0]).toContain('architect');
    // produced multiple files
    expect(edits.filter(e => e.op === 'write').length).toBeGreaterThanOrEqual(2);
    expect(edits.some(e => e.path === 'src/App.jsx')).toBe(true);
  });

  it('falls back to single-shot when the plan is not multi-file', async () => {
    // plan returns junk → no usable plan → single-shot fresh build path
    const callModel = vi.fn()
      .mockResolvedValueOnce('no json here')
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
