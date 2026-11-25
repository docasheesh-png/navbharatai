// "Build Android App" — ONE button, TWO real providers (2026-11-25).
//
//   Option 1 — NavBharatAI Native Cloud Build: our own cloud machines; no GitHub needed (NativeBuildPanel).
//   Option 2 — GitHub Actions Build: the existing, long-hardened flow, rendered UNCHANGED (StoreBuildPanel).
//
// The choice is always the user's: nothing here ever switches provider on its own, before or after a
// failure. A provider that cannot run is still shown, greyed, with the server's honest reason. The last
// choice is remembered and pre-selected, but the user still confirms it in the sheet.

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, Rocket, X, Check, Loader2 } from 'lucide-react';
import { Github } from '../ui/BrandIcons';
import { authedHeaders } from '../../lib/authHeaders';
import { readAnswer } from '../../lib/serverAnswer';
import {
  PROVIDER_PREF_KEY, isCapabilities, readProviderPreference, type ArtifactKind, type Capabilities, type ProviderId,
} from '../../lib/mobileBuildClient';
import { StoreBuildPanel, type StoreBuildPanelProps } from './StoreBuildPanel';
import { NativeBuildPanel } from './NativeBuildPanel';

const OPTION_TEXT: Record<ProviderId, { title: string; chip: string; points: string[] }> = {
  native_cloud: {
    title: 'NavBharatAI Native Cloud Build',
    chip: 'Native Cloud',
    points: [
      'Built on NavBharatAI’s own cloud machines',
      'No GitHub connection required',
      'APK and Play Store bundle (AAB)',
      'Progress, download and build history right here',
    ],
  },
  github_actions: {
    title: 'GitHub Actions Build',
    chip: 'GitHub Actions',
    points: [
      'Uses your own GitHub repository',
      'Existing workflow and signing set-up',
      'Automatic repair, retry and build reports',
      'Needs your GitHub account connected',
    ],
  },
};

