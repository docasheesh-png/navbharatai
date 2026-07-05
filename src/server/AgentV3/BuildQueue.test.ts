import { describe, it, expect } from 'vitest';
import {
  emptyQueue, enqueue, claimNext, completeRunning, cancelItem, reorderPending,
  pendingItems, runningItem, queueSummary, serializeQueue, parseStoredQueue,
  MAX_QUEUE_ITEMS, type CommandQueue,
} from './BuildQueue';

function withItems(ids: Array<{ id: string; source?: 'user' | 'planner' | 'advisor' }>): CommandQueue {
  let q = emptyQueue('ws1');
  ids.forEach((x, i) => { q = enqueue(q, { id: x.id, prompt: `do ${x.id}`, source: x.source ?? 'user', createdTs: i + 1 }).queue; });
  return q;
}

describe('enqueue', () => {
  it('appends a command as pending, in order', () => {
    const q = withItems([{ id: 'a' }, { id: 'b' }]);
    expect(q.items.map((i) => [i.id, i.status])).toEqual([['a', 'pending'], ['b', 'pending']]);
  });

  it('rejects a blank prompt, a duplicate id, and a full queue', () => {
    let q = emptyQueue('ws1');
    expect(enqueue(q, { id: 'x', prompt: '   ', source: 'user', createdTs: 1 })).toMatchObject({ added: false, reason: 'empty-prompt' });
    q = enqueue(q, { id: 'x', prompt: 'real', source: 'user', createdTs: 1 }).queue;
    expect(enqueue(q, { id: 'x', prompt: 'again', source: 'user', createdTs: 2 })).toMatchObject({ added: false, reason: 'duplicate-id' });
    // Fill to the cap then reject.
    for (let i = 0; i < MAX_QUEUE_ITEMS; i++) q = enqueue(q, { id: `f${i}`, prompt: 'p', source: 'user', createdTs: i }).queue;
    expect(enqueue(q, { id: 'overflow', prompt: 'p', source: 'user', createdTs: 999 })).toMatchObject({ added: false, reason: 'queue-full' });
  });

  it('is pure — never mutates the input queue', () => {
    const q = emptyQueue('ws1');
    enqueue(q, { id: 'a', prompt: 'p', source: 'user', createdTs: 1 });
    expect(q.items).toHaveLength(0);
  });
});

describe('claimNext — the serial executor invariant', () => {
  it('moves the OLDEST pending item to running', () => {
    const { queue, claimed } = claimNext(withItems([{ id: 'a' }, { id: 'b' }]));
    expect(claimed?.id).toBe('a');
    expect(runningItem(queue)?.id).toBe('a');
    expect(pendingItems(queue).map((i) => i.id)).toEqual(['b']);
  });

  it('refuses to claim a second command while one is running (one writer per app)', () => {
    const first = claimNext(withItems([{ id: 'a' }, { id: 'b' }])).queue;
    const second = claimNext(first);
    expect(second.claimed).toBeNull();
    expect(runningItem(second.queue)?.id).toBe('a'); // unchanged
  });

  it('returns claimed:null on an empty / all-done queue', () => {
    expect(claimNext(emptyQueue('ws1')).claimed).toBeNull();
  });
});

describe('completeRunning → drain the queue in order', () => {
  it('marks the running item done and lets the next be claimed', () => {
    let q = withItems([{ id: 'a' }, { id: 'b' }]);
    q = claimNext(q).queue;
    q = completeRunning(q, true);
    expect(q.items.find((i) => i.id === 'a')?.status).toBe('done');
    const claim2 = claimNext(q);
    expect(claim2.claimed?.id).toBe('b');
  });

  it('records a failure with an honest note', () => {
    let q = claimNext(withItems([{ id: 'a' }])).queue;
    q = completeRunning(q, false, 'build error: X');
    expect(q.items[0]).toMatchObject({ status: 'failed', note: 'build error: X' });
  });

  it('is a no-op when nothing is running', () => {
    const q = withItems([{ id: 'a' }]);
    expect(completeRunning(q, true)).toEqual(q);
  });
});

