import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Github, Download, CheckCircle2, AlertTriangle, ExternalLink,
  Rocket, Key, RefreshCw,
} from 'lucide-react';
import { authedHeaders } from '../../App';

// "Build my app and give me the file" — the real pipeline, end to end, inside NavBharatAI.
//
// WHY IT WORKS THIS WAY (admin 2026-07-27): the admin pointed out that this is exactly how Claude
// Code ships NavBharatAI's own apps, and that is right. Nobody builds Android or iOS binaries on
// their own web server:
//
//   NavBharatAI does : assemble the project, write the workflows, create and push the repo, start the
//                      build, watch it, and hand back the finished file. All of that is automatic.
//   GitHub does      : the compiling and signing, on its own runners. Linux for Android; macOS for
//                      iOS, because Apple allows no other kind of machine.
//   The user does    : adds their own signing key as a GitHub secret, once.
//
// That last step is not a gap we failed to close — it is the point. A signing key IS the app's
// permanent identity on the Play Store. If NavBharatAI generated one and held it, every user's app
// would depend on us never losing it; if we generated one and threw it away, they could never publish
// an update again. So it stays theirs, we never see it, and this panel walks them through it.

type Phase = 'idle' | 'preparing' | 'ready' | 'building' | 'built' | 'failed';

interface SetupResult {
  owner: string;
  repo: string;
  branch: string;
  repoUrl: string;
  createdRepo: boolean;
  fileCount: number;
  kind: 'built' | 'static';
  webDir: string;
  notes: string[];
  requiredSecrets: { android: string[]; ios: string[] };
}

interface RunInfo {
  id: number;
  status: string;
  conclusion: string | null;
  url: string;
}

interface Artifact { id: number; name: string; sizeBytes: number }

export interface StoreBuildPanelProps {
  /** Which of the user's apps to package. */
  sessionId: string;
  appName: string;
  appId: string;
  /** Data URL of the chosen icon, if any. */
  iconDataUrl?: string;
  /** The connected GitHub token; without one the panel explains what to do instead of failing. */
  githubToken?: string;
  onConnectGitHub?: () => void;
  /** Open the step-by-step publishing guide. */
  onOpenGuide?: () => void;
}

