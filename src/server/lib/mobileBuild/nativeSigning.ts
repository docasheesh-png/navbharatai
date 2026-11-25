// The trusted stage of a Native Cloud Build: sign (AAB) and validate (both) a finished binary.
//
// 🔒 WHY A SEPARATE MACHINE. The build sandbox ran the user's own npm packages and Gradle plugins, so
// anything it produced — including a file that claims to be a keystore check — is untrusted. This stage
// runs in a FRESH sandbox with NO network, gets only the built file (and, for an .aab, the upload key),
// and runs only the fixed script below. Nothing in it executes the app: jarsigner, apksigner, aapt2 and
// bundletool READ a zip. The key files are deleted by an EXIT trap whatever the outcome, and the machine
// itself is killed right after.
//
// 🔒 The key's passwords travel as FILES (`-storepass:file`), never as a command-line argument (visible in
// the process list) and never as an env var. Nothing here prints them.

import type { ArtifactInspection, MobileArtifactKind } from './types';

export const SIGN_DIR = '/home/user/nbai-sign';

/** A key alias we will put on a command line: what keytool itself accepts, minus anything shell-special. */
export function isSafeAlias(alias: unknown): alias is string {
  return typeof alias === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(alias);
}

/**
 * The fixed signing/validation script. Arguments: <kind apk|aab> <mode sign|verify-key> [alias].
 * Files it expects in SIGN_DIR: `in.bin` (the built file) and, when signing, `ks`, `storepass`, `keypass`.
 * Prints exactly one `::nbai-inspect::<json>` line on success; `::nbai-sign-error::<code>::<detail>` on failure.
 */
