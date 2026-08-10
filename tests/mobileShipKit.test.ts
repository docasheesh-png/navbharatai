import { describe, it, expect } from 'vitest';
import { generateShipKit } from '../src/server/lib/mobileShipKit';
import { isValidRepoRef, isDispatchableWorkflow, DISPATCHABLE_WORKFLOWS, registerMobileShipRoutes } from '../src/server/routes/mobileShip';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

// Admin 2026-07-26: "kya hamara NavBharatAI ek real .aab/.apk/.ipa bana sakta hai? ... direct testflight
// aur github se link karo". A browser/Linux server cannot compile or sign a mobile binary (and iOS
// legally needs macOS), so the honest architecture is to generate a REAL GitHub Actions pipeline into
// the user's repo and let GitHub's runners produce the genuine signed artifacts. These tests lock the
// generated kit's correctness — especially the store-rejection traps that cost real builds on this repo.

describe('generateShipKit — the generated pipeline', () => {
  it('emits both workflows, the fastlane lane, the Capacitor wrapper and an honest guide', () => {
    const kit = generateShipKit({ appName: 'My Shop' });
    expect(Object.keys(kit.files).sort()).toEqual([
      '.github/workflows/android-aab.yml',
      '.github/workflows/android-apk.yml',
      '.github/workflows/ios-ipa.yml',
      'MOBILE_EXPORT.md',
      'SHIPPING.md',
      'capacitor.config.ts',
      'fastlane/Fastfile',
    ]);
  });

  it('ios:false drops the iOS workflow, the Fastfile and the Apple secrets', () => {
    const kit = generateShipKit({ appName: 'My Shop', ios: false });
    expect(kit.files['.github/workflows/ios-ipa.yml']).toBeUndefined();
    expect(kit.files['fastlane/Fastfile']).toBeUndefined();
    expect(kit.requiredSecrets.ios).toEqual([]);
    expect(kit.requiredSecrets.android.length).toBeGreaterThan(0);
  });

  it('derives a valid reverse-DNS app id from the app name and threads it into signing', () => {
    const kit = generateShipKit({ appName: 'My Shop' });
    expect(kit.appId).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    // The Fastfile must sign the SAME bundle id, or export fails with a profile mismatch.
    expect(kit.files['fastlane/Fastfile']).toContain(kit.appId);
  });

  it('honours an explicitly supplied app id', () => {
    const kit = generateShipKit({ appName: 'My Shop', appId: 'com.acme.shop' });
    expect(kit.appId).toBe('com.acme.shop');
    expect(kit.files['fastlane/Fastfile']).toContain('com.acme.shop');
  });

  it('emits GitHub expression syntax literally — never interpolated away by the template literal', () => {
    const android = generateShipKit({ appName: 'X' }).files['.github/workflows/android-aab.yml'];
    expect(android).toContain('${{ secrets.ANDROID_KEYSTORE_BASE64 }}');
    expect(android).toContain('${{ github.run_number }}');
    expect(android).not.toContain('undefined');
  });
});

