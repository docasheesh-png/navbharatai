// 2026-09-27 (admin: "jarwis jaisa app banwaya jaye to, navbharatai banayega … yeh sab chahiye").
// The native capability registry is read in three places — the builder's brief, the user's summary and
// the phone build. These tests lock each reader to the table, and run the generated phone-build script
// for real against Capacitor-shaped files.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  NATIVE_CAPABILITIES, REGISTRY_CAPACITOR_MAJOR, REGISTRY_CAPACITOR_CORE, requestedCapabilities,
  capabilitiesInPackageJson, nativeCapabilityBrief, alignNativePlugins, nativePermissionScript,
  PLAY_RESTRICTED_ANDROID_PERMISSIONS,
} from '../src/server/AgentV3/nativeCapabilities';
import { buildPackageJson } from '../src/server/lib/mobileProjectAssembler';
import { generateShipKit } from '../src/server/lib/mobileShipKit';
import { DEFAULT_CAPACITOR_MAJOR } from '../src/server/lib/capacitorToolchain';
import { manifestRewrittenBy } from '../src/server/AgentV3/DependencyAutoFix';
import { makeTempDir } from './helpers/tempDir';

describe('the registry itself', () => {
  it('is verified against the phone build’s OWN default Capacitor major', () => {
    // If the default moves, every version in the table must be re-verified — this fails first.
    expect(REGISTRY_CAPACITOR_MAJOR).toBe(DEFAULT_CAPACITOR_MAJOR);
    expect(REGISTRY_CAPACITOR_CORE.startsWith(`${REGISTRY_CAPACITOR_MAJOR}.`)).toBe(true);
  });
  it('every row is an exact version, unique, and an official plugin sits on the registry major', () => {
    const pkgs = new Set<string>();
    for (const c of NATIVE_CAPABILITIES) {
      expect(c.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(pkgs.has(c.pkg)).toBe(false);
      pkgs.add(c.pkg);
      if (c.pkg.startsWith('@capacitor/')) expect(c.version.startsWith(`${REGISTRY_CAPACITOR_MAJOR}.`)).toBe(true);
      if (c.web !== 'works') expect(c.webFallback).toBeTruthy();
    }
  });
  it('🔒 Play-restricted permissions are never requested', () => {
    const all = NATIVE_CAPABILITIES.flatMap((c) => c.androidPermissions.map((p) => p.name));
    for (const banned of PLAY_RESTRICTED_ANDROID_PERMISSIONS) {
      expect(all).not.toContain(banned);
    }
  });
});

describe('the builder’s brief — only what was asked for, at the exact version', () => {
  it('Jarwis gets reminders, voice, calling/WhatsApp — each with its pinned version and a web fallback', () => {
    const brief = nativeCapabilityBrief('mujhe jarwis chahiye jo mujhe yaad dilaye, bolkar command le, aur whatsapp khole');
    expect(brief).toContain(`@capacitor/core@${REGISTRY_CAPACITOR_CORE}`);
    expect(brief).toContain('@capacitor/local-notifications@7.0.7');
    expect(brief).toContain('@capacitor-community/speech-recognition@7.0.1');
    expect(brief).toContain('@capacitor/app-launcher@7.0.4');
    expect(brief).toContain('Capacitor.isNativePlatform()');
    expect(brief).toContain('Works in the phone app');
  });
  it('🔒 an ordinary app gets NO brief — no plugin list to install for nothing', () => {
    for (const p of ['a todo app with dark mode', 'music player that I can listen to', 'chat app with notifications bell', 'ek billing app banao']) {
      expect(nativeCapabilityBrief(p)).toBe('');
      expect(requestedCapabilities(p)).toEqual([]);
    }
  });
  it('the route injects the brief for JS web frameworks', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('const nativeBrief = nativeCapabilityBrief(prompt);');
  });
});

describe('the phone build — every plugin on the app’s Capacitor major', () => {
  it('a plugin installed at its latest (Capacitor 8) is brought back to the verified Capacitor 7 version', () => {
    const out = alignNativePlugins({ '@capacitor/local-notifications': '^8.0.0', '@capacitor-community/contacts': '^8.0.0', react: '^18' }, 7);
    expect(out['@capacitor/local-notifications']).toBe('7.0.7');
    expect(out['@capacitor-community/contacts']).toBe('7.2.0');
    expect(out.react).toBe('^18');
  });
  it('an official plugin outside the table follows the major; an unknown community plugin is left alone', () => {
    const out = alignNativePlugins({ '@capacitor/dialog': '^8.0.1', 'some-capacitor-plugin': '^3.0.0' }, 7);
    expect(out['@capacitor/dialog']).toBe('^7.0.0');
    expect(out['some-capacitor-plugin']).toBe('^3.0.0');
  });
  it('an app on another major keeps its registry plugin as declared (not verified there)', () => {
    expect(alignNativePlugins({ '@capacitor-community/contacts': '^8.0.0' }, 8)['@capacitor-community/contacts']).toBe('^8.0.0');
  });
  it('buildPackageJson applies it', () => {
    const pkg = JSON.parse(buildPackageJson(JSON.stringify({ dependencies: { '@capacitor/core': '^7.0.0', '@capacitor/local-notifications': 'latest' } }), 'Jarwis', 'built'));
    expect(pkg.dependencies['@capacitor/local-notifications']).toBe('7.0.7');
  });
});

