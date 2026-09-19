/**
 * WHY A GUARD BUILT FOR THIS EXACT FAILURE DID NOT STOP IT (autopsy 2026-09-19).
 *
 * `12thmentors/app-50-files-2026-09-19` pressed "Google Play bundle" and the run died in twelve seconds
 * with all four signing secrets absent. A pre-flight written on 2026-09-15 — after an earlier report of
 * the same shape — exists to stop that press. It could not have run:
 *
 *   • it lives in `StoreBuildPanel.tsx`, i.e. in the BROWSER BUNDLE, and the Android app is BUNDLED
 *     mode (`webDir: 'dist'`, no `server.url`), so an installed user's frontend is whatever shipped in
 *     the last `.aab` — versionCode 91, uploaded 2026-08-25, three weeks before that code existed;
 *   • and `/api/mobile-ship/trigger`, the SERVER route that actually starts the build, checked nothing.
 *
 * 🔴 THE FIRST DIAGNOSIS WAS WRONG AND IS PINNED HERE SO IT IS NOT RE-DERIVED: "an org where the user
 * lacks admin". `mobileSetup.ts` takes `owner` from `GET /user` — the token's own login — so the
 * repository is always in the user's personal account and they always have admin on it.
 *
 * So the fix is architectural, in two halves, and this suite locks both:
 *   1. PREVENT — the key is created at SETUP, before the button that needs it can be pressed.
 *   2. GUARD   — and the refusal lives on the SERVER, which updates for every user the moment it
 *                merges, instead of in a binary they would have to reinstall.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shouldRefuseUnsignedDispatch } from '../src/server/lib/androidSigningSetup';
import { ANDROID_SIGNING_SECRETS } from '../src/lib/signingReadiness';

const root = join(__dirname, '..');
const ship = readFileSync(join(root, 'src/server/routes/mobileShip.ts'), 'utf8');
const setup = readFileSync(join(root, 'src/server/routes/mobileSetup.ts'), 'utf8');
const shared = readFileSync(join(root, 'src/server/lib/androidSigningSetup.ts'), 'utf8');
const panel = readFileSync(join(root, 'src/components/ide/StoreBuildPanel.tsx'), 'utf8');

describe('the guard that only ran on your phone', () => {
  it('refuses a dispatch only on a real verdict, never on our own blindness', () => {
    expect(shouldRefuseUnsignedDispatch([])).toBe(true);                       // read it: nothing there
    expect(shouldRefuseUnsignedDispatch(['ANDROID_KEY_ALIAS'])).toBe(true);    // read it: partial
    expect(shouldRefuseUnsignedDispatch([...ANDROID_SIGNING_SECRETS])).toBe(false);
    // 🔒 The whole reason this is a separate predicate from `missingSigningSecrets`, which treats a
    // null list as "all four missing" — right for a MESSAGE, catastrophic for a REFUSAL.
    expect(shouldRefuseUnsignedDispatch(null)).toBe(false);
    expect(shouldRefuseUnsignedDispatch(undefined)).toBe(false);
  });

  it('puts the guard on the SERVER dispatch route, where an old app binary cannot bypass it', () => {
    expect(ship).toContain('if (workflow === SHIP_WORKFLOWS.androidAab) {');
    expect(ship).toContain('if (shouldRefuseUnsignedDispatch(names)) {');
    expect(ship).toContain("code: 'SIGNING_NOT_READY',");
    // The refusal must come BEFORE the call that starts the build, or it refuses nothing.
    expect(ship.indexOf('shouldRefuseUnsignedDispatch(names)'))
      .toBeLessThan(ship.indexOf('/actions/workflows/${workflow}/dispatches'));
  });

  it('guards ANDROID only — the iOS workflow needs Apple credentials, a different set entirely', () => {
    // Asking about Android's four secret names on the iOS path would refuse every legitimate iOS build.
    expect(ship).not.toContain('if (needsUserSecrets(workflow)) {\n      let names');
    const guard = ship.slice(ship.indexOf('if (workflow === SHIP_WORKFLOWS.androidAab) {'));
    expect(guard.slice(0, 900)).not.toMatch(/iosIpa/);
  });

  it('creates the key at SETUP, before any build button exists', () => {
    expect(setup).toContain('await ensureUploadKeystore(headers, owner, repoName, name)');
    // It must not be able to fail the setup: the .apk needs no key, and taking that away to solve a
    // problem the user may not have is the trade this repo forbids.
    expect(setup).toContain("signing = { state: 'blocked', present: [], note:");
    // And the result has to REACH the response — computing it and dropping it is how this rots.
    expect(setup).toMatch(/\n        signing,\n/);
    expect(setup).toContain('keystore: newKey');
  });

  it('never replaces or completes an existing key', () => {
    // A published app is tied to its upload key; a fresh one makes the next update unpublishable.
    expect(shared).toContain("if (present.length === ANDROID_SIGNING_SECRETS.length) return { state: 'present', present };");
    expect(shared).toContain("if (present.length > 0) return { state: 'partial', present };");
    // A failed READ must never fall through to a WRITE.
    const readCatch = shared.indexOf('} catch (err) {');
    expect(readCatch).toBeGreaterThan(-1);
    expect(readCatch).toBeLessThan(shared.indexOf('const key = generateUploadKeystore(appName);'));
  });

  it('has ONE implementation of read-then-maybe-create, used by both routes', () => {
    // The original lived only inside /signing-setup, which is exactly why setup could not reuse it and
    // the key was only ever made after a build had already failed.
    expect(ship).toContain('const ensured = await ensureUploadKeystore(');
    expect(setup).toContain('ensureUploadKeystore');
    expect(shared).toContain('export async function ensureUploadKeystore(');
  });

  it('hands the key to the user from BOTH places, through one download path', () => {
    // This is the only moment the key exists outside the user's repository — NavBharatAI keeps no copy,
    // so a path that forgets to hand it over means they simply never get it.
    expect(panel).toContain('const receiveKeystore = useCallback(');
    // Two call sites: the setup response and the explicit "Create my signing key" press. The
    // definition reads `= useCallback(`, so it is not one of these matches.
    expect(panel.match(/receiveKeystore\(/g)!.length).toBe(2);
    expect(panel).toContain('a.download = `${repoName}-upload.keystore`;');
    // And exactly one place builds that download, so the two callers cannot drift.
    expect(panel.match(/URL\.createObjectURL\(new Blob\(\[bytes\]/g)!.length).toBe(1);
  });
});
