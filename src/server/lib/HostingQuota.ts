/**
 * HostingQuota — the SINGLE source of truth for NavBharatAI's "who-pays / how-much" hosting rules.
 *
 * WHY (build-diagnostics + admin cost review, 2026-07-04): the platform pays for every FIRST-PARTY
 * deploy (its own Firebase Hosting today, Cloudflare later) and there was NO size cap and NO count
 * cap — an open cost/abuse hole (one user could publish unlimited / huge apps on the platform's bill).
 * This module owns the policy; it is ENFORCED at one physical choke point (withDeploymentPersistence
 * in DeploymentStore.ts) so the rule lives in exactly one place and every first-party deploy passes it.
 *
 * Design invariants (cloned from the proven checkMonthlyCap / userMonthlyCapUsd template):
 *   • The COUNT cap is env-gated and DISABLED by default (0 = off) → zero behaviour change until the
 *     admin opts in with a number. The SIZE cap ships ON with a safe 50MB default (a normal SPA dist
 *     is <20MB, so no legitimate app is blocked, and it closes the oversized-upload vector with no
 *     admin config).
 *   • FAIL-OPEN: any missing userId / disabled cap / store error / timeout resolves to allowed=true —
 *     a quota-store outage must NEVER wrongly block a legitimate deploy (rule #1: never break the app).
 *   • Only FIRST-PARTY providers (platform pays) are counted; BYO-token deploys (the user's own
 *     GitHub/Netlify/Vercel/Cloudflare token) are the user's own cost and are never counted here.
 *   • Over-limit returns an HONEST message (specific used/cap + reset + a real BYO alternative) — the
 *     caller throws it as the deploy result; nothing is published, no fake success.
 */
import { hostingUsageStore } from './HostingUsageStore';
import { deploymentStore } from '../AgentV3/DeploymentStore';

/** Providers where NavBharatAI foots the hosting bill (so the quota + size cap apply). */
export const FIRST_PARTY_PROVIDERS = new Set<string>(['firebase', 'cloudflare']);

export function isFirstPartyProvider(providerId: string | null | undefined): boolean {
  return !!providerId && FIRST_PARTY_PROVIDERS.has(String(providerId).toLowerCase());
}

