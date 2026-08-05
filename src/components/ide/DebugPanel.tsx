// P-DEV.3 — Debugger panel.
//
// REAL today: breakpoints — toggled in the editor gutter, persisted, listed here, click to jump to
// the exact file+line, remove individually or all at once.
//
// HONESTLY DEFERRED: live pause / call stack / variable inspection. Those need a CDP (Node inspector)
// tunnel to the cloud sandbox, which is not wired yet.
//
// HOW that deferral is presented changed on 2026-08-04, when Debug became a phone FOOTER TAB. It used
// to ship four disabled run controls plus Call Stack and Variables tabs that opened "coming soon"
// screens. Nothing was faked — but once the panel is one tap away, a row of un-pressable buttons and
// two tabs that lead nowhere read as a BROKEN feature rather than an unbuilt one, and a user taps them
// anyway to find out. So the panel is now single-purpose: breakpoints, which are completely real, plus
// one sentence naming what is missing. Nothing to press that cannot be pressed.

import { Bug, X, MapPin, Trash2 } from 'lucide-react';
import type { BreakpointMap } from '../../lib/breakpoints';
import { breakpointList, breakpointCount } from '../../lib/breakpoints';

interface DebugPanelProps {
  onClose: () => void;
  breakpoints: BreakpointMap;
  onJumpToBreakpoint: (file: string, line: number) => void;
  onClearBreakpoint: (file: string, line: number) => void;
  onClearAll: () => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

const baseName = (p: string) => p.split('/').pop() || p;

export function DebugPanel({ onClose, breakpoints, onJumpToBreakpoint, onClearBreakpoint, onClearAll }: DebugPanelProps) {
  const list = breakpointList(breakpoints);
  const count = breakpointCount(breakpoints);

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-zinc-200">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Bug className="w-3.5 h-3.5 text-rose-400" />
          Debugger
          {count > 0 && <span className="text-[10px] text-zinc-500">({count} breakpoint{count > 1 ? 's' : ''})</span>}
        </div>
        <div className="flex items-center gap-1">
          {count > 0 && (
            <button onClick={onClearAll} title="Remove all breakpoints" className="text-zinc-500 hover:text-white transition-colors p-1">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onClose} aria-label="Close debugger" className="text-zinc-500 hover:text-white transition-colors p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* No run controls. There used to be four — Continue / Step over / Step into / Pause — rendered
          permanently DISABLED, which was honest about live debugging not existing but still put four
          dead buttons in front of the user. Since Debug became a footer tab (2026-08-04) they are the
          first thing you see, and a row of greyed-out controls reads as a broken feature rather than an
          unbuilt one. One plain sentence says the same thing without pretending there is a control to
          press. Breakpoints below are fully real. */}
      <div className="px-3 py-2 border-b border-white/5 shrink-0 text-[10px] leading-relaxed text-zinc-500">
        Set breakpoints in the editor gutter and manage them here. Pausing execution and stepping
        through code line by line is not available yet.
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-2 text-xs">
        {(
          list.length === 0 ? (
            <div className="text-zinc-500 p-3 leading-relaxed">
              No breakpoints yet. Click a line's gutter (left margin) in the editor to add a red breakpoint dot. Your breakpoints are saved and will be used automatically once live debugging is available.
            </div>
          ) : (
            <ul className="space-y-0.5">
              {list.map(({ file, line }) => (
                <li key={`${file}:${line}`} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-white/5 group">
                  <button onClick={() => onJumpToBreakpoint(file, line)} className="flex items-center gap-2 min-w-0 text-left">
                    <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                    <span className="truncate text-zinc-200">{baseName(file)}</span>
                    <span className="text-zinc-500 shrink-0">:{line}</span>
                  </button>
                  {/* Always visible, never hover-only. A touch device has no hover, so `opacity-0
                      group-hover:opacity-100` made this button INVISIBLE and effectively untappable on
                      a phone — and Debug is a phone footer tab now, so that is where it is most used.
                      It fades in on hover for the desktop polish, but starts visible enough to find. */}
                  <button
                    onClick={() => onClearBreakpoint(file, line)}
                    title="Remove breakpoint"
                    aria-label={`Remove breakpoint at ${baseName(file)} line ${line}`}
                    className="p-1 -m-1 text-zinc-500 hover:text-rose-400 opacity-70 group-hover:opacity-100 transition-opacity shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )
        )}

      </div>
    </div>
  );
}


export default DebugPanel;
