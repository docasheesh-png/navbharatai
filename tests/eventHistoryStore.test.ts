import { describe, it, expect } from 'vitest';
import { EventHistoryStore } from '../src/server/AppMakerLab/eventbus/EventHistoryStore';
import type { IEvent } from '../src/server/AppMakerLab/eventbus/IEvent';
import { EventType } from '../src/server/AppMakerLab/eventbus/EventTypes';

function makeEvent(workspaceId: string, correlationId = 'corr-1'): IEvent {
  return {
    type: EventType.GENERATION_STARTED,
    workspaceId,
    correlationId,
    payload: {},
    timestamp: new Date(),
  };
}

describe('EventHistoryStore', () => {
  it('starts with empty history', () => {
    const store = new EventHistoryStore('ns-1');
    expect(store.getHistory()).toHaveLength(0);
  });

  it('adds and retrieves events', () => {
    const store = new EventHistoryStore('ns-1');
    store.add(makeEvent('ws-1'));
    expect(store.getHistory()).toHaveLength(1);
  });

  it('returns a copy of history (not the internal array)', () => {
    const store = new EventHistoryStore('ns-1');
    store.add(makeEvent('ws-1'));
    const h1 = store.getHistory();
    const h2 = store.getHistory();
    expect(h1).not.toBe(h2); // different array references
  });

  it('respects the limit by dropping oldest events', () => {
    const store = new EventHistoryStore('ns-1', 3);
    store.add(makeEvent('ws-1', 'c-1'));
    store.add(makeEvent('ws-1', 'c-2'));
    store.add(makeEvent('ws-1', 'c-3'));
    store.add(makeEvent('ws-1', 'c-4')); // should drop c-1
    const history = store.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0].correlationId).toBe('c-2');
  });

  it('getByWorkspaceId filters correctly', () => {
    const store = new EventHistoryStore('ns-1');
    store.add(makeEvent('ws-A'));
    store.add(makeEvent('ws-B'));
    store.add(makeEvent('ws-A'));
    expect(store.getByWorkspaceId('ws-A')).toHaveLength(2);
    expect(store.getByWorkspaceId('ws-B')).toHaveLength(1);
  });

  it('getByCorrelationId filters correctly', () => {
    const store = new EventHistoryStore('ns-1');
    store.add(makeEvent('ws-1', 'corr-X'));
    store.add(makeEvent('ws-1', 'corr-Y'));
    expect(store.getByCorrelationId('corr-X')).toHaveLength(1);
  });
});
