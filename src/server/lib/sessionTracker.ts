/**
 * P-SEC.13 — Device fingerprinting + session binding.
 *
 * Firebase ID tokens are validated per-request but carry no device identity, so a replayed
 * token from a different device/IP is invisible. This module binds a lightweight device
 * fingerprint (hashed User-Agent + hashed IP) to each user and DETECTS + AUDITS anomalies
 * (a new device, a UA change) on sensitive operations.
 *
 * DESIGN — detection, not hard-blocking (deliberate):
 *   Real users' fingerprints change constantly — the UA string bumps on every browser update,
 *   the IP changes on every mobile-network handover. HARD-blocking on a mismatch would lock out
 *   legitimate users, which violates the "app must never break" rule. So this records the device,
 *   emits an audit event + an honest `X-Device-New` response signal on a first-seen device, and
 *   leaves the request to proceed. A hard step-up RE-AUTH prompt is a separate, deferred item
 *   (it needs the user-login UI, which carries breakage risk — safeguard #3).
 *
 * IMPOSSIBLE-TRAVEL (geo-velocity) is also deferred: it needs an external GeoIP database/service
 * that does not exist for this project yet — per "real features only", it is NOT faked here.
 *
 * Everything is BEST-EFFORT: a Firestore outage or VITEST never blocks or breaks a request.
 * The pure fingerprint + evaluation functions are exported and unit-tested.
 */
import crypto from 'crypto';

/** Stable short hash of a value (truncated SHA-256 hex) — we store hashes, never raw IPs (privacy). */
export function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export interface DeviceFingerprint {
  uaHash: string;
  ipHash: string;
}

/** Compute a device fingerprint from the request's User-Agent + IP. Pure + deterministic. */
export function computeFingerprint(userAgent: string | undefined | null, ip: string | undefined | null): DeviceFingerprint {
  return {
    uaHash: hashValue(String(userAgent || 'unknown')),
    ipHash: hashValue(String(ip || 'unknown')),
  };
}

export type DeviceRisk = 'none' | 'low' | 'high';

export interface DeviceEvaluation {
  /** True when the exact (UA+IP) fingerprint was seen before. */
  known: boolean;
  /** True when this UA-hash has been seen before for the user (even from a different IP). */
  uaSeen: boolean;
  /** True when this IP-hash has been seen before for the user. */
  ipSeen: boolean;
  /**
   * none → exact match · low → known device, new IP (e.g. mobile handover) · high → brand-new
   * UA never seen for this user (the strongest device-change signal).
   */
  risk: DeviceRisk;
}

/**
 * Compare a current fingerprint against the user's known devices. Pure — caller supplies the
 * history. A new UA is `high` risk (a different device/browser); a known UA from a new IP is
 * `low` (routine for mobile users); an exact match is `none`.
 */
export function evaluateDevice(known: DeviceFingerprint[], current: DeviceFingerprint): DeviceEvaluation {
  const uaSeen = known.some((d) => d.uaHash === current.uaHash);
  const ipSeen = known.some((d) => d.ipHash === current.ipHash);
  const exact = known.some((d) => d.uaHash === current.uaHash && d.ipHash === current.ipHash);
  let risk: DeviceRisk = 'none';
  if (!exact) risk = uaSeen ? 'low' : 'high';
  // First-ever device (empty history) establishes a baseline — not itself an anomaly.
  if (known.length === 0) risk = 'none';
  return { known: exact, uaSeen, ipSeen, risk };
}

// Cap stored devices per user so the doc can't grow unbounded; evict oldest by lastSeen.
const MAX_DEVICES_PER_USER = 20;

interface StoredDevice extends DeviceFingerprint { firstSeen: string; lastSeen: string }

async function getAdminFirestore(): Promise<import('firebase-admin/firestore').Firestore | null> {
  if (process.env.VITEST) return null;
  try {
    const admin = await import('firebase-admin');
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return admin.firestore();
  } catch {
    return null;
  }
}

/**
 * Record the current device for a user and return how it compares to known devices. Best-effort:
 * on any DB error (or VITEST) it returns a benign evaluation and never throws. New devices are
 * appended; an existing device's `lastSeen` is refreshed.
 */
export async function recordAndEvaluateDevice(
  uid: string,
  userAgent: string | undefined | null,
  ip: string | undefined | null,
  nowIso: string,
): Promise<DeviceEvaluation> {
  const current = computeFingerprint(userAgent, ip);
  const db = await getAdminFirestore();
  if (!db) return { known: false, uaSeen: false, ipSeen: false, risk: 'none' };
  try {
    const ref = db.collection('user_sessions').doc(uid);
    const snap = await ref.get();
    const stored: StoredDevice[] = (snap.exists ? snap.data()?.devices : null) || [];
    const evaluation = evaluateDevice(stored, current);

    const idx = stored.findIndex((d) => d.uaHash === current.uaHash && d.ipHash === current.ipHash);
    let next: StoredDevice[];
    if (idx >= 0) {
      next = stored.slice();
      next[idx] = { ...next[idx], lastSeen: nowIso };
    } else {
      next = [...stored, { ...current, firstSeen: nowIso, lastSeen: nowIso }];
    }
    // Keep the most-recently-seen devices if over the cap.
    if (next.length > MAX_DEVICES_PER_USER) {
      next = next.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1)).slice(0, MAX_DEVICES_PER_USER);
    }
    await ref.set({ devices: next, updatedAt: nowIso }, { merge: true });
    return evaluation;
  } catch (err) {
    console.error('[SESSION_TRACKER] record/evaluate failed:', err);
    return { known: false, uaSeen: false, ipSeen: false, risk: 'none' };
  }
}
