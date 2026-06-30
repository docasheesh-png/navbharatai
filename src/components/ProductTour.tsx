// P-UX.4 — Product Tour / Guided Walkthrough.
//
// A lightweight, DEPENDENCY-FREE guided tour (no driver.js / Shepherd.js). It spotlights real UI
// elements by their `data-tour="…"` attribute and walks the user through: sidebar → chat → preview
// → deploy → wallet/billing. Built to be UNBREAKABLE around a fragile app:
//   • each step declares the view that owns its target; the tour navigates there first (via the
//     app's own guarded `toggleTab`), then POLLS for the element with a bounded retry,
//   • if a target never appears (logged-out, collapsed, mobile, disabled), the step is GRACEFULLY
//     SKIPPED — it never throws, never spotlights an empty {0,0} box,
//   • it is user-initiated only (a subtle launcher), never auto-launches over a modal,
//   • all DOM access is guarded; a failure quietly ends the tour.
//
// Self-contained: it renders its own launcher + overlay, so mounting it once near the app root
// (plus the five `data-tour` attributes) is the entire integration.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Compass, X, ChevronRight, ChevronLeft } from 'lucide-react';

export interface TourStep {
  selector: string;
  title: string;
  body: string;
  /** ViewType the target lives in; the tour navigates here before showing the step. */
  view?: string;
}

const TOUR_KEY = 'navbharat_product_tour_v1';

export const DEFAULT_TOUR_STEPS: TourStep[] = [
  { selector: '[data-tour="sidebar"]', view: 'home', title: 'Navigation', body: 'Switch between everything from here — AI builders, your apps, wallet and settings.' },
  { selector: '[data-tour="chat"]', view: 'nbi_pro_chat', title: 'Build with AI', body: 'Describe the app you want in plain language and NavBharatAI Pro v3.0 builds it for you, end to end.' },
  { selector: '[data-tour="preview"]', view: 'nbi_pro_chat', title: 'Live preview', body: 'Watch your app run live as it is built. Switch to Files, Diff and Terminal right here too.' },
  { selector: '[data-tour="deploy"]', view: 'nbi_pro_chat', title: 'Deploy', body: 'When it is ready, publish your app to a permanent public URL with one click.' },
  { selector: '[data-tour="billing"]', view: 'billing', title: 'Wallet & billing', body: 'Track your credits and usage. You only pay for what you build.' },
];

const TOOLTIP_W = 320;

export function ProductTour({
  onNavigate,
  steps = DEFAULT_TOUR_STEPS,
}: {
  onNavigate?: (view: string) => void;
  steps?: TourStep[];
}) {
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cancelRef = useRef(false);

  const finish = useCallback(() => {
    cancelRef.current = true;
    setActive(false);
    setRect(null);
    setStepIdx(0);
    try { localStorage.setItem(TOUR_KEY, new Date().toISOString()); } catch { /* ignore */ }
  }, []);

  const advance = useCallback(() => {
    setRect(null);
    setStepIdx((i) => {
      if (i + 1 >= steps.length) { finish(); return i; }
      return i + 1;
    });
  }, [steps.length, finish]);

  const back = useCallback(() => {
    setRect(null);
    setStepIdx((i) => Math.max(0, i - 1));
  }, []);

  const start = useCallback(() => {
    setStepIdx(0);
    setRect(null);
    setActive(true);
  }, []);

  // Resolve the current step: navigate to its view, then poll for the element (bounded). If it never
  // shows, gracefully skip. Never throws.
  useEffect(() => {
    if (!active) return;
    cancelRef.current = false;
    const step = steps[stepIdx];
    if (!step) { finish(); return; }
    if (step.view && onNavigate) { try { onNavigate(step.view); } catch { /* nav is best-effort */ } }
    let raf = 0;
    let tries = 0;
    const MAX_TRIES = 120; // ~2s at 60fps — enough for a view switch + mount
    const poll = () => {
      if (cancelRef.current) return;
      let el: HTMLElement | null = null;
      try { el = document.querySelector(step.selector) as HTMLElement | null; } catch { el = null; }
      const r = el ? el.getBoundingClientRect() : null;
      if (el && r && r.width > 0 && r.height > 0) {
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
        setRect(r);
        return;
      }
      tries += 1;
      if (tries >= MAX_TRIES) { advance(); return; } // target absent → skip this step
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => { cancelRef.current = true; if (raf) cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIdx]);

  // Keep the spotlight aligned on resize/scroll while a step is shown.
  useEffect(() => {
    if (!active || !rect) return;
    const update = () => {
      const sel = steps[stepIdx]?.selector;
      if (!sel) return;
      let el: HTMLElement | null = null;
      try { el = document.querySelector(sel) as HTMLElement | null; } catch { el = null; }
      const r = el ? el.getBoundingClientRect() : null;
      if (r && r.width > 0 && r.height > 0) setRect(r);
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [active, rect, stepIdx, steps]);

  // Keyboard: Esc closes, arrows navigate.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') advance();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, finish, advance, back]);

  // Launcher (desktop only — the tour spotlights the desktop layout). User-initiated; never auto-runs.
  if (!active) {
    return (
      <button
        onClick={start}
        aria-label="Take a quick product tour"
        className="hidden lg:flex fixed bottom-4 left-4 z-[120] items-center gap-1.5 px-3 py-2 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-lg shadow-indigo-900/30 transition-colors"
      >
        <Compass className="w-4 h-4" />
        Tour
      </button>
    );
  }

  const step = steps[stepIdx];
  const total = steps.length;

  // Tooltip placement: below the target if there's room, else above; clamped to the viewport.
  let tipTop = 24;
  let tipLeft = 24;
  if (rect) {
    const belowRoom = window.innerHeight - rect.bottom;
    tipTop = belowRoom > 200 ? rect.bottom + 14 : Math.max(16, rect.top - 200);
    tipLeft = Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - TOOLTIP_W - 16));
  }

  return (
    <div className="fixed inset-0 z-[99998]" role="dialog" aria-modal="false" aria-label={`Product tour, step ${stepIdx + 1} of ${total}`}>
      {rect ? (
        // Spotlight ring — the huge box-shadow dims everything OUTSIDE the ring. pointer-events-none
        // so it never blocks the app underneath.
        <div
          className="fixed rounded-lg border-2 border-indigo-400 pointer-events-none transition-all duration-200"
          style={{
            top: Math.max(0, rect.top - 6),
            left: Math.max(0, rect.left - 6),
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: '0 0 0 9999px rgba(2,6,23,0.62)',
          }}
        />
      ) : (
        // Still resolving the target — a plain dim layer so the screen doesn't flash.
        <div className="fixed inset-0 pointer-events-none" style={{ background: 'rgba(2,6,23,0.62)' }} />
      )}

      <div
        className="fixed z-[99999] w-[320px] max-w-[calc(100vw-32px)] rounded-xl border border-white/10 bg-[#161b22] p-4 shadow-2xl"
        style={{ top: tipTop, left: tipLeft }}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">{step?.title}</h3>
          <button onClick={finish} aria-label="Close tour" className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{step?.body}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">{stepIdx + 1} / {total}</span>
          <div className="flex items-center gap-1.5">
            {stepIdx > 0 && (
              <button onClick={back} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-300 hover:text-white hover:bg-white/5 transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}
            <button onClick={advance} className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs text-white transition-colors">
              {stepIdx + 1 >= total ? 'Done' : 'Next'}
              {stepIdx + 1 < total && <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProductTour;
