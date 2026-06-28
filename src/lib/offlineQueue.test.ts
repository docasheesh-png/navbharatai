import { describe, it, expect, vi } from 'vitest';
import { isReplayable, OfflineQueue, type QueueStore, type QueuedWrite } from './offlineQueue';

/** In-memory store for deterministic tests (no IndexedDB). */
class MemStore implements QueueStore {
  items: QueuedWrite[] = [];
  async add(e: QueuedWrite) { this.items.push(e); }
  async getAll() { return [...this.items]; }
  async remove(id: string) { this.items = this.items.filter((x) => x.id !== id); }
}

describe('offlineQueue (P3.2)', () => {
  describe('isReplayable allowlist', () => {
    it('allows the safe telemetry endpoints', () => {
      expect(isReplayable('/api/analytics/event')).toBe(true);
      expect(isReplayable('/api/logs/error')).toBe(true);
      expect(isReplayable('https://navbharatai.com/api/logs/error')).toBe(true);
    });
    it('NEVER allows payment, build, or auth writes', () => {
      expect(isReplayable('/api/payment/create-order')).toBe(false);
      expect(isReplayable('/api/agentv3/chat')).toBe(false);
      expect(isReplayable('/api/auth/login')).toBe(false);
      expect(isReplayable('/api/admin/backup/firestore')).toBe(false);
    });
  });

  describe('postWithFallback', () => {
    it('sends straight out when online (no queue)', async () => {
      const store = new MemStore();
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const q = new OfflineQueue(store, fetchFn as any);
      const r = await q.postWithFallback('/api/logs/error', '{"m":1}');
      expect(r).toEqual({ sent: true, queued: false });
      expect(store.items).toHaveLength(0);
      expect(fetchFn).toHaveBeenCalledOnce();
    });

    it('queues an allowlisted write when offline (fetch rejects)', async () => {
      const store = new MemStore();
      const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
      const q = new OfflineQueue(store, fetchFn as any);
      const r = await q.postWithFallback('/api/logs/error', '{"m":1}');
      expect(r).toEqual({ sent: false, queued: true });
      expect(store.items).toHaveLength(1);
      expect(store.items[0].url).toBe('/api/logs/error');
    });

    it('does NOT queue a non-allowlisted write when offline', async () => {
      const store = new MemStore();
      const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
      const q = new OfflineQueue(store, fetchFn as any);
      const r = await q.postWithFallback('/api/payment/create-order', '{"amt":100}');
      expect(r).toEqual({ sent: false, queued: false });
      expect(store.items).toHaveLength(0);
    });

    it('never throws even if the store fails', async () => {
      const brokenStore: QueueStore = {
        add: async () => { throw new Error('idb broken'); },
        getAll: async () => [], remove: async () => {},
      };
      const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
      const q = new OfflineQueue(brokenStore, fetchFn as any);
      await expect(q.postWithFallback('/api/logs/error', '{}')).resolves.toEqual({ sent: false, queued: false });
    });
  });

  describe('flush (replay on reconnect)', () => {
    it('replays queued writes and removes the successful ones', async () => {
      const store = new MemStore();
      store.items = [
        { id: 'a', url: '/api/logs/error', body: '{"1":1}', ts: 1 },
        { id: 'b', url: '/api/analytics/event', body: '{"2":2}', ts: 2 },
      ];
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const q = new OfflineQueue(store, fetchFn as any);
      const flushed = await q.flush();
      expect(flushed).toBe(2);
      expect(store.items).toHaveLength(0);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('keeps writes that still fail (stays offline)', async () => {
      const store = new MemStore();
      store.items = [{ id: 'a', url: '/api/logs/error', body: '{}', ts: 1 }];
      const fetchFn = vi.fn().mockRejectedValue(new Error('still offline'));
      const q = new OfflineQueue(store, fetchFn as any);
      const flushed = await q.flush();
      expect(flushed).toBe(0);
      expect(store.items).toHaveLength(1); // kept for next reconnect
    });

    it('flush on an empty queue is a no-op (returns 0)', async () => {
      const q = new OfflineQueue(new MemStore(), vi.fn() as any);
      expect(await q.flush()).toBe(0);
    });
  });
});
