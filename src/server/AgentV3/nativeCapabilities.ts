// AgentV3 — THE NATIVE CAPABILITY REGISTRY: what a user's app can do on a phone, and exactly how.
//
// 🔴 WHY (autopsy 6bae5835, admin 2026-09-27: "jarwis jaisa app banwaya jaye to, navbharatai banayega …
// user ko saaf bataya jaye ki webapp me kaam nahi karega, github connect kar ke apk banana hoga"). A
// prompt for a phone assistant used to get a web page imitating one. The phone build (APK) already
// carries whatever Capacitor plugin the app declares — what was missing was the knowledge of WHICH
// plugin, at WHICH version, needing WHICH permissions, and what to tell the user. This table is that
// knowledge, and it is read in three places so they can never disagree:
//   1. the builder (`nativeCapabilityBrief`) — the right plugin at the right version, guarded so the
//      web preview never crashes;
//   2. the user's summary (`nativeCapabilityNotice`) — what works in the web app, what needs the phone
//      app and how to get it, what is impossible;
//   3. the phone build (`nativePermissionsFor`, `alignNativePlugins`) — every plugin on a version that
//      matches the app's Capacitor major, and the permissions / iOS usage strings it needs.
//
// 🔒 EVERY VERSION HERE WAS READ FROM THE NPM REGISTRY, NEVER GUESSED (2026-09-27). The phone build
// defaults to Capacitor 7 (`DEFAULT_CAPACITOR_MAJOR`), and most plugins' LATEST releases now require
// `@capacitor/core >= 8` — installing "latest" would fail the phone build. So each row pins the last
// release whose own `peerDependencies` accept Capacitor 7. Permissions were read from each package's
// own `AndroidManifest.xml` (what it declares itself) and its README / native source (what the APP
// must add); a permission the plugin already declares is NOT repeated here.
//
// ⚠️ PLAY POLICY SHAPED THIS TABLE AS MUCH AS THE CODE DID. Deliberately absent: `READ_MEDIA_IMAGES` /
// `READ_MEDIA_VIDEO` (Play restricts them to apps whose core purpose is a gallery; the camera plugin's
// picker needs neither), `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` (restricted to alarm-clock apps —
// reminders still fire, possibly a few minutes late), background location, and push notifications
// (they need the user's own Firebase project file, which the phone build cannot supply yet).
//
// PURE — no I/O.

import { withoutMachineText } from '../lib/machineText';

/**
 * Android permissions Google Play restricts to apps whose core purpose needs them — requesting one
 * without that purpose blocks the release in Play Console. ONE list for both the apps NavBharatAI
 * builds (this registry) and NavBharatAI's own Android app (tests/playRestrictedPermissionsStayOut):
 * the own app was never checked against it, and on 2026-10-06 its READ_MEDIA_IMAGES blocked a release.
 */
export const PLAY_RESTRICTED_ANDROID_PERMISSIONS: readonly string[] = [
  'READ_SMS', 'RECEIVE_SMS', 'READ_CALL_LOG', 'WRITE_CALL_LOG', 'PROCESS_OUTGOING_CALLS',
  'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_VISUAL_USER_SELECTED',
  'MANAGE_EXTERNAL_STORAGE', 'SCHEDULE_EXACT_ALARM', 'USE_EXACT_ALARM', 'ACCESS_BACKGROUND_LOCATION',
  'BIND_ACCESSIBILITY_SERVICE', 'QUERY_ALL_PACKAGES', 'REQUEST_INSTALL_PACKAGES', 'USE_FULL_SCREEN_INTENT',
];

/** The Capacitor major every version in this table was verified against. */
export const REGISTRY_CAPACITOR_MAJOR = 7;
/** The exact Capacitor 7 core the builder installs beside a plugin (latest 7.x on 2026-09-27). */
export const REGISTRY_CAPACITOR_CORE = '7.6.9';

