// P-DEV.3 — Debugger panel.
//
// REAL today: breakpoints — toggled in the editor gutter, persisted, listed here, click to jump to
// the exact file+line, remove individually or all at once.
//
// HONESTLY DEFERRED: live pause / call stack / variable inspection. Those need a CDP (Node inspector)
// tunnel to the cloud sandbox, which is not wired yet. Per the "real or honest-unavailable, never
// faked" rule, the Call Stack / Variables tabs show a clear "coming later" state and the run controls
// are rendered DISABLED — there is no mock data and no fake stepping.

import { useState } from 'react';
import { motion } from 'motion/react';
import { Bug, X, MapPin, Trash2, Layers, Braces } from 'lucide-react';
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

type DebugTab = 'breakpoints' | 'callstack' | 'variables';

const baseName = (p: string) => p.split('/').pop() || p;

export function DebugPanel({ onClose, breakpoints, onJumpToBreakpoint, onClearBreakpoint, onClearAll }: DebugPanelProps) {
  const [tab, setTab] = useState<DebugTab>('breakpoints');
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

      {/* Tabs */}
      <div className="flex gap-1 px-2 py-1.5 border-b border-white/5 shrink-0">
        {([
          { id: 'breakpoints', label: 'Breakpoints', icon: MapPin },
          { id: 'callstack', label: 'Call Stack', icon: Layers },
          { id: 'variables', label: 'Variables', icon: Braces },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${
              tab === id ? 'bg-rose-600/20 border-rose-500/50 text-rose-200' : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-100'
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-2 text-xs">
        {tab === 'breakpoints' && (
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
                  <button onClick={() => onClearBreakpoint(file, line)} title="Remove breakpoint" className="text-zinc-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === 'callstack' && (
          <DeferredState
            title="Call stack"
            body="Live pause and the call stack require running your app in the cloud sandbox with the Node inspector attached. This is coming in a later update — your breakpoints are saved and will be used automatically once it's available."
          />
        )}

        {tab === 'variables' && (
          <DeferredState
            title="Variable inspection"
            body="Inspecting local variables and watch expressions requires a paused session in the cloud sandbox. This is coming in a later update. For now, use console logs in your app and the AI Debugger for error analysis."
          />
        )}
      </div>
    </div>
  );
}

function DeferredState({ title, body }: { title: string; body: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center text-center h-full px-6 py-8 text-zinc-500">
      <Bug className="w-7 h-7 mb-2 text-zinc-600" />
      <div className="text-sm font-medium text-zinc-300 mb-1">{title} — coming soon</div>
      <p className="text-xs leading-relaxed max-w-sm">{body}</p>
    </motion.div>
  );
}

export default DebugPanel;
