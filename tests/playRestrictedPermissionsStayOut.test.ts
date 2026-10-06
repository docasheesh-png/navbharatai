// PLAY-RESTRICTED PERMISSIONS STAY OUT OF NAVBHARATAI'S OWN ANDROID APP (2026-10-06).
//
// Play Console blocked a release: "Use alternative system pickers for photos / videos". The app's own
// AndroidManifest.xml declared READ_MEDIA_IMAGES (and READ_MEDIA_AUDIO) "for file uploads", although nothing
// used them: uploads go through the system picker, which needs no permission. THE CLASS: the Play-restricted
// list already guarded the apps NavBharatAI BUILDS (nativeCapabilities.ts), but NavBharatAI's own manifest was
// never checked against it. These tests check the own manifest, AND every manifest a native dependency merges
// into it, against the same single list.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PLAY_RESTRICTED_ANDROID_PERMISSIONS } from '../src/server/AgentV3/nativeCapabilities';

const MANIFEST = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');

/** Every <uses-permission> element of a manifest: its short name, and whether it is a removal marker. */
function permissions(xml: string): Array<{ name: string; removed: boolean }> {
  const out: Array<{ name: string; removed: boolean }> = [];
  for (const m of xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*>/g)) {
    const name = /android:name="(?:android\.permission\.)?([^"]+)"/.exec(m[0])?.[1];
    if (name) out.push({ name, removed: /tools:node="remove"/.test(m[0]) });
  }
  return out;
}

/** The Android manifests of the native packages this app installs (each is merged into the release). */
function dependencyManifests(): Array<{ pkg: string; xml: string }> {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
  const out: Array<{ pkg: string; xml: string }> = [];
  for (const d of deps) {
    const androidDir = join('node_modules', d, 'android');
    if (!existsSync(androidDir)) continue;
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'build' && e.name !== 'test' && e.name !== 'androidTest') walk(p); }
        else if (e.name === 'AndroidManifest.xml') out.push({ pkg: d, xml: readFileSync(p, 'utf8') });
      }
    };
    walk(androidDir);
  }
  return out;
}

describe('NavBharatAI\'s own Android app requests no Play-restricted permission', () => {
  it('THE REPORTED CASE: no READ_MEDIA_IMAGES / READ_MEDIA_VIDEO grant — and both are removal markers', () => {
    const own = permissions(MANIFEST);
    for (const name of ['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_VISUAL_USER_SELECTED']) {
      expect(own.filter((p) => p.name === name), name).toEqual([{ name, removed: true }]);
    }
    expect(MANIFEST).toContain('xmlns:tools="http://schemas.android.com/tools"');
  });

  it('CENSUS: no restricted permission is granted by the app manifest', () => {
    const granted = permissions(MANIFEST).filter((p) => !p.removed).map((p) => p.name);
    expect(granted.filter((n) => PLAY_RESTRICTED_ANDROID_PERMISSIONS.includes(n))).toEqual([]);
  });

  it('CENSUS: a restricted permission a native dependency declares is stripped by a removal marker', () => {
    const removed = new Set(permissions(MANIFEST).filter((p) => p.removed).map((p) => p.name));
    const manifests = dependencyManifests();
    expect(manifests.length).toBeGreaterThan(0); // the scan really ran (@capacitor-firebase/messaging has one)
    const leaks = manifests.flatMap(({ pkg, xml }) => permissions(xml)
      .filter((p) => !p.removed && PLAY_RESTRICTED_ANDROID_PERMISSIONS.includes(p.name) && !removed.has(p.name))
      .map((p) => `${pkg}: ${p.name}`));
    expect(leaks).toEqual([]);
  });

  it('"Save to Photos" stays out of the media plugin\'s gallery mode, which is what would ask for gallery access', () => {
    // @capacitor-community/media requests READ_MEDIA_IMAGES/VIDEO at runtime ONLY with androidGalleryMode on.
    expect(readFileSync('capacitor.config.ts', 'utf8')).not.toMatch(/androidGalleryMode\s*:\s*true/);
  });
});
