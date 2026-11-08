import { describe, it, expect } from 'vitest';
import { manifest, grade, rehearse, simulate, stages } from '../scripts/mainChatLoad.mjs';

describe('main chat offline staged-load preparation', () => {
  it('plans every distinct public problem and four task types per conversation', () => {
    const plan = manifest(), all = plan.flat();
    expect(plan.map(batch => batch.length)).toEqual(stages);
    expect(all).toHaveLength(10110);
    expect(new Set(all.map(row => row.prompt)).size).toBe(10110);
    expect(new Set(all.map(row => row.requestId)).size).toBe(10110);
    for (let user = 0; user < 1000; user++) {
      expect(new Set(plan.slice(4).map(batch => batch[user].taskType)).size).toBe(4);
      expect(new Set(plan.slice(4).map(batch => batch[user].userId)).size).toBe(1);
    }
    expect(all.slice(0, 4).map(row => row.expected)).toEqual(['106', '1103', '-19,21,28', '167']);
    for (const task of all) { expect(grade(task, task.expected)).toBe(true); expect(grade(task, 'I am correct')).toBe(false); }
  });
  it('releases all clients together, settles global rounds and isolates history without answer keys', async () => {
    const plan = manifest();
    const tasks = new Map(plan.flat().map(task => [task.requestId, task]));
    let currentStage = 0, active = 0;
    const report = await rehearse(async request => {
      const task = tasks.get(request.requestId);
      if (task.stage !== currentStage) { expect(active).toBe(0); currentStage = task.stage; }
      expect(request.endpoint).toBe('/api/v1/chat/navbharat');
      expect(request.body).not.toHaveProperty('expected');
      expect(request.body.history).toHaveLength((task.turn - 1) * 2);
      for (let turn = 0; turn < task.turn - 1; turn++) {
        const prior = plan[turn + 4][Number(task.userId.split('-')[1])];
        expect(request.body.history[turn * 2]).toEqual({ role: 'user', content: prior.prompt });
      }
      active++;
      await new Promise(resolve => setImmediate(resolve));
      request.onChunk(task.expected); active--;
      return { outcome: 'complete', httpStatus: 200 };
    }, { deadlineMs: 60000 });
    expect(report.attempted).toBe(10110);
    expect(report.usersAllFourCorrect).toBe(1000);
    expect(report.batches.map(row => row.clientPeakPending)).toEqual(stages);
    expect(report.batches.every(row => row.actualProviderRequests === null && row.costs === null)).toBe(true);
    expect(report.liveRequests).toBe(0);
  }, 60000);
  it.each(['partial', 'refused', 'cancelled', 'failed'])('stops escalation on %s without replay', async outcome => {
    let calls = 0;
    const report = await rehearse(async request => { calls++; request.onChunk('incomplete'); return { outcome, httpStatus: 503 }; });
    expect(calls).toBe(10); expect(report.attempted).toBe(10); expect(report.notAttempted).toBe(10100);
    expect(report.batches[0].outcomes[outcome]).toBe(10);
    expect(report.batches[0].http503).toBe(10);
    expect(report.automaticReplays).toBe(0);
  });
  it('does not count empty or incorrect successful envelopes as correct', async () => {
    for (const answer of ['', '999']) {
      const report = await rehearse(async request => { request.onChunk(answer); return { outcome: 'complete', httpStatus: 200 }; });
      expect(report.attempted).toBe(10); expect(report.batches[0].correct).toBe(0);
    }
  });
  it('counts throttling honestly and never infers provider activity', async () => {
    const report = await rehearse(async () => ({ outcome: 'failed', httpStatus: 429 }));
    expect(report.batches[0].http429).toBe(10);
    expect(report.batches[0].ttftMs).toEqual({ p50: null, p95: null, p99: null });
    expect(report.batches[0].providerConcurrency).toBeNull();
  });
  it('bounds hanging fixtures and suppresses late output after cancellation', async () => {
    const callbacks = [];
    const report = await rehearse(request => { callbacks.push(request); return new Promise(() => {}); }, { deadlineMs: 5 });
    expect(report.batches[0].outcomes.cancelled).toBe(10);
    callbacks.forEach(request => { expect(request.signal.aborted).toBe(true); request.onChunk('late'); });
    expect(report.batches[0].correct).toBe(0);
    const controller = new AbortController(); controller.abort();
    const none = await rehearse(() => { throw Error('must not run'); }, { signal: controller.signal });
    expect(none.attempted).toBe(0);
  });
  it('labels simulation explicitly and records no invented real spend', async () => {
    const report = await simulate();
    expect(report.mode).toBe('offline-scheduler-rehearsal');
    expect(report.budget).toEqual({ authorizedINR: 1000, runtimeEnforcementVerified: false, measuredSpend: null });
  });
});
