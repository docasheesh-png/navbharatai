import { describe, it, expect, afterAll } from 'vitest';

import { generateFeedbackIntegration, FEEDBACK_SERVICE_SOURCE } from './FeedbackGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateFeedbackIntegration (wiring)', () => {
  it('emits the feedback service, routes and README', () => {
    const out = generateFeedbackIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/feedback/feedbackService.ts');
    expect(paths).toContain('server/feedback/routes.ts');
    expect(paths).toContain('server/feedback/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/feedback/routes.ts']).toContain('export const feedbackRouter');
    expect(out.files['server/feedback/routes.ts']).toContain('409');
  });
});

// Materialize + execute the emitted domain logic — the vote-once + status-machine rules are real business
// rules, verified against the actual emitted code.
describe('emitted FeedbackService — upvote-once + status lifecycle (real logic)', () => {
  const emitted = emitModule('feedback', FEEDBACK_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  type PostStatus = 'open' | 'planned' | 'in_progress' | 'done' | 'declined';
  interface Post { id: string; title: string; author: string; status: PostStatus; votes: number }
  interface Service {
    submit(i: { title: string; body?: string; author: string }, now?: Date): Post;
    get(id: string): Post | undefined;
    upvote(id: string, user: string): { voted: boolean; votes: number };
    unvote(id: string, user: string): { removed: boolean; votes: number };
    hasVoted(id: string, user: string): boolean;
    setStatus(id: string, to: PostStatus, now?: Date): Post;
    list(filter?: { status?: PostStatus }): Post[];
  }
  interface Emitted { FeedbackService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('a new post starts open with the author auto-voted (votes=1)', async () => {
    const { FeedbackService } = await load();
    const svc = new FeedbackService();
    const p = svc.submit({ title: 'Dark mode', author: 'asha' });
    expect(p).toMatchObject({ status: 'open', votes: 1 });
    expect(svc.hasVoted(p.id, 'asha')).toBe(true);
  });

  it('upvote is idempotent per user (no double-count); unvote is idempotent', async () => {
    const { FeedbackService } = await load();
    const svc = new FeedbackService();
    const p = svc.submit({ title: 'X', author: 'asha' }); // votes=1 (asha)
    expect(svc.upvote(p.id, 'bob')).toEqual({ voted: true, votes: 2 });
    expect(svc.upvote(p.id, 'bob')).toEqual({ voted: false, votes: 2 }); // repeat → no-op
    expect(svc.upvote(p.id, 'carol').votes).toBe(3);
    expect(svc.unvote(p.id, 'bob')).toEqual({ removed: true, votes: 2 });
    expect(svc.unvote(p.id, 'bob')).toEqual({ removed: false, votes: 2 }); // idempotent
    expect(svc.hasVoted(p.id, 'bob')).toBe(false);
  });

  it('enforces the status lifecycle open→planned→in_progress→done; invalid rejected', async () => {
    const { FeedbackService } = await load();
    const svc = new FeedbackService();
    const p = svc.submit({ title: 'X', author: 'a' });
    // open cannot jump straight to done
    expect(() => svc.setStatus(p.id, 'done')).toThrow(/invalid status transition/);
    expect(svc.setStatus(p.id, 'planned').status).toBe('planned');
    expect(svc.setStatus(p.id, 'in_progress').status).toBe('in_progress');
    expect(svc.setStatus(p.id, 'done').status).toBe('done');
    // done can be reopened but not moved straight back to in_progress
    expect(() => svc.setStatus(p.id, 'in_progress')).toThrow(/invalid status transition/);
    expect(svc.setStatus(p.id, 'open').status).toBe('open');
  });

  it('the board is sorted by votes (desc), filterable by status', async () => {
    const { FeedbackService } = await load();
    const svc = new FeedbackService();
    const a = svc.submit({ title: 'A', author: 'u1' }); // 1
    const b = svc.submit({ title: 'B', author: 'u2' }); // 1
    svc.upvote(b.id, 'u3'); svc.upvote(b.id, 'u4'); // B → 3
    svc.upvote(a.id, 'u5'); // A → 2
    expect(svc.list().map((p) => p.title)).toEqual(['B', 'A']); // vote-sorted
    svc.setStatus(a.id, 'planned');
    expect(svc.list({ status: 'planned' }).map((p) => p.title)).toEqual(['A']);
    expect(svc.list({ status: 'open' }).map((p) => p.title)).toEqual(['B']);
  });

  it('validates input and unknown posts', async () => {
    const { FeedbackService } = await load();
    const svc = new FeedbackService();
    expect(() => svc.submit({ title: '', author: 'a' })).toThrow(/title is required/);
    expect(() => svc.submit({ title: 'X', author: '' })).toThrow(/author is required/);
    expect(() => svc.upvote('nope', 'a')).toThrow(/post not found/);
    expect(() => svc.setStatus('nope', 'planned')).toThrow(/post not found/);
  });
});
