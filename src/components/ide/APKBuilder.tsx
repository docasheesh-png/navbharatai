import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Smartphone,
  Check,
  Download,
  Copy,
  ChevronRight,
  ChevronLeft,
  Package,
  Globe,
  Cpu,
  FileText,
  AlertCircle,
  Rocket,
  Upload,
  Clipboard,
  Sparkles,
  Loader2
} from 'lucide-react';
import { AppTargetPicker, useUserApps, useAppFiles } from './AppTargetPicker';
import { StoreBuildPanel } from './StoreBuildPanel';
import { readIconFile, readIconFromClipboard } from '../../lib/appIcon';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface APKBuilderProps {
  generatedCode?: string;
  appName?: string;
  /** The app the user is currently working on, pre-selected in the picker. */
  sessionId?: string;
  /** The connected GitHub token — the build runs on the user's own account. */
  githubToken?: string;
  onConnectGitHub?: () => void;
  /** Send the user to AI Image Gen to create an icon. */
  onMakeIcon?: () => void;
}

interface AppInfo {
  appName: string;
  packageName: string;
  version: string;
  description: string;
  icon: string;
  primaryColor: string;
  orientation: 'portrait' | 'landscape' | 'auto';
  targetSdk: '33' | '34';
}

interface PermissionState {
  CAMERA: boolean;
  MICROPHONE: boolean;
  ACCESS_FINE_LOCATION: boolean;
  ACCESS_COARSE_LOCATION: boolean;
  READ_EXTERNAL_STORAGE: boolean;
  WRITE_EXTERNAL_STORAGE: boolean;
  RECEIVE_BOOT_COMPLETED: boolean;
  VIBRATE: boolean;
  WAKE_LOCK: boolean;
}

type BuildMethod = 'twa' | 'capacitor';

interface BuildConfig {
  method: BuildMethod;
  twaUrl: string;
}

interface GeneratedFile {
  name: string;
  content: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EMOJI_OPTIONS = ['🚀', '⚡', '🎯', '💡', '🌟', '🔥', '🎨', '🛒', '📱', '🎵', '📰', '🏠'];

const PERMISSION_META: Record<keyof PermissionState, { label: string; desc: string }> = {
  CAMERA: { label: 'CAMERA', desc: 'Camera access for photos/video' },
  MICROPHONE: { label: 'RECORD_AUDIO', desc: 'Microphone for audio recording' },
  ACCESS_FINE_LOCATION: { label: 'ACCESS_FINE_LOCATION', desc: 'Precise GPS location' },
  ACCESS_COARSE_LOCATION: { label: 'ACCESS_COARSE_LOCATION', desc: 'Approximate network location' },
  READ_EXTERNAL_STORAGE: { label: 'READ_EXTERNAL_STORAGE', desc: 'Read files from storage' },
  WRITE_EXTERNAL_STORAGE: { label: 'WRITE_EXTERNAL_STORAGE', desc: 'Write files to storage' },
  RECEIVE_BOOT_COMPLETED: { label: 'RECEIVE_BOOT_COMPLETED', desc: 'Start on device boot (background tasks)' },
  VIBRATE: { label: 'VIBRATE', desc: 'Vibration motor control' },
  WAKE_LOCK: { label: 'WAKE_LOCK', desc: 'Keep screen/CPU awake' },
};

const BUILD_STEPS = [
  'Generating AndroidManifest.xml...',
  'Creating build.gradle...',
  'Configuring capacitor.config.json...',
  'Packaging files...',
  'Ready!',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPackageName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 20) || 'myapp';
  return `com.navbharat.${slug}`;
}

