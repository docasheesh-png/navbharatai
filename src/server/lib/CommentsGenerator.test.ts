import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateCommentsIntegration, COMMENT_SERVICE_SOURCE } from './CommentsGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateCommentsIntegration (wiring)', () => {
  it('emits the comment service, routes and README', () => {
    const out = generateCommentsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/comments/commentService.ts');
    expect(paths).toContain('server/comments/routes.ts');
    expect(paths).toContain('server/comments/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/comments/routes.ts']).toContain('export const commentRouter');
    expect(out.files['server/comments/routes.ts']).toContain('404');
  });
});

// Materialize + execute the emitted domain logic — the parent/depth/soft-delete rules are real business
// rules, verified against the actual emitted code.
describe('emitted CommentService — thread integrity + soft-delete (real logic)', () => {
  const artifact = join(here, `._comment_emitted_${process.pid}.ts`);
  writeFileSync(artifact, COMMENT_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface Comment { id: string; threadId: string; parentId: string | null; depth: number; deleted: boolean; body: string }
  interface ThreadNode extends Comment { replies: ThreadNode[] }
  interface Service {
    post(i: { threadId?: string; parentId?: string | null; author: string; body: string }, now?: Date): Comment;
    get(id: string): Comment | undefined;
    edit(id: string, body: string, now?: Date): Comment;
    remove(id: string, now?: Date): { id: string; tombstoned: boolean };
    listThread(threadId: string): Comment[];
    tree(threadId: string): ThreadNode[];
    count(threadId: string): number;
  }
  interface Emitted { CommentService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('a reply inherits its parent thread and gets depth = parent.depth + 1', async () => {
    const { CommentService } = await load();
    const svc = new CommentService();
    const top = svc.post({ threadId: 'post-1', author: 'a', body: 'top' });
    expect(top).toMatchObject({ depth: 0, parentId: null, threadId: 'post-1' });
    const reply = svc.post({ parentId: top.id, author: 'b', body: 'reply' });
    expect(reply).toMatchObject({ depth: 1, parentId: top.id, threadId: 'post-1' }); // inherited thread
    const deep = svc.post({ parentId: reply.id, author: 'c', body: 'deep' });
    expect(deep.depth).toBe(2);
  });

  it('rejects an orphan reply and a top-level comment without a thread', async () => {
    const { CommentService } = await load();
    const svc = new CommentService();
    expect(() => svc.post({ parentId: 'nope', author: 'a', body: 'x' })).toThrow(/parent comment not found/);
    expect(() => svc.post({ author: 'a', body: 'x' })).toThrow(/threadId is required/);
    expect(() => svc.post({ threadId: 't', author: '', body: 'x' })).toThrow(/author is required/);
    expect(() => svc.post({ threadId: 't', author: 'a', body: '' })).toThrow(/body is required/);
  });

  it('soft-delete tombstones a comment WITH replies (children survive), hard-removes a leaf', async () => {
    const { CommentService } = await load();
    const svc = new CommentService();
    const top = svc.post({ threadId: 't', author: 'a', body: 'top' });
    const reply = svc.post({ parentId: top.id, author: 'b', body: 'reply' });
    // deleting the parent (has a child) tombstones it but keeps the child
    const r1 = svc.remove(top.id);
    expect(r1.tombstoned).toBe(true);
    expect(svc.get(top.id)).toMatchObject({ deleted: true, body: '[deleted]' });
    expect(svc.get(reply.id)?.body).toBe('reply'); // child survived, still nested
    expect(svc.tree('t')[0].replies[0].id).toBe(reply.id);
    // deleting the leaf reply (no children) hard-removes it
    const r2 = svc.remove(reply.id);
    expect(r2.tombstoned).toBe(false);
    expect(svc.get(reply.id)).toBeUndefined();
  });

  it('tree() nests replies under parents; count() ignores tombstoned nodes', async () => {
    const { CommentService } = await load();
    const svc = new CommentService();
    const a = svc.post({ threadId: 't', author: 'u', body: 'a' });
    svc.post({ threadId: 't', author: 'u', body: 'b' }); // second top-level
    svc.post({ parentId: a.id, author: 'u', body: 'a1' });
    svc.post({ parentId: a.id, author: 'u', body: 'a2' });
    const tree = svc.tree('t');
    expect(tree.length).toBe(2); // two roots
    expect(tree[0].replies.map((r) => r.body)).toEqual(['a1', 'a2']);
    expect(svc.count('t')).toBe(4);
    svc.remove(a.id); // a has replies → tombstoned, not removed
    expect(svc.count('t')).toBe(3); // tombstone excluded from the live count
    expect(svc.listThread('t').length).toBe(4); // but still present in the flat list
  });

  it('cannot edit a tombstoned comment; edit updates the body', async () => {
    const { CommentService } = await load();
    const svc = new CommentService();
    const top = svc.post({ threadId: 't', author: 'a', body: 'top' });
    svc.post({ parentId: top.id, author: 'b', body: 'child' });
    expect(svc.edit(top.id, 'edited').body).toBe('edited');
    svc.remove(top.id); // tombstone (has a child)
    expect(() => svc.edit(top.id, 'again')).toThrow(/cannot edit a deleted comment/);
  });
});
