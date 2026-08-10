import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PublishToNavStore } from './PublishToNavStore';
import {
  Loader2, Github, Download, CheckCircle2, AlertTriangle, ExternalLink,
  Rocket, Key, RefreshCw,
} from 'lucide-react';
import { authedHeaders } from '../../App';
// The workflow filenames come from the ONE shared registry the server's dispatch allow-list also reads.
// Hand-written copies here and on the server are exactly why "Build my APK now" did nothing: this file
// asked for android-apk.yml while the server's own list had never heard of it.
import { SHIP_WORKFLOWS, needsUserSecrets, type ShipWorkflowFile } from '../../lib/shipWorkflows';

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
  // Each secret is an OBJECT, not a string. This was declared as `string[]`, so the panel rendered
  // "add your signing key as 4 secrets: [object Object], [object Object], …" to real users — the type
  // said string, TypeScript believed it, and join() did exactly what it was told. Mirrors
  // RequiredSecret in server/lib/mobileShipKit.ts.
  requiredSecrets: { android: RequiredSecret[]; ios: RequiredSecret[] };
}

/** A repository secret only the user can set — their signing identity. */
interface RequiredSecret {
  name: string;
  /** What it is, in plain language. */
  what: string;
  /** Exactly where to get it. */
  where: string;
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
  /**
   * The user's selected NavBharatAI Pro tier (weak/off/mini/medium/max). It routes the AI build-repair
   * to the SAME models the main build uses — weak stays on the cheap coders, paid tiers get Sonnet/Opus.
   */
  powerLevel?: string;
}

// TWO Android paths (admin 2026-08-02). The APK one needs NO secrets — Gradle signs a debug build
// with Android's universal key — so a non-technical user can hold their app today with one click. The
// AAB one is for Google Play and genuinely needs the user's own signing key.
type BuildKind = 'apk' | 'aab';
const workflowFor = (kind: BuildKind): ShipWorkflowFile =>
  kind === 'apk' ? SHIP_WORKFLOWS.androidApk : SHIP_WORKFLOWS.androidAab;

// HOW FAR ALONG ARE WE (admin 2026-08-03: "user ko bas loading % show ho").
//
// The percentage must never go backwards and must never lie. A build that fails and is repaired is
// FURTHER along than one still on its first try, so each attempt owns its own band of the bar and the
// bar only ever moves forward. Within an attempt it tracks elapsed time against how long these builds
// really take, and it stops just short of the band's end — arriving at 100% is earned by a finished
// build with a downloadable file in hand, never by a timer running out.
const ATTEMPT_BANDS: ReadonlyArray<readonly [number, number]> = [[3, 85], [85, 94], [94, 98]];
const TYPICAL_BUILD_MS = 5 * 60 * 1000;
/** Attempts NavBharatAI makes on its own before it stops and explains. */
const MAX_AUTO_ATTEMPTS = ATTEMPT_BANDS.length;

