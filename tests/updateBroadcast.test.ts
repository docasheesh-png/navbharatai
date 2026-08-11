import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  selectStaleDevices, canBroadcast, cohortSummary, updateBroadcastPayload,
  BROADCAST_COOLDOWN_MS, type DeviceRow,
} from '../src/server/lib/updateBroadcast';

/**
 * A BROADCAST CANNOT BE UN-SENT.
 *
 * Everything else in this file follows from that. The obvious implementation — notify every registered
 * device — is the one that kills the feature: it reaches people who already updated, and telling
 * someone on the newest build to "please update" teaches them that our notifications are noise. The
 * next one, the one that actually matters, then goes unread.
 */
const dev = (o: Partial<DeviceRow>): DeviceRow => ({ uid: 'u', token: 't', platform: 'android', ...o });

describe('who gets it — and, more importantly, who does not', () => {
  it('only devices genuinely behind the live build', () => {
    const c = selectStaleDevices([
      dev({ token: 'old1', appVersionCode: 8 }),
      dev({ token: 'old2', appVersionCode: 11 }),
      dev({ token: 'current', appVersionCode: 12 }),
    ], 12);
    expect(c.targets.map((t) => t.token)).toEqual(['old1', 'old2']);
    expect(c.upToDate).toBe(1);
  });

  it('a device AHEAD of the store build is left alone', () => {
    // Internal/testing tracks exist; telling a tester to downgrade is absurd.
    const c = selectStaleDevices([dev({ appVersionCode: 20 })], 12);
    expect(c.targets).toHaveLength(0);
    expect(c.upToDate).toBe(1);
  });

  it('NEVER GUESSES: a device that never reported a version is NOT sent to', () => {
    // An unknown version is not "probably old" — same rule as the in-app banner, same reason.
    const c = selectStaleDevices([
      dev({ token: 'unknown', appVersionCode: null }),
      dev({ token: 'alsoUnknown' }),
      dev({ token: 'junk', appVersionCode: 'abc' as unknown as number }),
    ], 12);
    expect(c.targets).toHaveLength(0);
    expect(c.unknownVersion).toBe(3);
  });

  it('non-Android devices are excluded — there is no iOS release to send them to', () => {
    const c = selectStaleDevices([
      dev({ platform: 'ios', appVersionCode: 1 }),
      dev({ platform: 'web', appVersionCode: 1 }),
      dev({ platform: 'android', appVersionCode: 1 }),
    ], 12);
    expect(c.targets).toHaveLength(1);
    expect(c.wrongPlatform).toBe(2);
  });

  it('with NO configured release version, nobody is targeted', () => {
    const c = selectStaleDevices([dev({ appVersionCode: 5 })], null);
    expect(c.targets).toHaveLength(0);
  });

  it('the exclusion counts are kept — they are the honest answer to "why only 40%?"', () => {
    // Without these the reach looks broken instead of explained.
    const c = selectStaleDevices([
      dev({ appVersionCode: 5 }), dev({ appVersionCode: 12 }),
      dev({ appVersionCode: null }), dev({ platform: 'ios', appVersionCode: 1 }),
    ], 12);
    expect(c).toMatchObject({ upToDate: 1, unknownVersion: 1, wrongPlatform: 1 });
    expect(c.targets).toHaveLength(1);
  });

  it('a row with no token is skipped rather than sent to nothing', () => {
    expect(selectStaleDevices([dev({ token: '', appVersionCode: 1 })], 12).targets).toHaveLength(0);
  });
});

describe('the send gate — a misclick must not reach thousands', () => {
  const base = { targetCount: 10, confirmCount: 10, latestVersionCode: 12, now: 1_000_000 };

  it('allows a confirmed send', () => {
    expect(canBroadcast(base).allowed).toBe(true);
  });

  it('refuses without a confirmation', () => {
    expect(canBroadcast({ ...base, confirmCount: null })).toMatchObject({ allowed: false });
  });

  it('REFUSES WHEN THE COHORT MOVED since the admin looked', () => {
    // The admin confirms a specific number of people, not a button. A stale dashboard must not fire
    // at a cohort they never saw.
    const g = canBroadcast({ ...base, targetCount: 4000, confirmCount: 10 });
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain('changed since you looked');
  });

  it('refuses when nobody is behind — there is nothing to announce', () => {
    const g = canBroadcast({ ...base, targetCount: 0, confirmCount: 0 });
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain('nobody needs this notification');
  });

  it('refuses when no release version is configured', () => {
    const g = canBroadcast({ ...base, latestVersionCode: null });
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain('not set');
  });

  it('blocks a SECOND broadcast for the same version', () => {
    const g = canBroadcast({ ...base, lastBroadcastVersionCode: 12, lastBroadcastAt: base.now - 1000 });
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain('already announced');
  });

  it('allows again once the cooldown has passed', () => {
    const g = canBroadcast({
      ...base, lastBroadcastVersionCode: 12, lastBroadcastAt: base.now - BROADCAST_COOLDOWN_MS - 1,
    });
    expect(g.allowed).toBe(true);
  });

  it('a NEW version is never blocked by the previous version\'s cooldown', () => {
    // Shipping twice in a day is legitimate; the cooldown guards against a double-tap, not a release.
    const g = canBroadcast({
      ...base, latestVersionCode: 13, lastBroadcastVersionCode: 12, lastBroadcastAt: base.now - 1000,
    });
    expect(g.allowed).toBe(true);
  });
});

