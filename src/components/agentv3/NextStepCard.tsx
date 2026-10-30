// THE NEXT STEP card — see src/lib/nextStepGuide.ts. One line under the Pro header that always says
// the single next thing, in Hindi + English, from facts looked up live. A pending domain re-checks
// itself (Firebase Hosting live status) so the user never has to ask "ho gaya kya?".

import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, CheckCircle2, AlertTriangle, ChevronRight, X } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';
import { nextStep, domainRecheckMs, type NextStepFacts, type NextStepTarget } from '../../lib/nextStepGuide';

export interface LiveDomain { domain: string | null; active?: boolean }

/** Live custom-domain state for this app. `undefined` ⇒ not looked (feature off / error). */
export function useLiveDomain(workspaceId: string | undefined, enabled: boolean, nonce: string): LiveDomain | undefined {
  const [state, setState] = useState<LiveDomain | undefined>(undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => { setState(undefined); }, [workspaceId]);
  useEffect(() => {
    if (!workspaceId || !enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/domains/nbai/state?${new URLSearchParams({ workspaceId })}`, { headers: await authedHeaders() });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (cancelled || !data) return;
        if (!data.domain) { setState({ domain: null }); return; }
        setState({ domain: String(data.domain), active: data.status ? data.status.active === true : undefined });
      } catch { /* offline — keep the last known verdict */ }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, enabled, nonce, tick]);
  // Re-check a pending domain on its own, gently, and only while the page is visible.
  const pending = !!state?.domain && state.active === false;
  useEffect(() => {
    if (!pending) return;
    let attempt = 0;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') setTick((n) => n + 1);
        attempt += 1;
        loop();
      }, domainRecheckMs(attempt));
    };
    loop();
    return () => clearTimeout(t);
  }, [pending]);
  return state;
}

export function NextStepCard({ facts, onGo }: { facts: NextStepFacts; onGo: (target: NextStepTarget) => void }) {
  const step = nextStep(facts);
  const [hidden, setHidden] = useState<string | null>(null);
  if (!step || hidden === step.id) return null;
  const tone = step.tone === 'urgent'
    ? 'bg-red-500/10 border-red-500/25'
    : step.tone === 'done' ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-indigo-500/10 border-indigo-500/20';
  const Icon = step.tone === 'wait' ? Loader2 : step.tone === 'done' ? CheckCircle2 : step.tone === 'urgent' ? AlertTriangle : ChevronRight;
  return (
    <div role="status" aria-live="polite" data-testid="next-step-card" data-step={step.id}
      className={`mx-2 mt-1.5 px-3 py-2 rounded-xl border flex items-start gap-2 ${tone}`}>
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 text-ink ${step.tone === 'wait' ? 'animate-spin' : ''}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-faint font-semibold">Next step · अगला कदम{step.recheck ? ' · live checking' : ''}</div>
        <div className="text-[12px] text-ink break-words">{step.hi}</div>
        <div className="text-[11px] text-muted break-words">{step.en}</div>
      </div>
      {step.cta && step.cta.target !== 'none' && (
        <button type="button" onClick={() => onGo(step.cta!.target)}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-on-accent">
          {step.cta.hi} <ArrowRight className="w-3 h-3" />
        </button>
      )}
      {step.tone !== 'urgent' && (
        <button type="button" aria-label="Hide" onClick={() => setHidden(step.id)} className="shrink-0 text-faint hover:text-ink">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