describe('generateShipKit — the store-rejection traps this repo learned the hard way', () => {
  const kit = generateShipKit({ appName: 'My Shop' });
  const android = kit.files['.github/workflows/android-aab.yml'];
  const ios = kit.files['.github/workflows/ios-ipa.yml'];
  const fastfile = kit.files['fastlane/Fastfile'];

  it('Android stamps a unique versionCode — Play rejects a re-used one', () => {
    expect(android).toContain('versionCode ${{ github.run_number }}');
  });

  it('Android actually builds a SIGNED bundle and publishes it as an artifact', () => {
    expect(android).toContain('bundleRelease');
    expect(android).toContain('signingConfigs');
    expect(android).toContain('app-release.aab');
  });

  it('Android ALSO builds an .apk so the user can install the app on a real phone before Play Console', () => {
    // Play only accepts .aab, but an .aab cannot be installed on a phone — a non-technical user needs
    // to be able to hold their app and try it, so both artifacts are produced.
    expect(android).toContain('assembleRelease');
    expect(android).toContain('app-release.apk');
    expect(android).toContain('name: release-apk');
  });

  it('Android fails EARLY when signing secrets are absent — never yields an unsigned bundle', () => {
    expect(android).toContain('Pre-flight — require signing secrets');
    expect(android).toMatch(/::error::Missing signing secret/);
  });

  it('Android wipes the keystore off the runner even when the build fails', () => {
    expect(android).toContain('if: always()');
    expect(android).toContain('rm -f android/app/release.keystore');
  });

  it('iOS stamps a unique CFBundleVersion — Apple rejects a re-used build number', () => {
    expect(ios).toContain('Set :CFBundleVersion ${{ github.run_number }}');
  });

  it('iOS pre-answers export compliance so there is no popup on every upload', () => {
    expect(ios).toContain('ITSAppUsesNonExemptEncryption');
  });

  it('iOS requires Xcode 26+ and fails before the long build, not after Apple refuses the .ipa', () => {
    expect(ios).toContain('-lt 26');
    expect(ios).toContain('Select the newest Xcode');
  });

  it('iOS runs on a real macOS runner — the user never needs to own a Mac', () => {
    expect(ios).toContain('runs-on: macos-15');
  });

  it('TestFlight upload WAITS for Apple processing — a green run must mean it truly landed', () => {
    expect(fastfile).toContain('skip_waiting_for_build_processing: false');
    expect(fastfile).toContain('upload_to_testflight');
  });

  it('uploads to TestFlight only when the user opted in', () => {
    expect(fastfile).toContain('if ENV["DO_UPLOAD"] == "true"');
    expect(ios).toContain('DO_UPLOAD: ${{ inputs.upload }}');
  });

  it('iOS cleans the App Store Connect private key off the runner unconditionally', () => {
    expect(ios).toContain('Always remove the API key');
  });
});

describe('generateShipKit — self-heals a broken Gradle wrapper (autopsy 2026-08-04)', () => {
  // Real user build failed with "Unable to access jarfile …/gradle/wrapper/gradle-wrapper.jar", and no
  // retry could fix it — the old guard checked only the gradlew SCRIPT, not the binary jar it runs. Both
  // Android workflows must now GUARANTEE the wrapper jar (fetch it, else re-scaffold) and verify it.
  const kit = generateShipKit({ appName: 'My Shop' });
  const apk = kit.files['.github/workflows/android-apk.yml'];
  const aab = kit.files['.github/workflows/android-aab.yml'];

  for (const [label, wf] of [['apk', apk], ['aab', aab]] as const) {
    it(`${label}: heals a missing gradle-wrapper.jar instead of failing forever`, () => {
      // fetches the exact wrapper jar for the pinned Gradle version …
      expect(wf).toContain('gradle/wrapper/gradle-wrapper.jar');
      expect(wf).toContain('raw.githubusercontent.com/gradle/gradle/');
      // … and re-scaffolds the project as a last resort …
      expect(wf).toMatch(/rm -rf android[\s\S]*npx cap add android/);
      // … and the final guard verifies BOTH the script AND the jar (not just gradlew).
      expect(wf).toContain('! -f android/gradlew ] || [ ! -f android/gradle/wrapper/gradle-wrapper.jar');
    });
  }
});

describe('generateShipKit — self-heals a missing splash drawable (autopsy 2026-08-10)', () => {
  // Real user build failed at resource-linking: "resource drawable/splash not found … Android resource
  // linking failed". Capacitor's launch theme (styles.xml) references @drawable/splash, but a fresh
  // `cap add android` (Capacitor 8) can omit the splash asset → the reference doesn't resolve. This lives
  // in the GENERATED android/ project (created on CI, gitignored), so the AI repair — which only edits repo
  // files — can never see it. Both workflows must deterministically guarantee @drawable/splash exists.
  const kit = generateShipKit({ appName: 'My Shop' });
  const apk = kit.files['.github/workflows/android-apk.yml'];
  const aab = kit.files['.github/workflows/android-aab.yml'];

  for (const [label, wf] of [['apk', apk], ['aab', aab]] as const) {
    it(`${label}: writes a placeholder @drawable/splash so resource linking never fails`, () => {
      // detects the missing asset across any density bucket …
      expect(wf).toContain('android/app/src/main/res/drawable*/splash.*');
      // … and writes a real, resolvable placeholder drawable at the canonical path.
      expect(wf).toContain('android/app/src/main/res/drawable/splash.xml');
      expect(wf).toContain('layer-list');
    });
  }
});