export interface AndroidPermission {
  name: string;
  /** Only declared up to this SDK — the storage permissions Android stopped using. */
  maxSdk?: number;
}

export interface NativeCapability {
  id: string;
  /** What it gives the user, in plain words — shown in their summary. */
  label: string;
  pkg: string;
  /** Exact version, verified to accept Capacitor 7. */
  version: string;
  /** One line for the builder: the call to make. */
  api: string;
  /** Does the web preview do something real without the phone app? */
  web: 'works' | 'partial' | 'none';
  /** What the web preview should do instead (only when `web` is not `works`). */
  webFallback?: string;
  /** Permissions the APP must add — the plugin does not declare them itself. */
  androidPermissions: readonly AndroidPermission[];
  /**
   * `<meta-data>` the app's `<application>` must carry — a plugin setting that is not a permission.
   * (Proven 2026-09-27: the barcode plugin's README requires one, and the table had no way to say so.)
   */
  androidMetaData?: readonly { name: string; value: string }[];
  /** iOS Info.plist usage strings the app must carry, key → text shown to the user. */
  iosUsage: Readonly<Record<string, string>>;
  /** Does the user's request ask for this? Precision-first: a miss costs a hint, a false hit adds a plugin. */
  asks: RegExp;
}

export const NATIVE_CAPABILITIES: readonly NativeCapability[] = [
  {
    id: 'reminders',
    label: 'reminders and alarms that ring even when the app is closed',
    pkg: '@capacitor/local-notifications',
    version: '7.0.7',
    api: "LocalNotifications.requestPermissions(); LocalNotifications.schedule({ notifications: [{ id, title, body, schedule: { at: date, allowWhileIdle: true } }] })",
    web: 'partial',
    webFallback: 'the browser Notification API while the tab is open',
    androidPermissions: [], // the plugin declares POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED and WAKE_LOCK itself
    iosUsage: {},
    asks: /\b(remind(?:er|ers)?|alarm|yaad\s+dila\w*|yaad\s+karwa\w*)\b/i,
  },
  {
    id: 'voice-input',
    label: 'voice commands (speak to the app)',
    pkg: '@capacitor-community/speech-recognition',
    version: '7.0.1',
    api: "SpeechRecognition.requestPermissions(); SpeechRecognition.start({ language: 'hi-IN', partialResults: true, popup: false }) and listen to 'partialResults'",
    web: 'partial',
    webFallback: 'window.SpeechRecognition / webkitSpeechRecognition where the browser has it',
    androidPermissions: [], // the plugin declares RECORD_AUDIO and its RecognitionService <queries> itself
    iosUsage: {
      NSMicrophoneUsageDescription: 'The app listens to your voice commands.',
      NSSpeechRecognitionUsageDescription: 'Your voice commands are turned into text so the app can act on them.',
    },
    asks: /\b(voice\s+(?:command|commands|control|input|assistant|se)|speech\s+(?:recognition|to\s+text)|bol\s*kar|bolkar|bol\s+ke|awaaz\s+se|awaz\s+se|jo\s+(?:me|main|mai)\s+kahu)\b/i,
  },
  {
    id: 'speak',
    label: 'spoken replies (the app talks back)',
    pkg: '@capacitor-community/text-to-speech',
    version: '6.1.0',
    api: "TextToSpeech.speak({ text, lang: 'hi-IN', rate: 1.0 })",
    web: 'works',
    androidPermissions: [], // the plugin declares its TTS_SERVICE <queries> itself
    iosUsage: {},
    asks: /\b(talk\s*back|speak\s+(?:the\s+)?(?:reply|answer)|read\s+(?:it\s+)?aloud|text\s*to\s*speech|bol\s*kar\s+jawab|jawab\s+bol\w*|bol\s+ke\s+bata\w*)\b/i,
  },
  {
    id: 'open-apps',
    label: 'calling, SMS and opening WhatsApp or other apps (they open with the message filled in; the user presses send)',
    pkg: '@capacitor/app-launcher',
    version: '7.0.4',
    api: "AppLauncher.openUrl({ url: 'tel:+91…' | 'sms:+91…?body=…' | 'https://wa.me/91…?text=…' })",
    web: 'partial',
    webFallback: 'plain tel:, sms: and https://wa.me links, which a phone browser also opens',
    androidPermissions: [],
    iosUsage: {},
    asks: /\b(call\s+(?:karo|kar|kare|kardo|mummy|mom|papa)|make\s+(?:a\s+)?call|whats\s*app|sms|open\s+(?:the\s+)?(?:app|apps)|app\s+khol\w*|khol\s+do)\b/i,
  },
  {
    id: 'contacts',
    label: 'reading your contacts (with your permission)',
    pkg: '@capacitor-community/contacts',
    version: '7.2.0',
    api: "Contacts.requestPermissions(); Contacts.getContacts({ projection: { name: true, phones: true } })",
    web: 'none',
    webFallback: 'let the user type the name and number',
    androidPermissions: [{ name: 'READ_CONTACTS' }],
    iosUsage: { NSContactsUsageDescription: 'The app finds the person you ask it to call or message.' },
    // The PHONE's contacts — never a "Contact us" page, form or email (the same stray-word class as
    // the scanner above; this one would have asked for READ_CONTACTS on a landing page).
    asks: /\b(?:phone\s*book|contact\s+list|(?:phone|my|device|mobile|saved|import(?:ing)?|pick(?:ing)?\s+a)\s+contacts?|contacts?\s+(?:se|list|picker|from\s+(?:the\s+)?phone|access|sync))\b/i,
  },
  {
    id: 'torch',
    label: 'the torch (flashlight)',
    pkg: '@capgo/capacitor-flash',
    version: '7.1.23',
    api: 'CapacitorFlash.switchOn({ intensity: 1 }) / CapacitorFlash.switchOff()',
    web: 'none',
    webFallback: 'show that the torch works in the phone app',
    androidPermissions: [],
    iosUsage: {},
    asks: /\b(torch|flash\s*light)\b/i,
  },
  {
    id: 'camera',
    label: 'taking photos and picking from the gallery',
    pkg: '@capacitor/camera',
    version: '7.0.5',
    api: 'Camera.getPhoto({ resultType: CameraResultType.Uri, source: CameraSource.Prompt })',
    web: 'partial',
    webFallback: 'an <input type="file" accept="image/*" capture>',
    androidPermissions: [{ name: 'READ_EXTERNAL_STORAGE', maxSdk: 32 }, { name: 'WRITE_EXTERNAL_STORAGE', maxSdk: 29 }],
    iosUsage: {
      NSCameraUsageDescription: 'The app takes photos you ask it to.',
      NSPhotoLibraryUsageDescription: 'The app lets you choose a photo from your gallery.',
      NSPhotoLibraryAddUsageDescription: 'The app saves photos to your gallery.',
    },
    asks: /\b(camera|take\s+(?:a\s+)?photo|selfie|photo\s+(?:khinch|le)\w*)\b/i,
  },
  {
    id: 'location',
    label: 'your location',
    pkg: '@capacitor/geolocation',
    version: '7.1.8',
    api: 'Geolocation.getCurrentPosition({ enableHighAccuracy: true })',
    web: 'works',
    androidPermissions: [{ name: 'ACCESS_COARSE_LOCATION' }, { name: 'ACCESS_FINE_LOCATION' }],
    iosUsage: { NSLocationWhenInUseUsageDescription: 'The app uses your location for the feature you asked for.' },
    // The DEVICE's location — never an "Event location" field or a shop's address.
    asks: /\b(?:gps|nearby|where\s+am\s+i|meri\s+location|(?:current|my|live|user'?s?|device|real[-\s]?time)\s+location|location\s+(?:tracking|access|permission|based|sharing))\b/i,
  },
  {
    id: 'qr-scan',
    label: 'scanning QR codes and barcodes',
    pkg: '@capacitor-mlkit/barcode-scanning',
    version: '7.5.0',
    // 🔴 PROVEN 2026-09-27 against the plugin's own README: on Android `scan()` runs Google's code
    // scanner, which is a separately downloaded Play-services module. Calling it before the module is
    // present fails — a QR button that errors on its first press. So the builder is told the full
    // sequence, and the phone build asks Android to fetch the module at install time (meta-data below).
    api: "on Android first: const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable(); if (!available) { await BarcodeScanner.installGoogleBarcodeScannerModule(); wait for the 'googleBarcodeScannerModuleInstallProgress' event with state 4 (COMPLETED; 5 is FAILED — tell the user) } — then BarcodeScanner.scan() on every platform",
    web: 'none',
    webFallback: 'let the user type or paste the code',
    androidPermissions: [{ name: 'CAMERA' }],
    androidMetaData: [{ name: 'com.google.mlkit.vision.DEPENDENCIES', value: 'barcode_ui' }],
    iosUsage: { NSCameraUsageDescription: 'The app scans QR codes and barcodes with your camera.' },
    // A bare "scan" is not a camera (autopsy Sur Taal, 2026-10-04): "Music Scanner", "scan the audio
    // files on the phone" handed a music player the barcode plugin. Scanning needs a CODE to scan.
    asks: /\b(?:qr|bar\s*codes?)\b|\bscan(?:ner|ning)?\s+(?:the\s+|a\s+|an\s+)?(?:qr|bar\s*codes?|codes?|tickets?|products?|labels?|coupons?|upi)\b|\b(?:ticket|product|code|upi)\s+scan(?:ner|ning)?\b|qr\s*(?:code\s*)?(?:स्कैन|scan)/i,
  },
  {
    id: 'biometric',
    label: 'fingerprint / face unlock',
    pkg: '@capgo/capacitor-native-biometric',
    version: '7.6.0',
    api: "NativeBiometric.isAvailable(); NativeBiometric.verifyIdentity({ reason: 'Unlock' })",
    web: 'none',
    webFallback: 'a PIN',
    androidPermissions: [{ name: 'USE_BIOMETRIC' }],
    iosUsage: { NSFaceIDUsageDescription: 'The app unlocks with your face.' },
    asks: /\b(fingerprint|biometric|face\s*(?:id|unlock)|finger\s*print)\b/i,
  },
  {
    id: 'vibrate',
    label: 'vibration',
    pkg: '@capacitor/haptics',
    version: '7.0.5',
    api: 'Haptics.vibrate({ duration: 300 })',
    web: 'partial',
    webFallback: 'navigator.vibrate where the browser has it',
    androidPermissions: [], // the plugin declares VIBRATE itself
    iosUsage: {},
    asks: /\b(vibrat\w*|haptic)\b/i,
  },
  {
    id: 'share',
    label: 'sharing to other apps',
    pkg: '@capacitor/share',
    version: '7.0.4',
    api: 'Share.share({ title, text, url })',
    web: 'partial',
    webFallback: 'navigator.share where the browser has it',
    androidPermissions: [],
    iosUsage: {},
    asks: /\b(share\s+(?:it|this|to|on|kar\w*)|share\s+button)\b/i,
  },
  {
    id: 'keep-awake',
    label: 'keeping the screen on',
    pkg: '@capacitor-community/keep-awake',
    version: '7.1.0',
    api: 'KeepAwake.keepAwake() / KeepAwake.allowSleep()',
    web: 'partial',
    webFallback: 'navigator.wakeLock where the browser has it',
    androidPermissions: [],
    iosUsage: {},
    asks: /\b(keep\s+(?:the\s+)?screen\s+on|screen\s+on\s+rahe|wake\s*lock)\b/i,
  },
  {
    id: 'bluetooth',
    label: 'Bluetooth devices',
    pkg: '@capacitor-community/bluetooth-le',
    version: '7.3.2',
    api: 'BleClient.initialize(); BleClient.requestDevice({ services: [...] })',
    web: 'partial',
    webFallback: 'Web Bluetooth where the browser has it',
    androidPermissions: [], // the plugin declares its Bluetooth and location permissions itself
    iosUsage: { NSBluetoothAlwaysUsageDescription: 'The app connects to your Bluetooth device.' },
    asks: /\b(bluetooth|ble)\b/i,
  },
];

/** What NO app built here can do, in the web app or the phone app — and why, in plain words. */
export interface ImpossiblePower {
  id: 'lock-screen' | 'read-private-phone-data' | 'control-other-apps' | 'listen-while-closed';
  label: string;
  why: string;
}

export const IMPOSSIBLE_POWERS: readonly ImpossiblePower[] = [
  { id: 'lock-screen', label: 'working on the lock screen', why: 'only the phone’s own default assistant can do that, and an app cannot become one' },
  { id: 'read-private-phone-data', label: 'reading SMS, call history or other apps’ notifications', why: 'Google Play allows that only to the phone’s default SMS and calling apps' },
  { id: 'control-other-apps', label: 'controlling other apps or the phone’s settings (Wi-Fi, Bluetooth, mobile data)', why: 'Google Play’s policy on that permission rejects apps like this' },
  { id: 'listen-while-closed', label: 'listening for your voice while the app is closed', why: 'it is not supported in apps built here yet' },
];

// ── the three readers ────────────────────────────────────────────────────────────────────────────

/** The capabilities a request asks for, in table order. */
export function requestedCapabilities(prompt: string | null | undefined): NativeCapability[] {
  // A reference link's words ask for nothing (autopsy 33812996) — read without machine text.
  const text = typeof prompt === 'string' ? withoutMachineText(prompt) : '';
  if (!text.trim()) return [];
  return NATIVE_CAPABILITIES.filter((c) => c.asks.test(text));
}

/** The capabilities an app ACTUALLY uses, read from its own package.json — evidence, not a guess. */
export function capabilitiesInPackageJson(pkgJson: string | null | undefined): NativeCapability[] {
  let deps: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(String(pkgJson ?? '')) as Record<string, unknown>;
    deps = { ...((pkg.dependencies as Record<string, unknown>) || {}), ...((pkg.devDependencies as Record<string, unknown>) || {}) };
  } catch {
    return [];
  }
  return NATIVE_CAPABILITIES.filter((c) => c.pkg in deps);
}

/**
 * The builder's brief for ONE build — only the capabilities the request asks for, so an ordinary app
 * is never handed a plugin list it might install for nothing. '' when none are asked for.
 */
export function nativeCapabilityBrief(prompt: string | null | undefined): string {
  const asked = requestedCapabilities(prompt);
  if (!asked.length) return '';
  const lines = asked.map((c) =>
    `  • ${c.label}: \`npm install ${c.pkg}@${c.version}\` — ${c.api}.`
    + (c.web === 'works' ? '' : ` On the web preview use ${c.webFallback ?? 'a clear note'} instead.`));
  return [
    'PHONE FEATURES THIS REQUEST NEEDS — build them for real with these EXACT versions (they match the',
    `phone app's Capacitor ${REGISTRY_CAPACITOR_MAJOR}; a newer version fails the phone build):`,
    `  • first: \`npm install @capacitor/core@${REGISTRY_CAPACITOR_CORE}\``,
    ...lines,
    'Wrap every plugin call in `if (Capacitor.isNativePlatform())` (import { Capacitor } from \'@capacitor/core\')',
    'and on the web show the fallback plus a small note "Works in the phone app" — the web preview must',
    'never crash or show a dead button. Never pin a different version and never run `npm install <plugin>`',
    'without the version.',
    // Autopsy e7baf61d (2026-09-29): "these EXACT versions" was read as a rule for EVERY package — the
    // builder also pinned an old router, charting and icon library from memory (the router pin carried two
    // advisories) and then told the user it had used "the exact versions you asked for". The user asked
    // for no versions; this block did.
    'These pins apply ONLY to the packages listed above, and they are a platform requirement, not the',
    'user\'s request — never tell the user they asked for versions. Install every other library the',
    'normal way.',
  ].join('\n');
}

/** Android permissions the app's plugins need that they do not declare themselves. */
export function nativePermissionsFor(pkgJson: string | null | undefined): { android: AndroidPermission[]; iosUsage: Record<string, string> } {
  const android = new Map<string, AndroidPermission>();
  const iosUsage: Record<string, string> = {};
  for (const c of capabilitiesInPackageJson(pkgJson)) {
    for (const p of c.androidPermissions) if (!android.has(p.name)) android.set(p.name, p);
    for (const [k, v] of Object.entries(c.iosUsage)) if (!(k in iosUsage)) iosUsage[k] = v;
  }
  return { android: [...android.values()], iosUsage };
}

/**
 * Put every plugin on a version that matches the app's Capacitor major. PURE; returns a new map.
 *
 * Official `@capacitor/<plugin>` packages share Capacitor's own major, so they move to `^<major>`
 * exactly as core does. A registry plugin is set to its verified version when the app is on the
 * registry's major. Anything else is left exactly as the app declared it — we do not know its matrix.
 */
export function alignNativePlugins(deps: Readonly<Record<string, string>>, major: number): Record<string, string> {
  const out: Record<string, string> = { ...deps };
  for (const [name, range] of Object.entries(deps)) {
    if (/^@capacitor\/(core|android|ios|cli)$/.test(name)) continue;
    const row = NATIVE_CAPABILITIES.find((c) => c.pkg === name);
    if (row && major === REGISTRY_CAPACITOR_MAJOR) { out[name] = row.version; continue; }
    if (name.startsWith('@capacitor/')) {
      const m = /(\d+)/.exec(String(range));
      if (!m || Number(m[1]) !== major) out[name] = `^${major}.0.0`;
    }
  }
  return out;
}

const list = (items: readonly string[]): string =>
  items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * The user's summary line: what needs the phone app (and how to get it), and what is impossible.
 * `used` is what the build ACTUALLY installed; `impossible` what the request asked for that no app can do.
 * '' when neither applies.
 */
export function nativeCapabilityNotice(used: readonly NativeCapability[], impossible: readonly ImpossiblePower[]): string {
  const phoneOnly = used.filter((c) => c.web !== 'works');
  const parts: string[] = [];
  if (phoneOnly.length) {
    parts.push(
      `\n\n📱 **Works in the phone app:** ${list(phoneOnly.map((c) => c.label))}. `
      + 'In this web preview these do not work fully — the app shows what it can here and says so. '
      + 'To get the phone app: **More → Download APK**, connect your GitHub, and NavBharatAI builds the APK for you.',
    );
  }
  if (impossible.length) {
    parts.push(
      `\n\n🚫 **Not possible in any app built here:** ${impossible.map((p) => `${p.label} (${p.why})`).join('; ')}.`,
    );
  }
  return parts.join('');
}

// ── the phone build's half: permissions, applied on the runner from the app's own package.json ────

/** plugin package → what the app must add for it. Only rows that need something are listed. */
export function nativePermissionMap(): Record<string, { android: AndroidPermission[]; meta: { name: string; value: string }[]; ios: Record<string, string> }> {
  const out: Record<string, { android: AndroidPermission[]; meta: { name: string; value: string }[]; ios: Record<string, string> }> = {};
  for (const c of NATIVE_CAPABILITIES) {
    const meta = [...(c.androidMetaData ?? [])];
    if (!c.androidPermissions.length && !meta.length && !Object.keys(c.iosUsage).length) continue;
    out[c.pkg] = { android: [...c.androidPermissions], meta, ios: { ...c.iosUsage } };
  }
  return out;
}

/**
 * A self-contained Node script the phone-build workflow runs after the native project is generated.
 * It reads the APP's package.json ON THE RUNNER, so the workflow text is the same for every app (a
 * refreshed workflow in an old repository applies it too) and it can never disagree with what the
 * app actually installed. Idempotent: a permission or usage key already present is never added twice.
 *
 * ⚠️ The output is embedded in a YAML `run: |` block inside a TypeScript template literal, so it uses
 * no backticks, no `${`, and only single-quoted JS strings. Returns an array of lines (unindented).
 */
export function nativePermissionScript(platform: 'android' | 'ios'): string[] {
  const map = JSON.stringify(nativePermissionMap());
  const head = [
    "const fs = require('fs');",
    `const MAP = ${map};`,
    "let pkg = {}; try { pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); } catch (e) {}",
    'const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});',
    'const used = Object.keys(MAP).filter(function (n) { return deps[n]; });',
  ];
  if (platform === 'android') {
    return [
      ...head,
      "const f = 'android/app/src/main/AndroidManifest.xml';",
      'if (used.length && fs.existsSync(f)) {',
      "  let xml = fs.readFileSync(f, 'utf8');",
      '  const lines = [];',
      '  used.forEach(function (n) { MAP[n].android.forEach(function (p) {',
      "    if (xml.indexOf('android.permission.' + p.name + '\"') >= 0) return;",
      "    if (lines.some(function (l) { return l.indexOf('.' + p.name + '\"') >= 0; })) return;",
      "    lines.push('    <uses-permission android:name=\"android.permission.' + p.name + '\"' + (p.maxSdk ? ' android:maxSdkVersion=\"' + p.maxSdk + '\"' : '') + ' />');",
      '  }); });',
      '  if (lines.length) {',
      "    xml = xml.replace('</manifest>', lines.join('\\n') + '\\n</manifest>');",
      "    console.log('NavBharatAI: added ' + lines.length + ' permission(s) the app\\'s phone features need');",
      '  }',
      '  const metas = [];',
      '  used.forEach(function (n) { (MAP[n].meta || []).forEach(function (m) {',
      "    if (xml.indexOf('android:name=\"' + m.name + '\"') >= 0) return;",
      "    if (metas.some(function (l) { return l.indexOf('\"' + m.name + '\"') >= 0; })) return;",
      "    metas.push('        <meta-data android:name=\"' + m.name + '\" android:value=\"' + m.value + '\" />');",
      '  }); });',
      "  if (metas.length && xml.indexOf('</application>') >= 0) {",
      "    xml = xml.replace('</application>', metas.join('\\n') + '\\n    </application>');",
      "    console.log('NavBharatAI: added ' + metas.length + ' plugin setting(s) the app\\'s phone features need');",
      '  }',
      '  if (lines.length || metas.length) fs.writeFileSync(f, xml);',
      '}',
    ];
  }
  return [
    ...head,
    "const f = 'ios/App/App/Info.plist';",
    'if (used.length && fs.existsSync(f)) {',
    "  let xml = fs.readFileSync(f, 'utf8');",
    '  const add = [];',
    '  used.forEach(function (n) { Object.keys(MAP[n].ios).forEach(function (k) {',
    "    if (xml.indexOf('<key>' + k + '</key>') >= 0 || add.some(function (a) { return a.k === k; })) return;",
    '    add.push({ k: k, v: MAP[n].ios[k] });',
    '  }); });',
    '  if (add.length) {',
    "    const at = xml.lastIndexOf('</dict>');",
    "    const ins = add.map(function (a) { return '\\t<key>' + a.k + '</key>\\n\\t<string>' + a.v.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</string>\\n'; }).join('');",
    '    if (at >= 0) { xml = xml.slice(0, at) + ins + xml.slice(at); fs.writeFileSync(f, xml); }',
    "    console.log('NavBharatAI: added ' + add.length + ' iOS permission description(s)');",
    '  }',
    '}',
  ];
}
