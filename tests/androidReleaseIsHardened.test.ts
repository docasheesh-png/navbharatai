import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The StatusBar plugin object, not the SplashScreen block that already uses #0d1117. */
function statusBarBlock(cfg: string): string {
  const start = cfg.search(/StatusBar:\s*\{/);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  const open = cfg.indexOf('{', start);
  for (let i = open; i < cfg.length; i++) {
    if (cfg[i] === '{') depth++;
    else if (cfg[i] === '}') {
      depth--;
      if (depth === 0) return cfg.slice(start, i + 1);
    }
  }
  throw new Error('StatusBar block is unterminated');
}

describe('UI-8 / D-7 android release hardening', () => {
  it('the status bar launches on the dark boot colour with light icons, and minify stays off', () => {
    const cfg = readFileSync('capacitor.config.ts', 'utf8');
    const bar = statusBarBlock(cfg);
    // Inside the StatusBar object — SplashScreen already has this colour, so a file-wide search is not enough.
    expect(bar).toContain("backgroundColor: '#0d1117'");
    expect(bar).toMatch(/style:\s*'DARK'/);
    expect(bar).not.toMatch(/style:\s*'dark'/);
    expect(bar).not.toContain('#ffffff');

    const gradle = readFileSync('android/app/build.gradle', 'utf8');
    const release = gradle.slice(gradle.indexOf('buildTypes'), gradle.indexOf('buildTypes') + 800);
    // D-7 opted in (owner 2026-11-18, Play Console: Obfuscation 2% < 25%). Minify is ON, with the NON-optimising
    // default file, and resource shrinking stays off.
    expect(release).toMatch(/minifyEnabled\s+true/);
    expect(release).not.toMatch(/minifyEnabled\s+false/);
    expect(release).toContain("getDefaultProguardFile('proguard-android.txt')");
    expect(release).not.toContain('proguard-android-optimize.txt');
    expect(gradle).not.toMatch(/shrinkResources\s+true/);
  });

  it('the keep rules protect everything the Capacitor shell finds by name at run time', () => {
    const rules = readFileSync('android/app/proguard-rules.pro', 'utf8');
    for (const keep of [
      '-keep class com.navbharatai.app.** { *; }',          // MainActivity + our three plugins
      '-keep class com.getcapacitor.** { *; }',             // bridge, PluginManager (Class.forName), SystemBars by name
      '-keep class com.capacitorjs.** { *; }',
      '-keep class io.capawesome.** { *; }',
      '-keep class org.apache.cordova.** { *; }',
      '-keep class com.facebook.FacebookSdk { public static *; }', // MetaConsentPlugin reflection
      '@android.webkit.JavascriptInterface <methods>;',
      '-keepattributes SourceFile,LineNumberTable',
    ]) expect(rules, keep).toContain(keep);
  });
  it('every class our own Java reaches by reflection is kept by name', () => {
    const src = readFileSync('android/app/src/main/java/com/navbharatai/app/MetaConsentPlugin.java', 'utf8');
    const rules = readFileSync('android/app/proguard-rules.pro', 'utf8');
    for (const m of src.matchAll(/Class\.forName\("([\w.]+)"\)/g)) expect(rules, m[1]).toContain(`-keep class ${m[1]}`);
  });
});
