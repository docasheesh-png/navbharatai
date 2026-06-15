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
  it('generate calls the model and parses edits', async () => {
    const callModel = vi.fn(async () => '[{"op":"write","path":"index.html","content":"<h1>hi</h1>"}]');
    const { generate } = makeAiEditGenerator(callModel);
    const edits = await generate('make a page', VirtualFileSystem.fromRecord({}));
    expect(edits).toEqual([{ op: 'write', path: 'index.html', content: '<h1>hi</h1>' }]);
    expect(callModel).toHaveBeenCalledOnce();
    // the user prompt includes the request
    expect(callModel.mock.calls[0][1]).toContain('make a page');
  });

  it('fix returns [] when there are no issues (no model call)', async () => {
    const callModel = vi.fn(async () => '[]');
    const { fix } = makeAiEditGenerator(callModel);
    expect(await fix([], VirtualFileSystem.fromRecord({}))).toEqual([]);
    expect(callModel).not.toHaveBeenCalled();
  });
});
