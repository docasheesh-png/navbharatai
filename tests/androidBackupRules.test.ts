import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ANDROID BACKUP RULES — and the one mistake that would sign every user out.
 *
 * WHY THE RULES EXIST. The per-app cloud backup limit is 25 MB; past it Android calls
 * onQuotaExceeded() and backs up NOTHING, silently. NavBharatAI ships ~39 MB of web assets and
 * registers a service worker that caches the app shell, so the WebView's caches alone can push the
 * data directory past that. The likely state before this change was cloud backup failing entirely,
 * with users quietly re-signing-in on every new phone and no way to know why.
 *
 * So excluding the caches is what makes backup WORK. It is not a tightening.
 *
 * ⚠️ WHY THESE TESTS EXIST. The obvious-looking one-liner — `<exclude path="app_webview/"/>` — would
 * "fix" the size problem and sign out every user who restores a backup, because `Local Storage` and
 * `IndexedDB` under that directory hold the Firebase Auth session. Nothing in a build, a typecheck or
 * a CI run would notice: the app compiles, the tests pass, and the damage only appears on a real
 * device restore, weeks later, to someone who has already lost their session.
 *
 * These assertions are the only thing standing between that edit and production.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const RULES_31 = 'android/app/src/main/res/xml/data_extraction_rules.xml';
const RULES_24 = 'android/app/src/main/res/xml/backup_rules.xml';
const MANIFEST = 'android/app/src/main/AndroidManifest.xml';

/** Every `path="…"` an <exclude> names, across a rules file. */
function excludedPaths(xml: string): string[] {
  return [...xml.matchAll(/<exclude[^>]*\bpath="([^"]+)"/g)].map((m) => m[1]);
}

describe('the session must survive a restore', () => {
  for (const file of [RULES_24, RULES_31]) {
    describe(file.split('/').pop()!, () => {
      const xml = read(file);
      const paths = excludedPaths(xml);

      it('never excludes app_webview wholesale', () => {
        // This is THE mistake. It looks like a tidy one-liner and it logs everyone out.
        for (const p of paths) {
          expect(p, `"${p}" would take the whole WebView profile`).not.toMatch(/^app_webview\/?$/);
          expect(p).not.toMatch(/^app_webview\/Default\/?$/);
        }
      });

      it('never excludes the directories that hold the Firebase session', () => {
        const forbidden = ['Local Storage', 'IndexedDB', 'databases', 'shared_prefs', 'Session Storage'];
        for (const p of paths) {
          for (const f of forbidden) {
            expect(p.toLowerCase(), `"${p}" contains "${f}"`).not.toContain(f.toLowerCase());
          }
        }
      });

      it('excludes ONLY things whose name says cache or scratch', () => {
        // A denylist is safe only while every entry is genuinely regenerable. Anything else that
        // appears here should have to justify itself by failing this test first.
        for (const p of paths) {
          expect(p, `"${p}" is not obviously regenerable`)
            .toMatch(/Cache|CacheStorage|ScriptCache|GPUCache|blob_storage/i);
        }
      });

      it('covers BOTH Chromium profile layouts', () => {
        // WebView has used `app_webview/<dir>` and `app_webview/Default/<dir>` across versions. A path
        // that matches nothing is harmless; a missing one silently keeps the cache in the backup.
        expect(paths.some((p) => /^app_webview\/Cache$/.test(p))).toBe(true);
        expect(paths.some((p) => /^app_webview\/Default\/Cache$/.test(p))).toBe(true);
      });

      it('uses the root domain — WebView data is not under files/ or databases/', () => {
        const domains = [...xml.matchAll(/<exclude[^>]*\bdomain="([^"]+)"/g)].map((m) => m[1]);
        expect(domains.length).toBeGreaterThan(0);
        expect(new Set(domains)).toEqual(new Set(['root']));
      });
    });
  }
});

describe('both API ranges are covered — minSdk is 24', () => {
  const manifest = read(MANIFEST);

  it('the manifest wires BOTH attributes', () => {
    // Each is ignored by the API levels the other covers. Shipping only dataExtractionRules would
    // leave Android 11 and below on the unrestricted default, i.e. the bug, on the older and
    // lower-memory phones that need this most.
    expect(manifest).toContain('android:fullBackupContent="@xml/backup_rules"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
  });

  it('backup is still ON — the fix is to make it work, not to switch it off', () => {
    expect(manifest).toContain('android:allowBackup="true"');
  });

  it('minSdk really is low enough to need the older file', () => {
    // If minSdk ever passes 30, backup_rules.xml becomes dead weight and should be removed rather
    // than left to rot as a file nobody reads.
    const vars = read('android/variables.gradle');
    const min = Number(/minSdkVersion\s*=\s*(\d+)/.exec(vars)?.[1]);
    expect(min).toBeLessThanOrEqual(30);
  });
});

describe('the two files agree', () => {
  it('cloud-backup and device-transfer exclude the same set', () => {
    // A cache is pointless to copy either way. Letting the two drift would mean a D2D transfer
    // carrying a stale service-worker cache — a known cause of "the app came back on an old version".
    const xml = read(RULES_31);
    const cloud = excludedPaths(/<cloud-backup>([\s\S]*?)<\/cloud-backup>/.exec(xml)?.[1] || '');
    const transfer = excludedPaths(/<device-transfer>([\s\S]*?)<\/device-transfer>/.exec(xml)?.[1] || '');
    expect(cloud.length).toBeGreaterThan(5);
    expect(new Set(transfer)).toEqual(new Set(cloud));
  });

  it('the API 24-30 file excludes the same set as cloud-backup', () => {
    const cloud = excludedPaths(/<cloud-backup>([\s\S]*?)<\/cloud-backup>/.exec(read(RULES_31))?.[1] || '');
    expect(new Set(excludedPaths(read(RULES_24)))).toEqual(new Set(cloud));
  });

  it('neither file disables backup on devices without E2E encryption', () => {
    // `disableIfNoEncryptionCapabilities="true"` would refuse to back up at all on cheaper phones,
    // which in this user base means losing the session on every device change. The data here is a
    // regenerable web session, not secrets worth that trade.
    expect(read(RULES_31)).not.toContain('disableIfNoEncryptionCapabilities="true"');
  });
});
