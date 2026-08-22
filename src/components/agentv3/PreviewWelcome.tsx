// The "your app will appear here" screen — what the preview shows before anything has been built.
//
// See previewWelcome.ts for the bug this replaced (a spinner and a red "Fix with AI" error shown to a
// user who had built nothing). The copy and the state rule live there, unit-tested; this file is only
// the picture.

import React, { useEffect, useState } from 'react';
import makeInIndia from '../../assets/make-in-india.jpg';
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
      {/* THE MARK ON THIS SCREEN (admin 2026-08-22, asked for four times: "use this, as it is!!").
          
          Used EXACTLY as supplied — the file in src/assets is a byte copy of what the admin sent, and
          nothing here recolours, crops or redraws it. It keeps its own white ground on a rounded card,
          which is how a logo is normally placed on a dark UI and is the only reading of "as it is"
          that also renders: the artwork is near-black, so dropping it straight onto #0d1117 would show
          the user an empty panel.
          
          ⚠️ FOR WHOEVER TOUCHES THIS NEXT — the licence question is REAL and unresolved. This is the
          Make in India lion, a DPIIT (Government of India) registered trademark. It is not public
          domain: Indian government works carry copyright under s.17(d) of the Copyright Act, and a
          trademark separately governs use in commerce, so displaying it in a paid product without
          permission is a live legal exposure and can read as government endorsement. There IS a
          permission pathway (DPIIT / makeinindia.com guidelines) and Indian firms are encouraged to
          apply. The admin was told this each time and chose to proceed; that is their call to make,
          and this comment exists so the next person does not assume it was cleared. */}
      <img
        src={makeInIndia}
        alt="Make in India"
        className="w-full max-w-[260px] rounded-xl bg-white"
        draggable={false}
      />

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
