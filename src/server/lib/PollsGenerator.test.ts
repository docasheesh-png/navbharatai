import { describe, it, expect, afterAll } from 'vitest';

import { generatePollsIntegration, POLL_SERVICE_SOURCE } from './PollsGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generatePollsIntegration (wiring)', () => {
  it('emits the poll service, routes and README', () => {
    const out = generatePollsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/polls/pollService.ts');
    expect(paths).toContain('server/polls/routes.ts');
    expect(paths).toContain('server/polls/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/polls/routes.ts']).toContain('export const pollRouter');
    expect(out.files['server/polls/routes.ts']).toContain('409');
  });
});

// Materialize + execute the emitted domain logic — vote integrity (one vote per voter) + tally are real
// business rules, verified against the actual emitted code.
describe('emitted PollService — vote integrity + tally (real logic)', () => {
  const emitted = emitModule('polls', POLL_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  interface Poll { id: string; options: Array<{ id: string; label: string }> }
  interface Results { total: number; tally: Array<{ optionId: string; votes: number }>; open: boolean }
  interface Service {
    createPoll(question: string, options: string[]): Poll;
    vote(pollId: string, optionId: string, voter: string, opts?: { allowChange?: boolean }): Results;
    closePoll(id: string): Poll;
    results(pollId: string): Results;
    hasVoted(pollId: string, voter: string): boolean;
  }
  interface Emitted { PollService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('tallies votes and REJECTS a second vote from the same voter', async () => {
    const { PollService } = await load();
    const svc = new PollService();
    const p = svc.createPoll('Best framework?', ['React', 'Vue']);
    const opt = p.options;
    svc.vote(p.id, opt[0].id, 'asha');
    svc.vote(p.id, opt[1].id, 'ravi');
    expect(svc.hasVoted(p.id, 'asha')).toBe(true);
    // asha votes again → rejected (vote integrity)
    expect(() => svc.vote(p.id, opt[0].id, 'asha')).toThrow(/already voted/);
    const r = svc.results(p.id);
    expect(r.total).toBe(2);
    expect(r.tally.find((t) => t.optionId === opt[0].id)?.votes).toBe(1);
    expect(r.tally.find((t) => t.optionId === opt[1].id)?.votes).toBe(1);
  });

  it('allowChange MOVES a vote instead of adding one', async () => {
    const { PollService } = await load();
    const svc = new PollService();
    const p = svc.createPoll('q', ['A', 'B']);
    svc.vote(p.id, p.options[0].id, 'asha');
    const r = svc.vote(p.id, p.options[1].id, 'asha', { allowChange: true });
    expect(r.total).toBe(1); // still one vote, just moved
    expect(r.tally.find((t) => t.optionId === p.options[0].id)?.votes).toBe(0);
    expect(r.tally.find((t) => t.optionId === p.options[1].id)?.votes).toBe(1);
  });

  it('a CLOSED poll accepts no more votes', async () => {
    const { PollService } = await load();
    const svc = new PollService();
    const p = svc.createPoll('q', ['A', 'B']);
    svc.vote(p.id, p.options[0].id, 'asha');
    svc.closePoll(p.id);
    expect(() => svc.vote(p.id, p.options[1].id, 'ravi')).toThrow(/poll is closed/);
    expect(svc.results(p.id).open).toBe(false);
  });

  it('validates input (>=2 options, known option, voter, poll)', async () => {
    const { PollService } = await load();
    const svc = new PollService();
    expect(() => svc.createPoll('', ['A', 'B'])).toThrow(/question is required/);
    expect(() => svc.createPoll('q', ['only one'])).toThrow(/at least 2 options/);
    const p = svc.createPoll('q', ['A', 'B']);
    expect(() => svc.vote(p.id, '999', 'asha')).toThrow(/unknown option/);
    expect(() => svc.vote(p.id, p.options[0].id, '')).toThrow(/voter is required/);
    expect(() => svc.vote('nope', '1', 'asha')).toThrow(/poll not found/);
  });
});
