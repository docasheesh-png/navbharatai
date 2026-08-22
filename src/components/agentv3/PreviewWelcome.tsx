// The "your app will appear here" screen — what the preview shows before anything has been built.
//
// See previewWelcome.ts for the bug this replaced (a spinner and a red "Fix with AI" error shown to a
// user who had built nothing). The copy and the state rule live there, unit-tested; this file is only
// the picture.

import React, { useEffect, useState } from 'react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { welcomeLine, WELCOME_HEADLINE, WELCOME_LINE_MS } from './previewWelcome';

/**
 * @param checking  the first render request is still in flight. Shown as a small, honest footnote —
 *                  NOT as a spinner over the whole screen, because at this point we genuinely do not
 *                  know whether there is an app, and claiming to prepare one is what caused the bug.
 */
export function PreviewWelcome({ checking = false, slow = false }: { checking?: boolean; slow?: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), WELCOME_LINE_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-6 text-center select-none">
      {/* THE TIRANGA SPINNER, LARGE (admin 2026-08-22: "aap hamara jo spinner hai tiranga wala, wahi
          laga do … bas size bada kar dena").
          
          It replaces a hand-drawn lion that never convinced anyone. The first version read as a bear
          (the admin: "apne panda bana diya"), and five attempts at redrawing it produced a buffalo —
          a profile animal silhouette is not something I can converge on by writing path coordinates
          and looking at renders. The admin's call to stop and use the mark the app ALREADY owns was
          the right one, and it is better on the merits: TirangaLoader is canvas-drawn from one shared
          rAF loop, is already proven on every other screen, and cannot be frozen by the global
          reduce-motion reset the way a CSS `animate-spin` can (see its header for that root cause).
          One mark everywhere beats a second one that has to be argued about.

          ⚠️ NO ANIMAL HERE, and that is a decision rather than an omission (admin, twice: "koi sher
          nahi chahiye, koi janwar nahi chahiye"). If a future session is tempted to put a mascot back
          on this screen, this comment is the answer: it was tried, it failed twice, and the tiranga
          is what the product already stands on. */}
      <TirangaLoader size={132} />

      <div className="space-y-2 max-w-sm">
        <h3 className="text-zinc-100 text-base font-semibold tracking-tight">{WELCOME_HEADLINE}</h3>
        {/* `key` restarts the fade on every change, so the line visibly turns over instead of
            swapping in place where the eye misses it. */}
        <p key={tick} className="text-xs leading-relaxed text-zinc-400 nbai-fade-in min-h-[2.6em]">
          {welcomeLine(tick)}
        </p>
      </div>

      {checking && (
        <p className="text-[11px] text-zinc-600">
          {slow ? 'Still checking for your saved files…' : 'Checking for your files…'}
        </p>
      )}

      <style>{`
        @keyframes nbaiFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        .nbai-fade-in { animation: nbaiFadeIn .5s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .nbai-fade-in { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
