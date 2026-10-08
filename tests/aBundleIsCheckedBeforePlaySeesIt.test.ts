// A BUNDLE IS CHECKED BEFORE PLAY SEES IT (2026-10-08, Q-749).
//
// Run #150 uploaded bundle 150 and Play Console would not send the release for review: "Use alternative system
// pickers for photos / videos". #3571 had removed READ_MEDIA_* from the manifest and Q-698 said "the first .aab
// is the real proof", but no step ever read that proof. The run was green and nobody could say whether bundle
// 150 carried the permission or an older bundle in another track did. THE CLASS: a bundle reached Play with
// its real permissions unread. Both workflows that build an .aab now read them: ours stops the upload, the one
// generated for users' apps warns.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import yaml from 'js-yaml';
import {
  permissionsInProtoManifest, playRestrictedIn, bundlePermissionVerdict, bundlePermissionWarnScript,
} from '../src/server/lib/bundlePermissions';
import { PLAY_RESTRICTED_ANDROID_PERMISSIONS } from '../src/server/AgentV3/nativeCapabilities';
import { generateShipKit } from '../src/server/lib/mobileShipKit';

/** One protobuf string field: tag, one-byte length, UTF-8 bytes. */
const str = (tag: number, s: string): number[] => [tag, s.length, ...Buffer.from(s, 'utf8')];
/** A uses-permission attribute as aapt2 writes it: name, then the value, then a following field tag. */
const usesPermission = (name: string, nextTag = 0x32): number[] => [
  ...str(0x12, 'name'), ...str(0x1a, `android.permission.${name}`), nextTag, 0x00,
];
const manifest = (...names: string[]): Uint8Array => Uint8Array.from([
  0x0a, 0x08, ...Buffer.from('manifest'),
  ...names.flatMap((n, i) => usesPermission(n, i % 2 ? 0x41 : 0x32)),
  ...str(0x1a, 'com.navbharat.ai.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'),
]);

describe('reading the permissions out of an .aab manifest', () => {
  it('reads each name by its length prefix — a following field tag ("2", "A") is never glued on', () => {
    expect(permissionsInProtoManifest(manifest('INTERNET', 'CAMERA', 'POST_NOTIFICATIONS')))
      .toEqual(['CAMERA', 'INTERNET', 'POST_NOTIFICATIONS']);
  });

  it('ignores a permission-looking substring of a longer string, and a non-permission string', () => {
    const bytes = Uint8Array.from([...str(0x1a, 'com.example.android.permission.FOO'), ...str(0x1a, 'android.permission.')]);
    expect(permissionsInProtoManifest(bytes)).toEqual([]);
  });

  it('finds a restricted permission', () => {
    expect(playRestrictedIn(permissionsInProtoManifest(manifest('INTERNET', 'READ_MEDIA_IMAGES')))).toEqual(['READ_MEDIA_IMAGES']);
  });
});

