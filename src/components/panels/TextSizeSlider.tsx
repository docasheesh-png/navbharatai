// Text-size control for the slide-out menu (admin 2026-08-08: "setting me jo size wala option hai,
// isko slidebar menu me kar do — 50% to 200% tak font size ho").
//
// WHY IT MOVED: a font-size control is the one setting a user reaches for when they are ALREADY
// struggling to read the screen — burying it three taps deep inside Settings is exactly backwards.
// It now sits in the menu the user is one tap from, and the range is a real accessibility range
// (50–200 %) instead of the previous cautious 90–140 %.
//
// WHY A SLIDER, not the old +/- pair: the range is now 15 steps wide. Fifteen taps to reach 200 % is
// not a control, it is a chore — a slider crosses the whole range in one gesture and shows where you
// are. The +/- buttons remain in Settings for anyone who prefers precise stepping (and for keyboard
// users, who get the same stepping from the slider's arrow keys for free).
//
// The scale itself lives on <html> as `--nb-font-scale`; because the UI is rem-based it zooms the
// WHOLE app, not one panel. Single source of truth for the bounds + persistence: src/lib/a11y.ts.

import React from 'react';
import { Type } from 'lucide-react';
import {
  applyFontScale, getStoredFontScale, clampFontScale,
  FONT_SCALE_MIN, FONT_SCALE_MAX, FONT_SCALE_STEP, FONT_SCALE_DEFAULT,
} from '../../lib/a11y';

export function TextSizeSlider() {
  const [scale, setScale] = React.useState<number>(() => getStoredFontScale());
  const pct = Math.round(scale * 100);

  const set = (next: number) => setScale(applyFontScale(clampFontScale(next)));

  return (
    <div className="px-1">
      <div className="flex items-center justify-between mb-2 px-2">
        <div className="flex items-center gap-2">
          <Type className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-bold tracking-tight">Text Size</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-indigo-300 tabular-nums">{pct}%</span>
          {/* A one-tap way back to normal — at 50 % or 200 % the slider itself can be hard to aim. */}
          {scale !== FONT_SCALE_DEFAULT && (
            <button
              onClick={() => set(FONT_SCALE_DEFAULT)}
              className="text-[10px] font-bold uppercase tracking-widest text-[#8b949e] hover:text-white transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={FONT_SCALE_MIN}
        max={FONT_SCALE_MAX}
        step={FONT_SCALE_STEP}
        value={scale}
        onChange={(e) => set(parseFloat(e.target.value))}
        aria-label={`Text size, ${pct} percent`}
        className="w-full accent-indigo-500 cursor-pointer"
      />
      <div className="flex justify-between px-1 mt-0.5 text-[10px] text-[#8b949e] tabular-nums">
        <span>{Math.round(FONT_SCALE_MIN * 100)}%</span>
        <span>{Math.round(FONT_SCALE_MAX * 100)}%</span>
      </div>
    </div>
  );
}