describe('the phone build — permissions, applied on the runner', () => {
  const run = (platform: 'android' | 'ios', deps: Record<string, string>, file: string, content: string): string => {
    const dir = makeTempDir('nbai-perms-');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: deps }));
    const target = join(dir, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
    const script = join(dir, 'perms.js');
    writeFileSync(script, nativePermissionScript(platform).join('\n'));
    execFileSync(process.execPath, [script], { cwd: dir });
    execFileSync(process.execPath, [script], { cwd: dir }); // twice: idempotent
    return readFileSync(target, 'utf8');
  };
  const MANIFEST = '<?xml version="1.0"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <uses-permission android:name="android.permission.INTERNET" />\n</manifest>\n';
  const PLIST = '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleName</key>\n\t<string>X</string>\n</dict>\n</plist>\n';

  it('Android: exactly the permissions the app’s plugins need, once each, with maxSdk where set', () => {
    const xml = run('android', { '@capacitor-community/contacts': '7.2.0', '@capacitor/camera': '7.0.5' }, 'android/app/src/main/AndroidManifest.xml', MANIFEST);
    expect(xml.match(/READ_CONTACTS/g)).toHaveLength(1);
    expect(xml).toContain('android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32"');
    expect(xml).not.toContain('CAMERA"'); // the camera plugin does not need it; qr-scan does
    expect(xml.trim().endsWith('</manifest>')).toBe(true);
  });
  it('Android: an app with no plugins is left byte-identical', () => {
    expect(run('android', { react: '^18' }, 'android/app/src/main/AndroidManifest.xml', MANIFEST)).toBe(MANIFEST);
  });
  it('iOS: every usage description the plugins need, inside the root dict, once each', () => {
    const plist = run('ios', { '@capacitor-community/speech-recognition': '7.0.1', '@capacitor-community/contacts': '7.2.0' }, 'ios/App/App/Info.plist', PLIST);
    expect(plist.match(/NSMicrophoneUsageDescription/g)).toHaveLength(1);
    expect(plist).toContain('<key>NSContactsUsageDescription</key>');
    expect(plist.indexOf('NSContactsUsageDescription')).toBeLessThan(plist.lastIndexOf('</dict>'));
  });
  it('all three generated workflows carry the step', () => {
    const kit = generateShipKit({ appName: 'Jarwis', ios: true });
    const workflows = Object.entries(kit.files).filter(([p]) => p.endsWith('.yml'));
    expect(workflows.length).toBe(3);
    for (const [, text] of workflows) expect(text).toContain("node - <<'NBAI_NATIVE_PERMS'");
  });
});

describe('what npm wrote is what gets saved', () => {
  it('names the manifest an install or uninstall rewrote', () => {
    expect(manifestRewrittenBy('npm install @capacitor/local-notifications@7.0.7')).toBe('package.json');
    expect(manifestRewrittenBy('cd client && npm i -D @playwright/test@1.49.1')).toBe('client/package.json');
    expect(manifestRewrittenBy('npm uninstall lodash')).toBe('package.json');
    expect(manifestRewrittenBy('yarn add zod')).toBe('package.json');
  });
  it('a bare install, npm ci and a run script rewrite nothing', () => {
    for (const c of ['npm install', 'npm ci', 'npm run build', 'npm install --no-audit --no-fund', 'npx prisma generate']) {
      expect(manifestRewrittenBy(c)).toBeNull();
    }
  });
  it('the shell tool reads the manifest back and records it after a successful install', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(src).toContain('const rewritten = manifestRewrittenBy(effectiveCommand);');
    expect(src).toContain('this.onFileWrite?.(rewritten, await this.actuator.readFile(this.workspaceId, rewritten))');
  });
});

describe('the used-capability reader is evidence, not a guess', () => {
  it('reads dependencies and devDependencies; unreadable JSON is nothing', () => {
    expect(capabilitiesInPackageJson(JSON.stringify({ devDependencies: { '@capgo/capacitor-flash': '7.1.23' } })).map((c) => c.id)).toEqual(['torch']);
    expect(capabilitiesInPackageJson('{not json')).toEqual([]);
  });
});
