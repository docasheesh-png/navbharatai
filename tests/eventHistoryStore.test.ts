import { describe, it, expect } from 'vitest';
import { EventHistoryStore } from '../src/server/AppMakerLab/eventbus/EventHistoryStore';
import { EventType } from '../src/server/AppMakerLab/eventbus/EventTypes';
import type { IEvent } from '../src/server/AppMakerLab/eventbus/IEvent';

function event(workspaceId: string, correlationId = 'c1', type = EventType.TASK_COMPLETED): IEvent {
  return { eventId: 'e-' + Math.random(), correlationId, workspaceId, sender: 'test', timestamp: new Date(), type, payload: {} };
}

describe('EventHistoryStore', () => {
  it('getHistory() returns empty array on a fresh store', () => {
    const store = new EventHistoryStore('ns');
    expect(store.getHistory()).toHaveLength(0);
  });

  it('add() then getHistory() contains the event', () => {
    const store = new EventHistoryStore('ns');
    const e = event('ws-1');
    store.add(e);
    expect(store.getHistory()).toContain(e);
  });

  it('getByWorkspaceId() returns only matching events', () => {
    const store = new EventHistoryStore('ns');
    store.add(event('ws-1'));
    store.add(event('ws-2'));
    store.add(event('ws-1'));
    const result = store.getByWorkspaceId('ws-1');
    expect(result).toHaveLength(2);
    result.forEach(e => expect(e.workspaceId).toBe('ws-1'));
  });

  it('getByCorrelationId() returns only events with matching correlationId', () => {
    const store = new EventHistoryStore('ns');
    store.add(event('ws-1', 'corr-A'));
    store.add(event('ws-2', 'corr-B'));
    const result = store.getByCorrelationId('corr-A');
    expect(result).toHaveLength(1);
    expect(result[0].correlationId).toBe('corr-A');
  });

  it('enforces the history limit by evicting the oldest event', () => {
    const store = new EventHistoryStore('ns', 3); // limit of 3
    for (let i = 0; i < 4; i++) store.add(event(`ws-${i}`));
    expect(store.getHistory()).toHaveLength(3);
  });

  it('getHistory() returns a copy (not a mutable reference)', () => {
    const store = new EventHistoryStore('ns');
    store.add(event('ws-1'));
    const snap1 = store.getHistory();
    store.add(event('ws-2'));
    const snap2 = store.getHistory();
    expect(snap1).toHaveLength(1);
    expect(snap2).toHaveLength(2);
  });
});
