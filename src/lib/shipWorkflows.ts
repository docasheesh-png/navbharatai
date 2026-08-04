// The GitHub Actions workflows NavBharatAI generates into a user's app repository — ONE declaration
// that the generator, the server's dispatch allow-list and the UI all read.
//
// WHY THIS FILE EXISTS (root cause of "Build my APK now did nothing", admin 2026-08-03):
// the same workflow filename used to be written out by hand in four unconnected places —
//   • src/server/lib/mobileShipKit.ts  wrote  '.github/workflows/android-apk.yml'
//   • src/components/ide/StoreBuildPanel.tsx  asked to run  'android-apk.yml'
//   • src/server/routes/mobileShip.ts  allowed only  ['android-aab.yml', 'ios-ipa.yml']
//   • src/server/routes/mobileSetup.ts  reported a third list back to the client
// so adding the APK workflow to the generator and the button left the SERVER's allow-list behind. Every
// press of "Build my APK now" was rejected with HTTP 400 before it ever reached GitHub, and the same
// allow-list also blocked the status poll — the build genuinely never started. The user had to run it
// by hand from GitHub's Actions tab.
//
// The class of bug is "one fact, four copies, no link". So the fact now lives here exactly once, in a
// dependency-free module both the browser bundle and the server can import, and a test asserts that
// every workflow the kit actually generates is dispatchable. A new workflow cannot be added to the
// generator without becoming runnable — the mismatch fails CI instead of silently killing a button.

/** Directory every generated workflow lives in, inside the user's repository. */
export const WORKFLOW_DIR = '.github/workflows/';

/**
 * Every workflow the ship kit can generate, keyed by what it produces.
 *
 *  • `androidApk` — installable .apk, signed with Android's universal debug key. NO secrets needed;
 *    this is the one-click path for a normal user.
 *  • `androidAab` — signed Play Store bundle. Needs the user's OWN keystore secrets.
 *  • `iosIpa`     — signed .ipa uploaded to TestFlight. Needs the user's Apple credentials.
 */
export const SHIP_WORKFLOWS = {
  androidApk: 'android-apk.yml',
  androidAab: 'android-aab.yml',
  iosIpa: 'ios-ipa.yml',
} as const;

export type ShipWorkflowKey = keyof typeof SHIP_WORKFLOWS;
export type ShipWorkflowFile = (typeof SHIP_WORKFLOWS)[ShipWorkflowKey];

/** Flat list — the dispatch allow-list and the status poll both derive from this, never from a copy. */
export const SHIP_WORKFLOW_FILES: readonly ShipWorkflowFile[] = Object.values(SHIP_WORKFLOWS);

/** Repository-relative path of a workflow, so the generator never spells the directory out again. */
export function workflowPath(file: ShipWorkflowFile): string {
  return `${WORKFLOW_DIR}${file}`;
}

/** True when this is a workflow NavBharatAI generated and may therefore start on the user's behalf. */
export function isShipWorkflow(file: unknown): file is ShipWorkflowFile {
  return typeof file === 'string' && (SHIP_WORKFLOW_FILES as readonly string[]).includes(file);
}

/**
 * Workflows that need NO repository secrets. Only these can succeed with nothing set up by the user, so
 * the UI must never blame a missing signing key when one of these fails — that would send a user hunting
 * for a problem that does not exist.
 */
export const ZERO_SECRET_WORKFLOWS: readonly ShipWorkflowFile[] = [SHIP_WORKFLOWS.androidApk];

export function needsUserSecrets(file: ShipWorkflowFile): boolean {
  return !(ZERO_SECRET_WORKFLOWS as readonly string[]).includes(file);
}
