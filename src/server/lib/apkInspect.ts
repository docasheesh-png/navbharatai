// Looking inside an uploaded .apk before anyone is allowed to install it.
//
// WHY THIS EXISTS (admin 2026-07-27): the Nav App Store lets one person upload an Android app that
// other people then install on their own phones. That is the highest-risk thing this platform does,
// and India is the single most-targeted country for Android banking trojans — so "someone uploaded
// a file" can never be the same thing as "this file is safe to hand out".
//
// WHAT THIS MODULE HONESTLY IS AND IS NOT:
//   IT IS     a real structural inspection. An .apk is a zip, so we can verify it genuinely is one,
//             confirm it carries the parts a real Android package must have, read its declared
//             permissions, and hash it so the exact bytes are recorded forever.
//   IT IS NOT a malware detector. Nobody can write one of those from scratch, and pretending
//             otherwise would be the most dangerous kind of fake feature. Actual malware scanning is
//             a separate step against VirusTotal's ~70 engines, and BOTH of those feed an admin who
//             makes the final call. Nothing here ever auto-approves anything.
//
// The permission list is the part a human reviewer actually acts on: an app that wants to read SMS,
// control accessibility services, or install other packages is either a very specific kind of tool
// or a trojan, and either way a person needs to look at it.

/** Anything larger is refused before it is read — an Android app is not 200 MB of anything good. */
export const MAX_APK_BYTES = 150 * 1024 * 1024;

/**
 * The largest APK that can actually be PUBLISHED — the store's own cap AND the malware scanner's,
 * whichever is smaller. Both caps are passed IN (no import) so this module stays dependency-free.
 *
 * ROOT CAUSE (2026-07-28): the store advertised `MAX_APK_BYTES` (150 MB) as its limit, but "no scan
 * ⇒ no publication" is the store's founding rule and the scanner tops out at 32 MB — so anything
 * above 32 MB uploaded fine and was then refused as unscannable. Fixing the transport ceiling earlier
 * the same day moved the REAL limit from ~24 MB to 32 MB but left the advertised 150 MB just as
 * fictional. DERIVING the number instead of maintaining it by hand keeps the promise true by
 * construction: raise the scanner (paid plan, large-file endpoint, another vendor) and the advertised
 * limit rises with it automatically. PURE.
 */
export function publishableApkLimitBytes(storeCap: number, scanCap: number): number {
  return Math.min(storeCap, scanCap);
}

/**
 * Permissions that mean a human must look at this app before anyone installs it.
 *
 * These are the ones real Android malware needs to do its damage: read the one-time password out of
 * an SMS, drive the screen on the victim's behalf, install a second payload, or survive a reboot
 * while watching everything. A legitimate app CAN use them — but not without a reason a reviewer
 * should be able to see.
 */
export const HIGH_RISK_PERMISSIONS: Record<string, string> = {
  'android.permission.READ_SMS': 'Can read your text messages, including bank OTPs',
  'android.permission.RECEIVE_SMS': 'Can intercept incoming texts, including bank OTPs',
  'android.permission.SEND_SMS': 'Can send texts from your phone, at your cost',
  'android.permission.BIND_ACCESSIBILITY_SERVICE': 'Can see and control what you do on screen',
  'android.permission.BIND_DEVICE_ADMIN': 'Can take administrative control of the phone',
  'android.permission.REQUEST_INSTALL_PACKAGES': 'Can install other apps on your phone',
  'android.permission.SYSTEM_ALERT_WINDOW': 'Can draw over other apps, including your bank app',
  'android.permission.READ_CONTACTS': 'Can read your contacts',
  'android.permission.RECORD_AUDIO': 'Can record audio through the microphone',
  'android.permission.READ_CALL_LOG': 'Can read who you have called',
  'android.permission.PROCESS_OUTGOING_CALLS': 'Can see and redirect calls you make',
  'android.permission.CAMERA': 'Can use the camera',
  'android.permission.ACCESS_FINE_LOCATION': 'Can track your exact location',
  'android.permission.QUERY_ALL_PACKAGES': 'Can see every other app installed on the phone',
};

export interface ApkFacts {
  ok: boolean;
  /** SHA-256 of the exact uploaded bytes — the permanent identity of this file, for takedowns. */
  sha256: string;
  sizeBytes: number;
  /** Permissions found declared in the package. */
  permissions: string[];
  /** The subset of those that need a human to look, with a plain-language reason each. */
  highRisk: Array<{ permission: string; why: string }>;
  /** True when the package is signed at all. An unsigned APK cannot even be installed. */
  signed: boolean;
  /** Entry names found, for the record. */
  entryCount: number;
  /** Present when ok is false — why this file cannot be accepted. */
  error?: string;
  /** True findings that are not rejections, surfaced to the reviewer rather than swallowed. */
  warnings: string[];
}

function fail(error: string, sha256 = '', sizeBytes = 0): ApkFacts {
  return { ok: false, sha256, sizeBytes, permissions: [], highRisk: [], signed: false, entryCount: 0, error, warnings: [] };
}