/** Monthly free first-party deploy cap. Env AGENTV3_USER_MONTHLY_DEPLOY_CAP; 0 / unset = DISABLED. */
export function hostingDeployCap(): number {
  const raw = Number(process.env.AGENTV3_USER_MONTHLY_DEPLOY_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** Per-deploy bundle ceiling in MB. Env AGENTV3_DEPLOY_MAX_MB; default 50 (safe ON). 0 = disabled. */
export function maxDeployMb(): number {
  const raw = Number(process.env.AGENTV3_DEPLOY_MAX_MB);
  if (Number.isFinite(raw) && raw >= 0) return raw; // allow explicit 0 (disable) or a custom value
  return 50;
}

/**
 * Total live first-party hosting one user may hold, in MB. Env AGENTV3_USER_STORAGE_CAP_MB; 0 = off.
 *
 * WHY THIS EXISTS ON TOP OF THE PER-PUBLISH CAP (admin 2026-08-21: "sara 10gb ek hi user kha gaya to
 * mera dhanda manda ho jayega"). The 50 MB per-publish ceiling bounds ONE app; it says nothing about
 * how many. With unlimited apps a single account could hold the whole 10 GB free Firebase allowance —
 * the exact hole the admin named, and one the UI already implied was closed ("Fair-use limits apply").
 *
 * DEFAULT 200 MB, and ON. A published SPA is typically well under 1 MB, so this is room for hundreds
 * of apps: it cannot reach a legitimate user, which is what makes shipping it enabled safe. It bounds
 * abuse, not use.
 */
export function hostingStorageCapMb(): number {
  // ⚠️ An EMPTY value means unset, not zero. `Number('')` is 0 — finite and non-negative — so the
  // obvious implementation turns a key set with no value in Cloud Run into a silent, total removal of
  // the protection, with nothing in the logs to explain it. Only a deliberate "0" disables the cap.
  // (Exactly the trap terminalQuota.ts documents; caught here by this module's own test.)
  const raw = String(process.env.AGENTV3_USER_STORAGE_CAP_MB ?? '').trim();
  if (!raw) return 200;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 200;
}

/**
 * How many DISTINCT apps one user may keep published on NavBharatAI's own hosting. 0 = off.
 *
 * WHY A COUNT AS WELL AS A SIZE AND A TOTAL (admin 2026-08-21: "maximum 5 free publish on
 * navbharatai — isse limit reach hone me thoda aram milega"). The three caps bound three different
 * things and none substitutes for another: MB-per-publish bounds one bundle, total-MB bounds a user's
 * disk, and this bounds the scarcest resource of all — Firebase Hosting CHANNELS. Every published app
 * holds one channel on one site, and that pool is capped for the WHOLE PLATFORM (ROADMAP §10), so the
 * count is what the ceiling is actually made of.
 *
 * ⚠️ IT COUNTS APPS, NOT PUBLISHES. Republishing an app reuses its channel and costs nothing new, so
 * charging for it would punish shipping a fix — the behaviour we most want. `liveAppCount` therefore
 * excludes the workspace being republished, exactly as the storage cap does.
 */
export function publishedAppCap(): number {
  // Empty means unset, not zero — see hostingStorageCapMb for the trap this avoids.
  const raw = String(process.env.AGENTV3_USER_PUBLISHED_APP_CAP ?? '').trim();
  if (!raw) return 5;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5;
}

/** Pure: how many DISTINCT live first-party apps this user holds, excluding the one being republished. */
export function liveAppCount(
  records: ReadonlyArray<{ workspaceId?: string; status?: string; providerId?: string; firstParty?: boolean }>,
  excludeWorkspaceId?: string,
): number {
  const seen = new Set<string>();
  for (const r of records || []) {
    if (!r || !r.workspaceId || r.workspaceId === excludeWorkspaceId) continue;
    if (r.status && r.status !== 'active') continue;
    const firstParty = r.firstParty === true
      || (r.firstParty === undefined && (r.providerId === undefined || isFirstPartyProvider(r.providerId)));
    if (!firstParty) continue;
    seen.add(r.workspaceId);
  }
  return seen.size;
}

/**
 * Pure: the MB this user already holds live, EXCLUDING the app being republished.
 *
 * That exclusion is the whole correctness of the check. Publishing an update to an existing app
 * replaces its files rather than adding to them, so counting the old copy would charge a user twice
 * for one app and could refuse an update to something already published — punishing the safest thing
 * a user can do. Only LIVE first-party records count: a taken-down app holds nothing, and a BYO
 * deploy sits on the user's own bill.
 */
export function liveStorageMb(
  records: ReadonlyArray<{ workspaceId?: string; sizeMb?: number; status?: string; providerId?: string; firstParty?: boolean }>,
  excludeWorkspaceId?: string,
): number {
  let mb = 0;
  for (const r of records || []) {
    if (!r || r.workspaceId === excludeWorkspaceId) continue;
    if (r.status && r.status !== 'active') continue;
    // Legacy records predate both fields and were all first-party Firebase deploys — counting them
    // is accurate, not merely cautious.
    const firstParty = r.firstParty === true
      || (r.firstParty === undefined && (r.providerId === undefined || isFirstPartyProvider(r.providerId)));
    if (!firstParty) continue;
    mb += Number.isFinite(r.sizeMb) ? Number(r.sizeMb) : 0;
  }
  return Math.round(mb * 100) / 100;
}

/** Pure: is `used` within `cap`? A cap of 0 (or negative) means DISABLED → always within. */
export function hostingWithinCap(used: number, cap: number): boolean {
  if (!Number.isFinite(cap) || cap <= 0) return true;
  return (Number.isFinite(used) ? used : 0) < cap;
}

/** Pure: total decoded size of a file map, in MB. */
export function deployBytesMb(files: Map<string, Buffer> | null | undefined): number {
  if (!files || files.size === 0) return 0;
  let bytes = 0;
  for (const buf of files.values()) bytes += buf?.byteLength ?? 0;
  return bytes / (1024 * 1024);
}

export interface HostingQuotaVerdict {
  allowed: boolean;
  /** deploys already used this month (first-party); 0 when disabled/unknown. */
  used: number;
  /** the active monthly cap; 0 = disabled. */
  cap: number;
  /** this deploy's bundle size in MB (rounded to 2dp). */
  byteMb: number;
  /** honest, human-readable denial reason when !allowed; '' when allowed. */
  message: string;
}

const ALLOW = (used: number, cap: number, byteMb: number): HostingQuotaVerdict =>
  ({ allowed: true, used, cap, byteMb: Math.round(byteMb * 100) / 100, message: '' });

/**
 * Enforce the hosting policy for one deploy. Pure-ish: the only I/O is a best-effort monthly-count
 * read (fail-open). Call this BEFORE publishing. For a BYO provider it is a no-op allow in Phase 0
 * (content-safety + rate limiting land in a later slice); for a first-party provider it enforces the
 * size ceiling then the monthly count cap.
 */
export async function enforceHostingQuota(input: {
  userId: string | null | undefined;
  workspaceId: string;
  providerId: string | null | undefined;
  files: Map<string, Buffer>;
}): Promise<HostingQuotaVerdict> {
  const byteMb = deployBytesMb(input.files);

  // BYO / non-platform providers: user's own host + cost → no size/count quota here.
  if (!isFirstPartyProvider(input.providerId)) return ALLOW(0, 0, byteMb);

  // Size ceiling (ships ON, deterministic, fail-SAFE — a genuinely oversized bundle is refused).
  const sizeCap = maxDeployMb();
  if (sizeCap > 0 && byteMb > sizeCap) {
    return {
      allowed: false,
      used: 0,
      cap: 0,
      byteMb: Math.round(byteMb * 100) / 100,
      message:
        `This app's built files are ${byteMb.toFixed(1)} MB, over the ${sizeCap} MB per-publish hosting limit. ` +
        `Reduce the bundle (code-split, drop large images/assets into a CDN) and publish again, ` +
        `or connect your own host (GitHub Pages / Netlify / Vercel) to publish larger apps.`,
    };
  }

  // TOTAL LIVE STORAGE for this user — the cap that actually protects the 10 GB free allowance.
  // Bounded + fail-OPEN like every other gate here: a Firestore hiccup must never refuse a real
  // publish. The app being republished is excluded, so updating an existing app is never blocked.
  const storageCap = hostingStorageCapMb();
  if (storageCap > 0 && input.userId) {
    const records = await Promise.race([
      deploymentStore.listByUser(input.userId, 500),
      new Promise<null>((r) => setTimeout(() => r(null), 3_000)),
    ]).catch(() => null);
    if (records) {
      // COUNT first — it is the scarcer resource, and its message is the more actionable one.
      const appCap = publishedAppCap();
      if (appCap > 0) {
        const apps = liveAppCount(records, input.workspaceId);
        if (apps >= appCap) {
          return {
            allowed: false,
            used: apps,
            cap: appCap,
            byteMb: Math.round(byteMb * 100) / 100,
            message:
              `You already have ${apps} apps published on NavBharatAI, which is the free limit of ` +
              `${appCap}. Updating an app you have already published is always free and does not count ` +
              `against this. To publish a NEW one, remove an app you no longer need, or publish it to ` +
              `your own free host (Vercel / Netlify / Cloudflare Pages) — that runs on your account, ` +
              `free from us.`,
          };
        }
      }

      const heldMb = liveStorageMb(records, input.workspaceId);
      if (heldMb + byteMb > storageCap) {
        return {
          allowed: false,
          used: heldMb,
          cap: storageCap,
          byteMb: Math.round(byteMb * 100) / 100,
          message:
            `Your published apps already use ${heldMb.toFixed(1)} MB of your ${storageCap} MB of free ` +
            `NavBharatAI hosting, and this one needs ${byteMb.toFixed(1)} MB more. Delete an app you no ` +
            `longer need from your published apps, or publish this one to your own free host ` +
            `(Vercel / Netlify / Cloudflare Pages) — that runs on your account, free from us.`,
        };
      }
    }
  }

  // Monthly free first-party deploy count — DISABLED by default (fail-open, best-effort read).
  const cap = hostingDeployCap();
  if (cap <= 0 || !input.userId) return ALLOW(0, cap, byteMb);

  let used = 0;
  try {
    const usage = await hostingUsageStore.get(input.userId);
    used = usage?.deployCount ?? 0;
  } catch {
    return ALLOW(0, cap, byteMb); // store error → fail OPEN, never wrongly block a real deploy
  }

  if (!hostingWithinCap(used, cap)) {
    return {
      allowed: false,
      used,
      cap,
      byteMb: Math.round(byteMb * 100) / 100,
      message:
        `You've used all ${cap} free publishes this month (${used}/${cap}). Your free hosting resets at ` +
        `the start of next month. To publish now, connect your own free host (GitHub Pages / Netlify / ` +
        `Vercel) in Settings, or upgrade your hosting plan.`,
    };
  }
  return ALLOW(used, cap, byteMb);
}
