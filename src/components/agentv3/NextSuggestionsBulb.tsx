// NEXT-BUILD SUGGESTIONS 💡 — a small bulb below the composer that, after a build finishes, shows
// tailored "what could I build next?" ideas for THIS app (admin 2026-08-13), AND — for a big app being
// built step by step — the guided ROADMAP with a one-tap "build the next step" (admin 2026-08-14, Phase 4).
//
// It is ONLY a suggestion surface: tapping anything FILLS the composer with a ready-to-send instruction the
// user can review, edit, or ignore — nothing ever runs on its own. Data comes from the server's free
// /api/agentv3/next-suggestions (deterministic ideas + the persisted roadmap, if any), so the bulb lights up
// the moment a build completes. When there is nothing to show, it renders nothing (no clutter).

import { useEffect, useRef, useState } from 'react';
import { Lightbulb, X, Check, MapPin } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

interface Suggestion {
  id: string;
  title: string;
  detail: string;
  prompt: string;
  kind: 'domain' | 'enhancement';
}

type RoadmapStepStatus = 'done' | 'current' | 'next' | 'upcoming';
interface RoadmapStep { n: number; title: string; goal: string; infraCeiling: boolean; status: RoadmapStepStatus }
interface PublicRoadmap {
  famousApp: string | null;
  userMessage: string;
  note: string | null;
  currentStep: number;
  totalSteps: number;
  complete: boolean;
  nextStep: number | null;
  nextFillPrompt: string | null;
  steps: RoadmapStep[];
}

interface Props {
  /** The app whose "next steps" to suggest. */
  workspaceId?: string;
  /** True once a build has finished and nothing is running — the moment to offer next steps. */
  ready: boolean;
  /** Fill the composer with a suggestion's ready-to-send instruction (the user then reviews & sends). */
  onPick: (promptText: string) => void;
}

