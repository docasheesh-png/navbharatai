// The little layout diagram on a starter template (ROADMAP #1 Phase 3.4).
//
// Plain divs, no images, no assets — a few rectangles that say "list", "dashboard", "grid". See
// starterSketch.ts for why this is a SHAPE and not a screenshot: we do not have a real screenshot of
// each template's output, and drawing a convincing fake one would be a picture of an app that does
// not exist, shown to someone deciding what to build.
//
// aria-hidden throughout: it is decoration beside a label that already says what the template is, so
// announcing "group of empty divs" to a screen reader would be noise, not information.

import React from 'react';
import { sketchFor, type SketchShape } from './starterSketch';

/** One bar/box in a sketch. `w` is a percentage so the whole thing scales with its container. */
const Bar = ({ w = 100, h = 4, dim = false }: { w?: number; h?: number; dim?: boolean }) => (
  <div
    className={`rounded-[2px] ${dim ? 'bg-zinc-700/70' : 'bg-indigo-400/60'}`}
    style={{ width: `${w}%`, height: h }}
  />
);

function ShapeBody({ shape }: { shape: SketchShape }) {
  switch (shape) {
    case 'dashboard':
      return (
        <div className="flex gap-1 h-full">
          <div className="w-1/4 h-full rounded-[2px] bg-zinc-700/70" />
          <div className="flex-1 flex flex-col gap-1">
            <div className="flex gap-1">
              <div className="flex-1 h-3 rounded-[2px] bg-indigo-400/60" />
              <div className="flex-1 h-3 rounded-[2px] bg-indigo-400/40" />
              <div className="flex-1 h-3 rounded-[2px] bg-indigo-400/25" />
            </div>
            <div className="flex-1 rounded-[2px] bg-zinc-700/50" />
          </div>
        </div>
      );
    case 'grid':
      return (
        <div className="grid grid-cols-3 gap-1 h-full">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={`rounded-[2px] ${i % 2 ? 'bg-zinc-700/60' : 'bg-indigo-400/45'}`} />
          ))}
        </div>
      );
    case 'feed':
      return (
        <div className="flex flex-col gap-1.5 justify-center h-full">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex gap-1 items-center">
              <div className="w-3 h-3 rounded-full bg-indigo-400/60 shrink-0" />
              <div className="flex-1 flex flex-col gap-0.5">
                <Bar w={70} h={3} />
                <Bar w={95} h={3} dim />
              </div>
            </div>
          ))}
        </div>
      );
    case 'board':
      return (
        <div className="flex gap-1 h-full">
          {[0, 1, 2].map((c) => (
            <div key={c} className="flex-1 flex flex-col gap-1">
              <div className="h-2 rounded-[2px] bg-indigo-400/55" />
              <div className="h-3 rounded-[2px] bg-zinc-700/60" />
              {c === 0 && <div className="h-3 rounded-[2px] bg-zinc-700/40" />}
            </div>
          ))}
        </div>
      );
    case 'form':
      return (
        <div className="flex flex-col gap-1 justify-center items-center h-full px-2">
          <Bar w={45} h={4} />
          <Bar w={100} h={5} dim />
          <Bar w={100} h={5} dim />
          <div className="w-1/2 h-[6px] rounded-[2px] bg-indigo-400/70 mt-0.5" />
        </div>
      );
    case 'keypad':
      return (
        <div className="flex flex-col gap-1 h-full">
          <div className="h-3 rounded-[2px] bg-zinc-700/70" />
          <div className="grid grid-cols-4 gap-[3px] flex-1">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={`rounded-[2px] ${i === 7 ? 'bg-indigo-400/70' : 'bg-zinc-700/60'}`} />
            ))}
          </div>
        </div>
      );
    case 'focus':
      return (
        <div className="flex flex-col items-center justify-center gap-1.5 h-full">
          <div className="w-7 h-7 rounded-full border-2 border-indigo-400/70" />
          <Bar w={40} h={3} dim />
        </div>
      );
    case 'landing':
      return (
        <div className="flex flex-col gap-1 h-full">
          <div className="h-1/2 rounded-[2px] bg-indigo-400/45" />
          <div className="grid grid-cols-3 gap-1 flex-1">
            {[0, 1, 2].map((i) => <div key={i} className="rounded-[2px] bg-zinc-700/60" />)}
          </div>
        </div>
      );
    case 'list':
    default:
      return (
        <div className="flex flex-col gap-1.5 justify-center h-full">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-1 items-center">
              <div className="w-2 h-2 rounded-[2px] bg-indigo-400/70 shrink-0" />
              <Bar w={i === 1 ? 65 : 90} h={3} dim />
            </div>
          ))}
        </div>
      );
  }
}

/**
 * The sketch tile.
 *
 * `title` deliberately says "layout sketch": this is what the SHAPE of the app looks like, not what
 * the built app will look like, and the wording has to keep that promise.
 */
export function StarterSketch({ id, className = '' }: { id: string; className?: string }) {
  const shape = sketchFor({ id });
  return (
    <div
      aria-hidden
      title="Layout sketch — the shape of this kind of app"
      className={`w-full h-11 rounded-md bg-zinc-950/60 border border-zinc-800 p-1.5 overflow-hidden ${className}`}
    >
      <ShapeBody shape={shape} />
    </div>
  );
}
