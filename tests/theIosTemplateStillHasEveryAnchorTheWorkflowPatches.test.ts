import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * THE iOS RELEASE BUILD PATCHES A TEMPLATE IT DOES NOT OWN — SO THE TEMPLATE IS CHECKED IN CI, NOT AT RELEASE.
 *
 * THE CLASS. `ios-ipa.yml` runs `npx cap add ios` and then edits what Capacitor generated (the Google Sign-In
 * redirect, the APNs forwards, the icon set, Info.plist, the Xcode target). Every one of those edits is anchored
 * to the shape of Capacitor's template. A Capacitor bump moves an anchor with no line of ours changing, and the
 * first anyone learns of it is a failed release build on a macOS runner (10× the cost) — exactly iOS run #111
 * (2026-10-14): Capacitor 8.5 moved the generated project to the UIScene lifecycle, `AppDelegate` lost
 * `application(_:open:options:)`, and the Google Sign-In step stopped. The instance was one anchor; the class is
 * "a patch whose anchor is checked only when it ships".
 *
 * THE LOCK. This test unpacks the two iOS templates Capacitor ships (`@capacitor/cli/assets/ios-spm-template.tar.gz`,
 * the one `cap add ios` generates by default, and `ios-pods-template.tar.gz`) — the very files `cap add ios` extracts
 * before it post-processes a few of them — and holds every anchor the workflow depends on against them. The next bump
 * that moves one fails the PR that bumps it. The Google Sign-In wiring is the one patch with logic, so it is also run for
 * real here, on BOTH templates and on a fixture of the classic one, and its "neither template" refusal is exercised: a
 * third shape is an error, never a silent skip (a silent skip ships a login that hangs forever).
 *
 * 🔴 WHY IT DOES NOT RUN `npx cap add ios` (found on this test's own first CI run). It did, and passed locally, then
 * failed in CI: `ci.yml` runs Node 20 while `@capacitor/cli` 8 requires Node >= 22 (the release workflows and the
 * Dockerfile are on 22), so the CLI refuses to start there. Reading the template tarball needs no CLI, no Node 22 and no
 * network. (The CI-vs-production Node gap is its own open row in BUILD_REPORT_QUEUE.md.) The generated `AppDelegate.swift`
 * and `SceneDelegate.swift` were compared byte for byte with the tarball's before this was written.
 */
const root = join(__dirname, '..');
const SCRIPT = join(root, 'scripts', 'ios-wire-google-signin.sh');
const read = (p: string) => readFileSync(p, 'utf8');

const ASSETS = join(root, 'node_modules', '@capacitor', 'cli', 'assets');
const TEMPLATES = { spm: 'ios-spm-template.tar.gz', pods: 'ios-pods-template.tar.gz' } as const;

let work = '';
/** The App group folder of each unpacked template: `<work>/<kind>/App/App`. */
const appDir = (kind: keyof typeof TEMPLATES) => join(work, kind, 'App', 'App');

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'nbai-ios-template-'));
  for (const [kind, file] of Object.entries(TEMPLATES)) {
    expect(existsSync(join(ASSETS, file)), `${file} — Capacitor moved its iOS template`).toBe(true);
    mkdirSync(join(work, kind));
    execFileSync('tar', ['-xzf', join(ASSETS, file), '-C', join(work, kind)], { stdio: 'pipe' });
  }
});

afterAll(() => { if (work) rmSync(work, { recursive: true, force: true }); });

const runScript = (dir: string) => spawnSync('bash', [SCRIPT, dir], { encoding: 'utf8' });
const KINDS = Object.keys(TEMPLATES) as Array<keyof typeof TEMPLATES>;

