// NavBharatAI Native Cloud Build — the screen for Option 1 of the Android build chooser (2026-11-25).
//
// Everything shown here is read from the server's job record: the step names are the worker's own, the
// progress bar moves only on the worker's step counter, and "Ready" appears only once the validated file
// is stored and downloadable. No timers pretend to be progress.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Download, CheckCircle2, AlertTriangle, Key, RefreshCw, CircleStop, Cloud, FileText, Upload } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';
import { readAnswer, writeFailure } from '../../lib/serverAnswer';
import { deliverFile, deliveryMessage } from '../../lib/downloadFile';
import { chargeHint } from '../../lib/apkChargeNotice';
import {
  FINISHED, androidVersionLabel, architectureLabel, isBuildAnswer, isGeneratedKeyAnswer, isHistoryAnswer, isKeyAnswer, isLogsAnswer,
  keystoreFileName, newIdempotencyKey, realProgress, stateLabel,
  type ArtifactKind, type BuildView, type ExportedKey, type KeyBackup, type SigningKeyMeta,
} from '../../lib/mobileBuildClient';
import { downloadSigningKey } from '../../lib/signingKeyDownload';

export interface NativeBuildPanelProps {
  sessionId: string | null;
  appName: string;
  appId: string;
  iconDataUrl?: string;
  backgroundColor?: string;
  powerLevel?: string;
  kind: ArtifactKind;
  priceInr: number;
  onChangeProvider: () => void;
}

