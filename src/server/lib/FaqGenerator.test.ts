import { describe, it, expect, afterAll } from 'vitest';

import { generateFaqIntegration, FAQ_SERVICE_SOURCE } from './FaqGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateFaqIntegration (wiring)', () => {
  it('emits the faq service, routes and README', () => {
    const out = generateFaqIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/faq/faqService.ts');
    expect(paths).toContain('server/faq/routes.ts');
    expect(paths).toContain('server/faq/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/faq/routes.ts']).toContain('export const faqRouter');
    expect(out.files['server/faq/routes.ts']).toContain('/publish');
  });
});

// Materialize + execute the emitted domain logic — the publish-gate + search + vote rules are real business
// rules, verified against the actual emitted code.
describe('emitted FaqService — publish gate + search + helpfulness votes (real logic)', () => {
  const emitted = emitModule('faq', FAQ_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  interface FaqEntry { id: string; question: string; answer: string; category: string; published: boolean; position: number; helpful: number; notHelpful: number; createdAt: string; updatedAt: string }
  interface Service {
    add(input: { question: string; answer: string; category?: string; published?: boolean }, now?: Date): FaqEntry;
    get(id: string): FaqEntry | undefined;
    update(id: string, patch: { question?: string; answer?: string; category?: string }, now?: Date): FaqEntry;
    setPublished(id: string, published: boolean, now?: Date): FaqEntry;
    remove(id: string): boolean;
    vote(id: string, helpful: boolean, now?: Date): FaqEntry;
    score(entry: FaqEntry): number;
    publicList(category?: string): FaqEntry[];
    adminList(): FaqEntry[];
    search(query: string): FaqEntry[];
  }
  interface Emitted { FaqService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('THE INVARIANT: a draft entry is NEVER in the public list or search; publishing reveals it', async () => {
    const { FaqService } = await load();
    const svc = new FaqService();
    const draft = svc.add({ question: 'How do I reset my password?', answer: 'Use the reset link.' }); // draft
    const live = svc.add({ question: 'Where is billing?', answer: 'Under Settings.', published: true });
    // public list has ONLY the published one
    expect(svc.publicList().map((e) => e.id)).toEqual([live.id]);
    // admin list has BOTH
    expect(svc.adminList().length).toBe(2);
    // search never returns the draft even on a matching term
    expect(svc.search('password')).toEqual([]);
    expect(svc.search('billing').map((e) => e.id)).toEqual([live.id]);
    // publish the draft -> now visible
    svc.setPublished(draft.id, true);
    expect(svc.publicList().map((e) => e.id).sort()).toEqual([draft.id, live.id].sort());
    expect(svc.search('password').map((e) => e.id)).toEqual([draft.id]);
  });

  it('search matches question OR answer, case-insensitive, published only', async () => {
    const { FaqService } = await load();
    const svc = new FaqService();
    svc.add({ question: 'Refund policy', answer: 'We refund within 30 days.', published: true });
    svc.add({ question: 'Shipping', answer: 'Free over ₹500.', published: true });
    expect(svc.search('REFUND').length).toBe(1);      // matches question, case-insensitive
    expect(svc.search('30 days').length).toBe(1);     // matches answer
    expect(svc.search('₹500').length).toBe(1);
    expect(svc.search('nonexistent').length).toBe(0);
    expect(svc.search('').length).toBe(0);            // empty query -> nothing
  });

  it('helpfulness votes are exact and score is the net', async () => {
    const { FaqService } = await load();
    const svc = new FaqService();
    const e = svc.add({ question: 'Q', answer: 'A', published: true });
    svc.vote(e.id, true);
    svc.vote(e.id, true);
    svc.vote(e.id, false);
    const fresh = svc.get(e.id) as FaqEntry;
    expect(fresh.helpful).toBe(2);
    expect(fresh.notHelpful).toBe(1);
    expect(svc.score(fresh)).toBe(1);
  });

  it('entries order by category then position; category filter works', async () => {
    const { FaqService } = await load();
    const svc = new FaqService();
    svc.add({ question: 'A1', answer: 'x', category: 'Account', published: true }); // pos 0
    svc.add({ question: 'B1', answer: 'x', category: 'Billing', published: true }); // pos 0
    svc.add({ question: 'A2', answer: 'x', category: 'Account', published: true }); // pos 1
    const all = svc.publicList();
    expect(all.map((e) => e.question)).toEqual(['A1', 'A2', 'B1']); // Account(0,1) then Billing(0)
    expect(svc.publicList('Billing').map((e) => e.question)).toEqual(['B1']);
  });

  it('validates input and unknown-entry cases', async () => {
    const { FaqService } = await load();
    const svc = new FaqService();
    expect(() => svc.add({ question: '', answer: 'a' })).toThrow(/question is required/);
    expect(() => svc.add({ question: 'q', answer: '' })).toThrow(/answer is required/);
    expect(() => svc.setPublished('nope', true)).toThrow(/entry not found/);
    expect(() => svc.vote('nope', true)).toThrow(/entry not found/);
    const e = svc.add({ question: 'q', answer: 'a' });
    expect(() => svc.update(e.id, { question: '   ' })).toThrow(/question cannot be empty/);
    expect(svc.remove(e.id)).toBe(true);
    expect(svc.remove(e.id)).toBe(false);
  });
});
