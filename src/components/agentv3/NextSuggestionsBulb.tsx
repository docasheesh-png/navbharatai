// NEXT-BUILD SUGGESTIONS 💡 — a small bulb below the composer that, after a build finishes, shows
// tailored "what could I build next?" ideas for THIS app (admin 2026-08-13).
//
// It is ONLY a suggestion: tapping one FILLS the composer with a ready-to-send instruction the user can
// review, edit, or ignore — nothing ever runs on its own. Suggestions come from the server's free,
// deterministic engine (/api/agentv3/next-suggestions), so there is no AI cost and the bulb lights up the
// moment a build completes. When there is nothing to suggest, the bulb renders nothing (no clutter).

import { useEffect, useRef, useState } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

interface Suggestion {
  id: string;
  title: string;
  detail: string;
  prompt: string;
  kind: 'domain' | 'enhancement';
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
  const [open, setOpen] = useState(false);
  // "Seen" is per suggestion-set: the badge shows until the user opens the list. Keyed by the set's
  // signature so a NEW build's fresh suggestions light the badge again.
  const [seenKey, setSeenKey] = useState<string>('');
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Fetch when a build has just finished for this workspace. Best-effort — a failure just means no bulb.
  useEffect(() => {
    if (!ready || !workspaceId) return;
    let live = true;
    authedFetch(`/api/agentv3/next-suggestions?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        const list = Array.isArray(d?.suggestions) ? (d.suggestions as Suggestion[]) : [];
        setSuggestions(list);
      })
      .catch(() => { /* a suggestion surface must never disrupt the app */ });
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

  if (suggestions.length === 0) return null;

  const setKey = suggestions.map((s) => s.id).join('|');
  const unseen = seenKey !== setKey; // badge lit until this exact set has been opened

  const toggle = () => {
    setOpen((v) => !v);
    if (!open) setSeenKey(setKey); // opening marks this set as seen
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        title="Ideas for what to build next"
        className={`relative h-7 w-7 flex items-center justify-center rounded-lg border transition-colors ${
          open ? 'border-amber-500 text-amber-300 bg-amber-950/30' : 'border-zinc-700 text-amber-300/80 hover:text-amber-200 hover:border-amber-600 bg-zinc-900'
        }`}
      >
        <Lightbulb className="w-4 h-4" />
        {/* notification badge — the count of fresh next-step ideas */}
        {unseen && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full bg-amber-500 text-[9px] font-black text-zinc-950">
            {suggestions.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-72 max-h-[60vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl z-50">
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
        </div>
      )}
    </div>
  );
}

export default NextSuggestionsBulb;