// Written with String.raw so every backslash reaches bash exactly as typed. Bash's own `${…}` cannot appear
// in a JS template, so the source spells it `@{…}` and it is restored below; the sign dir is a placeholder too.
export const SIGN_SCRIPT = String.raw`#!/usr/bin/env bash
set -uo pipefail
DIR="@@SIGN_DIR@@"
KIND="$1"; MODE="$2"; ALIAS="@{3:-}"
cleanup() { rm -f "$DIR/ks" "$DIR/storepass" "$DIR/keypass"; }
trap cleanup EXIT
die() { echo "::nbai-sign-error::$1::$2"; exit 1; }
SDK="@{ANDROID_HOME:-/opt/android-sdk}"
BT="$(ls -d "$SDK"/build-tools/*/ 2>/dev/null | sort -V | tail -1)"
BT="@{BT%/}"
BUNDLETOOL="@{NBAI_BUNDLETOOL:-/opt/nbai-android/bundletool.jar}"
[ -n "$BT" ] && [ -x "$BT/apksigner" ] || die TOOLCHAIN "Android build-tools are missing from the signing machine"
case "$ALIAS" in *[!A-Za-z0-9._-]*) die BAD_ALIAS "The key alias has unsupported characters";; esac

cert_sha256() {
  keytool -list -v -keystore "$DIR/ks" -storepass:file "$DIR/storepass" -alias "$ALIAS" 2>/dev/null \
    | sed -n 's/^[[:space:]]*SHA256:[[:space:]]*\([0-9A-F:]*\).*/\1/p' | head -1
}

if [ "$MODE" = "verify-key" ]; then
  keytool -list -keystore "$DIR/ks" -storepass:file "$DIR/storepass" >/dev/null 2>&1 \
    || die KEYSTORE_PASSWORD "The keystore could not be opened with that password"
  keytool -list -keystore "$DIR/ks" -storepass:file "$DIR/storepass" -alias "$ALIAS" >/dev/null 2>&1 \
    || die KEY_ALIAS "That keystore has no key named \"$ALIAS\""
  FP="$(cert_sha256)"
  [ -n "$FP" ] || die KEYSTORE_READ "The key's certificate could not be read"
  echo "::nbai-inspect::{\"certSha256\":\"$FP\"}"
  exit 0
fi

IN="$DIR/in.bin"
[ -s "$IN" ] || die NO_INPUT "No built file reached the signing machine"
unzip -tq "$IN" >/dev/null 2>&1 || die CORRUPT "The built file is not a valid archive"

if [ "$KIND" = "apk" ]; then
  OUT="$IN"
  VERIFY="$("$BT/apksigner" verify --print-certs "$OUT" 2>&1)" || die SIGNATURE "The APK signature does not verify: $(echo "$VERIFY" | head -3 | tr '\n' ' ')"
  FP="$(echo "$VERIFY" | sed -n 's/.*certificate SHA-256 digest: \([0-9a-f]*\).*/\1/p' | head -1 | tr 'a-f' 'A-F' | sed 's/../&:/g; s/:$//')"
  BADGING="$("$BT/aapt2" dump badging "$OUT" 2>/dev/null)" || die MANIFEST "The APK manifest could not be read"
  PKG="$(echo "$BADGING" | sed -n "s/^package: name='\([^']*\)'.*/\1/p" | head -1)"
  VC="$(echo "$BADGING" | sed -n "s/^package: .*versionCode='\([0-9]*\)'.*/\1/p" | head -1)"
  VN="$(echo "$BADGING" | sed -n "s/^package: .*versionName='\([^']*\)'.*/\1/p" | head -1)"
  MIN="$(echo "$BADGING" | sed -n "s/^minSdkVersion:'\([0-9]*\)'.*/\1/p" | head -1)"
  TGT="$(echo "$BADGING" | sed -n "s/^targetSdkVersion:'\([0-9]*\)'.*/\1/p" | head -1)"
  ABIS="$(echo "$BADGING" | sed -n "s/^native-code: //p" | tr -d "'" | head -1)"
  SIGNING=debug
else
  [ -s "$DIR/ks" ] || die NO_KEY "No upload key reached the signing machine"
  OUT="$DIR/signed.aab"
  jarsigner -keystore "$DIR/ks" -storepass:file "$DIR/storepass" -keypass:file "$DIR/keypass" \
    -digestalg SHA-256 -signedjar "$OUT" "$IN" "$ALIAS" >/dev/null 2>&1 \
    || die SIGN "The bundle could not be signed — check the key alias and passwords"
  jarsigner -verify "$OUT" 2>&1 | grep -q "jar verified" || die SIGNATURE "The signed bundle does not verify"
  java -jar "$BUNDLETOOL" validate --bundle="$OUT" >/dev/null 2>&1 || die BUNDLE "bundletool rejected the bundle"
  MANIFEST="$(java -jar "$BUNDLETOOL" dump manifest --bundle="$OUT" 2>/dev/null)" || die MANIFEST "The bundle manifest could not be read"
  PKG="$(echo "$MANIFEST" | sed -n 's/.* package="\([^"]*\)".*/\1/p' | head -1)"
  VC="$(echo "$MANIFEST" | sed -n 's/.*android:versionCode="\([0-9]*\)".*/\1/p' | head -1)"
  VN="$(echo "$MANIFEST" | sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' | head -1)"
  MIN="$(echo "$MANIFEST" | sed -n 's/.*android:minSdkVersion="\([0-9]*\)".*/\1/p' | head -1)"
  TGT="$(echo "$MANIFEST" | sed -n 's/.*android:targetSdkVersion="\([0-9]*\)".*/\1/p' | head -1)"
  ABIS="$(unzip -Z1 "$OUT" 2>/dev/null | sed -n 's#^base/lib/\([^/]*\)/.*#\1#p' | sort -u | tr '\n' ' ')"
  FP="$(cert_sha256)"
  SIGNING=upload_key
  cp "$OUT" "$DIR/out.bin"
fi
[ -n "$PKG" ] || die MANIFEST "The application id could not be read from the built file"
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
echo "::nbai-inspect::{\"applicationId\":\"$(esc "$PKG")\",\"versionCode\":\"$VC\",\"versionName\":\"$(esc "$VN")\",\"minSdk\":\"$MIN\",\"targetSdk\":\"$TGT\",\"abis\":\"$(esc "$ABIS")\",\"certSha256\":\"$FP\",\"signingType\":\"$SIGNING\"}"
`.replace(/@\{/g, '${').replace('@@SIGN_DIR@@', SIGN_DIR);

export interface SignError { code: string; detail: string }

function intOrNull(v: unknown): number | null {
  const n = Number(v);
  return typeof v === 'string' && /^\d{1,10}$/.test(v) && Number.isSafeInteger(n) ? n : null;
}

/** Read the script's result line. Never trusts a field it did not validate. */
export function parseSignOutput(stdout: string): { ok: true; inspection: ArtifactInspection } | { ok: false; error: SignError } {
  const errLine = /::nbai-sign-error::([A-Z_]{1,40})::([^\n]{0,400})/.exec(stdout);
  if (errLine) return { ok: false, error: { code: errLine[1], detail: errLine[2].trim() } };
  const m = /::nbai-inspect::(\{[^\n]{0,4000}\})/.exec(stdout);
  if (!m) return { ok: false, error: { code: 'NO_RESULT', detail: 'The signing machine returned no result' } };
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(m[1]); } catch { return { ok: false, error: { code: 'NO_RESULT', detail: 'The signing machine returned an unreadable result' } }; }
  const appId = typeof raw.applicationId === 'string' && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(raw.applicationId) ? raw.applicationId : '';
  const cert = typeof raw.certSha256 === 'string' && /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(raw.certSha256) ? raw.certSha256 : null;
  const abis = typeof raw.abis === 'string'
    ? raw.abis.split(/\s+/).filter((a) => /^[a-z0-9_-]{2,20}$/.test(a))
    : [];
  return {
    ok: true,
    inspection: {
      applicationId: appId,
      versionCode: intOrNull(raw.versionCode),
      versionName: typeof raw.versionName === 'string' && raw.versionName.length <= 64 ? raw.versionName : null,
      minSdk: intOrNull(raw.minSdk),
      targetSdk: intOrNull(raw.targetSdk),
      abis,
      certSha256: cert,
      signingType: raw.signingType === 'upload_key' ? 'upload_key' : 'debug',
    },
  };
}

