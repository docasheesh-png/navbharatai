import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const source = readFileSync('android/app/src/main/java/com/navbharatai/app/MainActivity.java', 'utf8');
describe('Android ANR diagnostic source contract (not a device ANR reproduction)', () => {
  it('enables non-fatal StrictMode only in debug before bridge creation', () => {
    expect(source).toMatch(/if \(BuildConfig.DEBUG\) \{\s*StrictMode.setThreadPolicy/);
    expect(source.match(/\.detectAll\(\)\.penaltyLog\(\)/g)).toHaveLength(2);
    expect(source.indexOf('StrictMode.setThreadPolicy')).toBeLessThan(source.indexOf('super.onCreate(savedInstanceState);'));
    expect(source).not.toMatch(/penaltyDeath|setCrashlyticsCollectionEnabled|clearCache|clearHistory|pauseTimers|setWebViewClient/);
  });
  for (const method of ['onCreate', 'onStart', 'onResume', 'onPause', 'onStop', 'onDestroy']) {
    it(`preserves ${method} delegation and balances debug trace on exceptional exit`, () => {
      expect(source).toContain(`if (BuildConfig.DEBUG) Trace.beginSection("NavBharatAI.${method}");`);
      expect(source).toMatch(new RegExp(`try \\{\\s*super\\.${method}\\([^)]*\\);\\s*\\} finally \\{\\s*if \\(BuildConfig.DEBUG\\) Trace.endSection\\(\\);`));
    });
  }
  it('still registers all three plugins before building the bridge', () => {
    for (const plugin of ['MetaConsentPlugin', 'PlayBillingPlugin', 'DeviceIntegrityPlugin']) {
      expect(source.indexOf(`registerPlugin(${plugin}.class)`)).toBeLessThan(source.indexOf('super.onCreate(savedInstanceState);'));
    }
  });
});
