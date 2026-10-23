import type { Firestore } from '../../lib/serverDb';
import type { FreeChainTelemetry } from './telemetry';
import { controlRef } from './control';
export function shouldPersistFreeChainEvent(requestId: string): boolean { return parseInt(requestId.replace(/-/g, '').slice(-4), 16) % 64 === 0; }
export async function persistFreeChainSample(db: Firestore, trace: FreeChainTelemetry, ok: boolean): Promise<void> {
  if (!shouldPersistFreeChainEvent(trace.requestId)) return;
  const slot = parseInt(trace.requestId.replace(/-/g, '').slice(0, 8), 16) % 4096;
  try { await controlRef(db).collection('events').doc(String(slot)).set({ ...trace, samplingProbability: 1 / 64, at: Date.now(), ok }); } catch { /* Telemetry is best-effort and never authorizes dispatch. */ }
}
