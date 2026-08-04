import React, { useState, useEffect, useRef } from 'react';
import { Terminal as TerminalIcon, X, Plus, Maximize2, Minimize2, ChevronDown } from 'lucide-react';
import { ShellTerminal, closeShellSession } from './ShellTerminal';

/**
 * MULTI-TERMINAL panel (admin spec 2026-08-04): "jab user terminal open kare, to uske andar hi ek
 * '+ New' button ho. Click karte hi dropdown khule jisme terminals ki list ho, aur last me '+ New'.
 * Har terminal ke last me x (close) button bhi."
 *
 * Code Studio previously mounted exactly ONE terminal, so a long-running command blocked every other
 * one — you could not watch a dev server AND run `git status` without killing the first. This panel
 * owns the session list and draws one shared header for all of them; each session is an independent
 * ShellTerminal backed by its own real PTY in the sandbox.
 *
 * THE KEY DESIGN DECISION: every session stays MOUNTED and inactive ones are hidden with CSS, never
 * unmounted. A terminal's value is its scrollback and command history — unmounting to "save memory"
 * would silently wipe the output of a build you switched away from, which is precisely what a user
 * opens a second terminal to avoid. Hidden-not-destroyed also means a command keeps running while you
 * work in another tab, which is the whole point of having more than one. (The shell itself survives
 * even a real unmount — ShellTerminal reattaches by shellId — so leaving Code Studio does not kill an
 * install. Only the ✕ below kills a shell on purpose.)
 *
 * Closing the LAST terminal closes the panel (there is nothing left to show), matching VS Code.
 */
export interface TerminalPanelProps {
  workspaceId?: string;
  userId?: string;
  email?: string;
  /** Close the whole panel — called when the last session is closed. */
  onClose: () => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

interface Session { id: string; label: string }

let seq = 0;
const nextSession = (): Session => {
  seq += 1;
  return { id: `t${Date.now()}_${seq}`, label: `Terminal ${seq}` };
};

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  workspaceId, userId, email, onClose, isMaximized, onToggleMaximize,
}) => {
  const [sessions, setSessions] = useState<Session[]>(() => [nextSession()]);
  const [activeId, setActiveId] = useState<string>(() => '');
  const [listOpen, setListOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // First mount: make the initial session active.
  useEffect(() => { if (!activeId && sessions[0]) setActiveId(sessions[0].id); }, [activeId, sessions]);

  // Click-away / Escape closes the dropdown.
  useEffect(() => {
    if (!listOpen) return;
    const away = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setListOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setListOpen(false); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [listOpen]);

  const addSession = () => {
    const s = nextSession();
    setSessions((cur) => [...cur, s]);
    setActiveId(s.id);
    setListOpen(false);
  };

  const closeSession = (id: string) => {
    // Closing a terminal is the ONE moment a shell should die on purpose — a tab switch or a
    // navigation must never kill a running build, so the kill lives here and not in an unmount.
    void closeShellSession(id, workspaceId, userId, email);
    setSessions((cur) => {
      const next = cur.filter((s) => s.id !== id);
      if (next.length === 0) { onClose(); return cur; } // last one closed → the panel goes away
      if (id === activeId) setActiveId(next[next.length - 1].id);
      return next;
    });
  };

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-white">
      {/* One shared header for every session */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-black uppercase tracking-widest text-[#8b949e] flex items-center gap-1.5 shrink-0">
            <TerminalIcon className="w-3.5 h-3.5 text-indigo-400" />
            {active?.label ?? 'Terminal'}
          </span>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setListOpen((v) => !v)}
              title="Terminals — switch, add or close"
              aria-label="Terminals"
              aria-expanded={listOpen}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest transition-colors ${
                listOpen ? 'bg-white/10 text-white' : 'text-indigo-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Plus className="w-3 h-3" />
              New
              <ChevronDown className="w-3 h-3 opacity-60" />
              {sessions.length > 1 && (
                <span className="ml-0.5 px-1 rounded bg-indigo-500/20 text-indigo-300 text-[9px]">{sessions.length}</span>
              )}
            </button>

            {listOpen && (
              <div className="absolute left-0 top-full mt-1 min-w-[220px] bg-[#1c2128] border border-white/10 rounded-lg shadow-2xl shadow-black/50 py-1 z-[9998]">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`group flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] cursor-pointer transition-colors ${
                      s.id === activeId ? 'text-white bg-white/5' : 'text-white/75 hover:bg-indigo-600 hover:text-white'
                    }`}
                    onClick={() => { setActiveId(s.id); setListOpen(false); }}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <TerminalIcon className="w-3 h-3 shrink-0 opacity-70" />
                      {s.label}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); closeSession(s.id); }}
                      title={`Close ${s.label}`}
                      aria-label={`Close ${s.label}`}
                      className="p-0.5 rounded text-white/40 hover:text-white hover:bg-white/15 shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <div className="h-px bg-white/10 my-1 mx-2" />
                <button
                  onClick={addSession}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-indigo-300 hover:bg-indigo-600 hover:text-white transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  New Terminal
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onToggleMaximize && (
            <button onClick={onToggleMaximize} className="p-1 text-[#8b949e] hover:text-white hover:bg-white/5 rounded" aria-label="Toggle maximize">
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
          <button onClick={onClose} className="p-1 text-[#8b949e] hover:text-white hover:bg-white/5 rounded" aria-label="Close terminal panel">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Every session stays MOUNTED — hidden, never destroyed — so scrollback, history and any
          running command survive switching away. */}
      <div className="flex-1 min-h-0 relative">
        {sessions.map((s) => (
          <div key={s.id} className={`absolute inset-0 ${s.id === activeId ? '' : 'hidden'}`}>
            <ShellTerminal
              sessionKey={s.id}
              active={s.id === activeId}
              workspaceId={workspaceId}
              userId={userId}
              email={email}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