/** Only the key-verification result: the certificate fingerprint. */
export function parseKeyVerify(stdout: string): { ok: true; certSha256: string } | { ok: false; error: SignError } {
  const r = parseSignOutput(stdout);
  if (!r.ok) return r;
  if (!r.inspection.certSha256) return { ok: false, error: { code: 'KEYSTORE_READ', detail: 'The key\'s certificate could not be read' } };
  return { ok: true, certSha256: r.inspection.certSha256 };
}

/**
 * Does the validated binary match what was asked for? A mismatch is refused, never delivered: an .aab whose
 * application id is not the app's would be a different app on Play.
 */
export function inspectionMismatch(kind: MobileArtifactKind, insp: ArtifactInspection, expected: { appId: string; versionCode: number | null; certSha256: string | null }): string | null {
  if (!insp.applicationId) return 'The application id could not be read from the built file.';
  if (insp.applicationId !== expected.appId) return `The built file's application id is ${insp.applicationId}, not ${expected.appId}.`;
  if (kind === 'aab') {
    if (expected.versionCode !== null && insp.versionCode !== expected.versionCode) {
      return `The bundle's versionCode is ${insp.versionCode ?? 'missing'}, not the ${expected.versionCode} it was built with.`;
    }
    if (insp.signingType !== 'upload_key') return 'The bundle is not signed with an upload key.';
    if (expected.certSha256 && insp.certSha256 !== expected.certSha256) return 'The bundle was signed with a different key than your saved upload key.';
  }
  return null;
}