export function NextSuggestionsBulb({ workspaceId, ready, onPick }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [roadmap, setRoadmap] = useState<PublicRoadmap | null>(null);
  const [open, setOpen] = useState(false);
  const [seenKey, setSeenKey] = useState<string>('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  // The roadmap step the user chose to build this turn. When the build finishes, we tell the server the
  // step is REACHED — never before, so a step is only ever marked done once its build actually ran.
  const pendingBuiltStepRef = useRef<number | null>(null);

  // Fetch when a build has just finished for this workspace. If the user built a roadmap step, advance the
  // journey FIRST so the refetch reflects it. Best-effort — a failure just means no bulb.
  useEffect(() => {
    if (!ready || !workspaceId) return;
    let live = true;
    const run = async () => {
      const built = pendingBuiltStepRef.current;
      if (built != null) {
        pendingBuiltStepRef.current = null;
        try {
          await authedFetch('/api/agentv3/mega-roadmap/advance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId, step: built }),
          });
        } catch { /* advancing is best-effort — the refetch still shows the real state */ }
      }
      try {
        const r = await authedFetch(`/api/agentv3/next-suggestions?workspaceId=${encodeURIComponent(workspaceId)}`);
        const d = r.ok ? await r.json() : null;
        if (!live) return;
        setSuggestions(Array.isArray(d?.suggestions) ? (d.suggestions as Suggestion[]) : []);
        setRoadmap(d?.roadmap && Array.isArray(d.roadmap.steps) ? (d.roadmap as PublicRoadmap) : null);
      } catch { /* a suggestion surface must never disrupt the app */ }
    };
    run();
    return () => { live = false; };
  }, [ready, workspaceId]);

  // Close the popover on an outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const hasRoadmap = !!roadmap && roadmap.steps.length > 0;
  if (suggestions.length === 0 && !hasRoadmap) return null;

  // The badge counts actionable things: the one next roadmap step (if any) plus the generic ideas.
  const roadmapActionable = hasRoadmap && roadmap!.nextStep != null ? 1 : 0;
  const count = roadmapActionable + suggestions.length;
  // "Seen" set signature — includes the roadmap's current milestone so reaching a new step re-lights it.
  const setKey = `${hasRoadmap ? `r${roadmap!.currentStep}` : ''}|${suggestions.map((s) => s.id).join('|')}`;
  const unseen = seenKey !== setKey && count > 0;

  const toggle = () => {
    setOpen((v) => !v);
    if (!open) setSeenKey(setKey);
  };

  const buildNextStep = () => {
    if (!roadmap || !roadmap.nextFillPrompt || roadmap.nextStep == null) return;
    pendingBuiltStepRef.current = roadmap.nextStep; // reached only once this build completes
    onPick(roadmap.nextFillPrompt);
    setOpen(false);
  };

  const stepMark = (status: RoadmapStepStatus) => {
    if (status === 'done') return <Check className="w-3 h-3 text-emerald-400" />;
    if (status === 'current') return <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />;
    if (status === 'next') return <span className="w-2 h-2 rounded-full bg-sky-400 inline-block animate-pulse" />;
    return <span className="w-2 h-2 rounded-full border border-zinc-600 inline-block" />;
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        title={hasRoadmap ? 'Your app roadmap & next-step ideas' : 'Ideas for what to build next'}
        className={`relative h-7 w-7 flex items-center justify-center rounded-lg border transition-colors ${
          open ? 'border-amber-500 text-amber-300 bg-amber-950/30' : 'border-zinc-700 text-amber-300/80 hover:text-amber-200 hover:border-amber-600 bg-zinc-900'
        }`}
      >
        <Lightbulb className="w-4 h-4" />
        {unseen && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full bg-amber-500 text-[9px] font-black text-zinc-950">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-72 max-h-[62vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl z-50">
          {/* ── ROADMAP (guided step-by-step big-app journey) ── */}
          {hasRoadmap && (
            <div className="border-b border-zinc-800">
              <div className="sticky top-0 flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-950">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-sky-400" />
                  <span className="text-[12px] font-bold text-white">Your app roadmap</span>
                </div>
                <span className="text-[10px] text-zinc-500">{roadmap!.currentStep}/{roadmap!.totalSteps}</span>
              </div>
              {roadmap!.userMessage && (
                <p className="px-3 pt-2 text-[10.5px] text-zinc-400 leading-relaxed">{roadmap!.userMessage}</p>
              )}
              <div className="flex flex-col p-1.5 gap-0.5">
                {roadmap!.steps.map((s) => (
                  <div
                    key={s.n}
                    className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 ${s.status === 'next' ? 'border border-sky-800/60 bg-sky-950/20' : ''}`}
                  >
                    <span className="mt-1 shrink-0">{stepMark(s.status)}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[11.5px] font-semibold ${s.status === 'done' ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>{s.n}. {s.title}</span>
                        {s.infraCeiling && (
                          <span className="text-[8px] font-black uppercase tracking-wider text-orange-300/90 bg-orange-950/40 px-1 py-0.5 rounded" title="Needs extra infrastructure — built as an honest separate step">needs setup</span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 leading-snug">{s.goal}</div>
                    </div>
                  </div>
                ))}
              </div>
              {roadmap!.note && (
                <p className="px-3 pb-1 text-[10px] text-zinc-500 italic leading-snug">{roadmap!.note}</p>
              )}
              <div className="p-1.5">
                {roadmap!.complete ? (
                  <div className="text-center text-[11px] font-semibold text-emerald-400 py-1.5">🎉 All steps done!</div>
                ) : (
                  <button
                    onClick={buildNextStep}
                    className="w-full rounded-lg border border-sky-700 bg-sky-950/40 hover:bg-sky-900/40 px-2.5 py-2 text-left transition-colors"
                  >
                    <div className="text-[11.5px] font-bold text-sky-200">▶ Build next step: {roadmap!.steps.find((s) => s.n === roadmap!.nextStep)?.title}</div>
                    <div className="text-[10px] text-sky-400/70 mt-0.5">Drops it into the box — review, then send.</div>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── GENERIC "what to build next" ideas ── */}
          {suggestions.length > 0 && (
            <>
              <div className="sticky top-0 flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-950">
                <div className="flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[12px] font-bold text-white">What to build next</span>
                </div>
                <button onClick={() => setOpen(false)} title="Close" className="p-0.5 rounded hover:bg-zinc-800 text-zinc-400">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="px-3 pt-2 pb-1 text-[10.5px] text-zinc-500 leading-relaxed">
                Only ideas for your app — tap one to drop it into the box, then edit or send it.
              </p>
              <div className="flex flex-col p-1.5 gap-1">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { onPick(s.prompt); setOpen(false); }}
                    className="text-left rounded-lg border border-zinc-800 bg-zinc-900/60 hover:border-amber-700/60 hover:bg-zinc-900 px-2.5 py-2 transition-colors group"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-zinc-100 group-hover:text-white">{s.title}</span>
                      {s.kind === 'domain' && (
                        <span className="text-[8px] font-black uppercase tracking-widest text-amber-300/90 bg-amber-950/40 px-1 py-0.5 rounded">For this app</span>
                      )}
                    </div>
                    <div className="text-[10.5px] text-zinc-500 leading-snug mt-0.5">{s.detail}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default NextSuggestionsBulb;
