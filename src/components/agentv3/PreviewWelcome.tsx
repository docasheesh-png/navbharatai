// The "your app will appear here" screen — what the preview shows before anything has been built.
//
// See previewWelcome.ts for the bug this replaced (a spinner and a red "Fix with AI" error shown to a
// user who had built nothing). The copy and the state rule live there, unit-tested; this file is only
// the picture.

import React, { useEffect, useState } from 'react';
import { indiaLionManeSvg, indiaLionFaceSvg } from '../../lib/indiaLion';
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
      <div className="relative w-24 h-24">
        {/* The mane turns slowly — slowly on purpose. A fast spin reads as "working", and nothing is
            working; this is a resting mark, not a progress indicator. */}
        <div
          className="absolute inset-0 animate-spin motion-reduce:animate-none"
          style={{ animationDuration: '18s' }}
          dangerouslySetInnerHTML={{ __html: indiaLionManeSvg(96) }}
        />
        {/* The face is still, and breathes. */}
        <div
          className="absolute inset-0 nbai-lion-breathe motion-reduce:animate-none"
          dangerouslySetInnerHTML={{ __html: indiaLionFaceSvg(96) }}
        />
      </div>

      <div className="space-y-2 max-w-sm">
        <h3 className="text-zinc-100 text-[17px] font-semibold tracking-tight">{WELCOME_HEADLINE}</h3>
        {/* `key` restarts the fade on every change, so the line visibly turns over instead of
            swapping in place where the eye misses it. */}
        <p key={tick} className="text-[12.5px] leading-relaxed text-zinc-400 nbai-fade-in min-h-[2.6em]">
          {welcomeLine(tick)}
        </p>
      </div>

      {checking && (
        <p className="text-[11px] text-zinc-600">
          {slow ? 'Still checking for your saved files…' : 'Checking for your files…'}
        </p>
      )}

      <style>{`
        @keyframes nbaiLionBreathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.045); } }
        .nbai-lion-breathe { animation: nbaiLionBreathe 3.4s ease-in-out infinite; transform-origin: 50% 50%; }
        @keyframes nbaiFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        .nbai-fade-in { animation: nbaiFadeIn .5s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .nbai-lion-breathe, .nbai-fade-in { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