describe('what the admin is told before they press send', () => {
  it('names the reach AND every exclusion', () => {
    const cohort = selectStaleDevices([
      dev({ appVersionCode: 5 }), dev({ appVersionCode: 12 }),
      dev({ appVersionCode: null }), dev({ platform: 'ios', appVersionCode: 1 }),
    ], 12);
    const s = cohortSummary(cohort, 12);
    expect(s).toContain('1 device(s) are on a build older than 12');
    expect(s).toContain('1 already up to date');
    expect(s).toContain('have not reported a version');
    expect(s).toContain('no iOS release');
  });

  it('says plainly when no version is configured', () => {
    expect(cohortSummary(selectStaleDevices([], null), null)).toContain('nobody can be told to update');
  });
});

describe('the notification itself', () => {
  it('names the version when known', () => {
    expect(updateBroadcastPayload('1.4.0').body).toContain('1.4.0');
  });

  it('still reads correctly without one', () => {
    const p = updateBroadcastPayload(null);
    expect(p.body).toContain('Play Store');
    expect(p.title).toBe('Update available');
  });

  it('carries the action that opens the STORE, not just the app', () => {
    // Tapping an "update" notification and landing on the app you already have is the same broken
    // promise as a false banner.
    expect(updateBroadcastPayload(null).data).toMatchObject({ kind: 'app_update', action: 'open_store' });
  });
});

/**
 * THE WIRING — and the safety that has to travel with it.
 */
describe('the admin can really do it, and cannot do it by accident', () => {
  const admin = readFileSync(join(__dirname, '../src/server/routes/admin.ts'), 'utf8');
  const store = readFileSync(join(__dirname, '../src/server/lib/DeviceTokenStore.ts'), 'utf8');
  const client = readFileSync(join(__dirname, '../src/lib/pushNotifications.ts'), 'utf8');
  const route = readFileSync(join(__dirname, '../src/server/routes/push.ts'), 'utf8');

  it('PREVIEW is separate from SEND, and both are admin-gated', () => {
    expect(admin).toContain("app.get('/api/admin/update-broadcast/preview', verifyAdminToken");
    expect(admin).toContain("app.post('/api/admin/update-broadcast/send', verifyAdminToken");
  });

  it('SEND goes through the gate rather than straight to FCM', () => {
    expect(admin).toContain('canBroadcast({');
    expect(admin).toContain('if (!gate.allowed)');
  });

  it('it targets the stale cohort, never every device', () => {
    expect(admin).toContain('selectStaleDevices(rows, latestVersionCode)');
    expect(admin).toContain('cohort.targets');
  });

  it('the preview reports the exclusions AND whether the scan was capped', () => {
    // "Why did only 40% get it?" must be answerable from the preview, not guessed at afterwards.
    for (const field of ['upToDate', 'unknownVersion', 'wrongPlatform', 'truncated']) {
      expect(admin, field).toContain(field);
    }
  });

  it('the device scan is HARD CAPPED — an unbounded cross-user read is a cost bug', () => {
    expect(store).toContain('async listAllTokens(limit = 5000)');
    expect(store).toContain('truncated');
  });

  it('THE DEVICE REPORTS ITS VERSION — without this the cohort is always "unknown"', () => {
    expect(client).toContain('async function currentVersionCode()');
    // Asserted by SHAPE, not by variable name — the previous version of this line broke on a rename
    // while the behaviour was unchanged, which is a test failing for the wrong reason.
    expect(client).toMatch(/registerDeviceToken\(userId, token, platform, \w+\)/);
    expect(route).toContain('appVersionCode');
  });

  it('the version is read ONCE, not on every token refresh', () => {
    // Re-reading a value that cannot change put a dynamic import in front of the refresh
    // re-registration and made it racy — CI caught it. Caching is the fix, so it is asserted.
    expect(client).toContain('let cachedVersionCode');
    expect(client).toContain('A running app\'s versionCode cannot change');
  });

  it('a junk version from a client is treated as unknown, never as a number', () => {
    expect(route).toContain('Number.isFinite(parsedVersion) && parsedVersion > 0 ? parsedVersion : undefined');
  });

  it('an older client re-registering must not erase a known version', () => {
    expect(store).toContain('never overwrite a known version');
  });
});

describe('the admin panel button, and the tap that follows', () => {
  const dash = readFileSync(join(__dirname, '../src/components/AdminDashboard.tsx'), 'utf8');
  const client = readFileSync(join(__dirname, '../src/lib/pushNotifications.ts'), 'utf8');

  it('the button exists in the admin panel', () => {
    expect(dash).toContain('App Update Notification');
    expect(dash).toContain('/api/admin/update-broadcast/preview');
    expect(dash).toContain('/api/admin/update-broadcast/send');
  });

  it('it CONFIRMS with the real number before sending', () => {
    expect(dash).toContain('window.confirm(');
    expect(dash).toContain('confirmCount: updateCohort.targetCount');
  });

  it('the button is disabled when nobody is behind', () => {
    expect(dash).toContain('updateCohort.targetCount <= 0');
  });

  it('it says so plainly when the release version is not configured', () => {
    expect(dash).toContain('ANDROID_LATEST_VERSION_CODE is not set');
  });

  it('it reports what the SERVER did — including a refusal and its reason', () => {
    // Never "sent!" for a request the server declined.
    expect(dash).toContain('d?.blocked ? `Not sent — ${d.reason}`');
  });

  it('a capped device scan is surfaced, not silently rounded down', () => {
    expect(dash).toContain('Device scan hit its cap');
  });

  it('TAPPING the notification opens the STORE, not just the app', () => {
    expect(client).toContain("addListener('notificationActionPerformed'");
    expect(client).toContain("String(data.action ?? '') !== 'open_store'");
    expect(client).toContain('Browser.open({ url })');
  });

  it('the tap handler refuses a non-http url', () => {
    expect(client).toContain('/^https?:\\/\\//.test(data.storeUrl)');
  });
});
