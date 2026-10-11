// THE PERMISSIONS A FINISHED ANDROID BUNDLE REALLY REQUESTS (2026-10-08, Q-749).
//
// Play Console judges the bundle it receives, not our source. On 2026-10-08 run #150 uploaded bundle 150 and
// Play would not send the release for review: "Use alternative system pickers for photos / videos". #3571 had
// already removed READ_MEDIA_* from the manifest and Q-698 said "the first .aab is the real proof", yet no step
// read that proof. The run went green without anyone knowing what the bundle actually asked for. Only Play
// knew, and it found out last.
//
// This module reads the `android.permission.*` names out of an .aab's `base/manifest/AndroidManifest.xml` and
// checks them against PLAY_RESTRICTED_ANDROID_PERMISSIONS (the one list). It is used by NavBharatAI's own
// release workflow (scripts/checkBundlePermissions.ts, which blocks the upload) and by the workflow generated
// for users' apps (mobileShipKit.ts, which warns).

import { PLAY_RESTRICTED_ANDROID_PERMISSIONS } from '../AgentV3/nativeCapabilities';

/**
 * The short `android.permission.*` names in an .aab manifest (aapt2's protobuf XML), sorted and unique.
 *
 * Every string in that format is length-prefixed, so a name is read as exactly the bytes its one-byte prefix
 * covers, never by scanning to the next non-name byte: the field tag after a value can be `2` or an upper-case
 * letter, which a greedy match would glue onto the name ("CAMERA2").
 *
 * PURE and SELF-CONTAINED on purpose: the users' workflow inlines it with Function#toString, so it may not
 * refer to anything outside its own body.
 */
export function permissionsInProtoManifest(bytes: Uint8Array): string[] {
  const prefix = 'android.permission.';
  const found = new Set<string>();
  scan: for (let i = 1; i + prefix.length <= bytes.length; i++) {
    for (let k = 0; k < prefix.length; k++) {
      if (bytes[i + k] !== prefix.charCodeAt(k)) continue scan;
    }
    const len = bytes[i - 1];
    if (len <= prefix.length || len > 127 || i + len > bytes.length) continue;
    let name = '';
    for (let k = prefix.length; k < len; k++) name += String.fromCharCode(bytes[i + k]);
    if (/^[A-Z][A-Z0-9_]*$/.test(name)) found.add(name);
  }
  return [...found].sort();
}

/** The names in `permissions` that Google Play restricts. PURE. */
export function playRestrictedIn(permissions: readonly string[]): string[] {
  return permissions.filter((p) => PLAY_RESTRICTED_ANDROID_PERMISSIONS.includes(p));
}

export interface BundlePermissionVerdict {
  /** False only when a restricted permission was read from the bundle. An unreadable bundle is not a failure. */
  ok: boolean;
  permissions: string[];
  restricted: string[];
  /** GitHub workflow commands. Annotations are readable over the API, so a session can check the proof. */
  annotations: string[];
  /** One Markdown line for the run summary. */
  summary: string;
}

/**
 * The verdict for one bundle's manifest bytes (`null` when the bundle has no manifest entry). PURE.
 *
 * A bundle whose permissions cannot be read is reported as NOT VERIFIED and does not block: failing a release
 * on our own parser's surprise would break a working pipeline, and a warning says exactly what is unknown.
 */
export function bundlePermissionVerdict(manifest: Uint8Array | null): BundlePermissionVerdict {
  const permissions = manifest ? permissionsInProtoManifest(manifest) : [];
  if (permissions.length === 0) {
    const why = manifest ? 'no permission could be read from its manifest' : 'it has no base/manifest/AndroidManifest.xml';
    return {
      ok: true, permissions, restricted: [],
      annotations: [`::warning title=Bundle permissions NOT verified::The bundle's permissions could not be checked: ${why}. Play's restricted-permission check was not proven for this bundle.`],
      summary: `⚠️ **Bundle permissions NOT verified** — ${why}.`,
    };
  }
  const restricted = playRestrictedIn(permissions);
  if (restricted.length > 0) {
    return {
      ok: false, permissions, restricted,
      annotations: [
        `::error title=Play-restricted permission in the bundle::${restricted.join(', ')}. Google Play will not send a release with this permission for review unless the app's core purpose needs it. Remove it from android/app/src/main/AndroidManifest.xml (tools:node="remove" if a library adds it).`,
        `::notice title=Bundle permissions::${permissions.join(', ')}`,
      ],
      summary: `⛔ **The bundle requests a permission Google Play restricts: ${restricted.join(', ')}** — so it was NOT sent to Play. All permissions: ${permissions.join(', ')}.`,
    };
  }
  return {
    ok: true, permissions, restricted,
    annotations: [`::notice title=Bundle permissions::${permissions.join(', ')} (none on Play's restricted list)`],
    summary: `✅ **Bundle permissions checked** — none is on Google Play's restricted list: ${permissions.join(', ')}.`,
  };
}

/**
 * A standalone Node script (CommonJS) for the workflow generated into a USER's repository, which has no copy of
 * this module. It inlines `permissionsInProtoManifest` and the restricted list, so the user's check is this
 * same code. It WARNS and never fails the build: an app whose core purpose needs a restricted permission may
 * declare it in Play Console, and that is the user's call. Argument: the path to the extracted manifest bytes.
 */
export function bundlePermissionWarnScript(): string {
  return [
    "const fs = require('fs');",
    `const permissionsIn = (${permissionsInProtoManifest.toString()});`,
    `const RESTRICTED = ${JSON.stringify(PLAY_RESTRICTED_ANDROID_PERMISSIONS)};`,
    'let bytes = null;',
    'try { bytes = fs.readFileSync(process.argv[2]); } catch (e) { bytes = null; }',
    'const permissions = bytes && bytes.length ? permissionsIn(bytes) : [];',
    'const restricted = permissions.filter((p) => RESTRICTED.includes(p));',
    "const say = (line) => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\\n\\n'); };",
    'if (permissions.length === 0) {',
    "  console.log('::warning title=Bundle permissions NOT verified::No permission could be read from the bundle, so Google Play\\'s restricted-permission check was not proven.');",
    "  say('⚠️ **Bundle permissions NOT verified** — no permission could be read from the bundle.');",
    '} else if (restricted.length > 0) {',
    "  console.log('::warning title=Play-restricted permission in the bundle::' + restricted.join(', ') + '. Google Play will not send this release for review unless your app\\'s core purpose needs it. If it does not, remove it from android/app/src/main/AndroidManifest.xml.');",
    "  say('⚠️ **This bundle requests a permission Google Play restricts: ' + restricted.join(', ') + '.** Play will not send the release for review unless your app\\'s core purpose needs it. All permissions: ' + permissions.join(', ') + '.');",
    '} else {',
    "  console.log('::notice title=Bundle permissions::' + permissions.join(', ') + ' (none on Google Play\\'s restricted list)');",
    "  say('✅ **Bundle permissions checked** — none is on Google Play\\'s restricted list: ' + permissions.join(', ') + '.');",
    '}',
  ].join('\n');
}
