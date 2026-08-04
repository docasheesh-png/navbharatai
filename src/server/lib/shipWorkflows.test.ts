// THE LOCK ON "generated but not runnable".
//
// Root cause, admin 2026-08-03: the ship kit generated .github/workflows/android-apk.yml and the panel's
// "Build my APK now" button asked for it, but the server's dispatch allow-list was a separate hand-typed
// array that still listed only the .aab and .ipa workflows. Every press was rejected with HTTP 400 before
// it reached GitHub. The build never started; the user ran it by hand from GitHub's Actions tab.
//
// The test below is the part that makes it un-repeatable: adding a workflow to the generator without
// making it dispatchable now fails CI instead of shipping a dead button.

import { describe, it, expect } from 'vitest';
import {
  SHIP_WORKFLOWS, SHIP_WORKFLOW_FILES, WORKFLOW_DIR,
  isShipWorkflow, needsUserSecrets, workflowPath, ZERO_SECRET_WORKFLOWS,
} from '../../lib/shipWorkflows';
import { generateShipKit } from './mobileShipKit';
import { DISPATCHABLE_WORKFLOWS, isDispatchableWorkflow } from '../routes/mobileShip';

// Lives under src/server/ deliberately: it must import the SERVER's real allow-list to prove the two
// agree, and an import from src/lib/ would pull express-typed server code into the frontend compile.

/** Every workflow file the kit actually writes into a user's repository. */
function generatedWorkflowFiles(ios: boolean): string[] {
  const kit = generateShipKit({ appName: 'Test App', ios });
  return Object.keys(kit.files)
    .filter((p) => p.startsWith(WORKFLOW_DIR))
    .map((p) => p.slice(WORKFLOW_DIR.length));
}

describe('ship workflow registry', () => {
  it('EVERY workflow the kit generates can be dispatched by the server', () => {
    for (const file of generatedWorkflowFiles(true)) {
      expect(
        isDispatchableWorkflow(file),
        `${file} is generated into the user's repo but the server refuses to start it — ` +
        'add it to SHIP_WORKFLOWS in src/lib/shipWorkflows.ts',
      ).toBe(true);
    }
  });

  it('the specific workflow that was broken — android-apk.yml — is generated AND dispatchable', () => {
    expect(generatedWorkflowFiles(true)).toContain('android-apk.yml');
    expect(isDispatchableWorkflow('android-apk.yml')).toBe(true);
  });

  it('the server allow-list is the registry itself, not a copy of it', () => {
    expect([...DISPATCHABLE_WORKFLOWS].sort()).toEqual([...SHIP_WORKFLOW_FILES].sort());
  });

  it('an app built without iOS still has both Android workflows runnable', () => {
    const files = generatedWorkflowFiles(false);
    expect(files).toContain('android-apk.yml');
    expect(files).toContain('android-aab.yml');
    for (const f of files) expect(isDispatchableWorkflow(f)).toBe(true);
  });

  it('refuses anything that is not a generated workflow', () => {
    for (const bad of ['../../../etc/passwd', 'release.yml', '', 'android-apk.yml ', null, 42]) {
      expect(isShipWorkflow(bad)).toBe(false);
    }
  });

  it('builds repository paths from one directory constant', () => {
    expect(workflowPath(SHIP_WORKFLOWS.androidApk)).toBe('.github/workflows/android-apk.yml');
  });

  it('only the .apk build needs no secrets — the UI must never blame a missing key there', () => {
    expect(ZERO_SECRET_WORKFLOWS).toEqual([SHIP_WORKFLOWS.androidApk]);
    expect(needsUserSecrets(SHIP_WORKFLOWS.androidApk)).toBe(false);
    expect(needsUserSecrets(SHIP_WORKFLOWS.androidAab)).toBe(true);
    expect(needsUserSecrets(SHIP_WORKFLOWS.iosIpa)).toBe(true);
  });
});
