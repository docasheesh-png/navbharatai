/** Process-local turn admission, NOT a replacement for provider quotas or shared spend reservations.
 * Only server-verified identities belong here. Limits apply per Cloud Run instance, not globally.
 * A granted turn keeps its slot until its caller releases it in finally, even after disconnect.
 */
export interface AdmissionQueueLimits {
  maxActive: number;
  maxQueued: number;
  maxWaitMs: number;
  perUserActive: number;
  perUserQueued: number;
}
export const DEFAULT_ADMISSION_QUEUE_LIMITS: Readonly<AdmissionQueueLimits> = Object.freeze({
  maxActive: 8, maxQueued: 64, maxWaitMs: 5000, perUserActive: 1, perUserQueued: 1,
});
export type AdmissionDenial = 'capacity' | 'queue-full' | 'timeout' | 'aborted' | 'user-limit';
export type AdmissionResult = { admitted: true; release: () => void; waitedMs: number }
  | { admitted: false; reason: AdmissionDenial; waitedMs: number };
export interface AdmissionRequest extends Partial<AdmissionQueueLimits> { uid: string; signal?: AbortSignal }
interface Waiting {
  uid: string; signal?: AbortSignal; enqueuedAt: number; deadline: number;
  resolve: (result: AdmissionResult) => void;
  timer: ReturnType<typeof setTimeout>;
  abort: () => void;
}
function limitsFor(input: AdmissionRequest): AdmissionQueueLimits | null {
  const limits = { ...DEFAULT_ADMISSION_QUEUE_LIMITS, ...input };
  if (!Number.isInteger(limits.maxActive) || limits.maxActive < 1 || limits.maxActive > 64
    || !Number.isInteger(limits.maxQueued) || limits.maxQueued < 0 || limits.maxQueued > 1024
    || !Number.isInteger(limits.maxWaitMs) || limits.maxWaitMs < 0 || limits.maxWaitMs > 10000
    || !Number.isInteger(limits.perUserActive) || limits.perUserActive < 1 || limits.perUserActive > limits.maxActive
    || !Number.isInteger(limits.perUserQueued) || limits.perUserQueued < 0 || limits.perUserQueued > 16) return null;
  return { maxActive: limits.maxActive, maxQueued: limits.maxQueued, maxWaitMs: limits.maxWaitMs,
    perUserActive: limits.perUserActive, perUserQueued: limits.perUserQueued };
}
export class FreeChainAdmissionQueue {
  private limits: AdmissionQueueLimits = { ...DEFAULT_ADMISSION_QUEUE_LIMITS };
  private active = 0;
  private readonly activeByUser = new Map<string, number>();
  private readonly queuedByUser = new Map<string, number>();
  private readonly waiting: Waiting[] = [];

  /** FIFO among eligible users; a user's blocked second turn cannot head-of-line block others. */
  acquire(input: AdmissionRequest): Promise<AdmissionResult> {
    if (input.signal?.aborted) return Promise.resolve({ admitted: false, reason: 'aborted', waitedMs: 0 });
    const limits = limitsFor(input);
    if (!limits || typeof input.uid !== 'string' || !input.uid.trim() || input.uid.length > 512) {
      return Promise.resolve({ admitted: false, reason: 'capacity', waitedMs: 0 });
    }
    // New server configuration governs all FUTURE grants; already active work is never revoked.
    this.limits = limits;
    this.drain();
    if (this.canGrant(input.uid)) return Promise.resolve(this.grant(input.uid, Date.now()));
    if ((this.queuedByUser.get(input.uid) ?? 0) >= limits.perUserQueued) {
      return Promise.resolve({ admitted: false, reason: 'user-limit', waitedMs: 0 });
    }
    if (limits.maxWaitMs === 0) return Promise.resolve({ admitted: false, reason: 'capacity', waitedMs: 0 });
    if (this.waiting.length >= limits.maxQueued) return Promise.resolve({ admitted: false, reason: 'queue-full', waitedMs: 0 });
    const enqueuedAt = Date.now();
    return new Promise(resolve => {
      const entry: Waiting = { uid: input.uid, signal: input.signal, enqueuedAt, deadline: enqueuedAt + limits.maxWaitMs,
        resolve, timer: undefined as unknown as ReturnType<typeof setTimeout>, abort: () => this.reject(entry, 'aborted') };
      entry.timer = setTimeout(() => this.reject(entry, 'timeout'), limits.maxWaitMs);
      this.waiting.push(entry);
      this.queuedByUser.set(entry.uid, (this.queuedByUser.get(entry.uid) ?? 0) + 1);
      input.signal?.addEventListener('abort', entry.abort, { once: true });
      // Defends custom signals whose abort occurred while registering the listener.
      if (input.signal?.aborted) this.reject(entry, 'aborted');
    });
  }

  snapshot(): { active: number; queued: number; activeUsers: number; queuedUsers: number } {
    return { active: this.active, queued: this.waiting.length, activeUsers: this.activeByUser.size, queuedUsers: this.queuedByUser.size };
  }
  private canGrant(uid: string): boolean {
    return this.active < this.limits.maxActive && (this.activeByUser.get(uid) ?? 0) < this.limits.perUserActive;
  }
  private grant(uid: string, enqueuedAt: number): AdmissionResult & { admitted: true } {
    this.active += 1;
    this.activeByUser.set(uid, (this.activeByUser.get(uid) ?? 0) + 1);
    let released = false;
    return { admitted: true, waitedMs: Math.max(0, Date.now() - enqueuedAt), release: () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.decrement(this.activeByUser, uid);
      this.drain();
    } };
  }
  private decrement(map: Map<string, number>, uid: string): void {
    const next = (map.get(uid) ?? 0) - 1;
    if (next > 0) map.set(uid, next); else map.delete(uid);
  }
  private remove(entry: Waiting): boolean {
    const index = this.waiting.indexOf(entry);
    if (index < 0) return false;
    this.waiting.splice(index, 1);
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
    this.decrement(this.queuedByUser, entry.uid);
    return true;
  }
  private reject(entry: Waiting, reason: 'aborted' | 'timeout'): void {
    if (!this.remove(entry)) return;
    entry.resolve({ admitted: false, reason, waitedMs: Math.max(0, Date.now() - entry.enqueuedAt) });
    this.drain();
  }
  private drain(): void {
    // At most 1024 bounded entries. Resolve only after removal, so abort/release is idempotent.
    for (let i = 0; i < this.waiting.length;) {
      const entry = this.waiting[i];
      const expired = Date.now() >= entry.deadline;
      if (entry.signal?.aborted || expired) {
        this.remove(entry);
        entry.resolve({ admitted: false, reason: entry.signal?.aborted ? 'aborted' : 'timeout', waitedMs: Math.max(0, Date.now() - entry.enqueuedAt) });
      } else if (this.canGrant(entry.uid)) {
        this.remove(entry);
        entry.resolve(this.grant(entry.uid, entry.enqueuedAt));
      } else i += 1;
    }
  }
}
/** Reused across request-scoped routers so a new router cannot reset local capacity. */
export const freeChainAdmissionQueue = new FreeChainAdmissionQueue();
