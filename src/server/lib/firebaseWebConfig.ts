// A FIREBASE CLIENT API KEY IS NOT A LEAK (autopsy d0b2fcd6, 2026-10-07, Q-742).

/**
 * A Firebase WEB config's `apiKey` is public by design (it ships in every Firebase web app; access is
 * enforced by security rules, App Check and API-key restrictions) — this repository's own secret census
 * says so. Flagging it as a hardcoded secret made the repair replace a user's `firebaseConfig` with env
 * reads that do not exist (autopsy d0b2fcd6, Q-742). The SAME `AIza…` shape is a real secret elsewhere (a
 * Gemini or server-side Maps key), so the exemption needs the config's own neighbours, not the prefix. PURE.
 */
// Web (camelCase), Android `google-services.json` (snake_case) and iOS `GoogleService-Info.plist` (UPPER) —
// the same public client config in the three shapes a Capacitor app ships.
const FIREBASE_WEB_CONFIG_FIELDS = /\b(?:authDomain|projectId|storageBucket|messagingSenderId|appId|measurementId|project_id|storage_bucket|mobilesdk_app_id|project_number|firebase_url|PROJECT_ID|STORAGE_BUCKET|GOOGLE_APP_ID|GCM_SENDER_ID|BUNDLE_ID)\b|\.firebaseapp\.com\b/g;
export function isFirebaseWebConfigKey(around: string | undefined): boolean {
  if (!around || !/\bAIza[0-9A-Za-z_-]{30,}/.test(around)) return false;
  const fields = new Set((around.match(FIREBASE_WEB_CONFIG_FIELDS) ?? []).map((f) => f.replace(/^\./, '')));
  return fields.size >= 2;
}


/** For a line-based scanner: the lines around line `i`, joined — enough to see a config object's fields. */
export function firebaseConfigAroundLine(lines: readonly string[], i: number): string {
  return lines.slice(Math.max(0, i - 15), i + 16).join('\n');
}