export function buildProgressPercent(attempt: number, elapsedMs: number): number {
  const [start, end] = ATTEMPT_BANDS[Math.min(attempt, ATTEMPT_BANDS.length - 1)];
  const share = Math.min(Math.max(elapsedMs, 0) / TYPICAL_BUILD_MS, 1) * 0.97;
  return Math.round(start + (end - start) * share);
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const StoreBuildPanel: React.FC<StoreBuildPanelProps> = ({
  sessionId, appName, appId, iconDataUrl, githubToken, onConnectGitHub, onOpenGuide, powerLevel,
}) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [setup, setSetup] = useState<SetupResult | null>(null);
  // Which of the two Android builds is running — the UI must never claim a missing-signing-key problem
  // on the APK path, which needs no keys at all.
  const [buildKind, setBuildKind] = useState<BuildKind>('apk');
  const [run, setRun] = useState<RunInfo | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [error, setError] = useState('');
  // What the user actually watches while everything else happens by itself.
  const [progress, setProgress] = useState(0);
  const [progressNote, setProgressNote] = useState('');
  const [attempt, setAttempt] = useState(0);
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
    // The prepare step now includes the compile pre-flight: the server verifies the app compiles and
    // heals it if not, BEFORE anything reaches GitHub — so this can take up to a minute or two when a
    // repair runs, and the note must not pretend it is only an upload.
    setBusyNote('Checking your app compiles, fixing anything broken, and sending it to your GitHub…');
    try {
      const res = await fetch('/api/mobile-ship/setup', {
        method: 'POST',
        headers: await ghHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sessionId, appName, appId, iconDataUrl, ios: true, powerLevel }),
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

  /**
   * Start the workflow on GitHub. Returns false when GitHub refused, so the caller can stop the whole
   * cycle instead of watching for a run that was never created — the exact failure this feature shipped
   * with, where a rejected dispatch still left the panel spinning.
   */
  const dispatch = useCallback(async (workflow: ShipWorkflowFile): Promise<boolean> => {
    if (!setup) return false;
    const res = await fetch('/api/mobile-ship/trigger', {
      method: 'POST',
      headers: await ghHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ owner: setup.owner, repo: setup.repo, ref: setup.branch, workflow }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      if (liveRef.current) setError(data?.error || 'Could not start the build.');
      return false;
    }
    return true;
  }, [setup, ghHeaders]);

  /**
   * THE WHOLE CYCLE, hands-off: start the build, watch it, and when it fails for a reason NavBharatAI
   * put there itself, fix it and start it again — all the user sees is the percentage climbing.
   *
   * It stops on its own in three honest cases: the fix worked and the app is ready; the cause is
   * something only the user can supply (their signing key); or NavBharatAI genuinely cannot name the
   * problem. It never loops forever, because a repair that changes nothing is reported as unfixable by
   * the server rather than committed and retried.
   */
  const runCycle = useCallback(async (kind: BuildKind) => {
    if (!setup) return;
    const workflow = workflowFor(kind);
    const { owner, repo } = setup;
    // Runs that already existed before this press — so we watch OUR run, never an older one whose
    // result would be reported as if it were this build.
    let seen = new Set<number>();
    try {
      const res = await fetch(
        `/api/mobile-ship/runs?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&workflow=${workflow}`,
        { headers: await ghHeaders() },
      );
      const data = await res.json().catch(() => null);
      seen = new Set<number>((data?.runs || []).map((r: RunInfo) => r.id));
    } catch { /* no history readable — every run we see next is new by definition */ }

    for (let attempt = 0; attempt < MAX_AUTO_ATTEMPTS && liveRef.current; attempt++) {
      setAttempt(attempt);
      setProgressNote(attempt === 0 ? 'Sending your app to be built…' : 'Starting the build again…');
      setProgress(ATTEMPT_BANDS[attempt][0]);

      if (!(await dispatch(workflow))) { if (liveRef.current) setPhase('ready'); return; }
      if (!liveRef.current) return;
      setProgressNote('Building your app…');

      const startedAt = Date.now();
      let finished: RunInfo | null = null;
      for (let i = 0; i < 150 && liveRef.current && !finished; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        if (!liveRef.current) return;
        setProgress(buildProgressPercent(attempt, Date.now() - startedAt));
        try {
          const res = await fetch(
            `/api/mobile-ship/runs?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&workflow=${workflow}`,
            { headers: await ghHeaders() },
          );
          const data = await res.json().catch(() => null);
          const ours = ((data?.runs || []) as RunInfo[]).find((r) => !seen.has(r.id));
          if (!ours) continue;
          setRun(ours);
          if (ours.status === 'completed') finished = ours;
        } catch {
          // A single failed poll is not a failed build; keep watching.
        }
      }
      if (!liveRef.current) return;

      if (!finished) {
        setPhase('failed');
        setError('The build is taking longer than usual. It is still running — open it on GitHub to see where it is.');
        return;
      }
      seen.add(finished.id);

      // ── Finished successfully: fetch what it produced ──
      if (finished.conclusion === 'success') {
        setProgress(96);
        setProgressNote('Collecting your app file…');
        try {
          const aRes = await fetch(
            `/api/mobile-ship/artifacts?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&runId=${finished.id}`,
            { headers: await ghHeaders() },
          );
          const aData = await aRes.json().catch(() => null);
          setArtifacts(Array.isArray(aData?.artifacts) ? aData.artifacts : []);
        } catch { setArtifacts([]); }
        if (!liveRef.current) return;
        setProgress(100);
        setPhase('built');
        return;
      }

      if (finished.conclusion !== 'failure') {
        setPhase('failed');
        setError(`The build ended as "${finished.conclusion}".`);
        return;
      }

      // ── Failed: work out why and fix it, rather than handing the user a log ──
      if (attempt === MAX_AUTO_ATTEMPTS - 1) {
        setPhase('failed');
        setError('NavBharatAI fixed what it could and tried again, but the build still did not finish.');
        return;
      }
      setProgressNote('Something went wrong — NavBharatAI is looking at it…');
      let fix: { fixed?: boolean; summary?: string; code?: string } | null = null;
      try {
        const fRes = await fetch('/api/mobile-ship/autofix', {
          method: 'POST',
          headers: await ghHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ owner, repo, ref: setup.branch, workflow, runId: finished.id, powerLevel }),
        });
        fix = await fRes.json().catch(() => null);
      } catch { /* handled as "could not fix" below */ }
      if (!liveRef.current) return;

      if (!fix?.fixed) {
        setPhase('failed');
        setError(
          // A missing signing key is the ONE failure that is genuinely the user's to resolve, and only
          // the Play Store path can hit it — the .apk build needs no key at all, so never say this there.
          fix?.code === 'MISSING_SIGNING_SECRET' && needsUserSecrets(workflow)
            ? `${fix.summary} It has to stay yours, so NavBharatAI cannot add it for you — the guide below walks through creating it.`
            : fix?.summary
              ? `${fix.summary} NavBharatAI could not fix this one on its own.`
              : 'The build did not finish, and NavBharatAI could not work out why.',
        );
        return;
      }
      setProgressNote(`${fix.summary} NavBharatAI fixed it and is building again…`);
    }
  }, [setup, ghHeaders, dispatch]);

  /** Step 2 — one press, and everything from here on happens on its own. */
  const build = useCallback((kind: BuildKind = 'apk') => {
    if (!setup) return;
    setBuildKind(kind);
    setPhase('building');
    setError('');
    setArtifacts([]);
    setRun(null);
    setAttempt(0);
    setProgress(ATTEMPT_BANDS[0][0]);
    setProgressNote('Sending your app to be built…');
    void runCycle(kind);
  }, [setup, runCycle]);

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
              onClick={() => build('apk')}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-base font-bold bg-green-600 hover:bg-green-500 transition-colors text-white"
            >
              <Rocket size={17} /> {phase === 'failed' ? 'Try again' : 'Build my APK now'}
            </button>
            <p className="text-[11px] text-white/45 leading-relaxed -mt-1">
              Installs straight onto any Android phone. Nothing to set up — no signing key needed.
              (This file cannot go on Google Play; for that, use the option below.)
              {' '}₹1 per built app file (.apk, Play Store .aab, or iOS .ipa alike), taken from your
              wallet when you download the finished file — a failed build costs nothing, and
              re-downloading the same file is free.
            </p>

            {/* SECONDARY — Google Play. This is the only path that genuinely needs the user's own key. */}
            <div className="rounded-lg border border-amber-500/25 p-3 text-xs leading-relaxed"
                 style={{ background: 'rgba(245,158,11,0.07)' }}>
              <p className="flex items-center gap-1.5 text-amber-300 font-semibold mb-1.5">
                <Key size={13} /> Publishing on Google Play? One thing only you can do
              </p>
              <p className="text-white/60">
                Play needs a signed bundle, so add your signing key to the repository as
                {' '}{setup.requiredSecrets.android.length} secrets. This key is your app's permanent
                identity on the Play Store — it must stay with you, and NavBharatAI never sees it.
              </p>
              {/* Each secret spelled out: the name to type AND what it is. A bare list of names told a
                  non-technical user nothing about what to actually put in them. */}
              <ul className="mt-2 space-y-1.5">
                {setup.requiredSecrets.android.map((s) => (
                  <li key={s.name} className="text-white/55">
                    <span className="text-white/85 font-mono text-[11px]">{s.name}</span>
                    {s.what ? <> — {s.what}</> : null}
                  </li>
                ))}
              </ul>
              <p className="text-white/60 mt-2">The guide walks through creating it, step by step.</p>
              {onOpenGuide && (
                <button onClick={onOpenGuide} className="mt-2 text-indigo-400 hover:text-indigo-300 font-medium">
                  Show me how, step by step →
                </button>
              )}
              <button
                onClick={() => build('aab')}
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

        {/* Step 3 — building. One number, one line of plain language, and nothing to do. */}
        {phase === 'building' && (
          <div className="rounded-lg border border-white/10 p-4 text-center" style={{ background: '#0d1117' }}>
            <p className="text-3xl font-bold text-white tabular-nums">{progress}%</p>
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden my-3">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-700 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="flex items-center justify-center gap-1.5 text-sm text-white/80 font-medium">
              <Loader2 size={13} className="animate-spin text-indigo-400" />
              {progressNote || 'Building your app…'}
            </p>
            <p className="text-xs text-white/40 mt-1.5 leading-relaxed">
              This takes a few minutes and runs on its own — if anything goes wrong NavBharatAI fixes it
              and starts again. You can leave this screen open.
              {attempt > 0 && ` (Attempt ${attempt + 1} of ${MAX_AUTO_ATTEMPTS}.)`}
            </p>
            {run && (
              <a href={run.url} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1 mt-2 text-xs text-white/35 hover:text-indigo-300">
                <ExternalLink size={11} /> Watch the details
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
              {/* Publish straight from this build (admin 2026-08-04). Offered ONLY for the .apk: the
                  Nav App Store installs apps, and a .aab is a Play Store bundle no phone can install —
                  showing it here would promise something that cannot work. */}
              {setup && artifacts.filter((a) => /apk/i.test(a.name)).map((a) => (
                <PublishToNavStore
                  key={`store-${a.id}`}
                  owner={setup.owner}
                  repo={setup.repo}
                  artifactId={a.id}
                  ghHeaders={ghHeaders}
                  defaultAppName={setup.repo}
                />
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
            onClick={() => { setPhase('ready'); setError(''); setArtifacts([]); setProgress(0); setAttempt(0); }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-white/10 hover:bg-white/5 transition-colors text-white/60"
          >
            <RefreshCw size={12} /> Start over
          </button>
        )}
      </div>
    </div>
  );
};