function safeStorage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export const AndroidBuildProviders: React.FC<StoreBuildPanelProps> = (props) => {
  const [chosen, setChosen] = useState<ProviderId | null>(null);
  const [kind, setKind] = useState<ArtifactKind>('apk');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pick, setPick] = useState<ProviderId>(() => readProviderPreference(safeStorage()) ?? 'native_cloud');
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [capsError, setCapsError] = useState<string | null>(null);

  const loadCaps = useCallback(async () => {
    setCapsError(null);
    try {
      const res = await fetch('/api/mobile-builds/capabilities', { headers: await authedHeaders() });
      const a = await readAnswer(res, isCapabilities);
      if (a.ok) setCaps(a.value); else setCapsError(a.sentence);
    } catch {
      setCapsError('Could not check which build options are available. Check your connection.');
    }
  }, []);

  useEffect(() => { if (sheetOpen && !caps) void loadCaps(); }, [sheetOpen, caps, loadCaps]);

  const info = (id: ProviderId) => caps?.providers.find((p) => p.id === id) ?? null;
  const pickInfo = info(pick);
  const canContinue = !!pickInfo && pickInfo.available && (pick === 'github_actions' || pickInfo.artifacts.includes(kind));

  const confirm = (): void => {
    if (!canContinue) return;
    try { safeStorage()?.setItem(PROVIDER_PREF_KEY, pick); } catch { /* a preference only */ }
    setChosen(pick);
    setSheetOpen(false);
  };

  const sheet = sheetOpen ? (
    <div className="nb-sheet-overlay nb-sheet-over-nav fixed inset-0 z-[200] flex items-center justify-center bg-scrim" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="android-build-title" className="nb-sheet w-full max-w-lg bg-card border border-line rounded-2xl p-4 sm:p-5 space-y-4 shadow-2xl overflow-y-auto">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h2 id="android-build-title" className="text-base font-black text-ink">Build Android App</h2>
            <p className="text-xs text-muted mt-0.5">Choose how you want to build your application.</p>
          </div>
          <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close" className="text-muted hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        {!caps && !capsError && <p className="text-xs text-muted flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Checking which build options are available…</p>}
        {capsError && (
          <div className="text-xs text-warn space-y-2">
            <p>{capsError}</p>
            <button onClick={() => void loadCaps()} className="text-accent-text font-semibold">Try again</button>
          </div>
        )}

        {caps && (
          <div role="radiogroup" aria-label="Build provider" className="space-y-2.5">
            {(['native_cloud', 'github_actions'] as const).map((id, i) => {
              const p = info(id);
              const t = OPTION_TEXT[id];
              const selected = pick === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!p?.available}
                  onClick={() => setPick(id)}
                  className={`w-full text-left px-3.5 py-3 rounded-xl border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${selected ? 'border-accent bg-raised' : 'border-line'}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="flex items-center gap-2 text-sm font-bold text-ink">
                      {id === 'native_cloud' ? <Cloud size={15} className="text-accent-text" /> : <Github size={15} />}
                      Option {i + 1} — {t.title}
                    </span>
                    {selected && p?.available && <Check size={15} className="text-accent-text flex-shrink-0" />}
                  </div>
                  <span className="inline-block text-[10px] font-bold uppercase tracking-wide text-accent-text border border-line rounded px-1.5 py-0.5 mb-1.5">{t.chip}</span>
                  <ul className="text-[11px] text-body space-y-0.5 list-disc pl-4">
                    {t.points.map((pt) => <li key={pt}>{pt}</li>)}
                  </ul>
                  {p && !p.available && p.unavailableReason && <p className="text-[11px] text-warn mt-1.5">{p.unavailableReason}</p>}
                </button>
              );
            })}
          </div>
        )}

        {caps && pick === 'native_cloud' && pickInfo?.available && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-muted">What to build</p>
            <div className="flex gap-2">
              {(['apk', 'aab'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  disabled={!pickInfo.artifacts.includes(k)}
                  className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold disabled:opacity-40 ${kind === k ? 'border-accent text-accent-text' : 'border-line text-body'}`}
                >
                  {k === 'apk' ? 'Installable .apk' : 'Play Store .aab'}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted leading-relaxed">{pickInfo.signing[kind]}</p>
          </div>
        )}
        {caps && pick === 'github_actions' && pickInfo?.available && (
          <p className="text-[11px] text-muted leading-relaxed">
            Next, connect GitHub (if needed) and choose the installable .apk or the Play Store bundle — the same GitHub flow as before.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setSheetOpen(false)} className="px-4 py-2 rounded-xl bg-raised text-sm font-bold text-ink">Cancel</button>
          <button type="button" onClick={confirm} disabled={!canContinue} className="px-4 py-2 rounded-xl bg-accent text-sm font-black text-on-accent disabled:opacity-40">Continue</button>
        </div>
      </div>
    </div>
  ) : null;

  if (chosen === 'github_actions') {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-line bg-raised text-xs">
          <span className="flex items-center gap-2 text-body"><Github size={13} /> Building with <span className="font-semibold text-ink">GitHub Actions</span></span>
          <button onClick={() => { setChosen(null); setSheetOpen(true); }} className="text-[11px] font-semibold text-accent-text">Change</button>
        </div>
        <StoreBuildPanel {...props} />
        {sheet && createPortal(sheet, document.body)}
      </div>
    );
  }

  if (chosen === 'native_cloud') {
    return (
      <>
        <NativeBuildPanel
          sessionId={props.sessionId}
          appName={props.appName}
          appId={props.appId}
          iconDataUrl={props.iconDataUrl}
          backgroundColor={props.backgroundColor}
          powerLevel={props.powerLevel}
          kind={kind}
          priceInr={caps?.priceInr ?? 0}
          onChangeProvider={() => { setChosen(null); setSheetOpen(true); }}
        />
        {sheet && createPortal(sheet, document.body)}
      </>
    );
  }

  return (
    <div className="rounded-xl border border-line p-4 sm:p-5 bg-card">
      <h3 className="flex items-center gap-2 text-base font-bold text-ink mb-1.5">
        <Rocket size={17} className="text-accent-text" /> Build a real Android app
      </h3>
      <p className="text-xs text-muted leading-relaxed mb-3">
        Get a genuine installable .apk or a Play Store bundle (.aab). Choose NavBharatAI&apos;s own cloud or your GitHub.
      </p>
      <button
        onClick={() => setSheetOpen(true)}
        disabled={!props.sessionId}
        className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-base font-bold bg-accent text-on-accent disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Rocket size={17} /> Build Android App
      </button>
      {sheet && createPortal(sheet, document.body)}
    </div>
  );
};
