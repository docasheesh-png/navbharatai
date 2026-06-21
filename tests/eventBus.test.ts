import { describe, it, expect } from 'vitest';
import { eventBus } from '../src/server/lib/eventBus';
import { eventStore } from '../src/server/lib/eventStore';

describe('eventBus (G1 shared bus)', () => {
  it('publishes and reads back newest-first, filtered by workspace', () => {
    const ws = `ws-${Math.random().toString(36).slice(2)}`;
    eventBus.publish({ type: 'BUILD_STARTED', workspaceId: ws, payload: { a: 1 } });
    eventBus.publish({ type: 'BUILD_COMPLETED', workspaceId: ws, payload: { ok: true } });
    const events = eventBus.recent({ workspaceId: ws });
    expect(events.length).toBe(2);
    expect(events[0].type).toBe('BUILD_COMPLETED'); // newest first
    expect(events[1].type).toBe('BUILD_STARTED');
    expect(events[0].eventId).toBeTruthy();
    expect(typeof events[0].ts).toBe('number');
    expect(events[0].correlationId).toBe(ws); // defaults to workspaceId
  });

  it('filters by correlationId', () => {
    const corr = `corr-${Math.random().toString(36).slice(2)}`;
    eventBus.publish({ type: 'TASK_STARTED', workspaceId: 'x', correlationId: corr });
    expect(eventBus.recent({ correlationId: corr }).length).toBe(1);
  });

  it('publish NEVER throws, even on odd input', () => {
    expect(() => eventBus.publish({ type: 'X' } as any)).not.toThrow();
    expect(() => eventBus.publish({ type: 'Y', payload: undefined } as any)).not.toThrow();
    // unknown workspace defaults are applied
    const ev = eventBus.recent().find(e => e.type === 'X');
    expect(ev?.workspaceId).toBe('unknown');
  });

  it('onAny receives events and unsubscribe stops them', () => {
    const seen: string[] = [];
    const off = eventBus.onAny((e) => { if (e.type === 'PING') seen.push(e.eventId); });
    eventBus.publish({ type: 'PING', workspaceId: 'z' });
    off();
    eventBus.publish({ type: 'PING', workspaceId: 'z' });
    expect(seen.length).toBe(1); // only the first, after unsubscribe none
  });
});

describe('eventStore (G1 persistence, db-null fallback under test)', () => {
  it('append is a no-op that never throws when Firestore is unavailable', async () => {
    await expect(eventStore.append({
      eventId: 'e1', type: 'BUILD_STARTED', workspaceId: 'w', correlationId: 'w',
      sender: 'pro', ts: Date.now(), payload: {},
    })).resolves.toBeUndefined();
  });

  it('query falls back to the in-memory ring when there is no db', async () => {
    const ws = `wq-${Math.random().toString(36).slice(2)}`;
    eventBus.publish({ type: 'BUILD_STARTED', workspaceId: ws });
    const out = await eventStore.query({ workspaceId: ws, limit: 10 });
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('BUILD_STARTED');
  });
});
