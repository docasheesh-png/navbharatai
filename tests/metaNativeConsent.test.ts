// The Android SDK gate. The property that matters is not that a grant switches Meta ON — it is that
// everything else switches it OFF, because the manifest ships it off and only an explicit grant may
// change that.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nativeMetaConsentGranted, syncNativeMetaConsent } from '../src/lib/metaNativeConsent';
import { consentAllowsAnalytics } from '../src/lib/consent';

describe('native Meta consent gate', () => {
  it('only an explicit grant turns the SDK on', () => {
    expect(nativeMetaConsentGranted('granted')).toBe(true);
  });

  it('refusal, no decision, junk and a storage failure all leave it off', () => {
    for (const raw of ['denied', null, undefined, '', 'GRANTED', 'true', 'yes', '1']) {
      expect(nativeMetaConsentGranted(raw), `${String(raw)} must not enable the SDK`).toBe(false);
    }
  });

  it('reads the SAME consent value as the pixel and web-vitals, not a second interpretation', () => {
    for (const raw of ['granted', 'denied', null, '', 'Granted']) {
      expect(nativeMetaConsentGranted(raw)).toBe(consentAllowsAnalytics(raw));
    }
  });

  it('on the web it reports not-native instead of pretending it acted', async () => {
    await expect(syncNativeMetaConsent(true)).resolves.toBe('not-native');
  });
});

// The JavaScript gate above is only half of it. If the manifest ever ships those three switches ON,
// the SDK initialises from its ContentProvider at process start and collects BEFORE any of our code
// runs — and nothing in the app would fail to reveal it. So the manifest is asserted here directly.
describe('the Android manifest ships Meta collection switched OFF', () => {
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');

  for (const flag of ['AutoInitEnabled', 'AutoLogAppEventsEnabled', 'AdvertiserIDCollectionEnabled']) {
    it(`com.facebook.sdk.${flag} is hard-wired to false`, () => {
      const line = new RegExp(`com\\.facebook\\.sdk\\.${flag}"\\s+android:value="([^"]*)"`);
      const match = manifest.match(line);
      expect(match, `${flag} meta-data is missing from the manifest`).not.toBeNull();
      // A build-time placeholder here is the exact regression this guards: it would read as "false"
      // in source and ship as "true" in the release .aab.
      expect(match?.[1]).toBe('false');
    });
  }

  it('MainActivity registers the plugin that opens them after consent', () => {
    const activity = readFileSync('android/app/src/main/java/com/navbharatai/app/MainActivity.java', 'utf8');
    expect(activity).toContain('registerPlugin(MetaConsentPlugin.class)');
  });
});
