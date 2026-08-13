import React, { useCallback, useEffect, useRef, useState } from 'react';
import { chargeReceipt, chargeHint, readChargeHeaders, APK_PRICE_INR } from '../../lib/apkChargeNotice';
import { PublishToNavStore } from './PublishToNavStore';
import {
  Loader2, Github, Download, CheckCircle2, AlertTriangle, ExternalLink,
  Rocket, Key, RefreshCw, Wrench,
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
  /** The app's background colour (`#rrggbb`) from the App Information form; wired into the real build. */
  backgroundColor?: string;
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
type BuildKind = 'apk' | 'aab' | 'ipa';
const workflowFor = (kind: BuildKind): ShipWorkflowFile =>
  kind === 'apk' ? SHIP_WORKFLOWS.androidApk
    : kind === 'aab' ? SHIP_WORKFLOWS.androidAab
      : SHIP_WORKFLOWS.iosIpa;
/** iOS produces no installable file for the user — a green build lands in TestFlight (Apple's rule). */
const isIos = (kind: BuildKind): boolean => kind === 'ipa';

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

/** m:ss for the live elapsed clock. */
function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const StoreBuildPanel: React.FC<StoreBuildPanelProps> = ({
  sessionId, appName, appId, iconDataUrl, backgroundColor, githubToken, onConnectGitHub, onOpenGuide, powerLevel,
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
  // The REAL steps of the running build, read from GitHub — so the user sees where it actually is, not a
  // guess from a timer. Empty until the run appears and its steps are readable.
  const [steps, setSteps] = useState<Array<{ label: string; state: 'done' | 'running' | 'pending' | 'failed' }>>([]);
  /**
   * The FULL problem from the server, ready to hand to NavBharatAI Pro v5.
   *
   * The auto-repair above only fixes what NavBharatAI itself SET UP (the workflow, the Capacitor
   * project, the signing wiring). When the failure is in the user's own APP CODE it is out of its
   * remit — and until now that left the user holding an error message with nothing to press.
   */
  const [fixReport, setFixReport] = useState('');
  // How long the current build has been running — shown alongside the steps so the wait feels honest
  // ("2:14 · usually about 5 minutes") instead of a bar that could sit still.
  const [buildStartedAt, setBuildStartedAt] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [busyNote, setBusyNote] = useState('');
  const [downloading, setDownloading] = useState('');
  /** What the last download cost — shown in plain words so a charge is never silent. */
  const [chargeNote, setChargeNote] = useState('');

  const liveRef = useRef(true);
  useEffect(() => () => { liveRef.current = false; }, []);

  // A once-a-second elapsed clock while a build runs, so the wait has an honest number even in the gaps
  // between the 5-second status polls. Stops the moment the build leaves the 'building' phase.
  useEffect(() => {
    if (phase !== 'building' || !buildStartedAt) return;
    const t = setInterval(() => setElapsedSec(Math.max(0, Math.round((Date.now() - buildStartedAt) / 1000))), 1000);
    return () => clearInterval(t);
  }, [phase, buildStartedAt]);

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
        body: JSON.stringify({ sessionId, appName, appId, iconDataUrl, backgroundColor, ios: true, powerLevel }),
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
  }, [sessionId, appName, appId, iconDataUrl, backgroundColor, ghHeaders]);

  /**
   * Start the workflow on GitHub. Returns false when GitHub refused, so the caller can stop the whole
   * cycle instead of watching for a run that was never created — the exact failure this feature shipped
   * with, where a rejected dispatch still left the panel spinning.
   */
  const dispatch = useCallback(async (workflow: ShipWorkflowFile, inputs?: Record<string, string>): Promise<boolean> => {
    if (!setup) return false;
    const res = await fetch('/api/mobile-ship/trigger', {
      method: 'POST',
      headers: await ghHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ owner: setup.owner, repo: setup.repo, ref: setup.branch, workflow, ...(inputs ? { inputs } : {}) }),
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

      // iOS has no installable file to hand back; a green build goes to the user's TestFlight, so we ask
      // the workflow to upload there (Apple's rule). Android just builds the file.
      if (!(await dispatch(workflow, isIos(kind) ? { upload: 'true' } : undefined))) { if (liveRef.current) setPhase('ready'); return; }
      if (!liveRef.current) return;
      setProgressNote('Building your app…');

      const startedAt = Date.now();
      let finished: RunInfo | null = null;
      const bumpProgress = (next: number) => setProgress((p) => Math.max(p, next)); // never go backward
      for (let i = 0; i < 150 && liveRef.current && !finished; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        if (!liveRef.current) return;
        try {
          const res = await fetch(
            `/api/mobile-ship/runs?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&workflow=${workflow}`,
            { headers: await ghHeaders() },
          );
          const data = await res.json().catch(() => null);
          const ours = ((data?.runs || []) as RunInfo[]).find((r) => !seen.has(r.id));
          if (!ours) {
            // The run has not appeared yet — a brief gap; a time estimate keeps the bar honest-ish here.
            bumpProgress(buildProgressPercent(attempt, Date.now() - startedAt));
            continue;
          }
          setRun(ours);
          // REAL progress from the run's actual steps. Falls back to the time estimate only if the steps
          // are not readable yet (the run is queued, or a single poll failed).
          let usedReal = false;
          try {
            const sRes = await fetch(
              `/api/mobile-ship/run-steps?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&runId=${ours.id}`,
              { headers: await ghHeaders() },
            );
            const s = await sRes.json().catch(() => null);
            if (s && typeof s.percent === 'number' && Array.isArray(s.steps) && s.steps.length) {
              usedReal = true;
              bumpProgress(s.percent);
              if (s.currentStep) setProgressNote(s.currentStep);
              setSteps(s.steps);
            }
          } catch { /* fall back below */ }
          if (!usedReal) bumpProgress(buildProgressPercent(attempt, Date.now() - startedAt));
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

      // ── Finished successfully ──
      if (finished.conclusion === 'success') {
        setProgress(96);
        if (isIos(kind)) {
          // iOS has no file to collect — it went to TestFlight. Straight to the honest done state.
          setProgressNote('Sending to TestFlight…');
          if (!liveRef.current) return;
          setProgress(100);
          setPhase('built');
          return;
        }
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
      let fix: { fixed?: boolean; summary?: string; code?: string; report?: string } | null = null;
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
        if (fix?.report) setFixReport(fix.report);
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
    setFixReport('');
    setArtifacts([]);
    setRun(null);
    setSteps([]);
    setAttempt(0);
    setBuildStartedAt(Date.now());
    setElapsedSec(0);
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
      // TELL THE USER, EVERY TIME (admin 2026-08-10). The server reports what it charged; we say it
      // in plain words. `applied` is false for a free-list account or a zero price, so this can never
      // claim a charge nobody paid — and it names the per-BUILD rule, because "it charged me twice!"
      // is the guaranteed support message if a bare price is shown for a file people re-download.
      const charge = readChargeHeaders((n) => res.headers.get(n));
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
      setChargeNote(chargeReceipt({ priceInr: charge.priceInr, applied: charge.applied }));
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

            {/* FIX — the bridge that was missing. "Try again" only helps if the cause was transient;
                when the build died on the app's own code, repeating it repeats the failure. This hands
                the WHOLE problem (what stopped it + the real log) to NavBharatAI Pro v5, which is the
                only surface that can change app code, and starts the fix on arrival — the press IS the
                consent, so making the user hit send again would be one dead step too many. */}
            {phase === 'failed' && fixReport && (
              <>
                <button
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('navbharat:navigate', {
                      detail: { view: 'nbi_pro_chat', fixPrompt: fixReport, autoSend: true },
                    }));
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-base font-bold bg-indigo-600 hover:bg-indigo-500 transition-colors text-white"
                >
                  <Wrench size={17} /> Fix this with NavBharatAI
                </button>
                <p className="text-[11px] text-white/45 leading-relaxed -mt-1">
                  Opens NavBharatAI Pro with the full error and starts fixing your app&apos;s code.
                  Come back and press &ldquo;Try again&rdquo; once it is done.
                </p>
              </>
            )}
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

            {/* iPhone / TestFlight. Apple LEGALLY requires a Mac + an Apple signing identity, so this path
                needs the user's own Apple credentials as repository secrets — exactly like the Play Store
                needs a keystore. A successful build goes straight to TestFlight (there is no installable
                file for the user to download — Apple's rule), and the panel says so honestly. */}
            {setup.requiredSecrets.ios.length > 0 && (
              <div className="rounded-lg border border-sky-500/25 p-3 text-xs leading-relaxed"
                   style={{ background: 'rgba(56,189,248,0.07)' }}>
                <p className="flex items-center gap-1.5 text-sky-300 font-semibold mb-1.5">
                  <Key size={13} /> Building for iPhone? What only you can do
                </p>
                <p className="text-white/60">
                  Apple only lets an app reach an iPhone through TestFlight or the App Store, and only from
                  a Mac with your own Apple signing identity. Add your Apple credentials to the repository
                  as {setup.requiredSecrets.ios.length} secrets — they are yours, and NavBharatAI never
                  sees them. A successful build is sent to your TestFlight (no file to download).
                </p>
                <ul className="mt-2 space-y-1.5">
                  {setup.requiredSecrets.ios.map((s) => (
                    <li key={s.name} className="text-white/55">
                      <span className="text-white/85 font-mono text-[11px]">{s.name}</span>
                      {s.what ? <> — {s.what}</> : null}
                    </li>
                  ))}
                </ul>
                {onOpenGuide && (
                  <button onClick={onOpenGuide} className="mt-2 text-indigo-400 hover:text-indigo-300 font-medium">
                    Show me how, step by step →
                  </button>
                )}
                <button
                  onClick={() => build('ipa')}
                  className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold border border-sky-500/40 text-sky-200 hover:bg-sky-500/10 transition-colors"
                >
                  <Rocket size={14} /> Build for iPhone (TestFlight)
                </button>
              </div>
            )}

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
            {/* The REAL steps of the build, straight from GitHub — so the user sees exactly where it is. */}
            {steps.length > 0 && (
              <ul className="mt-3 space-y-1 text-left max-w-xs mx-auto">
                {steps.map((s, i) => (
                  <li key={`${s.label}-${i}`} className="flex items-center gap-2 text-xs">
                    {s.state === 'done' ? (
                      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                    ) : s.state === 'running' ? (
                      <Loader2 size={13} className="animate-spin text-indigo-400 shrink-0" />
                    ) : s.state === 'failed' ? (
                      <AlertTriangle size={13} className="text-amber-400 shrink-0" />
                    ) : (
                      <span className="w-[13px] h-[13px] rounded-full border border-white/20 shrink-0" />
                    )}
                    <span className={
                      s.state === 'done' ? 'text-white/45'
                        : s.state === 'running' ? 'text-white/90 font-medium'
                          : s.state === 'failed' ? 'text-amber-300'
                            : 'text-white/40'
                    }>{s.label}</span>
                  </li>
                ))}
              </ul>
            )}
            {/* An honest clock: how long it has been running, against how long these builds usually take. */}
            <p className="text-xs text-white/55 mt-3 tabular-nums">
              {fmtDuration(elapsedSec)} elapsed · usually about {isIos(buildKind) ? '8' : '5'} minutes
            </p>
            <p className="text-xs text-white/40 mt-1 leading-relaxed">
              This runs on its own — if anything goes wrong NavBharatAI fixes it and starts again. You can
              leave this screen open.
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

        {/* Step 4 — the result. iOS has no installable file to download: a green build lands in the
            user's TestFlight (Apple allows no other way to put an app on an iPhone), so we tell the truth
            instead of showing a download button that would hand over an unusable .ipa. */}
        {phase === 'built' && isIos(buildKind) && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm text-green-400 font-semibold">
              <CheckCircle2 size={15} /> Sent to TestFlight
            </p>
            <p className="text-xs text-white/55 leading-relaxed">
              Your iPhone app was built and uploaded to TestFlight. Open App Store Connect → your app →
              TestFlight to invite testers; internal testers get it automatically once Apple finishes
              processing (a few minutes). An iPhone app can only be installed through TestFlight or the App
              Store, so there is no file to download here.
            </p>
            <a href="https://appstoreconnect.apple.com/apps" target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <ExternalLink size={11} /> Open App Store Connect
            </a>
            {run && (
              <a href={run.url} target="_blank" rel="noreferrer"
                 className="block text-[11px] text-white/35 hover:text-indigo-300">Watch the build details</a>
            )}
          </div>
        )}

        {/* Step 4 — the actual file (Android). */}
        {phase === 'built' && !isIos(buildKind) && (
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
              {/* THE PRICE, BEFORE THE CLICK (admin 2026-08-10: "har bar user ko bataya jaye"). A
                  charge the user only discovers afterwards is a charge taken behind their back — and
                  the per-BUILD rule is stated here because a bare price on a re-downloadable file
                  guarantees the "it charged me twice!" message. */}
              {APK_PRICE_INR > 0 && (
                <p className="text-[11px] text-[#8b949e] text-center">{chargeHint(APK_PRICE_INR)}</p>
              )}
              {/* …and what it actually cost, once the file is in their hands. */}
              {chargeNote && (
                <p className="text-[11px] text-emerald-300 text-center font-semibold">{chargeNote}</p>
              )}
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