describe('the iOS templates Capacitor ships today (both flavours)', () => {
  for (const kind of KINDS) {
    describe(kind, () => {
      it('has every file and directory the workflow edits', () => {
        for (const rel of [
          'App/App/AppDelegate.swift',
          'App/App/Info.plist',
          'App/App/Assets.xcassets/AppIcon.appiconset',
          'App/App.xcodeproj/project.pbxproj',
        ]) expect(existsSync(join(work, kind, rel)), rel).toBe(true);
      });

      it('the APNs step can still insert before the class\'s final closing brace', () => {
        // The push step does `s/\n\}\s*\z/…/` on AppDelegate.swift: the file must still END with the class.
        expect(read(join(appDir(kind), 'AppDelegate.swift'))).toMatch(/\n\}\s*$/);
      });

      it('at least one of the two known redirect anchors exists — never neither', () => {
        const ad = read(join(appDir(kind), 'AppDelegate.swift'));
        const sdPath = join(appDir(kind), 'SceneDelegate.swift');
        const sd = existsSync(sdPath) ? read(sdPath) : '';
        const classic = /return ApplicationDelegateProxy\.shared\.application\(app, open: url, options: options\)/.test(ad);
        const scene = /SceneDelegateProxy\.shared\.scene\(scene, openURLContexts: URLContexts\)/.test(sd);
        expect(classic || scene, 'a third template shape: ios-wire-google-signin.sh must learn it').toBe(true);
      });

      it('🔒 the Google Sign-In script wires it, ahead of the Capacitor proxy, and is idempotent', () => {
        const dir = join(work, `wire-${kind}`);
        cpSync(appDir(kind), dir, { recursive: true });
        const r = runScript(dir);
        expect(r.status, r.stderr + r.stdout).toBe(0);
        const files = ['AppDelegate.swift', 'SceneDelegate.swift'].filter((f) => existsSync(join(dir, f)));
        const patchedFile = files.find((f) => read(join(dir, f)).includes('GIDSignIn.sharedInstance.handle'));
        expect(patchedFile, 'no file carries the GIDSignIn call').toBeTruthy();
        const patched = read(join(dir, patchedFile!));
        // The call comes BEFORE the generic proxy line it must pre-empt, and is compile-guarded.
        const at = patched.indexOf('GIDSignIn.sharedInstance.handle');
        const proxyAt = Math.min(...['ApplicationDelegateProxy.shared.application(app, open', 'SceneDelegateProxy.shared.scene(scene, openURLContexts']
          .map((m) => patched.indexOf(m)).filter((i) => i >= 0));
        expect(at).toBeGreaterThan(-1);
        expect(at).toBeLessThan(proxyAt);
        expect(patched).toContain('#if canImport(GoogleSignIn)');
        expect(patched.indexOf('import GoogleSignIn')).toBeLessThan(at);
        const again = runScript(dir);
        expect(again.status).toBe(0);
        expect(read(join(dir, patchedFile!)).split('GIDSignIn.sharedInstance.handle').length - 1).toBe(1);
      });
    });
  }
});

describe('the Google Sign-In script knows both templates and refuses a third', () => {
  it('the CLASSIC template (URL in AppDelegate) is wired in AppDelegate', () => {
    const dir = join(work, 'wire-classic');
    mkdirSync(dir);
    cpSync(join(root, 'tests', 'fixtures', 'ios', 'AppDelegate.classic.swift'), join(dir, 'AppDelegate.swift'));
    const r = runScript(dir);
    expect(r.status, r.stderr).toBe(0);
    const t = read(join(dir, 'AppDelegate.swift'));
    expect(t).toContain('if GIDSignIn.sharedInstance.handle(url) {');
    expect(t.indexOf('GIDSignIn.sharedInstance.handle')).toBeLessThan(t.indexOf('return ApplicationDelegateProxy.shared.application(app, open'));
  });

  it('🔒 a template with NEITHER anchor is an error naming the script, and changes nothing', () => {
    const dir = join(work, 'wire-third');
    mkdirSync(dir);
    const body = 'import UIKit\nclass AppDelegate: UIResponder {}\n';
    writeFileSync(join(dir, 'AppDelegate.swift'), body);
    const r = runScript(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('::error::');
    expect(r.stderr).toContain('ios-wire-google-signin.sh');
    expect(read(join(dir, 'AppDelegate.swift'))).toBe(body);
  });
});

describe('the workflow calls the script — no second, inline copy to drift', () => {
  const wf = read(join(root, '.github', 'workflows', 'ios-ipa.yml'));
  it('the step runs scripts/ios-wire-google-signin.sh on the project `cap add ios` generates', () => {
    expect(wf).toContain('run: bash scripts/ios-wire-google-signin.sh ios/App/App');
  });
  it('the old inline AppDelegate-only patch is gone (the comments still tell its history)', () => {
    // YAML comments are stripped: the note above the step quotes the old call to explain why it moved.
    const code = wf.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(code).not.toContain('GIDSignIn.sharedInstance.handle(url)');
    expect(code).not.toContain("sed -i '' '1s/^/#if canImport(GoogleSignIn)");
  });
});
