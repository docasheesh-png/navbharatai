// "Tell the users who are actually behind" — the targeting behind the admin's update broadcast.
//
// THE ASK (admin, 2026-08-11): an admin-panel button that notifies users when a new build is on Play,
// with a direct button to the store listing.
//
// WHY IT IS NOT "SEND TO EVERYONE". The obvious build is a blast to every registered device. It is
// also the version that destroys the feature: it notifies people who ALREADY updated. That is exactly
// the mistake the in-app banner has 32 tests preventing — and it is worse in a notification, because a
// notification interrupts. Tell someone on the newest build to "please update" once and they learn the
// notification is noise; the next one, the one that matters, goes unread.
//
// So the unit of sending is not "all users", it is THE STALE COHORT: devices whose reported
// versionCode is genuinely older than what is live on Play.
//
// THE RULES, each preventing a specific way a broadcast goes wrong:
//   • NEVER GUESS. A device that has not reported its version is NOT sent to. An unknown version is
//     not "probably old" — same rule as the banner, for the same reason.
//   • ANDROID ONLY. There is no iOS release (admin: no .ipa), so an "update" push to an iPhone would
//     lead nowhere.
//   • A SEND CANNOT BE UN-SENT. It requires an explicit confirmation carrying the count the admin was
//     shown, so a stale dashboard cannot fire at a cohort the admin never saw.
//   • NOT TWICE BY ACCIDENT. A cooldown blocks a second broadcast for the same version.
//
// Pure + dependency-free → the whole decision is unit-tested without Firestore or FCM.

export interface DeviceRow {
  uid: string;
  token: string;
  platform: string;
  /** The versionCode the device reported when it registered. Null = never reported. */
  appVersionCode?: number | null;
}

export interface StaleCohort {
  /** Devices that should receive the notification. */
  targets: DeviceRow[];
  /** Devices already on the latest build — deliberately untouched. */
  upToDate: number;
  /** Devices whose version we do not know. NOT sent to; counted so the gap is visible. */
  unknownVersion: number;
  /** Non-Android devices, excluded because there is no iOS release to send them to. */
  wrongPlatform: number;
}

const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

/**
 * Split every registered device into who should hear about the update and who should not.
 *
 * The three exclusion counts are returned rather than discarded because they are the honest answer to
 * "why did only 40% get it?" — a question that otherwise turns into a bug report.
 */
export function selectStaleDevices(devices: readonly DeviceRow[], latestVersionCode: number | null): StaleCohort {
  const latest = int(latestVersionCode);
  const out: StaleCohort = { targets: [], upToDate: 0, unknownVersion: 0, wrongPlatform: 0 };
  // Without a known latest version there is no such thing as "behind" — send to nobody.
  if (latest == null) {
    for (const d of devices ?? []) {
      if (String(d.platform).toLowerCase() !== 'android') out.wrongPlatform += 1;
      else out.unknownVersion += 1;
    }
    return out;
  }

  for (const d of devices ?? []) {
    if (!d?.token) continue;
    if (String(d.platform).toLowerCase() !== 'android') { out.wrongPlatform += 1; continue; }
    const v = int(d.appVersionCode);
    if (v == null) { out.unknownVersion += 1; continue; } // never guess
    if (v >= latest) { out.upToDate += 1; continue; }
    out.targets.push(d);
  }
  return out;
}

export interface BroadcastGate {
  allowed: boolean;
  reason: string;
}

/** A second broadcast for the SAME version is almost always a misclick. */
export const BROADCAST_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * May this broadcast go out?
 *
 * `confirmCount` is the count the admin was SHOWN. Requiring it back means a stale dashboard cannot
 * fire at a cohort that has since changed — the admin confirms a specific number of people, not a
 * button.
 */
export function canBroadcast(input: {
  targetCount: number;
  confirmCount: number | null;
  latestVersionCode: number | null;
  lastBroadcastVersionCode?: number | null;
  lastBroadcastAt?: number | null;
  now: number;
}): BroadcastGate {
  if (int(input.latestVersionCode) == null) {
    return { allowed: false, reason: 'ANDROID_LATEST_VERSION_CODE is not set — there is no release to announce.' };
  }
  if (input.targetCount <= 0) {
    return { allowed: false, reason: 'No device is on an older build — nobody needs this notification.' };
  }
  if (input.confirmCount == null) {
    return { allowed: false, reason: 'A broadcast must be confirmed with the number of devices it will reach.' };
  }
  if (input.confirmCount !== input.targetCount) {
    return {
      allowed: false,
      reason: `The cohort changed since you looked (you confirmed ${input.confirmCount}, it is now ${input.targetCount}). Re-check and send again.`,
    };
  }
  const lastVersion = int(input.lastBroadcastVersionCode);
  const lastAt = typeof input.lastBroadcastAt === 'number' ? input.lastBroadcastAt : null;
  if (lastVersion != null && lastVersion === int(input.latestVersionCode) && lastAt != null
      && input.now - lastAt < BROADCAST_COOLDOWN_MS) {
    const hrs = Math.ceil((BROADCAST_COOLDOWN_MS - (input.now - lastAt)) / 3600000);
    return { allowed: false, reason: `This version was already announced. You can send again in ~${hrs}h.` };
  }
  return { allowed: true, reason: 'ok' };
}

/** One honest line for the admin panel before they press send. */
export function cohortSummary(cohort: StaleCohort, latestVersionCode: number | null): string {
  const latest = int(latestVersionCode);
  if (latest == null) return 'No release version is configured, so nobody can be told to update.';
  const parts = [`${cohort.targets.length} device(s) are on a build older than ${latest} and will be notified`];
  if (cohort.upToDate) parts.push(`${cohort.upToDate} already up to date (skipped)`);
  if (cohort.unknownVersion) parts.push(`${cohort.unknownVersion} have not reported a version (skipped — we do not guess)`);
  if (cohort.wrongPlatform) parts.push(`${cohort.wrongPlatform} non-Android (skipped — there is no iOS release)`);
  return `${parts.join('; ')}.`;
}

/** The notification itself. Short — a push nobody reads is a push nobody taps. */
export function updateBroadcastPayload(versionName?: string | null): { title: string; body: string; data: Record<string, string> } {
  const name = versionName?.trim();
  return {
    title: 'Update available',
    body: name
      ? `NavBharatAI ${name} is on the Play Store — tap to update.`
      : 'A new version of NavBharatAI is on the Play Store — tap to update.',
    // The client opens the store listing on tap rather than just bringing the app forward.
    data: { kind: 'app_update', action: 'open_store' },
  };
}
