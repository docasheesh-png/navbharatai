import { describe, it, expect, vi } from 'vitest';
import { InProcessEventBus } from '../src/server/AppMakerLab/eventbus/InProcessEventBus';
import { EventType } from '../src/server/AppMakerLab/eventbus/EventTypes';
import type { IEvent } from '../src/server/AppMakerLab/eventbus/IEvent';

function stubStore() {
  return { add: vi.fn() };
}

function makeEvent(type: EventType = EventType.TASK_COMPLETED): IEvent {
  return { eventId: 'e1', correlationId: 'c1', workspaceId: 'ws-1', sender: 'test', timestamp: new Date(), type, payload: {} };
}

describe('InProcessEventBus', () => {
  it('calls historyStore.add when an event is published', async () => {
    const store = stubStore();
    const bus = new InProcessEventBus(store as any);
    const event = makeEvent();
    await bus.publish(event);
    expect(store.add).toHaveBeenCalledWith(event);
  });

  it('calls the subscribed handler when a matching event is published', async () => {
    const store = stubStore();
    const bus = new InProcessEventBus(store as any);
    const handler = vi.fn();
    bus.subscribe(EventType.TASK_COMPLETED, handler);
    const event = makeEvent(EventType.TASK_COMPLETED);
    await bus.publish(event);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('does not call a handler registered for a different event type', async () => {
    const store = stubStore();
    const bus = new InProcessEventBus(store as any);
    const handler = vi.fn();
    bus.subscribe(EventType.TASK_FAILED, handler);
    await bus.publish(makeEvent(EventType.TASK_COMPLETED));
    expect(handler).not.toHaveBeenCalled();
  });

  it('subscribe() returns a unique subscription ID', () => {
    const bus = new InProcessEventBus(stubStore() as any);
    const id1 = bus.subscribe(EventType.BUILD_STARTED, vi.fn());
    const id2 = bus.subscribe(EventType.BUILD_STARTED, vi.fn());
    expect(id1).not.toBe(id2);
  });

  it('unsubscribe() stops the handler from receiving future events', async () => {
    const store = stubStore();
    const bus = new InProcessEventBus(store as any);
    const handler = vi.fn();
    const id = bus.subscribe(EventType.TASK_COMPLETED, handler);
    bus.unsubscribe(id);
    await bus.publish(makeEvent(EventType.TASK_COMPLETED));
    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple handlers for the same event type are all called', async () => {
    const store = stubStore();
    const bus = new InProcessEventBus(store as any);
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe(EventType.BUILD_COMPLETED, h1);
    bus.subscribe(EventType.BUILD_COMPLETED, h2);
    await bus.publish(makeEvent(EventType.BUILD_COMPLETED));
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });
});
