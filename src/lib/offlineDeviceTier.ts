// Device-capability detection for the on-device "Offline Thinking (beta)" (Stage-1 LLM roadmap, PR-2).
// A phone can only run an on-device AI model if it has WebGPU + enough RAM + enough free storage. This
// module honestly probes those real signals and RECOMMENDS the largest model tier the device can run —
// it never forces a download, and a device that can't run any model cleanly stays on the deterministic
// chat (tier 0). `recommendTier` is pure/unit-tested; `probeDevice` is the thin browser-glue that gathers
// the signals (guarded, so it degrades to "unsupported" rather than throwing on any platform).

/** 0 = deterministic only (no model); 1..3 = increasingly capable on-device model tiers. */
export type OfflineTier = 0 | 1 | 2 | 3;

export interface DeviceSignals {
  /** WebGPU is available AND an adapter could be obtained (required to run any model). */
  webgpu: boolean;
  /** Approx device RAM in GB (navigator.deviceMemory; coarse, capped at 8, often present on Chrome). */
  ramGB?: number;
  /** Logical CPU cores (navigator.hardwareConcurrency) — a fallback signal when RAM is unknown. */
  cores?: number;
  /** Estimated free storage in GB (from navigator.storage.estimate()). */
  storageFreeGB?: number;
  /** The user asked the OS/browser to save data (navigator.connection.saveData). */
  saveData?: boolean;
}

export interface TierInfo {
  label: string;
  /** Approx download size in MB (the beta model is fetched once, then cached on-device). */
  approxDownloadMB: number;
  /** Minimum comfortable RAM in GB. */
  minRamGB: number;
}

export const TIER_INFO: Record<OfflineTier, TierInfo> = {
  0: { label: 'Deterministic (no model)', approxDownloadMB: 0, minRamGB: 0 },
  1: { label: 'Stage 1 · compact', approxDownloadMB: 400, minRamGB: 4 },
  2: { label: 'Stage 2 · standard', approxDownloadMB: 900, minRamGB: 6 },
  3: { label: 'Stage 3 · large', approxDownloadMB: 2000, minRamGB: 8 },
};

export interface TierRecommendation {
  /** The highest tier the device can comfortably run (0 = deterministic only). */
  tier: OfflineTier;
  /** True when an on-device model (tier ≥ 1) can run here. */
  supported: boolean;
  /** Honest, human-readable explanation (safe to show the user). */
  reason: string;
}

/** Headroom multiplier so we only recommend a tier we can store with room to spare. */
const STORAGE_HEADROOM = 1.3;

/**
 * Recommend the largest on-device model tier this device can run, from its capability signals. Pure and
 * conservative: no WebGPU → tier 0 (deterministic only); otherwise pick by RAM (falling back to cores when
 * RAM is unknown), then step down if free storage can't hold that tier. Never throws. Pure.
 */
export function recommendTier(s: DeviceSignals): TierRecommendation {
  if (!s.webgpu) {
    return {
      tier: 0,
      supported: false,
      reason: "On-device AI needs WebGPU — update Chrome (Android) or use a device that supports it. The deterministic chat still works fully.",
    };
  }

  // Base tier by RAM; when RAM isn't reported, use CPU cores as a cautious fallback (WebGPU already
  // implies a reasonably modern device, so a bare minimum of tier 1).
  let tier: OfflineTier;
  if (s.ramGB != null) {
    tier = s.ramGB >= 8 ? 3 : s.ramGB >= 6 ? 2 : s.ramGB >= 4 ? 1 : 0;
  } else {
    const cores = s.cores ?? 0;
    tier = cores >= 8 ? 2 : 1;
  }

  // Step down until the chosen tier fits in free storage (with headroom).
  if (s.storageFreeGB != null) {
    while (tier > 0 && s.storageFreeGB * 1000 < TIER_INFO[tier].approxDownloadMB * STORAGE_HEADROOM) {
      tier = (tier - 1) as OfflineTier;
    }
  }

  if (tier === 0) {
    return {
      tier: 0,
      supported: false,
      reason: "This device runs the deterministic chat, but not the on-device AI model (not enough memory or free storage).",
    };
  }
  return {
    tier,
    supported: true,
    reason: `Your device can run ${TIER_INFO[tier].label} (~${TIER_INFO[tier].approxDownloadMB} MB, downloaded once).`,
  };
}

/** A navigator-like surface, so probeDevice can be unit-tested with a fake. */
export interface NavigatorLike {
  gpu?: { requestAdapter: () => Promise<unknown> };
  deviceMemory?: number;
  hardwareConcurrency?: number;
  storage?: { estimate?: () => Promise<{ quota?: number; usage?: number }> };
  connection?: { saveData?: boolean };
}

/** True when WebGPU is present and an adapter can actually be obtained. Guarded — never throws. */
export async function hasWebGpu(nav: NavigatorLike): Promise<boolean> {
  try {
    if (!nav.gpu?.requestAdapter) return false;
    const adapter = await nav.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/** Gather this device's real capability signals. Browser-only glue — each probe is guarded so it degrades
 *  gracefully (missing API → undefined, never a throw). */
export async function probeDevice(nav?: NavigatorLike): Promise<DeviceSignals> {
  const n = nav ?? (typeof navigator !== 'undefined' ? (navigator as unknown as NavigatorLike) : undefined);
  if (!n) return { webgpu: false };

  const webgpu = await hasWebGpu(n);
  const ramGB = typeof n.deviceMemory === 'number' ? n.deviceMemory : undefined;
  const cores = typeof n.hardwareConcurrency === 'number' ? n.hardwareConcurrency : undefined;
  const saveData = n.connection?.saveData;

  let storageFreeGB: number | undefined;
  try {
    const est = await n.storage?.estimate?.();
    if (est && typeof est.quota === 'number' && typeof est.usage === 'number') {
      storageFreeGB = Math.max(0, (est.quota - est.usage) / 1e9);
    }
  } catch {
    /* storage estimate unavailable — leave undefined */
  }

  return { webgpu, ramGB, cores, storageFreeGB, saveData };
}