describe('cancelItem', () => {
  it('cancels a pending item (and it is then never claimed)', () => {
    let q = withItems([{ id: 'a' }, { id: 'b' }]);
    q = cancelItem(q, 'a');
    expect(q.items.find((i) => i.id === 'a')?.status).toBe('cancelled');
    expect(claimNext(q).claimed?.id).toBe('b'); // skips the cancelled one
  });

  it('will NOT cancel a running item (must be Stopped via the build)', () => {
    const q = claimNext(withItems([{ id: 'a' }])).queue;
    expect(cancelItem(q, 'a')).toEqual(q); // unchanged — still running
  });
});

describe('reorderPending — reorder the roadmap', () => {
  it('moves a pending item to a new pending position', () => {
    const q = withItems([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const r = reorderPending(q, 'c', 0);
    expect(pendingItems(r).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('reorders only AMONG pending items — a running/done item keeps its slot', () => {
    let q = withItems([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    q = completeRunning(claimNext(q).queue, true); // 'a' done
    const r = reorderPending(q, 'c', 0);
    // 'a' stays first (done); the pending order becomes c, b.
    expect(r.items.map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect(pendingItems(r).map((i) => i.id)).toEqual(['c', 'b']);
  });

  it('clamps an out-of-range index and no-ops a same-position move', () => {
    const q = withItems([{ id: 'a' }, { id: 'b' }]);
    expect(pendingItems(reorderPending(q, 'a', 99)).map((i) => i.id)).toEqual(['b', 'a']);
    expect(reorderPending(q, 'a', 0)).toEqual(q);
  });
});

describe('serializeQueue / parseStoredQueue (durable, strict)', () => {
  it('round-trips a queue', () => {
    let q = withItems([{ id: 'a' }, { id: 'b' }]);
    q = completeRunning(claimNext(q).queue, true);
    expect(parseStoredQueue('ws1', serializeQueue(q))).toEqual(q);
  });

  it('unparseable / non-array input → an EMPTY queue (executor never runs on garbage)', () => {
    expect(parseStoredQueue('ws1', 'not json')).toEqual(emptyQueue('ws1'));
    expect(parseStoredQueue('ws1', { items: 'nope' })).toEqual(emptyQueue('ws1'));
    expect(parseStoredQueue('ws1', null)).toEqual(emptyQueue('ws1'));
  });

  it('drops malformed items (missing/invalid fields) but keeps the valid ones', () => {
    const raw = { items: [
      { id: 'ok', prompt: 'p', source: 'user', status: 'pending', createdTs: 1 },
      { id: 'no-status', prompt: 'p', source: 'user', createdTs: 2 },
      { id: 'bad-source', prompt: 'p', source: 'hacker', status: 'pending', createdTs: 3 },
      { prompt: 'no-id', source: 'user', status: 'pending', createdTs: 4 },
    ] };
    expect(parseStoredQueue('ws1', raw).items.map((i) => i.id)).toEqual(['ok']);
  });

  it("heals a stale 'running' item (a dead instance) to 'failed' so the serial slot is never stuck", () => {
    const raw = { items: [
      { id: 'x', prompt: 'p', source: 'user', status: 'running', createdTs: 1 },
      { id: 'y', prompt: 'p', source: 'user', status: 'pending', createdTs: 2 },
    ] };
    const q = parseStoredQueue('ws1', raw);
    expect(q.items.find((i) => i.id === 'x')?.status).toBe('failed');
    expect(runningItem(q)).toBeUndefined();       // slot free
    expect(claimNext(q).claimed?.id).toBe('y');   // next can run
  });
});

describe('queueSummary', () => {
  it('tallies every status honestly', () => {
    let q = withItems([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
    q = completeRunning(claimNext(q).queue, true); // a done
    q = completeRunning(claimNext(q).queue, false); // b failed
    q = cancelItem(q, 'c'); // c cancelled
    q = claimNext(q).queue; // d running
    expect(queueSummary(q)).toEqual({ pending: 0, running: 1, done: 1, failed: 1, cancelled: 1 });
  });
});
