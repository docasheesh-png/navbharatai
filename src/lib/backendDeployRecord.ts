// WHERE YOUR BACKEND IS, AFTER A RELOAD TOO (Q-806, found by the Render audit of 2026-09-07).
//
// "Deploy backend" told the user the truth while the screen stayed open — "Your backend is live at …" — and then
// forgot it. Nothing durable held the service, its address or its last verdict, so a reload showed the button
// again as if nothing had ever been deployed, and the live address was gone from the screen. THE CLASS: a fact
// learned once, kept only in a screen's memory. The deploy and each status check now write it on the app's own
// record, and the Publish screen reads it back when it opens. PURE — shared by the server and the screen.

export interface BackendDeployRecord {
  serviceId: string;
  url: string;
  /** true live, false came up broken, null not yet known. */
  live: boolean | null;
  /** Our own phase word: 'in-progress' | 'live' | 'failed' | the verdict's phase. Never the host's raw status. */
  phase: string;
  /** The last sentence the user was shown about it — ours, white-label. */
  message: string;
  deployedAt: number;
  checkedAt: number;
}

/** A check still worth resuming after a reload: an unknown verdict on a deploy younger than this. */
export const RESUME_CHECK_WITHIN_MS = 15 * 60_000;

/** The record a fresh deploy writes. PURE. */
export function deployedRecord(serviceId: string, url: string, nowMs: number): BackendDeployRecord {
  return { serviceId, url, live: null, phase: 'in-progress', message: 'Deployed — checking whether it comes up.', deployedAt: nowMs, checkedAt: 0 };
}

/** The record after a status check — only for the service the record is about. PURE. */
export function checkedRecord(
  prev: BackendDeployRecord | null | undefined,
  serviceId: string,
  verdict: { live?: boolean; phase?: string; message?: string },
  nowMs: number,
): BackendDeployRecord | null {
  if (!prev || prev.serviceId !== serviceId) return null;
  if (verdict.phase === 'in-progress') return { ...prev, checkedAt: nowMs };
  return {
    ...prev,
    live: typeof verdict.live === 'boolean' ? verdict.live : null,
    phase: String(verdict.phase ?? (verdict.live ? 'live' : 'failed')).slice(0, 40),
    message: String(verdict.message ?? '').slice(0, 400),
    checkedAt: nowMs,
  };
}

/** Read a stored or served record. Anything without a service and an address is not a record. PURE. */
export function readBackendDeployRecord(raw: unknown): BackendDeployRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.serviceId !== 'string' || !r.serviceId || typeof r.url !== 'string') return null;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    serviceId: r.serviceId,
    url: r.url,
    live: typeof r.live === 'boolean' ? r.live : null,
    phase: typeof r.phase === 'string' ? r.phase : 'in-progress',
    message: typeof r.message === 'string' ? r.message : '',
    deployedAt: num(r.deployedAt),
    checkedAt: num(r.checkedAt),
  };
}

/** What the Publish screen says about it when it opens, and whether to keep checking. PURE. */
export function backendDeployView(rec: BackendDeployRecord | null, nowMs: number): { line: string; resumeCheck: boolean } | null {
  if (!rec) return null;
  const where = rec.url ? ` at ${rec.url}` : '';
  if (rec.live === true) return { line: `✅ Your backend is live${where}.`, resumeCheck: false };
  if (rec.live === false) return { line: `⚠️ ${rec.message || `Your backend${where} did not come up.`}`, resumeCheck: false };
  const fresh = rec.deployedAt > 0 && nowMs - rec.deployedAt < RESUME_CHECK_WITHIN_MS;
  return fresh
    ? { line: `⏳ Your backend was deployed${where} and is still being checked.`, resumeCheck: true }
    : { line: `ℹ️ Your backend was deployed${where}, but whether it came up was never confirmed. Open that address to check, or deploy again.`, resumeCheck: false };
}
