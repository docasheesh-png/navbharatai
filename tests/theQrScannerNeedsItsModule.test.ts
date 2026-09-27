// PROVEN 2026-09-27 by building the capability registry's real plugin set: all 14 plugins install
// together on Capacitor 7.6.9, `cap add android` finds all 14, and the generated permission script
// writes a valid, idempotent manifest. One row was wrong: on Android the QR scanner's `scan()` runs
// Google's code scanner, a separately downloaded module, and the builder was told to call `scan()`
// straight away — a QR button that fails on its first press. The plugin's README also requires a
// `<meta-data>` inside `<application>`, which the table had no way to express.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { NATIVE_CAPABILITIES, nativePermissionMap, nativePermissionScript } from '../src/server/AgentV3/nativeCapabilities';

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="x">
        <activity android:name=".MainActivity" />
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

function runScript(deps: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nbai-perm-'));
  mkdirSync(join(dir, 'android/app/src/main'), { recursive: true });
  writeFileSync(join(dir, 'android/app/src/main/AndroidManifest.xml'), MANIFEST);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: deps }));
  writeFileSync(join(dir, 'perm.js'), nativePermissionScript('android').join('\n'));
  execFileSync(process.execPath, ['perm.js'], { cwd: dir, stdio: 'pipe' });
  execFileSync(process.execPath, ['perm.js'], { cwd: dir, stdio: 'pipe' }); // a re-run adds nothing
  return readFileSync(join(dir, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
}

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('the QR scanner is usable on its first press', () => {
  const qr = NATIVE_CAPABILITIES.find((c) => c.id === 'qr-scan')!;

  it('the builder is told to make sure Google\'s scanner module is present before scanning', () => {
    const api = qr.api;
    expect(api).toMatch(/isGoogleBarcodeScannerModuleAvailable/);
    expect(api).toMatch(/installGoogleBarcodeScannerModule/);
    expect(api).toMatch(/googleBarcodeScannerModuleInstallProgress/);
    expect(api.indexOf('isGoogleBarcodeScannerModuleAvailable')).toBeLessThan(api.indexOf('BarcodeScanner.scan()'));
  });

  it('the phone build asks Android to fetch the module at install time', () => {
    expect(nativePermissionMap()['@capacitor-mlkit/barcode-scanning'].meta)
      .toEqual([{ name: 'com.google.mlkit.vision.DEPENDENCIES', value: 'barcode_ui' }]);
  });

  it('the generated script puts it INSIDE <application>, once, and the manifest stays well-formed', () => {
    const xml = runScript({ '@capacitor-mlkit/barcode-scanning': '7.5.0' });
    const meta = '<meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="barcode_ui" />';
    expect(count(xml, meta)).toBe(1);
    expect(xml.indexOf(meta)).toBeLessThan(xml.indexOf('</application>'));
    expect(count(xml, 'android.permission.CAMERA"')).toBe(1);
    expect(xml.trim().endsWith('</manifest>')).toBe(true);
  });

  it('an app without the scanner gets no scanner setting', () => {
    const xml = runScript({ '@capacitor-community/contacts': '7.2.0' });
    expect(xml).not.toMatch(/mlkit/);
    expect(count(xml, 'android.permission.READ_CONTACTS"')).toBe(1);
  });

  it('the script stays safe to embed in the workflow YAML template', () => {
    const s = nativePermissionScript('android').join('\n');
    expect(s).not.toMatch(/`/);
    expect(s).not.toMatch(/\$\{/);
  });
});
