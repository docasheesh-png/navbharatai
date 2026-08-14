import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Smartphone,
  Upload,
  Clipboard,
  Sparkles,
  Loader2,
  ArrowDown,
} from 'lucide-react';
import { AppTargetPicker, useUserApps, useAppFiles } from './AppTargetPicker';
import { StoreBuildPanel } from './StoreBuildPanel';
import { readIconFile, readIconFromClipboard } from '../../lib/appIcon';
// The SAME pure helpers the server uses to derive and normalise the package name (rule 4 — no drift, so
// what the user sees here is exactly what the build will use). appId.ts / mobileProjectAssembler are pure
// (no server-only deps), and client code already imports such pure server modules elsewhere.
import { isValidAppId } from '../../server/lib/appId';
import { normaliseAppId } from '../../server/lib/mobileProjectAssembler';

// ─── APK BUILDER — ONE HONEST FLOW (redesigned admin 2026-08-11) ────────────────
//
// WHY THIS WAS REWRITTEN (admin: "app information wala option, github app builder se connect nahi hai …
// generate config file ki .txt ka kya use? … app information ko niche 'build a real android app' se sync
// kardo").
//
// The old screen had TWO parallel flows. A 4-step wizard (App Info → Permissions → Build Method →
// Generate) ended by producing a plain-text ".txt" of Android config files — files that were NEVER used
// by the real build and that a non-technical user could do nothing with. Below it, disconnected in the
// user's eyes, sat the REAL builder (StoreBuildPanel) that actually compiles a signed .apk/.aab on
// GitHub's runners. So the wizard's settings (permissions, orientation, build method) shaped nothing, the
// ".txt" was dead output, and the one part that worked looked unrelated to the form above it.
//
// This is now a SINGLE flow: one "App Information" form (name, package, icon, background colour) that
// FEEDS the real builder directly below it. Every field genuinely reaches the built app — name, package
// and icon always did; the background colour is now wired through capacitor.config too. The dead ".txt"
// path and the settings that reached nothing are gone (second absolute rule: real features only).

// ─── Types ────────────────────────────────────────────────────────────────────

export interface APKBuilderProps {
  generatedCode?: string;
  appName?: string;
  /** The app the user is currently working on, pre-selected in the picker. */
  sessionId?: string;
  /** The connected GitHub token — the build runs on the user's own account. */
  githubToken?: string;
  /** The connected GitHub account (so the user can SEE which account will own the build). */
  githubUser?: { login?: string; username?: string; name?: string } | null;
  onConnectGitHub?: () => void;
  /** Disconnect the current GitHub account (used by the "Switch" account control). */
  onDisconnectGitHub?: () => void;
  /** Send the user to AI Image Gen to create an icon. */
  onMakeIcon?: () => void;
}