/**
 * Read the permission names out of a binary AndroidManifest.xml.
 *
 * Android compiles its manifest into a binary XML format, so the permission strings live in the
 * file's string pool as UTF-16. Rather than write a full binary-XML parser — which would be a lot of
 * code to get subtly wrong — we scan the pool for the `android.permission.*` strings, which is
 * exactly what they are: literal entries in that table.
 *
 * This is deliberately conservative. It can miss a custom permission name, and it never invents one.
 * A missed permission means a reviewer sees less, not that something unsafe is marked safe — and the
 * reviewer is the actual gate.
 */
export function extractPermissions(manifest: Buffer): string[] {
  const found = new Set<string>();

  // UTF-16LE (the usual encoding of the binary manifest's string pool).
  const utf16 = manifest.toString('utf16le');
  for (const m of utf16.matchAll(/android\.permission\.[A-Z_0-9]{3,60}/g)) found.add(m[0]);
  for (const m of utf16.matchAll(/com\.android\.[a-z.]*permission\.[A-Z_0-9]{3,60}/g)) found.add(m[0]);

  // Some tools emit UTF-8 pools; a plain-text manifest (unusual but valid in some builds) also lands here.
  const utf8 = manifest.toString('utf8');
  for (const m of utf8.matchAll(/android\.permission\.[A-Z_0-9]{3,60}/g)) found.add(m[0]);

  return [...found].sort();
}

/** Pair each declared permission with the plain-language reason a reviewer should care. */
export function flagHighRisk(permissions: string[]): Array<{ permission: string; why: string }> {
  return permissions
    .filter((p) => HIGH_RISK_PERMISSIONS[p])
    .map((p) => ({ permission: p, why: HIGH_RISK_PERMISSIONS[p] }));
}

/**
 * Inspect an uploaded file and report what it actually is.
 *
 * Every rejection below is a real structural fact, not a guess: a file that is not a zip, or a zip
 * with no AndroidManifest.xml, or one with no signature block, is not an installable Android app —
 * so accepting it would mean hosting something that can only confuse or harm whoever downloads it.
 */
export async function inspectApk(buffer: Buffer): Promise<ApkFacts> {
  const crypto = await import('crypto');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const sizeBytes = buffer.length;

  if (sizeBytes === 0) return fail('That file is empty.', sha256, 0);
  if (sizeBytes > MAX_APK_BYTES) {
    return fail(`That file is ${(sizeBytes / 1024 / 1024).toFixed(0)} MB. The limit is ${MAX_APK_BYTES / 1024 / 1024} MB.`, sha256, sizeBytes);
  }
  // Every zip — and therefore every apk — starts with "PK\x03\x04".
  if (!(buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04)) {
    return fail('That is not an Android app file. An .apk is a zip archive, and this file is not one.', sha256, sizeBytes);
  }

  let zip: import('jszip');
  try {
    const JSZip = (await import('jszip')).default;
    zip = await JSZip.loadAsync(buffer) as unknown as import('jszip');
  } catch {
    return fail('That file could not be opened — it looks damaged.', sha256, sizeBytes);
  }

  const files = (zip as unknown as { files: Record<string, unknown> }).files;
  const names = Object.keys(files);
  const warnings: string[] = [];

  const manifestName = names.find((n) => n === 'AndroidManifest.xml');
  if (!manifestName) {
    return fail('That file is a zip, but not an Android app — it has no AndroidManifest.xml.', sha256, sizeBytes);
  }
  if (!names.some((n) => /^classes\d*\.dex$/.test(n))) {
    // No code at all is not necessarily fatal (a resource-only split), but it is unusual enough that
    // a reviewer should know rather than have it hidden.
    warnings.push('This package contains no code (no classes.dex). It may be a split or an incomplete build.');
  }

  // A signature block is what makes an APK installable at all; Android refuses an unsigned one.
  const signed = names.some((n) => /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(n))
    || names.some((n) => /^META-INF\/MANIFEST\.MF$/i.test(n));
  if (!signed) {
    return fail('That app is not signed, so no phone will install it. Build a signed release and upload that.', sha256, sizeBytes);
  }

  let permissions: string[] = [];
  try {
    const manifestBuf = await (zip as unknown as { file: (n: string) => { async: (t: string) => Promise<Buffer> } })
      .file(manifestName).async('nodebuffer');
    permissions = extractPermissions(manifestBuf);
  } catch {
    warnings.push('The app’s manifest could not be read, so its permissions are unknown — review this one especially carefully.');
  }
  if (permissions.length === 0 && !warnings.length) {
    warnings.push('No permissions were detected. That can be genuine for a simple app, but it is worth a second look.');
  }

  return {
    ok: true,
    sha256,
    sizeBytes,
    permissions,
    highRisk: flagHighRisk(permissions),
    signed,
    entryCount: names.length,
    warnings,
  };
}
