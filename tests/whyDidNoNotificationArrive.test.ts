// WHY DID NO NOTIFICATION ARRIVE? — the diagnosis that had to be built before anything could be fixed.
//
// WHY (admin 2026-09-20). Push notifications are built end to end and deliver nothing, and all four
// reasons look identical from outside: an app too old to contain the plugin, no registered device, a
// Cloud Messaging API that was never enabled, a service account without permission. `sendPushToUser`
// swallows the last two by design — a push must never fail a build — which is right for the build
// path and is exactly why a separate, loud check has to exist.
//
// 🔒 THE ONE ASSERTION THAT MATTERS MOST: Firebase refusing the probe with "invalid argument" is the
// GOOD answer. It means we authenticated, the project was right, Cloud Messaging was reached, and
// only the deliberately-undecodable test token was rejected. Reporting that as a failure would send
// the admin to fix a setup that already works.

import { describe, it, expect } from 'vitest';
import {
  classifyRelease, classifyDevices, classifyFcmError,
  FIRST_RELEASE_WITH_PUSH_PLUGIN, MANUAL_STEPS,
} from '../src/server/lib/pushPreflight';

describe('the installed app has to contain the feature', () => {
  it('names build 91 — the live release — as the reason nothing arrives', () => {
    const c = classifyRelease('91');
    expect(c.state).toBe('failed');
    expect(c.detail).toContain('91');
    expect(c.detail).toContain(String(FIRST_RELEASE_WITH_PUSH_PLUGIN));
    expect(c.remedy).toMatch(/fresh \.aab/i);
  });

  it('accepts the first build that actually carries the plugin', () => {
    expect(classifyRelease(String(FIRST_RELEASE_WITH_PUSH_PLUGIN)).state).toBe('ok');
    expect(classifyRelease('122').state).toBe('ok');
  });

  it('is UNKNOWN when the version code is unset or junk — never a pass, never a failure', () => {
    for (const raw of [undefined, '', '   ', 'latest', '9.1', '-3', '0']) {
      const c = classifyRelease(raw);
      expect(c.state, `for ${JSON.stringify(raw)}`).toBe('unknown');
      expect(c.remedy).not.toBe('');
    }
  });
});

describe('somebody has to be registered to receive', () => {
  it('an empty registry is a FAILURE, because a perfect send path delivers to nobody', () => {
    const c = classifyDevices([]);
    expect(c.state).toBe('failed');
    expect(c.detail).toMatch(/No device/i);
  });

  it('counts the platforms it found', () => {
    const c = classifyDevices([
      { platform: 'android' }, { platform: 'android' }, { platform: 'web' }, { platform: 'quest' },
    ]);
    expect(c.state).toBe('ok');
    expect(c.detail).toContain('4 registered devices');
    expect(c.detail).toContain('2 Android');
    expect(c.detail).toContain('1 web');
    expect(c.detail).toContain('1 unknown');
  });

  it('says "device" once and "devices" otherwise', () => {
    expect(classifyDevices([{ platform: 'ios' }]).detail).toContain('1 registered device —');
  });
});

describe('what Firebase refusing the probe actually means', () => {
  it('an invalid token is the GOOD answer — the whole chain works', () => {
    const c = classifyFcmError({ code: 'messaging/invalid-argument', message: 'The registration token is not a valid FCM registration token' });
    expect(c.state).toBe('ok');
    expect(c.remedy).toBe('');
  });

  it('recognises the good answer from the message alone, with no code', () => {
    expect(classifyFcmError({ message: 'The registration token is not a valid FCM registration token' }).state).toBe('ok');
  });

  it('a disabled API is named as a disabled API, with the console path', () => {
    const c = classifyFcmError({
      code: 'messaging/unknown-error',
      message: 'Firebase Cloud Messaging API has not been used in project 950841184325 before or it is disabled.',
    });
    expect(c.state).toBe('failed');
    expect(c.remedy).toMatch(/Firebase Cloud Messaging API/);
    expect(c.remedy).toMatch(/enable/i);
  });

  it('a permission problem is named as a permission problem — a different fix entirely', () => {
    const c = classifyFcmError({ code: 'messaging/authentication-error', message: 'PERMISSION_DENIED' });
    expect(c.state).toBe('failed');
    expect(c.remedy).toMatch(/service account/i);
    // The two 403s need opposite actions, so they must never collapse into one message.
    expect(c.remedy).not.toMatch(/APIs & Services/);
  });

  it('the wrong project is its own diagnosis', () => {
    const c = classifyFcmError({ code: 'messaging/mismatched-credential', message: 'credential mismatch' });
    expect(c.state).toBe('failed');
    expect(c.remedy).toMatch(/google-services\.json/);
  });

  it('an answer it does not recognise is UNKNOWN, never guessed into a failure', () => {
    const c = classifyFcmError({ code: 'messaging/server-unavailable', message: 'backend is busy' });
    expect(c.state).toBe('unknown');
    expect(c.detail).toContain('backend is busy');
  });

  it('survives a non-error being thrown at it', () => {
    for (const junk of [null, undefined, 'boom', 42]) {
      expect(classifyFcmError(junk).state).toBe('unknown');
    }
  });

  it('never leaks an unbounded provider message into the report', () => {
    const c = classifyFcmError({ code: 'messaging/weird', message: 'x'.repeat(5000) });
    expect(c.detail.length).toBeLessThan(400);
  });
});

describe('what no server can see is stated as work, not reported as a state', () => {
  it('lists the Play release, iOS, and the per-person permission', () => {
    const all = MANUAL_STEPS.join(' ').toLowerCase();
    expect(all).toContain('play');
    expect(all).toContain('ios');
    expect(all).toContain('apns');
    expect(all).toContain('prompt'); // the step's own word for per-person consent
  });

  it('is honest that iOS cannot work today rather than silently omitting it', () => {
    expect(MANUAL_STEPS.some((s) => /GoogleService-Info\.plist/.test(s))).toBe(true);
  });
});