function generateManifest(info: AppInfo, perms: PermissionState): string {
  const extraPerms = (Object.keys(perms) as Array<keyof PermissionState>)
    .filter((k) => perms[k])
    .map((k) => `    <uses-permission android:name="android.permission.${PERMISSION_META[k].label}" />`)
    .join('\n');

  const orientationAttr =
    info.orientation === 'auto'
      ? 'unspecified'
      : info.orientation === 'portrait'
      ? 'portrait'
      : 'landscape';

  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${info.packageName}">

    <uses-permission android:name="android.permission.INTERNET" />
${extraPerms ? extraPerms + '\n' : ''}
    <application
        android:label="${info.appName}"
        android:theme="@style/AppTheme"
        android:allowBackup="true"
        android:supportsRtl="true">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:screenOrientation="${orientationAttr}">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

    </application>
</manifest>`;
}

function generateBuildGradle(info: AppInfo): string {
  const minSdk = 21;
  const targetSdk = parseInt(info.targetSdk, 10);
  const compileSdk = targetSdk;

  const [major, minor, patch] = info.version.split('.').map((n) => parseInt(n, 10) || 0);
  const versionCode = major * 10000 + minor * 100 + patch;

  return `plugins {
    id 'com.android.application'
}

android {
    compileSdk ${compileSdk}
    namespace '${info.packageName}'

    defaultConfig {
        applicationId "${info.packageName}"
        minSdk ${minSdk}
        targetSdk ${targetSdk}
        versionCode ${versionCode}
        versionName "${info.version}"
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }
}

dependencies {
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'com.google.android.material:material:1.11.0'
    // TWA Support
    implementation 'com.google.androidbrowserhelper:androidbrowserhelper:2.5.0'
}`;
}

function generateCapacitorConfig(info: AppInfo, twaUrl: string): string {
  return JSON.stringify(
    {
      appId: info.packageName,
      appName: info.appName,
      webDir: 'dist',
      server: {
        androidScheme: 'https',
        url: twaUrl || undefined,
      },
      android: {
        allowMixedContent: false,
        backgroundColor: info.primaryColor,
      },
    },
    null,
    2
  );
}

function generateReadme(info: AppInfo, method: BuildMethod, twaUrl: string): string {
  if (method === 'twa') {
    return `# ${info.appName} — Android Build (TWA)

## Prerequisites
- Android Studio installed
- Java 11+
- Git

## Steps

### 1. Create new Android project
\`\`\`
File > New > New Project > Empty Activity
Package: ${info.packageName}
\`\`\`

### 2. Add TWA dependency
In \`app/build.gradle\` add:
\`\`\`
implementation 'com.google.androidbrowserhelper:androidbrowserhelper:2.5.0'
\`\`\`

### 3. Replace AndroidManifest.xml
Copy the provided \`AndroidManifest.xml\` to \`app/src/main/AndroidManifest.xml\`.

### 4. Configure your URL
Set your deployed app URL:
- URL: ${twaUrl || 'https://your-app.example.com'}
- Verify Digital Asset Links: https://digitalassetlinks.googleapis.com/v1/statements

### 5. Build APK
\`\`\`
./gradlew assembleRelease
\`\`\`
The APK will be at: \`app/build/outputs/apk/release/app-release.apk\`

### 6. Sign APK
\`\`\`
keytool -genkey -v -keystore my-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias my-key-alias
\`\`\`

## Notes
- Requires: Android 5.0+ (API 21)
- Target SDK: Android ${info.targetSdk === '33' ? '13' : '14'} (API ${info.targetSdk})
- Package: ${info.packageName}
- Version: ${info.version}
`;
  }

  return `# ${info.appName} — Android Build (Capacitor)

## Prerequisites
- Node.js 16+
- Android Studio
- Java 11+
- \`npm install -g @capacitor/cli\`

## Steps

### 1. Initialize Capacitor in your web project
\`\`\`bash
npm install @capacitor/core @capacitor/android
npx cap init "${info.appName}" "${info.packageName}"
\`\`\`

### 2. Build your web app
\`\`\`bash
npm run build
\`\`\`

### 3. Add Android platform
\`\`\`bash
npx cap add android
\`\`\`

### 4. Copy config files
- Place \`capacitor.config.json\` in the root (already done)
- \`AndroidManifest.xml\` → \`android/app/src/main/AndroidManifest.xml\`
- \`build.gradle\` → \`android/app/build.gradle\`

### 5. Sync & open in Android Studio
\`\`\`bash
npx cap sync android
npx cap open android
\`\`\`

### 6. Build APK
In Android Studio: **Build > Build Bundle(s) / APK(s) > Build APK(s)**

### 7. Sign for release
\`\`\`bash
keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias key0
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 -keystore release.jks app-debug.apk key0
\`\`\`

## App Details
- Package: ${info.packageName}
- Version: ${info.version}
- Target SDK: Android ${info.targetSdk === '33' ? '13' : '14'} (API ${info.targetSdk})
- Orientation: ${info.orientation}
`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  const labels = ['App Info', 'Permissions', 'Build Method', 'Generate'];
  return (
    <div className="flex items-center justify-center mb-8 px-4">
      {Array.from({ length: total }).map((_, i) => (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center gap-1">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all
                ${i < current
                  ? 'bg-green-600 border-green-600 text-white'
                  : i === current
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-transparent border-white/20 text-white/30'}`}
            >
              {i < current ? <Check size={16} /> : i + 1}
            </div>
            <span
              className={`text-xs whitespace-nowrap ${
                i === current ? 'text-indigo-400' : i < current ? 'text-green-400' : 'text-white/30'
              }`}
            >
              {labels[i]}
            </span>
          </div>
          {i < total - 1 && (
            <div className={`flex-1 h-0.5 mx-2 mb-5 ${i < current ? 'bg-green-600' : 'bg-white/10'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [text]);
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-xs text-white/50 hover:text-indigo-400 transition-colors px-2 py-1 rounded hover:bg-white/5"
    >
      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function FileCard({ file }: { file: GeneratedFile }) {
  const download = useCallback(() => {
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: '#0d1117' }}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10" style={{ background: '#161b22' }}>
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-indigo-400" />
          <span className="text-sm font-mono text-white/80">{file.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <CopyButton text={file.content} />
          <button
            onClick={download}
            className="flex items-center gap-1 text-xs text-white/50 hover:text-indigo-400 transition-colors px-2 py-1 rounded hover:bg-white/5"
          >
            <Download size={12} />
            Download
          </button>
        </div>
      </div>
      <pre className="text-xs text-white/70 p-4 overflow-x-auto max-h-48 leading-relaxed font-mono whitespace-pre-wrap">
        {file.content}
      </pre>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const APKBuilder: React.FC<APKBuilderProps> = ({ appName, sessionId, githubToken, onConnectGitHub, onMakeIcon }) => {
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');

  // Step 1
  const [info, setInfo] = useState<AppInfo>({
    appName: appName || 'My App',
    packageName: toPackageName(appName || 'myapp'),
    version: '1.0.0',
    description: '',
    icon: '🚀',
    primaryColor: '#6366f1',
    orientation: 'portrait',
    targetSdk: '34',
  });

  // WHICH app is being packaged (admin 2026-07-27). The builder used to have no idea — it packaged
  // whatever preview happened to be open, under a hardcoded "NavBharatAI App" name.
  const { apps, loading: appsLoading, selected: targetSession, setSelected: setTargetSession } = useUserApps(sessionId);
  const { files: appFiles, loading: filesLoading } = useAppFiles(targetSession);

  // A REAL icon, not an emoji. Play needs a 512x512 PNG; an emoji rendered by whatever font the build
  // machine happens to have is not one.
  const [iconDataUrl, setIconDataUrl] = useState('');
  const [iconNote, setIconNote] = useState('');
  const [iconFailed, setIconFailed] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptIcon = useCallback(async (run: () => Promise<{ ok: boolean; dataUrl?: string; error?: string; warning?: string }>) => {
    setIconBusy(true);
    setIconNote('');
    setIconFailed(false);
    try {
      const r = await run();
      if (!r.ok || !r.dataUrl) {
        setIconFailed(true);
        setIconNote(r.error || 'That image could not be used.');
        return;
      }
      setIconDataUrl(r.dataUrl);
      setIconNote(r.warning || 'Icon set.');
      setIconFailed(!!r.warning);
    } finally {
      setIconBusy(false);
    }
  }, []);

  // Keep the app name in step with the app the user picked, unless they have typed their own.
  const nameTouched = useRef(false);
  useEffect(() => {
    if (nameTouched.current || !targetSession) return;
    const picked = apps.find((a) => a.sessionId === targetSession);
    if (picked) setInfo((prev) => ({ ...prev, packageName: prev.packageName }));
  }, [targetSession, apps]);

  // Step 2
  const [perms, setPerms] = useState<PermissionState>({
    CAMERA: false,
    MICROPHONE: false,
    ACCESS_FINE_LOCATION: false,
    ACCESS_COARSE_LOCATION: false,
    READ_EXTERNAL_STORAGE: false,
    WRITE_EXTERNAL_STORAGE: false,
    RECEIVE_BOOT_COMPLETED: false,
    VIBRATE: false,
    WAKE_LOCK: false,
  });

  // Step 3
  const [buildConfig, setBuildConfig] = useState<BuildConfig>({ method: 'twa', twaUrl: '' });

  // Step 4
  const [buildState, setBuildState] = useState<'idle' | 'building' | 'done'>('idle');
  const [buildStepIdx, setBuildStepIdx] = useState(-1);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);

  const updateInfo = useCallback((patch: Partial<AppInfo>) => {
    setInfo((prev) => {
      const next = { ...prev, ...patch };
      if (patch.appName !== undefined) {
        next.packageName = toPackageName(patch.appName);
      }
      return next;
    });
  }, []);

  const validate = useCallback((): boolean => {
    setError('');
    if (step === 0 && !info.appName.trim()) {
      setError('App Name is required.');
      return false;
    }
    if (step === 2 && buildConfig.method === 'twa' && !buildConfig.twaUrl.trim()) {
      setError('HTTPS URL is required for TWA builds.');
      return false;
    }
    return true;
  }, [step, info.appName, buildConfig]);

  const next = useCallback(() => {
    if (!validate()) return;
    setStep((s) => Math.min(s + 1, 3));
  }, [validate]);

  const back = useCallback(() => {
    setError('');
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const startBuild = useCallback(() => {
    if (!validate()) return;
    // Generate the Android project CONFIG FILES synchronously (admin autopsy 2026-07-21). The old
    // code ran a 650ms fake "build" timer even though nothing is compiled here — a browser cannot
    // build or sign an APK/AAB. The real signed .aab is produced by the repo's CI workflow (see the
    // honest note in the 'done' panel). No fake progress theatre.
    const files: GeneratedFile[] = [
      { name: 'AndroidManifest.xml', content: generateManifest(info, perms) },
      { name: 'build.gradle', content: generateBuildGradle(info) },
      ...(buildConfig.method === 'capacitor'
        ? [{ name: 'capacitor.config.json', content: generateCapacitorConfig(info, buildConfig.twaUrl) }]
        : []),
      { name: 'README.md', content: generateReadme(info, buildConfig.method, buildConfig.twaUrl) },
    ];
    setGeneratedFiles(files);
    setBuildStepIdx(BUILD_STEPS.length - 1);
    setBuildState('done');
  }, [info, perms, buildConfig, validate]);

  // SHIP KIT (admin 2026-07-26) — the config files above describe the app but cannot become an
  // installable one on their own. This fetches the REAL build pipeline (GitHub Actions workflows that
  // produce a signed .aab and an .ipa uploaded to TestFlight, plus the fastlane lane and a setup guide)
  // and downloads every file. The binaries are built by GitHub's own Linux + macOS runners, because a
  // browser cannot compile or sign one — and iOS legally requires macOS.
  const [shipBusy, setShipBusy] = useState(false);
  const [shipErr, setShipErr] = useState('');
  const [shipDone, setShipDone] = useState(false);

  // Step-by-step publishing walkthrough, fetched from the ONE structured source that also feeds the
  // AIs and the generated SHIPPING.md — so the three can never drift.
  const [guide, setGuide] = useState<null | Array<{ platform: string; title: string; upfront: string; steps: Array<{ id: string; title: string; detail: string; youShouldSee?: string; cost?: string; takes?: string; youMustDoThis?: boolean; navbharatDoesThis?: boolean; link?: string }> }>>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guidePlatform, setGuidePlatform] = useState<'android' | 'ios'>('android');
  const [guideErr, setGuideErr] = useState('');
  const [doneSteps, setDoneSteps] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('navbharat_publish_steps') || '{}'); } catch { return {}; }
  });

  const toggleStep = useCallback((id: string) => {
    setDoneSteps((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem('navbharat_publish_steps', JSON.stringify(next)); } catch { /* progress is a nicety, never blocks */ }
      return next;
    });
  }, []);

  const openGuide = useCallback(async () => {
    setGuideOpen(true);
    if (guide) return;
    setGuideErr('');
    try {
      const r = await fetch('/api/mobile-ship/guide');
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
      const d = await r.json();
      setGuide(d.guides || null);
    } catch (e) {
      setGuideErr((e as { message?: string })?.message || 'Could not load the guide.');
    }
  }, [guide]);

  const downloadShipKit = useCallback(async () => {
    setShipBusy(true);
    setShipErr('');
    setShipDone(false);
    try {
      const r = await fetch('/api/mobile-ship/kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appName: info.appName, appId: info.packageName }),
      });
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
      const kit = await r.json();
      const files = (kit?.files || {}) as Record<string, string>;
      if (!Object.keys(files).length) throw new Error('The server returned an empty kit');
      // One download per file, keeping the real paths in the filename so they are easy to place.
      for (const [path, content] of Object.entries(files)) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = path.replace(/\//g, '__');
        a.click();
        URL.revokeObjectURL(url);
      }
      setShipDone(true);
    } catch (e) {
      // Honest failure — never pretend a kit was produced.
      setShipErr((e as { message?: string })?.message || 'Could not build the ship kit. Please try again.');
    } finally {
      setShipBusy(false);
    }
  }, [info.appName, info.packageName]);

  const downloadAll = useCallback(() => {
    // Honest filename: this is a plain-text bundle of the config files, not a real .zip / .apk.
    const combined = generatedFiles.map((f) => `\n\n===== ${f.name} =====\n\n${f.content}`).join('');
    const blob = new Blob([combined], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${info.packageName}-android-config.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [generatedFiles, info.packageName]);

  // ── Renders ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto overscroll-contain p-4 sm:p-6 font-sans" style={{ background: '#0d1117', color: '#e6edf3', WebkitOverflowScrolling: 'touch' }}>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Smartphone size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Android APK Builder</h1>
            <p className="text-sm text-white/50">Convert your web app into an Android package</p>
          </div>
        </div>

        {/* WHICH app is being packaged. Without this the builder had no idea — it used whatever
            preview was open, under a hardcoded name. */}
        <div className="rounded-xl border border-white/10 mb-6" style={{ background: '#161b22' }}>
          <AppTargetPicker
            apps={apps}
            appsLoading={appsLoading}
            files={appFiles}
            filesLoading={filesLoading}
            sessionId={targetSession}
            onSessionChange={setTargetSession}
          />
        </div>

        <StepIndicator current={step} total={4} />

        {/* Card */}
        <div className="rounded-xl border border-white/10 p-6" style={{ background: '#161b22' }}>

          {/* ── Step 0: App Info ── */}
          {step === 0 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-white mb-4">App Information</h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-white/50 mb-1">App Name *</label>
                  <input
                    className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    style={{ background: '#0d1117' }}
                    value={info.appName}
                    onChange={(e) => updateInfo({ appName: e.target.value })}
                    placeholder="My App"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Package Name</label>
                  <input
                    className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 focus:outline-none focus:border-indigo-500"
                    style={{ background: '#0d1117' }}
                    value={info.packageName}
                    onChange={(e) => setInfo((p) => ({ ...p, packageName: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-white/50 mb-1">Version</label>
                  <input
                    className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    style={{ background: '#0d1117' }}
                    value={info.version}
                    onChange={(e) => updateInfo({ version: e.target.value })}
                    placeholder="1.0.0"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Primary Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="w-10 h-10 rounded-lg border border-white/10 cursor-pointer p-0.5"
                      style={{ background: '#0d1117' }}
                      value={info.primaryColor}
                      onChange={(e) => updateInfo({ primaryColor: e.target.value })}
                    />
                    <span className="text-sm font-mono text-white/60">{info.primaryColor}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-white/50 mb-1">Description</label>
                <textarea
                  rows={2}
                  className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 resize-none"
                  style={{ background: '#0d1117' }}
                  value={info.description}
                  onChange={(e) => updateInfo({ description: e.target.value })}
                  placeholder="App ka short description..."
                />
              </div>

              {/* Icon picker */}
              <div>
                <label className="block text-xs text-white/50 mb-2">App Icon</label>

                {/* A REAL icon (admin 2026-07-27). The emoji row below is still handy as a quick
                    placeholder, but Play needs a 512x512 image — an emoji drawn with whatever font
                    the build machine has is not an app icon. */}
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl border border-white/10 flex-shrink-0 overflow-hidden"
                    style={{ background: info.primaryColor + '33' }}
                  >
                    {iconDataUrl
                      ? <img src={iconDataUrl} alt="App icon" className="w-full h-full object-cover" />
                      : info.icon}
                  </div>
                  <div className="flex flex-wrap gap-2 flex-1 min-w-0">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void acceptIcon(() => readIconFile(f));
                      }}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={iconBusy}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-white/15 hover:bg-white/5 disabled:opacity-40 transition-colors"
                    >
                      <Upload size={13} /> Upload
                    </button>
                    <button
                      onClick={() => void acceptIcon(() => readIconFromClipboard())}
                      disabled={iconBusy}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-white/15 hover:bg-white/5 disabled:opacity-40 transition-colors"
                    >
                      {iconBusy ? <Loader2 size={13} className="animate-spin" /> : <Clipboard size={13} />} Paste
                    </button>
                    {onMakeIcon && (
                      <button
                        onClick={onMakeIcon}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                      >
                        <Sparkles size={13} /> Make icon
                      </button>
                    )}
                    {iconDataUrl && (
                      <button
                        onClick={() => { setIconDataUrl(''); setIconNote(''); setIconFailed(false); }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-white/15 hover:bg-white/5 text-white/60 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-white/40 leading-relaxed mb-2">
                  Use a square picture, at least 512×512. "Make icon" opens AI Image Gen — copy the
                  image it creates, then come back and press Paste.
                </p>

                {iconNote && (
                  <p className={`text-xs leading-relaxed mb-3 px-3 py-2 rounded-lg ${iconFailed ? 'text-amber-300' : 'text-green-300'}`}
                     style={{ background: iconFailed ? 'rgba(245,158,11,0.1)' : 'rgba(63,185,80,0.1)' }}>
                    {iconNote}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {EMOJI_OPTIONS.map((e) => (
                    <button
                      key={e}
                      onClick={() => updateInfo({ icon: e })}
                      className={`w-9 h-9 rounded-lg text-xl flex items-center justify-center border transition-all
                        ${info.icon === e && !iconDataUrl ? 'border-indigo-500 bg-indigo-500/20' : 'border-white/10 hover:border-white/30'}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              {/* Orientation */}
              <div>
                <label className="block text-xs text-white/50 mb-2">Orientation</label>
                <div className="flex gap-3">
                  {(['portrait', 'landscape', 'auto'] as const).map((o) => (
                    <label key={o} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="orientation"
                        checked={info.orientation === o}
                        onChange={() => updateInfo({ orientation: o })}
                        className="accent-indigo-500"
                      />
                      <span className="text-sm capitalize text-white/70">{o}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Target SDK */}
              <div>
                <label className="block text-xs text-white/50 mb-2">Target SDK</label>
                <div className="flex gap-4">
                  {([['33', 'Android 13 (API 33)'], ['34', 'Android 14 (API 34)']] as const).map(([val, label]) => (
                    <label key={val} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="targetSdk"
                        checked={info.targetSdk === val}
                        onChange={() => updateInfo({ targetSdk: val })}
                        className="accent-indigo-500"
                      />
                      <span className="text-sm text-white/70">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 1: Permissions ── */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold text-white mb-4">Android Permissions</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* INTERNET — required */}
                <label className="flex items-start gap-3 p-3 rounded-lg border border-indigo-500/30 cursor-not-allowed opacity-70" style={{ background: '#0d1117' }}>
                  <input type="checkbox" checked disabled className="mt-0.5 accent-indigo-500" />
                  <div>
                    <div className="text-sm font-mono text-white/80">INTERNET</div>
                    <div className="text-xs text-white/40 mt-0.5">Required — network access</div>
                  </div>
                </label>

                {(Object.keys(perms) as Array<keyof PermissionState>).map((key) => (
                  <label
                    key={key}
                    className="flex items-start gap-3 p-3 rounded-lg border border-white/10 cursor-pointer hover:border-white/20 transition-colors"
                    style={{ background: '#0d1117' }}
                  >
                    <input
                      type="checkbox"
                      checked={perms[key]}
                      onChange={(e) => setPerms((p) => ({ ...p, [key]: e.target.checked }))}
                      className="mt-0.5 accent-indigo-500"
                    />
                    <div>
                      <div className="text-sm font-mono text-white/80">{PERMISSION_META[key].label}</div>
                      <div className="text-xs text-white/40 mt-0.5">{PERMISSION_META[key].desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2: Build Method ── */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4">Build Method</h2>

              {/* TWA Card */}
              <label
                className={`block p-4 rounded-xl border-2 cursor-pointer transition-all
                  ${buildConfig.method === 'twa' ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/10 hover:border-white/20'}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="method"
                    checked={buildConfig.method === 'twa'}
                    onChange={() => setBuildConfig((p) => ({ ...p, method: 'twa' }))}
                    className="mt-1 accent-indigo-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Globe size={16} className="text-indigo-400" />
                      <span className="font-semibold text-white">TWA (Trusted Web Activity)</span>
                      <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">Recommended</span>
                    </div>
                    <p className="text-sm text-white/60 mt-1">
                      Wraps your web app with a native feel inside Chrome
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-white/40">
                      <span>✓ HTTPS URL required</span>
                      <span>✓ No Java code needed</span>
                      <span>✓ Output: ~2MB APK</span>
                      <span>✓ Auto Chrome updates</span>
                    </div>
                  </div>
                </div>
                {buildConfig.method === 'twa' && (
                  <div className="mt-4 ml-7">
                    <label className="block text-xs text-white/50 mb-1">Deployed App URL (HTTPS) *</label>
                    <input
                      className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                      style={{ background: '#0d1117' }}
                      value={buildConfig.twaUrl}
                      onChange={(e) => setBuildConfig((p) => ({ ...p, twaUrl: e.target.value }))}
                      placeholder="https://your-app.example.com"
                    />
                  </div>
                )}
              </label>

              {/* Capacitor Card */}
              <label
                className={`block p-4 rounded-xl border-2 cursor-pointer transition-all
                  ${buildConfig.method === 'capacitor' ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/10 hover:border-white/20'}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="method"
                    checked={buildConfig.method === 'capacitor'}
                    onChange={() => setBuildConfig((p) => ({ ...p, method: 'capacitor' }))}
                    className="mt-1 accent-indigo-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Cpu size={16} className="text-purple-400" />
                      <span className="font-semibold text-white">Capacitor (Full Native)</span>
                    </div>
                    <p className="text-sm text-white/60 mt-1">
                      Full native app — camera, mic, storage APIs available
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-white/40">
                      <span>✓ Node.js + Android Studio</span>
                      <span>✓ Native plugin support</span>
                      <span>✓ Full APK output</span>
                      <span>✓ Local build required</span>
                    </div>
                  </div>
                </div>
                {buildConfig.method === 'capacitor' && (
                  <div className="mt-3 ml-7 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
                    <div className="flex items-start gap-2 text-xs text-yellow-400">
                      <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                      <span>
                        A Capacitor build needs Node.js 16+ and Android Studio installed on your machine
                        . Full instructions are in the README.
                      </span>
                    </div>
                  </div>
                )}
              </label>
            </div>
          )}

          {/* ── Step 3: Generate ── */}
          {step === 3 && (
            <div>
              <h2 className="text-lg font-semibold text-white mb-4">Generate Package</h2>

              {buildState === 'idle' && (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="rounded-lg p-4 border border-white/10 space-y-2" style={{ background: '#0d1117' }}>
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">App Name</span>
                      <span className="text-white">{info.appName}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">Package</span>
                      <span className="font-mono text-white/80 text-xs">{info.packageName}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">Version</span>
                      <span className="text-white">{info.version}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">Build Method</span>
                      <span className="text-indigo-400 uppercase text-xs font-semibold">{buildConfig.method}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">Target SDK</span>
                      <span className="text-white">Android {info.targetSdk === '33' ? '13' : '14'} (API {info.targetSdk})</span>
                    </div>
                  </div>

                  <button
                    onClick={startBuild}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 transition-colors text-white font-semibold text-base"
                  >
                    <Package size={18} />
                    Generate config files
                  </button>
                </div>
              )}

              {buildState === 'building' && (
                <div className="space-y-3 py-4">
                  {BUILD_STEPS.map((label, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all
                          ${i < buildStepIdx
                            ? 'bg-green-600'
                            : i === buildStepIdx
                            ? 'bg-indigo-600 animate-pulse'
                            : 'bg-white/10'}`}
                      >
                        {i < buildStepIdx ? (
                          <Check size={12} className="text-white" />
                        ) : (
                          <span className="text-xs text-white/40">{i + 1}</span>
                        )}
                      </div>
                      <span
                        className={`text-sm ${
                          i < buildStepIdx
                            ? 'text-green-400'
                            : i === buildStepIdx
                            ? 'text-indigo-300'
                            : 'text-white/30'
                        }`}
                      >
                        {label}
                        {i < buildStepIdx && i < BUILD_STEPS.length - 1 ? ' ✅' : ''}
                        {i === BUILD_STEPS.length - 1 && i <= buildStepIdx ? ' 🎉' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {buildState === 'done' && (
                <div className="space-y-4">
                  <div className="text-center py-3">
                    <div className="text-4xl mb-1">📄</div>
                    <p className="text-green-400 font-semibold">Config files ready — download below.</p>
                  </div>

                  {/* Honest note (admin autopsy 2026-07-21): this generates the Android project config
                      files; it does NOT compile or sign an APK/AAB (a browser can't). The real signed
                      .aab comes from CI. */}
                  <div className="rounded-xl p-3 border border-indigo-500/20 bg-indigo-500/5 text-[11px] text-white/60 leading-relaxed">
                    <span className="text-indigo-300 font-semibold">These are config files, not an installable app. </span>
                    A browser cannot compile or sign an <code className="text-white/80">.apk</code>/<code className="text-white/80">.aab</code>,
                    and iOS builds legally require macOS. Get the build kit below — it runs on GitHub&apos;s own
                    Linux and macOS runners and produces the genuine signed app.
                  </div>

                  {/* REAL ship pipeline (admin 2026-07-26). Generates the GitHub Actions workflows that
                      build a signed .aab and an .ipa uploaded to TestFlight, plus the fastlane lane and
                      an honest setup guide naming the secrets only the user can provide. */}
                  <div className="rounded-xl p-3 border border-green-500/25 bg-green-500/5 space-y-2">
                    <p className="text-[11px] text-white/70 leading-relaxed">
                      <span className="text-green-300 font-semibold">Store-ready build kit: </span>
                      GitHub Actions workflows that produce a signed <code className="text-white/80">.aab</code> for
                      Play Store and an <code className="text-white/80">.ipa</code> uploaded straight to
                      <span className="text-white/80"> TestFlight</span> — no Mac needed. Add the files to a GitHub
                      repo, set your signing secrets (listed in the included SHIPPING.md), then run it from the
                      Actions tab.
                    </p>
                    <button
                      onClick={downloadShipKit}
                      disabled={shipBusy}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors text-white font-semibold"
                    >
                      <Rocket size={18} />
                      {shipBusy ? 'Preparing the build kit…' : 'Get store-ready build kit'}
                    </button>
                    {shipDone && (
                      <p className="text-[11px] text-green-400">
                        Downloaded. Each file is named with its real path (<code className="text-white/70">__</code> stands
                        for a folder separator) — recreate those folders in your repo, then open SHIPPING.md.
                        The Android build gives you a <code className="text-white/70">.aab</code> for Play Store
                        and a <code className="text-white/70">.apk</code> you can install straight onto your phone.
                      </p>
                    )}
                    {shipErr && <p className="text-[11px] text-red-400">{shipErr}</p>}

                    <button
                      onClick={openGuide}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-white/80 text-xs font-semibold"
                    >
                      <FileText size={15} />
                      Show me how to publish, step by step
                    </button>
                  </div>

                  {/* Step-by-step walkthrough for a first-time, non-technical publisher. */}
                  {guideOpen && (
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3">
                      <div className="flex gap-2">
                        {(['android', 'ios'] as const).map((p) => (
                          <button
                            key={p}
                            onClick={() => setGuidePlatform(p)}
                            className={`flex-1 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors ${
                              guidePlatform === p ? 'bg-indigo-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'
                            }`}
                          >
                            {p === 'android' ? 'Play Store' : 'App Store'}
                          </button>
                        ))}
                      </div>

                      {guideErr && <p className="text-[11px] text-red-400">{guideErr}</p>}
                      {!guide && !guideErr && <p className="text-[11px] text-white/50">Loading the guide…</p>}

                      {guide?.filter((g) => g.platform === guidePlatform).map((g) => (
                        <div key={g.platform} className="space-y-3">
                          <p className="text-[11px] text-amber-300/90 leading-relaxed bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                            <span className="font-bold">Before you start: </span>{g.upfront}
                          </p>
                          {g.steps.map((s, i) => (
                            <div key={s.id} className="flex gap-2.5">
                              <button
                                onClick={() => toggleStep(s.id)}
                                aria-label={doneSteps[s.id] ? `Mark step ${i + 1} as not done` : `Mark step ${i + 1} as done`}
                                className={`mt-0.5 shrink-0 w-5 h-5 rounded-md border text-[10px] font-bold transition-colors ${
                                  doneSteps[s.id] ? 'bg-green-600 border-green-500 text-white' : 'border-white/25 text-transparent hover:border-white/50'
                                }`}
                              >
                                ✓
                              </button>
                              <div className={`flex-1 min-w-0 ${doneSteps[s.id] ? 'opacity-50' : ''}`}>
                                <p className="text-[12px] font-semibold text-white/90">{i + 1}. {s.title}</p>
                                <p className="text-[11px] text-white/60 leading-relaxed mt-0.5">{s.detail}</p>
                                {s.youShouldSee && (
                                  <p className="text-[11px] text-green-400/80 mt-1">You should see: {s.youShouldSee}</p>
                                )}
                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                  {s.cost && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">{s.cost}</span>}
                                  {s.takes && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">{s.takes}</span>}
                                  {s.navbharatDoesThis && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-300">NavBharatAI does this</span>}
                                  {s.youMustDoThis && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">Only you can do this</span>}
                                </div>
                                {s.link && (
                                  <a href={s.link} target="_blank" rel="noopener noreferrer" className="text-[11px] text-indigo-400 hover:text-indigo-300 underline mt-1 inline-block">
                                    Open the page →
                                  </a>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}

                  {generatedFiles.map((f) => (
                    <FileCard key={f.name} file={f} />
                  ))}

                  <button
                    onClick={downloadAll}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-green-700 hover:bg-green-600 transition-colors text-white font-semibold"
                  >
                    <Download size={18} />
                    Download config files (.txt)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 flex items-center gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
              <AlertCircle size={14} className="flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Navigation */}
          {!(step === 3 && buildState !== 'idle') && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/10">
              <button
                onClick={back}
                disabled={step === 0}
                className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors hover:bg-white/5"
              >
                <ChevronLeft size={16} />
                Back
              </button>

              {step < 3 && (
                <button
                  onClick={next}
                  className="flex items-center gap-1 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* THE BUTTON THIS SCREEN IS FOR — a real Android app, built on real machines, downloaded
            here. Kept at the very bottom so it reads as the last step after decorating the app. */}
        <div className="mt-6 mb-2">
          <StoreBuildPanel
            sessionId={targetSession}
            appName={info.appName}
            appId={info.packageName}
            iconDataUrl={iconDataUrl || undefined}
            githubToken={githubToken}
            onConnectGitHub={onConnectGitHub}
            onOpenGuide={() => void openGuide()}
          />
        </div>
      </div>
    </div>
  );
};

export default APKBuilder;