interface AppInfo {
  appName: string;
  packageName: string;
  icon: string;
  primaryColor: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EMOJI_OPTIONS = ['🚀', '⚡', '🎯', '💡', '🌟', '🔥', '🎨', '🛒', '📱', '🎵', '📰', '🏠'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Derive the package name through the SERVER's own helper, so a name like "New" or "Class" can never
// produce a Java reserved-word segment the Android build would reject (G8) — the client and the build
// agree by construction. normaliseAppId('', name) takes the derive path.
function toPackageName(name: string): string {
  return normaliseAppId('', name);
}

/**
 * What the build will ACTUALLY use for this package name, and why — computed with the exact server
 * normaliser so the preview never lies. Returns the effective id plus an optional reason when it differs
 * from what the user typed, so they can fix it up front instead of being surprised after a build.
 */
function packageAdvisory(typed: string, appName: string): { effective: string; ok: boolean; reason?: string } {
  const candidate = (typed || '').trim();
  const effective = normaliseAppId(candidate, appName);
  if (isValidAppId(candidate.toLowerCase()) && effective === candidate) return { effective, ok: true };
  if (!candidate) return { effective, ok: false, reason: 'A package name is required — this one is generated from your app name.' };
  // Shape is fine but a segment is a reserved word → the normaliser only tweaked that segment.
  const shaped = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(candidate);
  if (shaped) return { effective, ok: false, reason: 'Android does not allow a reserved word as a package part, so it will be adjusted slightly.' };
  return { effective, ok: false, reason: 'A package name must look like com.company.app (letters, all lowercase, at least two parts).' };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const APKBuilder: React.FC<APKBuilderProps> = ({ appName, sessionId, githubToken, githubUser, onConnectGitHub, onDisconnectGitHub, onMakeIcon }) => {
  // The tier the user selected in the v5.0 panel (persisted there). It routes the AI build-repair to the
  // same models the main build uses; absent ⇒ the server falls back to the weak-safe (cheap, no-Claude)
  // path by construction, so this can never accidentally spend a flagship model.
  const selectedPowerLevel = (() => {
    try { return localStorage.getItem('nbai_power_level') || undefined; } catch { return undefined; }
  })();

  const [info, setInfo] = useState<AppInfo>({
    appName: appName || 'My App',
    packageName: toPackageName(appName || 'myapp'),
    icon: '🚀',
    primaryColor: '#6366f1',
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

  const updateInfo = useCallback((patch: Partial<AppInfo>) => {
    setInfo((prev) => {
      const next = { ...prev, ...patch };
      if (patch.appName !== undefined) {
        next.packageName = toPackageName(patch.appName);
      }
      return next;
    });
  }, []);

  // Keep the app name in step with the app the user picked, unless they have typed their own.
  const nameTouched = useRef(false);
  useEffect(() => {
    if (nameTouched.current || !targetSession) return;
    const picked = apps.find((a) => a.sessionId === targetSession);
    if (picked?.label && picked.label !== info.appName) {
      setInfo((prev) => ({ ...prev, appName: picked.label, packageName: toPackageName(picked.label) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSession, apps]);

  // What the build will REALLY use for the package name, computed live with the server's own normaliser
  // (rule 4). Drives the inline preview AND is what we hand the build, so the two can never disagree.
  const pkgAdvisory = packageAdvisory(info.packageName, info.appName);

  // Step-by-step publishing walkthrough, fetched from the ONE structured source that also feeds the AIs
  // and the generated SHIPPING.md — so the three can never drift. Opened from the build panel's
  // "Show me how to publish" button.
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto overscroll-contain p-4 sm:p-6 font-sans" style={{ background: '#0d1117', color: '#e6edf3', WebkitOverflowScrolling: 'touch' }}>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Smartphone size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Android App Builder</h1>
            <p className="text-sm text-white/50">Set your app’s name and icon, then build a real installable app below.</p>
          </div>
        </div>

        {/* WHICH app is being packaged. Without this the builder had no idea — it used whatever
            preview was open, under a hardcoded name. */}
        <div className="rounded-xl border border-white/10 mb-4" style={{ background: '#161b22' }}>
          <AppTargetPicker
            apps={apps}
            appsLoading={appsLoading}
            files={appFiles}
            filesLoading={filesLoading}
            sessionId={targetSession}
            onSessionChange={setTargetSession}
          />
        </div>

        {/* ── App Information — the ONE form. Everything here reaches the real build below. ── */}
        <div className="rounded-xl border border-white/10 p-5 sm:p-6" style={{ background: '#161b22' }}>
          <h2 className="text-lg font-semibold text-white mb-1">App Information</h2>
          <p className="text-xs text-white/45 mb-5">Your app’s name, package, icon and colour — used by the build below.</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-white/50 mb-1">App Name *</label>
              <input
                className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                style={{ background: '#0d1117' }}
                value={info.appName}
                onChange={(e) => { nameTouched.current = true; updateInfo({ appName: e.target.value }); }}
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
              {/* Live preview of the id the build will REALLY use — catch a bad package name here, not after
                  a five-minute build. Only shown when it differs from what the user typed. */}
              {!pkgAdvisory.ok && (
                <p className="mt-1 text-[11px] leading-snug text-amber-300/90">
                  Will be saved as <span className="font-mono text-amber-200">{pkgAdvisory.effective}</span>
                  {pkgAdvisory.reason ? ` — ${pkgAdvisory.reason}` : ''}
                </p>
              )}
              {pkgAdvisory.ok && (
                <p className="mt-1 text-[11px] text-emerald-400/80">✓ Valid package name.</p>
              )}
            </div>
          </div>

          {/* Background colour */}
          <div className="mt-4">
            <label className="block text-xs text-white/50 mb-1">Background Colour</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="w-10 h-10 rounded-lg border border-white/10 cursor-pointer p-0.5"
                style={{ background: '#0d1117' }}
                value={info.primaryColor}
                onChange={(e) => updateInfo({ primaryColor: e.target.value })}
              />
              <span className="text-sm font-mono text-white/60">{info.primaryColor}</span>
              <span className="text-[11px] text-white/35">Used as your app’s background and splash colour.</span>
            </div>
          </div>

          {/* Icon picker */}
          <div className="mt-5">
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
        </div>

        {/* Visual bridge: the form above FEEDS the real build below — one flow, not two. */}
        <div className="flex items-center justify-center gap-2 my-3 text-white/40 text-xs">
          <ArrowDown size={14} className="text-indigo-400" />
          <span>Your app info flows into the build below</span>
          <ArrowDown size={14} className="text-indigo-400" />
        </div>

        {/* THE BUILD — a real Android app, built on real machines, downloaded here. It uses the App
            Information above (name, package, icon, background colour). */}
        <div className="mb-2">
          <StoreBuildPanel
            sessionId={targetSession}
            appName={info.appName}
            // Hand the build the NORMALISED id — exactly the value previewed above — so what the user was
            // shown is what ships, with no build-time surprise.
            appId={pkgAdvisory.effective}
            iconDataUrl={iconDataUrl || undefined}
            backgroundColor={info.primaryColor}
            githubToken={githubToken}
            githubUser={githubUser}
            onConnectGitHub={onConnectGitHub}
            onDisconnectGitHub={onDisconnectGitHub}
            onOpenGuide={() => void openGuide()}
            powerLevel={selectedPowerLevel}
          />
        </div>

        {/* Step-by-step publishing walkthrough for a first-time, non-technical publisher. Opened from
            the build panel's "Show me how to publish" button. */}
        {guideOpen && (
          <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3 mb-4">
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
      </div>
    </div>
  );
};

export default APKBuilder;
