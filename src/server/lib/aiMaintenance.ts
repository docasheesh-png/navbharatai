import { getServerDb, type Firestore } from './serverDb';

import { MAINTENANCE_MESSAGE } from './aiMaintenanceMessage';
export { MAINTENANCE_MESSAGE };
export const MAINTENANCE_COLLECTION = 'platform_settings';
export const MAINTENANCE_DOCUMENT = 'ai_maintenance';
export const MAINTENANCE_FAILURE_WINDOW_MS = 120_000;
export const MAINTENANCE_FAILURE_THRESHOLD = 3;
export interface MaintenanceState {
  enabled: boolean;
  unavailable?: boolean;
  autoEnabled: boolean;
  reason: 'manual' | 'kimi_quota' | null;
  updatedAt: number | null;
  failures: number[];
}
const defaults = (): MaintenanceState => ({ enabled: false, autoEnabled: true, reason: null, updatedAt: null, failures: [] });
export function maintenanceState(data: unknown): MaintenanceState {
  const d = (data ?? {}) as Partial<MaintenanceState>;
  return {
    enabled: d.enabled === true,
    autoEnabled: d.autoEnabled !== false,
    reason: d.reason === 'manual' || d.reason === 'kimi_quota' ? d.reason : null,
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : null,
    failures: Array.isArray(d.failures) ? d.failures.filter(n => typeof n === 'number' && Number.isFinite(n)).slice(-MAINTENANCE_FAILURE_THRESHOLD) : [],
  };
}
/** Account exhaustion only. A prompt/context limit or temporary RPM/TPM throttle must not stop the site. */
export function isKimiQuotaFailure(provider: string, error: unknown): boolean {
  if (!/kimi|moonshot/i.test(provider)) return false;
  const e = error as { message?: unknown; code?: unknown; error?: { message?: unknown; code?: unknown } } | null;
  const text = [e?.message, e?.code, e?.error?.message, e?.error?.code, typeof error === 'string' ? error : ''].join(' ');
  if (/context.{0,25}(length|window|limit)|maximum context|prompt.{0,15}(long|large)|max_tokens|tokens per minute|tokens_per_minute|rate.?limit|requests per minute/i.test(text)) return false;
  return /insufficient[_ -]?(quota|balance|credit)|quota[_ -]?(exceeded|exhausted)|exceeded.{0,20}quota|out of (tokens?|credits?)|token.{0,15}(quota|balance).{0,15}(exhausted|exceeded|insufficient)|credit balance.{0,20}(low|exhausted)|balance.{0,20}(insufficient|exhausted)|arrearage/i.test(text);
}
export interface MaintenanceBackend {
  read(): Promise<unknown>;
  change(fn: (old: MaintenanceState) => MaintenanceState): Promise<MaintenanceState>;
  subscribe?(fn: (data: unknown) => void, error: () => void): () => void;
}
function firestoreBackend(): MaintenanceBackend {
  const db: Firestore | null = getServerDb();
  if (!db) throw new Error("Maintenance storage unavailable");
  const ref = db.collection(MAINTENANCE_COLLECTION).doc(MAINTENANCE_DOCUMENT);
  return {
    read: async () => (await ref.get()).data(),
    change: fn => db.runTransaction(async tx => {
      const next = fn(maintenanceState((await tx.get(ref)).data()));
      tx.set(ref, next);
      return next;
    }),
    subscribe: (fn, error) => ref.onSnapshot(snap => fn(snap.data()), error),
  };
}
export class AiMaintenanceStore {
  private value: MaintenanceState | null = null;
  private readAt = 0;
  private generation = 0;
  private pending: Promise<MaintenanceState> | null = null;
  private stopWatch?: () => void;
  private readonly listeners = new Set<(state: MaintenanceState) => void>();
  constructor(private backend: () => MaintenanceBackend = firestoreBackend, private now: () => number = Date.now) {}
  private accept(state: MaintenanceState): MaintenanceState {
    this.value = state; this.readAt = this.now();
    for (const fn of this.listeners) fn(state);
    return state;
  }
  onChange(fn: (state: MaintenanceState) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  /** No paid calls on an unreadable setting. Never report a failed admin save as successful. */
  async read(): Promise<MaintenanceState> {
    if (this.value && this.now() - this.readAt < 2_000) return this.value;
    if (this.pending) return this.pending;
    const generation = this.generation;
    this.pending = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const data = await Promise.race([
          this.backend().read(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Maintenance setting unavailable')), 1_500); }),
        ]);
        // An old read finishing after an admin write must never turn maintenance back off.
        if (generation !== this.generation && this.value) return this.value;
        return this.accept(maintenanceState(data));
      } catch {
        return { ...(this.value ?? defaults()), enabled: true, unavailable: true };
      } finally { if (timer) clearTimeout(timer); this.pending = null; }
    })();
    return this.pending;
  }
  start(): void {
    if (this.stopWatch) return;
    try {
      this.stopWatch = this.backend().subscribe?.(data => { this.generation++; this.accept(maintenanceState(data)); }, () => {
        this.readAt = 0; this.stopWatch?.(); this.stopWatch = undefined;
      });
    } catch { /* read() still refuses spending until storage can be read. */ }
  }
  async set(patch: { enabled?: boolean; autoEnabled?: boolean }): Promise<MaintenanceState> {
    const value = await this.backend().change(old => ({
      ...old, ...patch,
      reason: patch.enabled === undefined ? old.reason : patch.enabled ? 'manual' : null,
      failures: patch.enabled === false || patch.autoEnabled === false ? [] : old.failures,
      updatedAt: this.now(),
    }));
    this.generation++; return this.accept(value);
  }
  async recordFailure(provider: string, error: unknown): Promise<void> {
    if (!isKimiQuotaFailure(provider, error)) return;
    const now = this.now();
    try {
      const value = await this.backend().change(old => {
        if (!old.autoEnabled || old.enabled) return old;
        const failures = [...old.failures.filter(t => t > now - MAINTENANCE_FAILURE_WINDOW_MS && t <= now), now].slice(-MAINTENANCE_FAILURE_THRESHOLD);
        const trip = failures.length >= MAINTENANCE_FAILURE_THRESHOLD;
        return { ...old, failures, enabled: trip, reason: trip ? 'kimi_quota' : old.reason, updatedAt: trip ? now : old.updatedAt };
      });
      this.generation++; this.accept(value);
    } catch {
      // Trip this instance closed too: persistence failure cannot authorise expensive fallbacks.
      this.accept({ ...(this.value ?? defaults()), enabled: true, unavailable: true, reason: 'kimi_quota', updatedAt: now });
    }
  }
}
export class AiMaintenanceError extends Error {
  readonly status = 503;
  constructor() { super(MAINTENANCE_MESSAGE); this.name = 'AiMaintenanceError'; }
}
export const aiMaintenanceStore = new AiMaintenanceStore();
export async function assertAiAvailable(): Promise<void> {
  // Unit tests never read a production setting. Store and HTTP tests use injected stores instead.
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
  aiMaintenanceStore.start();
  if ((await aiMaintenanceStore.read()).enabled) throw new AiMaintenanceError();
}