const POLL_MS = 4000;

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtElapsed(fromIso: string | null, toIso: string | null, nowMs: number): string {
  if (!fromIso) return '0:00';
  const s = Math.max(0, Math.floor(((toIso ? Date.parse(toIso) : nowMs) - Date.parse(fromIso)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const NativeBuildPanel: React.FC<NativeBuildPanelProps> = ({
  sessionId, appName, appId, iconDataUrl, backgroundColor, powerLevel, kind, priceInr, onChangeProvider,
}) => {
  const [build, setBuild] = useState<BuildView | null>(null);
  const [history, setHistory] = useState<BuildView[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [key, setKey] = useState<SigningKeyMeta | null | undefined>(undefined);
  const [backup, setBackup] = useState<KeyBackup | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMode, setKeyMode] = useState<'import' | 'generate'>('import');
  const [ksFile, setKsFile] = useState<File | null>(null);
  const [alias, setAlias] = useState('upload');
  const [storePw, setStorePw] = useState('');
  const [keyPw, setKeyPw] = useState('');
  const [consent, setConsent] = useState(false);
  const [neverPublished, setNeverPublished] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exported, setExported] = useState<ExportedKey | null>(null);
  // One request id per press of "Build": a double click or a retried network call is the SAME build.
  const pendingKey = useRef<string | null>(null);

  const active = !!build && !FINISHED.has(build.state);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/mobile-builds/history', { headers: await authedHeaders() });
      const a = await readAnswer(res, isHistoryAnswer);
      if (!a.ok) return;
      const mine = a.value.builds.filter((b) => b.appId === appId);
      setHistory(mine);
      // Resume a build still running for this app — a reload or another device never loses it.
      setBuild((cur) => cur ?? mine.find((b) => b.kind === kind && !FINISHED.has(b.state)) ?? null);
    } catch { /* history is a convenience; the build itself still works */ }
  }, [appId, kind]);

  const loadKey = useCallback(async () => {
    if (kind !== 'aab') { setKey(null); return; }
    try {
      const res = await fetch(`/api/mobile-builds/signing-key?appId=${encodeURIComponent(appId)}`, { headers: await authedHeaders() });
      const a = await readAnswer(res, isKeyAnswer);
      setKey(a.ok ? a.value.key : null);
    } catch { setKey(null); }
  }, [appId, kind]);

  useEffect(() => { void loadHistory(); void loadKey(); }, [loadHistory, loadKey]);

  // Poll the real job while it is running. Each poll also drives the build forward on the server.
  useEffect(() => {
    if (!build || FINISHED.has(build.state)) return;
    const t = setInterval(async () => {
      setNow(Date.now());
      try {
        const res = await fetch(`/api/mobile-builds/${build.id}`, { headers: await authedHeaders() });
        const a = await readAnswer(res, isBuildAnswer);
        if (a.ok) {
          setBuild(a.value.build);
          if (FINISHED.has(a.value.build.state)) void loadHistory();
        }
      } catch { /* the next poll tries again */ }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [build, loadHistory]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const start = useCallback(async () => {
    if (!sessionId || starting) return;
    setStarting(true); setError(null); setNote(null); setLogs(null);
    pendingKey.current = pendingKey.current ?? newIdempotencyKey();
    try {
      const res = await fetch('/api/mobile-builds', {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          provider: 'native_cloud', kind, sessionId, appName, appId, iconDataUrl, backgroundColor, powerLevel,
          idempotencyKey: pendingKey.current,
        }),
      });
      const a = await readAnswer(res, isBuildAnswer);
      if (a.ok) {
        setBuild(a.value.build);
        pendingKey.current = null;
      } else {
        setError(a.sentence);
        // A refusal is final for this press; the next press is a new request.
        pendingKey.current = null;
        if (res.status === 409) void loadKey();
      }
    } catch {
      setError('Could not reach NavBharatAI. Check your connection and try again — if the build had started, it will appear here.');
    } finally {
      setStarting(false);
    }
  }, [sessionId, starting, kind, appName, appId, iconDataUrl, backgroundColor, powerLevel, loadKey]);

  const stop = useCallback(async () => {
    if (!build) return;
    try {
      const res = await fetch(`/api/mobile-builds/${build.id}/cancel`, { method: 'POST', headers: await authedHeaders() });
      const a = await readAnswer(res, isBuildAnswer);
      if (a.ok) setBuild(a.value.build); else setError(a.sentence);
    } catch {
      setError('Could not reach NavBharatAI to stop the build. It is still running — try again.');
    }
  }, [build]);

  const showLogs = useCallback(async (b: BuildView) => {
    try {
      const res = await fetch(`/api/mobile-builds/${b.id}/logs`, { headers: await authedHeaders() });
      const a = await readAnswer(res, isLogsAnswer);
      setLogs(a.ok ? (a.value.lines.length ? a.value.lines : ['No log was recorded for this build.']) : [a.sentence]);
    } catch { setLogs(['The log could not be loaded.']); }
  }, []);

  const download = useCallback(async (b: BuildView) => {
    if (!b.artifact) return;
    setDownloading(true); setError(null);
    try {
      const res = await fetch(`/api/mobile-builds/${b.id}/download`, { headers: await authedHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? 'The file could not be downloaded.');
        return;
      }
      const blob = await res.blob();
      if (blob.size !== b.artifact.sizeBytes) {
        setError('The download was incomplete. Please try again.');
        return;
      }
      const result = await deliverFile(b.artifact.fileName, blob, b.kind === 'apk' ? 'application/vnd.android.package-archive' : 'application/octet-stream');
      setNote(deliveryMessage(result, b.artifact.fileName));
    } catch {
      setError('The file could not be downloaded.');
    } finally {
      setDownloading(false);
    }
  }, []);

  const saveKey = useCallback(async () => {
    setKeyBusy(true); setError(null);
    try {
      if (keyMode === 'import') {
        if (!ksFile) { setError('Choose your keystore file (.jks, .keystore or .p12).'); return; }
        const res = await fetch('/api/mobile-builds/signing-key/import', {
          method: 'POST',
          headers: await authedHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ appId, alias, storePassword: storePw, keyPassword: keyPw || undefined, keystoreBase64: await fileToBase64(ksFile), consent }),
        });
        const a = await readAnswer(res, isKeyAnswer);
        if (a.ok) { setKey(a.value.key); setStorePw(''); setKeyPw(''); setKsFile(null); } else setError(a.sentence);
      } else {
        const res = await fetch('/api/mobile-builds/signing-key/generate', {
          method: 'POST',
          headers: await authedHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ appId, appName, consent, confirmNeverPublished: neverPublished }),
        });
        const a = await readAnswer(res, isGeneratedKeyAnswer);
        if (a.ok) {
          setKey(a.value.key);
          setBackup(a.value.backup);
          const bytes = Uint8Array.from(atob(a.value.backup.base64), (c) => c.charCodeAt(0));
          await deliverFile(keystoreFileName(appId), new Blob([bytes], { type: 'application/x-pkcs12' }));
        } else setError(a.sentence);
      }
    } catch {
      setError('The key could not be saved. Nothing was changed — please try again.');
    } finally {
      setKeyBusy(false);
    }
  }, [keyMode, ksFile, appId, alias, storePw, keyPw, consent, appName, neverPublished]);

  const removeKey = useCallback(async () => {
    setKeyBusy(true); setError(null);
    try {
      const res = await fetch(`/api/mobile-builds/signing-key?appId=${encodeURIComponent(appId)}`, { method: 'DELETE', headers: await authedHeaders() });
      const failure = await writeFailure(res, 'The key could not be deleted. It is still saved.');
      if (failure) setError(failure); else { setKey(null); setConfirmDelete(false); setNote('The saved upload key was deleted from NavBharatAI.'); }
    } catch {
      setError('The key could not be deleted. It is still saved.');
    } finally {
      setKeyBusy(false);
    }
  }, [appId]);

  // The user's own copy of the saved key (Q-3703) — the same helper the account-deletion warning uses.
  const exportKey = useCallback(async () => {
    setKeyBusy(true); setError(null);
    const r = await downloadSigningKey(appId);
    if (r.ok) { setExported(r.key); setNote(r.message); } else setError(r.sentence);
    setKeyBusy(false);
  }, [appId]);

  const needsKey = kind === 'aab' && key === null;
  const progress = build ? realProgress(build) : null;
  const label = kind === 'apk' ? '.apk' : 'Play Store bundle (.aab)';

  return (
    <div className="rounded-xl border border-line overflow-hidden bg-card">
      <div className="p-4 sm:p-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-bold text-ink mb-1">
            <Cloud size={17} className="text-accent-text" /> NavBharatAI Native Cloud Build
          </h3>
          <p className="text-xs text-muted leading-relaxed">
            Building your {label} on NavBharatAI&apos;s own cloud machines. No GitHub account needed.
          </p>
        </div>
        <button onClick={onChangeProvider} disabled={active} className="flex-shrink-0 text-[11px] font-semibold text-accent-text px-2.5 py-1 rounded-md border border-line disabled:opacity-40">
          Change
        </button>
      </div>

      {error && (
        <div role="alert" className="mx-4 sm:mx-5 mb-4 flex gap-2 px-3 py-2.5 rounded-lg text-xs leading-relaxed text-warn bg-raised border border-line">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}
      {note && <p className="mx-4 sm:mx-5 mb-3 text-xs text-success">{note}</p>}

      <div className="px-4 sm:px-5 pb-5 space-y-3">
        {/* ── The upload key (AAB only) ── */}
        {kind === 'aab' && key === undefined && <p className="text-xs text-muted flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Checking your signing key…</p>}
        {kind === 'aab' && key && (
          <div className="px-3 py-2.5 rounded-lg border border-line bg-raised text-xs text-body">
            <p className="font-semibold text-ink flex items-center gap-1.5"><Key size={13} /> Upload key saved ({key.source === 'imported' ? 'your own key' : 'created by NavBharatAI'})</p>
            <p className="text-[11px] text-muted break-all mt-1">Alias: {key.alias} · SHA-256: {key.certSha256}</p>
            {!active && (
              confirmDelete ? (
                <div className="mt-2 space-y-1.5">
                  <p className="text-[11px] text-warn">Delete the saved key? Keep your own copy first: Google Play only accepts updates signed with this key.</p>
                  <div className="flex gap-2">
                    <button onClick={() => void removeKey()} disabled={keyBusy} className="flex-1 px-3 py-1.5 rounded-lg border border-line text-danger font-semibold disabled:opacity-40">Delete key</button>
                    <button onClick={() => setConfirmDelete(false)} className="flex-1 px-3 py-1.5 rounded-lg border border-line text-body font-semibold">Keep it</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="mt-1.5 text-[11px] text-accent-text font-semibold">Delete saved key</button>
              )
            )}
            <button onClick={() => void exportKey()} disabled={keyBusy} className="mt-1.5 ml-3 inline-flex items-center gap-1 text-[11px] text-accent-text font-semibold disabled:opacity-40">
              <Download size={11} /> Download my key
            </button>
            {exported && (
              <div className="mt-2 text-[11px] text-body space-y-0.5">
                <p className="break-all">Keystore password: <span className="font-mono text-ink">{exported.storePassword}</span></p>
                <p className="break-all">Key password: <span className="font-mono text-ink">{exported.keyPassword}</span> · Alias: <span className="font-mono text-ink">{exported.keyAlias}</span></p>
                <p className="text-muted">Keep the key file and these passwords safe: Google Play only accepts updates signed with this key.</p>
              </div>
            )}
          </div>
        )}
        {backup && (
          <div className="px-3 py-3 rounded-lg border border-line bg-raised text-xs text-body">
            <p className="font-bold text-success mb-1">Your new upload key — keep this backup</p>
            <p className="mb-1">The key file has been saved to this device. Keep it and this password safe: you need them if you ever build this app elsewhere.</p>
            <p className="text-[11px] text-muted break-all">Password: <span className="text-ink">{backup.storePassword}</span></p>
            <p className="text-[11px] text-muted break-all">Alias: <span className="text-ink">{backup.keyAlias}</span></p>
          </div>
        )}
        {needsKey && !active && (
          <div className="px-3 py-3 rounded-lg border border-line bg-raised text-xs text-body space-y-2.5">
            <p className="font-bold text-ink">This app needs its upload key</p>
            <p className="text-muted leading-relaxed">
              Google Play only accepts updates signed with the same upload key. If this app is already on Play — or you
              built it before with the GitHub option — add that key. Only create a new one for an app that has never been uploaded.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setKeyMode('import')} className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold ${keyMode === 'import' ? 'border-accent text-accent-text' : 'border-line text-muted'}`}>Add my existing key</button>
              <button onClick={() => setKeyMode('generate')} className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold ${keyMode === 'generate' ? 'border-accent text-accent-text' : 'border-line text-muted'}`}>Create a new key</button>
            </div>
            {keyMode === 'import' ? (
              <div className="space-y-2">
                <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-line cursor-pointer text-body">
                  <Upload size={13} /> <span className="truncate">{ksFile ? ksFile.name : 'Choose keystore file (.jks, .keystore, .p12)'}</span>
                  <input type="file" accept=".jks,.keystore,.p12,.pfx" className="hidden" onChange={(e) => setKsFile(e.target.files?.[0] ?? null)} />
                </label>
                <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Key alias" className="w-full px-3 py-2 rounded-lg border border-line bg-surface text-ink" />
                <input type="password" value={storePw} onChange={(e) => setStorePw(e.target.value)} placeholder="Keystore password" autoComplete="off" className="w-full px-3 py-2 rounded-lg border border-line bg-surface text-ink" />
                <input type="password" value={keyPw} onChange={(e) => setKeyPw(e.target.value)} placeholder="Key password (if different)" autoComplete="off" className="w-full px-3 py-2 rounded-lg border border-line bg-surface text-ink" />
              </div>
            ) : (
              <label className="flex items-start gap-2 text-body">
                <input type="checkbox" checked={neverPublished} onChange={(e) => setNeverPublished(e.target.checked)} className="mt-0.5" />
                <span>This app has never been uploaded to Google Play.</span>
              </label>
            )}
            <label className="flex items-start gap-2 text-body">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
              <span>Keep this key encrypted in NavBharatAI and use it only to sign my builds of this app. I can delete it at any time.</span>
            </label>
            <button
              onClick={() => void saveKey()}
              disabled={keyBusy || !consent || (keyMode === 'generate' && !neverPublished)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-accent text-on-accent disabled:opacity-40"
            >
              {keyBusy ? <Loader2 size={15} className="animate-spin" /> : <Key size={15} />}
              {keyBusy ? 'Checking the key…' : keyMode === 'import' ? 'Check and save my key' : 'Create my upload key'}
            </button>
          </div>
        )}

        {/* ── Start ── */}
        {/* The start button only when no build is on screen — a finished one carries its own Build again / Try again. */}
        {!build && (
          <>
            <button
              onClick={() => void start()}
              disabled={starting || !sessionId || needsKey || key === undefined}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-base font-bold bg-accent text-on-accent disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {starting ? <Loader2 size={17} className="animate-spin" /> : <Cloud size={17} />}
              {starting ? 'Preparing your app…' : `Build my ${label}`}
            </button>
            {chargeHint(priceInr) && <p className="text-[11px] text-muted text-center">{chargeHint(priceInr)} A build that fails costs nothing.</p>}
          </>
        )}

        {starting && <p className="text-xs text-muted text-center flex items-center justify-center gap-2"><Loader2 size={13} className="animate-spin" /> Checking and preparing your app before the build machine starts. This can take a few minutes.</p>}

        {/* ── Running ── */}
        {build && active && (
          <div className="px-3 py-3 rounded-lg border border-line bg-raised space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-ink flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> {stateLabel(build.state)}</span>
              <span className="text-muted tabular-nums">{fmtElapsed(build.startedAt ?? build.createdAt, null, now)}</span>
            </div>
            {build.step && (
              <p className="text-[11px] text-muted">
                {build.stepIndex && build.stepCount ? `Step ${build.stepIndex} of ${build.stepCount}: ` : ''}{build.step}
              </p>
            )}
            {progress !== null && (
              <div className="h-1.5 rounded-full bg-surface overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
            <p className="text-[10.5px] text-faint">Build ID {build.id}</p>
            <button onClick={() => void stop()} disabled={build.state === 'cancelling'} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-line text-xs font-semibold text-body disabled:opacity-40">
              <CircleStop size={13} /> {build.state === 'cancelling' ? 'Stopping…' : 'Stop build'}
            </button>
          </div>
        )}

        {/* ── Finished ── */}
        {build && build.state === 'completed' && build.artifact && (
          <div className="px-3 py-3 rounded-lg border border-line bg-raised space-y-2 text-xs text-body">
            <p className="font-bold text-success flex items-center gap-1.5"><CheckCircle2 size={14} /> Your {build.kind === 'apk' ? '.apk' : '.aab'} is ready</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
              <dt className="text-muted">File</dt><dd className="break-all">{build.artifact.fileName} · {fmtSize(build.artifact.sizeBytes)}</dd>
              <dt className="text-muted">Package</dt><dd className="break-all">{build.artifact.inspection.applicationId}</dd>
              <dt className="text-muted">Version</dt><dd>{build.artifact.inspection.versionName ?? '—'} (code {build.artifact.inspection.versionCode ?? '—'})</dd>
              <dt className="text-muted">Works on</dt><dd>{androidVersionLabel(build.artifact.inspection.minSdk)} and newer</dd>
              <dt className="text-muted">Targets</dt><dd>{androidVersionLabel(build.artifact.inspection.targetSdk)}</dd>
              <dt className="text-muted">Processors</dt><dd>{architectureLabel(build.artifact.inspection.abis)}</dd>
              <dt className="text-muted">Signing</dt>
              <dd>{build.artifact.inspection.signingType === 'debug' ? 'Debug key — for installing and testing, not for Google Play' : 'Your upload key — ready for Google Play'}</dd>
              <dt className="text-muted">SHA-256</dt><dd className="break-all text-faint">{build.artifact.sha256}</dd>
              <dt className="text-muted">Kept until</dt><dd>{new Date(build.artifact.expiresAt).toLocaleDateString()}</dd>
            </dl>
            <button onClick={() => void download(build)} disabled={downloading} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-accent text-on-accent disabled:opacity-40">
              {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Download {build.artifact.fileName}
            </button>
            <button onClick={() => { setBuild(null); setNote(null); }} className="w-full text-[11px] text-accent-text">Build again</button>
          </div>
        )}

        {build && (build.state === 'failed' || build.state === 'cancelled' || build.state === 'expired') && (
          <div className="px-3 py-3 rounded-lg border border-line bg-raised space-y-2 text-xs">
            <p className={`font-bold flex items-center gap-1.5 ${build.state === 'failed' ? 'text-danger' : 'text-body'}`}>
              <AlertTriangle size={14} /> {stateLabel(build.state)}
            </p>
            {build.errorMessage && <p className="text-body leading-relaxed break-words">{build.errorMessage}</p>}
            {build.failedStep && <p className="text-[11px] text-muted">Stopped at: {build.failedStep}</p>}
            <div className="flex gap-2">
              <button onClick={() => void showLogs(build)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-line text-body font-semibold"><FileText size={13} /> Build log</button>
              <button onClick={() => void start()} disabled={starting} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-line text-body font-semibold disabled:opacity-40"><RefreshCw size={13} /> Try again</button>
            </div>
          </div>
        )}

        {logs && (
          <pre className="max-h-64 overflow-auto px-3 py-2 rounded-lg border border-line bg-surface text-[10.5px] leading-snug text-body whitespace-pre-wrap break-all">{logs.join('\n')}</pre>
        )}

        {/* ── This app's earlier native builds ── */}
        {history.filter((h) => h.id !== build?.id).length > 0 && (
          <div className="pt-2">
            <p className="text-[11px] font-semibold text-muted mb-1.5">Earlier Native Cloud builds of this app</p>
            <ul className="space-y-1.5">
              {history.filter((h) => h.id !== build?.id).slice(0, 8).map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-line text-[11px]">
                  <span className="min-w-0 truncate text-body">{h.kind.toUpperCase()} · {new Date(h.createdAt).toLocaleString()} · {stateLabel(h.state)}</span>
                  {h.state === 'completed' && h.artifact
                    ? <button onClick={() => void download(h)} disabled={downloading} className="flex-shrink-0 text-accent-text font-semibold disabled:opacity-40">Download</button>
                    : !FINISHED.has(h.state)
                      ? <button onClick={() => setBuild(h)} className="flex-shrink-0 text-accent-text font-semibold">Open</button>
                      : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
