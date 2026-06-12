// 12.4 — A/B testing / feature flag infrastructure
// Flags are evaluated once per device and stored in localStorage for consistency.

export type FlagName = 'new_onboarding_v2' | 'show_referral_banner' | 'pro_upsell_chat';

const STORAGE_KEY = 'navbharat_flags';

function loadFlags(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function saveFlags(flags: Record<string, boolean>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(flags)); } catch {}
}

// Deterministic bucketing: hash deviceId into [0,100)
function bucket(deviceId: string, salt: string): number {
  let h = 5381;
  for (const c of deviceId + salt) h = ((h << 5) + h) ^ c.charCodeAt(0);
  return Math.abs(h) % 100;
}

const deviceId = (() => {
  const k = 'navbharat_did';
  const existing = localStorage.getItem(k);
  if (existing) return existing;
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem(k, id);
  return id;
})();

// Flag definitions: name → rollout % (0-100)
const FLAG_ROLLOUT: Record<FlagName, number> = {
  new_onboarding_v2:  50,
  show_referral_banner: 30,
  pro_upsell_chat:    20,
};

const _cache = loadFlags();
let _dirty = false;

export function isEnabled(flag: FlagName): boolean {
  if (flag in _cache) return _cache[flag];
  const rollout = FLAG_ROLLOUT[flag] ?? 0;
  const enabled = bucket(deviceId, flag) < rollout;
  _cache[flag] = enabled;
  _dirty = true;
  if (_dirty) { saveFlags(_cache); _dirty = false; }
  return enabled;
}

export function overrideFlag(flag: FlagName, value: boolean) {
  _cache[flag] = value;
  saveFlags(_cache);
}
