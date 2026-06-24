// Real-time USD→INR exchange rate for customer billing (always shown in INR).
//
// The billing path must NEVER block or throw on the FX source, so this keeps a CACHED
// rate that is refreshed best-effort in the background; readers (`usdInrRate()`) always
// return synchronously. On any fetch failure the last good value (or the env/default
// fallback) is kept. Default/fallback is `USD_INR_RATE` (env) or 85.

/** Fallback rate from env, or 85. */
function fallbackRate(): number {
  const n = Number(process.env.USD_INR_RATE);
  return Number.isFinite(n) && n > 0 ? n : 85;
}

let cached = fallbackRate();
let lastUpdated = 0;

/** The current USD→INR rate (synchronous; never throws). */
export function usdInrRate(): number {
  return cached;
}

/** Epoch ms of the last successful live refresh (0 if never). */
export function usdInrRateUpdatedAt(): number {
  return lastUpdated;
}

/** Manually set the rate (ops override / tests). Ignores non-positive values. */
export function setUsdInrRate(rate: number): void {
  if (Number.isFinite(rate) && rate > 0) cached = rate;
}

/** Convert a USD amount to INR at the current cached rate. */
export function usdToInr(usd: number): number {
  return Math.max(0, usd) * cached;
}

type FetchJson = (url: string) => Promise<unknown>;

const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
  return res.json();
};

/**
 * Best-effort live refresh from a free no-key FX source. Updates the cache on success;
 * on ANY failure keeps the last good value. Never throws. Returns the (possibly unchanged)
 * current rate. `fetchJson` is injectable for tests (no network).
 */
export async function refreshUsdInrRate(fetchJson: FetchJson = defaultFetchJson): Promise<number> {
  try {
    const data = (await fetchJson('https://open.er-api.com/v6/latest/USD')) as { rates?: { INR?: unknown } };
    const rate = Number(data?.rates?.INR);
    if (Number.isFinite(rate) && rate > 0) {
      cached = rate;
      lastUpdated = Date.now();
    }
  } catch {
    // keep last good / fallback — billing must never break on FX
  }
  return cached;
}

// Best-effort periodic refresh in production only (never under tests — no network in CI).
if (!process.env.VITEST) {
  void refreshUsdInrRate();
  const timer = setInterval(() => void refreshUsdInrRate(), 60 * 60 * 1000);
  // Don't keep the process alive just for the FX refresher.
  (timer as { unref?: () => void }).unref?.();
}