// TWO Android paths (admin 2026-08-02). The APK one needs NO secrets — Gradle signs a debug build
// with Android's universal key — so a non-technical user can hold their app today with one click. The
// AAB one is for Google Play and genuinely needs the user's own signing key.
const ANDROID_APK_WORKFLOW = 'android-apk.yml';
const ANDROID_AAB_WORKFLOW = 'android-aab.yml';
type BuildKind = 'apk' | 'aab';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const StoreBuildPanel: React.FC<StoreBuildPanelProps> = ({
  sessionId, appName, appId, iconDataUrl, githubToken, onConnectGitHub, onOpenGuide,
}) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [setup, setSetup] = useState<SetupResult | null>(null);
  // Which of the two Android builds is running — the UI must never claim a missing-signing-key problem
  // on the APK path, which needs no keys at all.
  const [buildKind, setBuildKind] = useState<BuildKind>('apk');
  const [run, setRun] = useState<RunInfo | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [error, setError] = useState('');
  const [busyNote, setBusyNote] = useState('');
  const [downloading, setDownloading] = useState('');

  const liveRef = useRef(true);
  useEffect(() => () => { liveRef.current = false; }, []);

  const ghHeaders = useCallback(async (extra?: Record<string, string>) => {
    const h = await authedHeaders(extra);
    if (githubToken) h['X-GitHub-Token'] = githubToken;
    return h;
  }, [githubToken]);

  /** Step 1 — assemble the app into a repository GitHub can build. */
  const prepare = useCallback(async () => {
    if (!sessionId) { setError('Choose which app to package first.'); return; }
    setPhase('preparing');
    setError('');
    setBusyNote('Packaging your app and sending it to your GitHub…');
    try {
      const res = await fetch('/api/mobile-ship/setup', {
        method: 'POST',
        headers: await ghHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sessionId, appName, appId, iconDataUrl, ios: true }),
      });
      const data = await res.json().catch(() => null);
      if (!liveRef.current) return;
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'Could not prepare your app for building.');
        setPhase('idle');
        return;
      }
      setSetup(data as SetupResult);
      setPhase('ready');
    } catch {
      if (liveRef.current) { setError('Could not reach the server.'); setPhase('idle'); }
    } finally {
      if (liveRef.current) setBusyNote('');
    }
  }, [sessionId, appName, appId, iconDataUrl, ghHeaders]);

  /** Poll the run until GitHub finishes, then read what it produced. */
  const watchRun = useCallback(async (owner: string, repo: string, workflow: string, kind: BuildKind) => {
    for (let i = 0; i < 120 && liveRef.current; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      if (!liveRef.current) return;
      try {
        const res = await fetch(
          `/api/mobile-ship/runs?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&workflow=${workflow}`,
          { headers: await ghHeaders() },
        );
        const data = await res.json().catch(() => null);
        const latest = data?.runs?.[0] as RunInfo | undefined;
        if (!latest) continue;
        setRun(latest);
        if (latest.status !== 'completed') continue;

        if (latest.conclusion !== 'success') {
          setPhase('failed');
          setError(
            latest.conclusion !== 'failure'
              ? `The build ended as "${latest.conclusion}".`
              : kind === 'aab'
                // Only the Play-Store build can fail for missing secrets; saying that on the APK build
                // (which needs none) would send the user hunting for a problem that does not exist.
                ? 'The Play Store build failed on GitHub. The usual reason is that the signing secrets are not set yet — open the guide below.'
                : 'The build failed on GitHub. Open the run there to see the exact step that failed.',
          );
          return;
        }
        const aRes = await fetch(
          `/api/mobile-ship/artifacts?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&runId=${latest.id}`,
          { headers: await ghHeaders() },
        );
        const aData = await aRes.json().catch(() => null);
        setArtifacts(Array.isArray(aData?.artifacts) ? aData.artifacts : []);
        setPhase('built');
        return;
      } catch {
        // A single failed poll is not a failed build; keep watching.
      }
    }
    if (liveRef.current) {
      setPhase('failed');
      setError('The build is taking longer than expected. Open it on GitHub to see where it is.');
    }
  }, [ghHeaders]);

  /** Step 2 — start the real build on GitHub's runners. */
  const build = useCallback(async (kind: BuildKind = 'apk') => {
    if (!setup) return;
    setBuildKind(kind);
    setPhase('building');
    setError('');
    setArtifacts([]);
    setRun(null);
    try {
      const res = await fetch('/api/mobile-ship/trigger', {
        method: 'POST',
        headers: await ghHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          owner: setup.owner, repo: setup.repo, ref: setup.branch,
          workflow: kind === 'apk' ? ANDROID_APK_WORKFLOW : ANDROID_AAB_WORKFLOW,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!liveRef.current) return;
      if (!res.ok) {
        setError(data?.error || 'Could not start the build on GitHub.');
        setPhase('ready');
        return;
      }
      void watchRun(setup.owner, setup.repo, kind === 'apk' ? ANDROID_APK_WORKFLOW : ANDROID_AAB_WORKFLOW, kind);
    } catch {
      if (liveRef.current) { setError('Could not reach the server.'); setPhase('ready'); }
    }
  }, [setup, ghHeaders, watchRun]);

  /** Step 3 — the actual file, streamed through the server so the browser just gets a download. */
  const download = useCallback(async (artifact: Artifact) => {
    if (!setup) return;
    setDownloading(String(artifact.id));
    setError('');
    try {
      const res = await fetch(
        `/api/mobile-ship/download?owner=${encodeURIComponent(setup.owner)}&repo=${encodeURIComponent(setup.repo)}&artifactId=${artifact.id}`,
        { headers: await ghHeaders() },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || 'Could not download that file.');
        return;
      }
      const blob = await res.blob();
      const name = /apk/i.test(artifact.name)
        ? (buildKind === 'apk' ? 'app-debug.apk' : 'app-release.apk')
        : 'app-release.aab';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not download that file.');
    } finally {
      if (liveRef.current) setDownloading('');
    }
  }, [setup, ghHeaders]);

  // ── Not connected: say what is needed and why, rather than showing a dead button ──
  if (!githubToken) {
    return (
      <div className="rounded-xl border border-white/10 p-4 sm:p-5" style={{ background: '#161b22' }}>
        <h3 className="flex items-center gap-2 text-base font-bold text-white mb-2">
          <Rocket size={17} className="text-indigo-400" /> Build a real Android app
        </h3>
        <p className="text-sm text-white/60 leading-relaxed mb-3">
          NavBharatAI packages your app and starts the build for you — the build itself runs on GitHub's
          machines, and the signing key stays yours so nobody else can publish updates to your app.
          Connect GitHub once and the rest is automatic.
        </p>
        <button
          onClick={onConnectGitHub}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-white text-black hover:bg-white/90 transition-colors"
        >
          <Github size={16} /> Connect GitHub
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: '#161b22' }}>
      <div className="p-4 sm:p-5">
        <h3 className="flex items-center gap-2 text-base font-bold text-white mb-1">
          <Rocket size={17} className="text-indigo-400" /> Build a real Android app
        </h3>
        <p className="text-xs text-white/50 leading-relaxed">
          Your app is packaged and sent to your own GitHub, built there on a real machine, and the
          finished file comes back here.
        </p>
      </div>

      {error && (
        <div className="mx-4 sm:mx-5 mb-4 flex gap-2 px-3 py-2.5 rounded-lg text-xs leading-relaxed text-amber-300"
             style={{ background: 'rgba(245,158,11,0.1)' }}>
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <div className="px-4 sm:px-5 pb-5 space-y-3">
        {/* Step 1 */}
        {(phase === 'idle' || phase === 'preparing') && (
          <>
            <button
              onClick={() => void prepare()}
              disabled={phase === 'preparing' || !sessionId}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-base font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white"
            >
              {phase === 'preparing' ? <Loader2 size={17} className="animate-spin" /> : <Github size={17} />}
              {phase === 'preparing' ? 'Preparing…' : 'Get my app ready to build'}
            </button>
            {/* NAMING FIX (admin 2026-08-02): this button used to say "Prepare my app for the Play
                Store", so a user who only wanted an installable APK read it as "not for me" and never
                pressed it — the APK button lives on the NEXT screen, so they never reached it. The step
                is shared by BOTH paths, so it is named neutrally and says what comes next. */}
            <p className="text-[11px] text-white/45 text-center leading-relaxed">
              First step for both: your app goes to your own GitHub. Next you can build an
              installable <span className="text-white/70 font-medium">.apk</span> in one click — no
              signing key needed — or the Play Store bundle.
            </p>
            {busyNote && <p className="text-xs text-white/50 text-center">{busyNote}</p>}
          </>
        )}

        {/* Step 2 — prepared, waiting for the signing key */}
        {setup && phase !== 'idle' && phase !== 'preparing' && (
          <div className="rounded-lg border border-white/10 p-3 text-xs" style={{ background: '#0d1117' }}>
            <p className="flex items-center gap-1.5 text-green-400 font-semibold mb-1.5">
              <CheckCircle2 size={13} />
              {setup.createdRepo ? 'Created' : 'Updated'} {setup.owner}/{setup.repo}
            </p>
            <p className="text-white/50 leading-relaxed">
              {setup.fileCount} files sent{setup.kind === 'static' ? ' (your pages are packaged as they are)' : ' (your app builds itself first)'}.
            </p>
            {setup.notes.map((n, i) => (
              <p key={i} className="text-white/40 leading-relaxed mt-1.5">• {n}</p>
            ))}
            <a
              href={setup.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-indigo-400 hover:text-indigo-300"
            >
              <ExternalLink size={11} /> Open it on GitHub
            </a>
          </div>
        )}

        {setup && (phase === 'ready' || phase === 'failed') && (
          <>
            {/* PRIMARY — the one-click path. No keys, no secrets, nothing for the user to set up. */}
            <button
              onClick={() => void build('apk')}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-base font-bold bg-green-600 hover:bg-green-500 transition-colors text-white"
            >
              <Rocket size={17} /> {phase === 'failed' ? 'Try again' : 'Build my APK now'}
            </button>
            <p className="text-[11px] text-white/45 leading-relaxed -mt-1">
              Installs straight onto any Android phone. Nothing to set up — no signing key needed.
              (This file cannot go on Google Play; for that, use the option below.)
            </p>

            {/* SECONDARY — Google Play. This is the only path that genuinely needs the user's own key. */}
            <div className="rounded-lg border border-amber-500/25 p-3 text-xs leading-relaxed"
                 style={{ background: 'rgba(245,158,11,0.07)' }}>
              <p className="flex items-center gap-1.5 text-amber-300 font-semibold mb-1.5">
                <Key size={13} /> Publishing on Google Play? One thing only you can do
              </p>
              <p className="text-white/60">
                Play needs a signed bundle, so add your signing key to the repository as
                {' '}{setup.requiredSecrets.android.length} secrets:
                {' '}<span className="text-white/80">{setup.requiredSecrets.android.join(', ')}</span>.
                This key is your app's permanent identity on the Play Store — it must stay with you, and
                NavBharatAI never sees it. The guide walks through creating it, step by step.
              </p>
              {onOpenGuide && (
                <button onClick={onOpenGuide} className="mt-2 text-indigo-400 hover:text-indigo-300 font-medium">
                  Show me how, step by step →
                </button>
              )}
              <button
                onClick={() => void build('aab')}
                className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold border border-amber-500/40 text-amber-200 hover:bg-amber-500/10 transition-colors"
              >
                <Rocket size={14} /> Build the Play Store bundle
              </button>
            </div>

            {/* Second route to the same file — straight to their own repo on GitHub. */}
            <a
              href={`https://github.com/${setup.owner}/${setup.repo}/actions`}
              target="_blank"
              rel="noreferrer"
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-white/10 hover:bg-white/5 transition-colors text-white/60"
            >
              <ExternalLink size={12} /> Open this app's builds on GitHub
            </a>
          </>
        )}

        {/* Step 3 — building */}
        {phase === 'building' && (
          <div className="rounded-lg border border-white/10 p-4 text-center" style={{ background: '#0d1117' }}>
            <Loader2 size={22} className="animate-spin text-indigo-400 mx-auto mb-2" />
            <p className="text-sm text-white/80 font-medium">Building your app on GitHub…</p>
            <p className="text-xs text-white/40 mt-1 leading-relaxed">
              This usually takes 3–6 minutes. You can leave this screen open.
            </p>
            {run && (
              <a href={run.url} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1 mt-2 text-xs text-indigo-400 hover:text-indigo-300">
                <ExternalLink size={11} /> Watch it on GitHub
              </a>
            )}
          </div>
        )}

        {/* Step 4 — the actual file */}
        {phase === 'built' && (
          artifacts.length > 0 ? (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm text-green-400 font-semibold">
                <CheckCircle2 size={15} /> Your app is ready
              </p>
              {artifacts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => void download(a)}
                  disabled={downloading === String(a.id)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-base font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 transition-colors text-white"
                >
                  {downloading === String(a.id) ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
                  Download {/apk/i.test(a.name) ? '.apk (install on a phone)' : '.aab (upload to Play Store)'}
                  <span className="text-xs font-normal opacity-70">{fmtSize(a.sizeBytes)}</span>
                </button>
              ))}
              <p className="text-[11px] text-white/40 leading-relaxed">
                {buildKind === 'apk'
                  ? 'Copy this .apk to an Android phone and open it — allow "install from unknown sources" when asked. It is for installing and sharing; Google Play needs the signed bundle instead.'
                  : 'The .aab is what Google Play wants. The .apk beside it is the one you can send to someone to install directly.'}
                {' '}GitHub keeps the file for 14 days — after that, just build again.
              </p>
            </div>
          ) : (
            // A green build with no artifact is a real state, and pretending otherwise would be a lie.
            <div className="rounded-lg border border-amber-500/25 p-3 text-xs text-amber-300 leading-relaxed"
                 style={{ background: 'rgba(245,158,11,0.07)' }}>
              The build finished but produced no downloadable file. Open it on GitHub to see what it did.
            </div>
          )
        )}

        {(phase === 'built' || phase === 'failed') && setup && (
          <button
            onClick={() => { setPhase('ready'); setError(''); setArtifacts([]); }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-white/10 hover:bg-white/5 transition-colors text-white/60"
          >
            <RefreshCw size={12} /> Start over
          </button>
        )}
      </div>
    </div>
  );
};
