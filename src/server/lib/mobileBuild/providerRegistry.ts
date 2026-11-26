// Which Android build providers can run RIGHT NOW, and why not when one cannot (2026-11-25).
//
// The UI shows exactly two choices. A choice that cannot run is still SHOWN, greyed, with the honest
// reason — never hidden (the user would not know the option exists) and never offered as if it worked
// (rule 2: a button must do what it says). Every reason names what is missing, so the admin can act on it.
//
// 🔒 Configuration is read from env at call time (an env value always beats a code default, and a Cloud
// Run change must apply without a deploy). Nothing here is a credential: it only reports PRESENCE.

import { parseEnvFlag } from '../envFlag';
import type { MobileArtifactKind, MobileBuildProviderId } from './types';

export interface ProviderCapability {
  id: MobileBuildProviderId;
  label: string;
  available: boolean;
  /** Why it cannot run now — set exactly when `available` is false. User-safe wording, no vendor names. */
  unavailableReason: string | null;
  /** Admin-facing: the configuration names that are missing (names only, never values). */
  missing: string[];
  artifacts: MobileArtifactKind[];
  requiresGithub: boolean;
  /** Per artifact: how the delivered file is signed. */
  signing: Record<MobileArtifactKind, string>;
}

type Env = Record<string, string | undefined>;

function present(env: Env, name: string): boolean {
  return typeof env[name] === 'string' && env[name]!.trim().length > 0;
}

/** Same parsing as envFlag (the one flag reader), against an injectable env so tests need no global mutation. */
function flag(env: Env, name: string, dflt: boolean): boolean {
  return parseEnvFlag(env[name]) ?? dflt;
}

/** The E2B template alias of the Capacitor Android worker (infra/e2b/e2b-android-native.Dockerfile). */
export function nativeBuildTemplate(env: Env = process.env): string | null {
  const t = (env.MOBILE_NATIVE_BUILD_TEMPLATE ?? '').trim();
  return /^[A-Za-z0-9_-]{1,100}$/.test(t) ? t : null;
}

/** The private bucket native artifacts are kept in. Same fallback convention as the Nav Store bucket. */
export function nativeArtifactBucket(env: Env = process.env): string | null {
  const b = (env.MOBILE_BUILD_ARTIFACT_BUCKET ?? env.FIREBASE_STORAGE_BUCKET ?? '').trim();
  return /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(b) ? b : null;
}

/** Signing keys are sealed with the platform secret key (secrets.ts encrypt). Production refuses the dev fallback. */
export function signingKeySealAvailable(env: Env = process.env): boolean {
  return present(env, 'SECRET_ENCRYPTION_KEY') || present(env, 'SECRET_KEY_V1');
}

function clampInt(raw: string | undefined, dflt: number, min: number, max: number): number {
  const n = Number((raw ?? '').trim());
  if (!(raw ?? '').trim() || !Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function nativeLimits(env: Env = process.env): { perUser: number; system: number; buildTimeoutMs: number; retentionDays: number } {
  return {
    perUser: clampInt(env.MOBILE_NATIVE_BUILD_MAX_ACTIVE_PER_USER, 1, 1, 5),
    system: clampInt(env.MOBILE_NATIVE_BUILD_MAX_ACTIVE, 4, 1, 50),
    buildTimeoutMs: clampInt(env.MOBILE_NATIVE_BUILD_TIMEOUT_MIN, 25, 5, 55) * 60_000,
    retentionDays: clampInt(env.MOBILE_NATIVE_BUILD_RETENTION_DAYS, 30, 1, 365),
  };
}

export function githubBuildEnabled(env: Env = process.env): boolean {
  return flag(env, 'MOBILE_GITHUB_BUILD_ENABLED', true);
}

export function nativeBuildEnabled(env: Env = process.env): boolean {
  return flag(env, 'MOBILE_NATIVE_BUILD_ENABLED', false);
}

/** Native readiness for one artifact kind: the missing configuration names (empty = ready). */
export function nativeMissing(kind: MobileArtifactKind | null, env: Env = process.env): string[] {
  const missing: string[] = [];
  if (!nativeBuildEnabled(env)) missing.push('MOBILE_NATIVE_BUILD_ENABLED');
  if (!present(env, 'E2B_API_KEY')) missing.push('E2B_API_KEY');
  if (!nativeBuildTemplate(env)) missing.push('MOBILE_NATIVE_BUILD_TEMPLATE');
  if (!nativeArtifactBucket(env)) missing.push('MOBILE_BUILD_ARTIFACT_BUCKET');
  if (kind === 'aab' && !signingKeySealAvailable(env)) missing.push('SECRET_ENCRYPTION_KEY');
  return missing;
}

export function providerCapabilities(env: Env = process.env): ProviderCapability[] {
  const nativeAll = nativeMissing(null, env);
  const nativeAab = nativeMissing('aab', env);
  const nativeArtifacts: MobileArtifactKind[] = nativeAll.length > 0 ? [] : nativeAab.length > 0 ? ['apk'] : ['apk', 'aab'];
  const gh = githubBuildEnabled(env);
  return [
    {
      id: 'native_cloud',
      label: 'NavBharatAI Native Cloud Build',
      available: nativeArtifacts.length > 0,
      unavailableReason: nativeArtifacts.length > 0 ? null : 'Native Cloud Build is not switched on yet. Use the GitHub option for now.',
      missing: nativeAab,
      artifacts: nativeArtifacts,
      requiresGithub: false,
      signing: {
        apk: 'Debug-signed — for installing and testing on a phone. Not for Google Play.',
        aab: 'Signed with your own upload key, kept encrypted by NavBharatAI with your consent.',
      },
    },
    {
      id: 'github_actions',
      label: 'GitHub Actions Build',
      available: gh,
      unavailableReason: gh ? null : 'GitHub builds are switched off right now.',
      missing: gh ? [] : ['MOBILE_GITHUB_BUILD_ENABLED'],
      artifacts: gh ? ['apk', 'aab'] : [],
      requiresGithub: true,
      signing: {
        apk: 'Debug-signed — for installing and testing on a phone. Not for Google Play.',
        aab: 'Signed with the upload key kept as a secret in your own GitHub repository.',
      },
    },
  ];
}