describe('the verdict', () => {
  it('🔒 a restricted permission fails, names it, and lists everything as an annotation', () => {
    const v = bundlePermissionVerdict(manifest('INTERNET', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO'));
    expect(v.ok).toBe(false);
    expect(v.restricted).toEqual(['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO']);
    expect(v.annotations[0]).toMatch(/^::error title=Play-restricted permission in the bundle::READ_MEDIA_IMAGES, READ_MEDIA_VIDEO/);
    expect(v.annotations.join('\n')).toContain('::notice title=Bundle permissions::INTERNET, READ_MEDIA_IMAGES, READ_MEDIA_VIDEO');
  });

  it('a clean bundle passes with its permissions posted', () => {
    const v = bundlePermissionVerdict(manifest('INTERNET', 'CAMERA'));
    expect(v).toMatchObject({ ok: true, restricted: [] });
    expect(v.annotations[0]).toBe("::notice title=Bundle permissions::CAMERA, INTERNET (none on Play's restricted list)");
  });

  it('an unreadable bundle is NOT VERIFIED, said plainly — never a pass, never a stop', () => {
    for (const input of [null, new Uint8Array(0), Uint8Array.from([1, 2, 3])]) {
      const v = bundlePermissionVerdict(input);
      expect(v.ok).toBe(true);
      expect(v.annotations[0]).toMatch(/^::warning title=Bundle permissions NOT verified::/);
      expect(v.summary).toMatch(/NOT verified/);
    }
  });
});

async function aab(bytes: Uint8Array): Promise<string> {
  const zip = new JSZip();
  zip.file('base/manifest/AndroidManifest.xml', bytes);
  zip.file('base/dex/classes.dex', 'x');
  const dir = mkdtempSync(join(tmpdir(), 'aab-'));
  const path = join(dir, 'app-release.aab');
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
  return path;
}

describe('the script the release workflow runs, on a real zip', () => {
  const run = (path: string) => spawnSync('npx', ['tsx', 'scripts/checkBundlePermissions.ts', path], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });

  it('🔒 exits 1 on a restricted permission, 0 on a clean bundle', async () => {
    const bad = run(await aab(manifest('INTERNET', 'READ_MEDIA_IMAGES')));
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('::error title=Play-restricted permission in the bundle::READ_MEDIA_IMAGES');
    const good = run(await aab(manifest('INTERNET', 'CAMERA')));
    expect(good.status).toBe(0);
    expect(good.stdout).toContain('::notice title=Bundle permissions::CAMERA, INTERNET');
  }, 60_000);
});

describe('NavBharatAI\'s own release workflow', () => {
  const wf = readFileSync('.github/workflows/android-aab.yml', 'utf8');
  const steps = (yaml.load(wf) as { jobs: Record<string, { steps: Array<{ id?: string; name?: string; run?: string }> }> })
    .jobs[Object.keys((yaml.load(wf) as { jobs: object }).jobs)[0]].steps;
  const at = (id: string) => steps.findIndex((s) => s.id === id);

  it('🔒 reads the bundle\'s permissions after it is built and BEFORE the Play upload', () => {
    expect(at('permissions')).toBeGreaterThan(at('bundle'));
    expect(at('permissions')).toBeLessThan(at('play_upload'));
    expect(steps[at('permissions')].run).toContain('scripts/checkBundlePermissions.ts android/app/build/outputs/bundle/release/app-release.aab');
  });

  it('🔒 the summary never calls a permission-stopped upload "not ticked"', () => {
    const summary = steps.find((s) => s.name === 'Summary')!.run!;
    const guard = summary.indexOf('steps.permissions.outcome');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(summary.indexOf('case "${{ steps.play_upload.outcome }}"'));
    const script = summary.replace(/\$\{\{[^}]*\}\}/g, 'x');
    expect(spawnSync('bash', ['-n'], { input: script }).status).toBe(0);
  });
});

describe('the workflow generated for a user\'s app (the sibling)', () => {
  const wf = generateShipKit({ appName: 'X' }).files['.github/workflows/android-aab.yml'];
  const script = /<<'NBAI_PERMISSIONS'\n([\s\S]*?)\n\s*NBAI_PERMISSIONS\n/.exec(wf)?.[1].replace(/^ {10}/gm, '') ?? '';

  it('carries the check, after the bundle is built, and the YAML still parses', () => {
    expect(() => yaml.load(wf)).not.toThrow();
    expect(script).not.toBe('');
    expect(wf.indexOf('bundleRelease assembleRelease')).toBeGreaterThan(0);
    expect(wf.indexOf('NBAI_PERMISSIONS')).toBeGreaterThan(wf.indexOf('bundleRelease assembleRelease'));
    expect(script).toContain(JSON.stringify(PLAY_RESTRICTED_ANDROID_PERMISSIONS)); // the one list, inlined at generation
  });

  it('🔒 the inlined script really runs: it warns on a restricted permission and never fails the build', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-perm-'));
    writeFileSync(join(dir, 'check.cjs'), script);
    const runOn = (bytes: Uint8Array) => {
      writeFileSync(join(dir, 'manifest.pb'), bytes);
      return spawnSync(process.execPath, [join(dir, 'check.cjs'), join(dir, 'manifest.pb')], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
    };
    const bad = runOn(manifest('INTERNET', 'READ_MEDIA_IMAGES'));
    expect(bad.status).toBe(0);
    expect(bad.stdout).toContain('::warning title=Play-restricted permission in the bundle::READ_MEDIA_IMAGES');
    const good = runOn(manifest('INTERNET', 'CAMERA'));
    expect(good.stdout).toContain('::notice title=Bundle permissions::CAMERA, INTERNET');
    expect(runOn(new Uint8Array(0)).stdout).toContain('::warning title=Bundle permissions NOT verified::');
  });

  it('the inlined decoder is the same code as ours (one implementation)', () => {
    expect(bundlePermissionWarnScript()).toContain(permissionsInProtoManifest.toString());
  });
});