describe('generateShipKit — honesty about what only the user can do', () => {
  const kit = generateShipKit({ appName: 'My Shop' });

  it('never claims to have built or signed anything itself', () => {
    expect(kit.instructions).toMatch(/does not\s+build or sign the binary itself/i);
  });

  it('names every secret the user must set, with where to get it', () => {
    const all = [...kit.requiredSecrets.android, ...kit.requiredSecrets.ios];
    expect(all.map((s) => s.name)).toEqual([
      'ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD',
      'IOS_ASC_KEY_ID', 'IOS_ASC_ISSUER_ID', 'IOS_ASC_KEY_BASE64', 'IOS_TEAM_ID',
    ]);
    for (const s of all) {
      expect(s.what.length).toBeGreaterThan(10);
      expect(s.where.length).toBeGreaterThan(10);
    }
  });

  it('warns that losing the keystore permanently blocks future updates', () => {
    expect(kit.files['SHIPPING.md']).toMatch(/never accept an update/i);
  });

  it('states plainly that Play Console upload and store review stay with the user', () => {
    const doc = kit.files['SHIPPING.md'];
    expect(doc).toContain('Play Console');
    expect(doc).toMatch(/Only you/i);
  });
});

describe('mobileShip routes', () => {
  const routes = captureRoutes(registerMobileShipRoutes);

  it('registers both endpoints', () => {
    expect(typeof routes.get('POST /api/mobile-ship/kit')).toBe('function');
    expect(typeof routes.get('POST /api/mobile-ship/trigger')).toBe('function');
  });

  it('kit generation needs no GitHub token (it is pure) and returns the files', async () => {
    const res = mockRes();
    await routes.get('POST /api/mobile-ship/kit')!(mockReq({ body: { appName: 'My Shop' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.files['.github/workflows/android-aab.yml']).toContain('bundleRelease');
    expect(res.body.appId).toBeTruthy();
  });

  it('trigger without a GitHub token is refused honestly (401), never silently ignored', async () => {
    const res = mockRes();
    await routes.get('POST /api/mobile-ship/trigger')!(
      mockReq({ body: { owner: 'me', repo: 'app', workflow: 'android-aab.yml' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('trigger rejects an arbitrary workflow file — only the generated ones may be dispatched', async () => {
    const res = mockRes();
    await routes.get('POST /api/mobile-ship/trigger')!(
      mockReq({ headers: { authorization: 'token gh_x' }, body: { owner: 'me', repo: 'app', workflow: 'evil.yml' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('trigger rejects a malformed repo reference', async () => {
    const res = mockRes();
    await routes.get('POST /api/mobile-ship/trigger')!(
      mockReq({ headers: { authorization: 'token gh_x' }, body: { owner: 'me/../x', repo: 'app', workflow: 'android-aab.yml' } }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('mobileShip guards (pure)', () => {
  it('isValidRepoRef accepts real slugs and rejects path traversal / injection', () => {
    expect(isValidRepoRef('docasheesh-png', 'navbharatai')).toBe(true);
    expect(isValidRepoRef('a.b_c-d', 'repo.name')).toBe(true);
    expect(isValidRepoRef('me/../x', 'app')).toBe(false);
    expect(isValidRepoRef('me', 'app?x=1')).toBe(false);
    expect(isValidRepoRef('', 'app')).toBe(false);
    expect(isValidRepoRef(undefined, 'app')).toBe(false);
  });

  it('isDispatchableWorkflow allows exactly the two generated workflows', () => {
    for (const w of DISPATCHABLE_WORKFLOWS) expect(isDispatchableWorkflow(w)).toBe(true);
    expect(isDispatchableWorkflow('deploy.yml')).toBe(false);
    expect(isDispatchableWorkflow('../../.github/workflows/android-aab.yml')).toBe(false);
    expect(isDispatchableWorkflow(undefined)).toBe(false);
  });
});

describe('one-click installable APK — the zero-secret path (admin 2026-08-02)', () => {
  const apk = () => generateShipKit({ appName: 'My App' }).files['.github/workflows/android-apk.yml'];

  it('is always generated alongside the Play Store bundle workflow', () => {
    const files = generateShipKit({ appName: 'My App' }).files;
    expect(Object.keys(files)).toContain('.github/workflows/android-apk.yml');
    expect(Object.keys(files)).toContain('.github/workflows/android-aab.yml');
  });

  it('THE POINT: needs NO signing secrets at all — that is what makes it one click', () => {
    const wf = apk();
    for (const secret of [
      'ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD',
    ]) {
      expect(wf, secret).not.toContain(secret);
    }
    // The precise check: the workflow must never READ a secret. (Prose that merely mentions signing
    // secrets, to point the user at the Play Store path, is fine and intended.)
    expect(wf).not.toContain('${{ secrets.');
    expect(wf).not.toMatch(/release\.keystore/);
  });

  it('really builds an installable apk (assembleDebug) and uploads it', () => {
    const wf = apk();
    expect(wf).toContain('assembleDebug');
    expect(wf).toContain('android/app/build/outputs/apk/debug/app-debug.apk');
    expect(wf).toContain('upload-artifact');
    expect(wf).toContain('name: app-apk');
  });

  it('still does the real Capacitor work (web build + native sync)', () => {
    const wf = apk();
    expect(wf).toContain('npm run build');
    expect(wf).toContain('npx cap sync android');
    expect(wf).toContain('setup-java');
  });

  it('is HONEST about the limit — this file cannot go on Google Play', () => {
    const wf = apk();
    expect(wf).toMatch(/Google Play needs the SIGNED bundle/i);
    expect(wf).toMatch(/install/i);
  });

  it('the Play Store workflow is UNCHANGED — it still requires the real signing secrets', () => {
    const aab = generateShipKit({ appName: 'My App' }).files['.github/workflows/android-aab.yml'];
    expect(aab).toContain('ANDROID_KEYSTORE_BASE64');
    expect(aab).toContain('bundleRelease');
  });
});

describe('generated workflows must actually RUN on GitHub (real failure 2026-08-02)', () => {
  // A user's android-apk.yml died after 18 seconds with "Process completed with exit code 1".
  // Cause: every generated workflow asked actions/setup-node for cache:'npm', but NavBharatAI pushes
  // the app source WITHOUT a package-lock.json — and setup-node HARD-FAILS when the lock file it is
  // told to cache does not exist, before a single line of the app is built.
  const kit = () => generateShipKit({ appName: 'My App' }).files;
  const workflows = () => Object.entries(kit()).filter(([p]) => p.startsWith('.github/workflows/'));

  it('no generated workflow asks for an npm cache while no lock file is shipped', () => {
    const shipsLockFile = Object.keys(kit()).some((p) => /package-lock\.json$|npm-shrinkwrap\.json$|yarn\.lock$/.test(p));
    expect(shipsLockFile).toBe(false); // documents WHY the cache must stay off
    for (const [path, wf] of workflows()) {
      expect(wf, path).not.toContain("cache: 'npm'");
      expect(wf, path).not.toContain('cache: npm');
    }
  });

  it('every workflow still installs dependencies in a lock-file-free way', () => {
    for (const [path, wf] of workflows()) {
      expect(wf, path).toContain('npm ci || npm install'); // ci fails without a lock, install then works
    }
  });

  it('covers ALL generated workflows, not just the apk one (the bug was in all three)', () => {
    const paths = workflows().map(([p]) => p).sort();
    expect(paths).toEqual([
      '.github/workflows/android-aab.yml',
      '.github/workflows/android-apk.yml',
      '.github/workflows/ios-ipa.yml',
    ]);
  });
});

