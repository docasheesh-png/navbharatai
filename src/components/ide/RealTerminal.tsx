import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal as TerminalIcon, X, Maximize2, Minimize2, Loader2 } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { auth } from '../../App';

/**
 * REAL Code Studio terminal — runs each command in the user's own warm v5.0 sandbox via
 * POST /api/agentv3/exec (bounded: hard timeout + capped output, server-side). No simulated output:
 * every line shown is the actual stdout/stderr the sandbox produced. When the sandbox isn't warm,
 * it says so honestly and tells the user to start/continue a build — it never fakes a result.
 */
export interface RealTerminalProps {
  workspaceId?: string;
  userId?: string;
  email?: string;
  onClose: () => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  /** Hide this terminal's OWN header row. Set by TerminalPanel, which draws one shared header for all
   *  sessions (title + tab dropdown + maximize + close) instead of one per terminal. */
  hideHeader?: boolean;
  /** Auto-focus the input when this session becomes the visible one (multi-terminal switching). */
  autoFocus?: boolean;
}

type Line = { kind: 'cmd' | 'out' | 'err' | 'info'; text: string };

const PROMPT = '$';

export const RealTerminal: React.FC<RealTerminalProps> = ({ workspaceId, userId, email, onClose, isMaximized, onToggleMaximize, hideHeader, autoFocus }) => {
  const [lines, setLines] = useState<Line[]>([
    { kind: 'info', text: 'NavBharatAI terminal — runs real commands in your v5.0 sandbox (e.g. ls, cat package.json, npm run build). Each command is bounded by a 30s timeout.' },
  ]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number>(-1);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines, running]);
  useEffect(() => { if (autoFocus) setTimeout(() => inputRef.current?.focus(), 0); }, [autoFocus]);

  const append = (next: Line[]) => setLines((cur) => [...cur, ...next]);

  const run = useCallback(async (command: string) => {
    const cmd = command.trim();
    if (!cmd) return;
    setHistory((h) => [...h, cmd]);
    setHistIdx(-1);
    append([{ kind: 'cmd', text: `${PROMPT} ${cmd}` }]);
    if (cmd === 'clear') { setLines([]); return; }
    if (!workspaceId || !userId) {
      append([{ kind: 'err', text: 'Sandbox not active — sign in and start a build in NavBharatAI Pro v5.0 to activate the terminal.' }]);
      return;
    }
    setRunning(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try { const tok = await auth.currentUser?.getIdToken(); if (tok) headers.Authorization = `Bearer ${tok}`; } catch { /* token optional */ }
      const res = await fetch('/api/agentv3/exec', {
        method: 'POST',
        headers,
        body: JSON.stringify({ workspaceId, userId, email: email || '', command: cmd }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j) {
        append([{ kind: 'err', text: j?.error || `Request failed (${res.status}).` }]);
      } else if (j.available === false) {
        // Honest dormant state — not a dead-end. A cold Cloud Run instance (min-instances=0) loses the
        // live sandbox, but the project's files are durably saved. Match the git panel's calm copy:
        // sending a message in v5.0 chat re-warms the sandbox, then the terminal works again.
        const msg = j.reason === 'dormant'
          ? `Workspace is dormant after a restart — your ${j.savedFileCount} saved file${j.savedFileCount === 1 ? '' : 's'} ${j.savedFileCount === 1 ? 'is' : 'are'} safe. Send a message in NavBharatAI Pro v5.0 chat to bring the sandbox back online, then the terminal works again.`
          : 'Sandbox not active yet — start a build in NavBharatAI Pro v5.0 chat to bring the terminal online.';
        append([{ kind: 'info', text: msg }]);
      } else {
        if (j.stdout) append([{ kind: 'out', text: String(j.stdout).replace(/\n$/, '') }]);
        if (j.stderr) append([{ kind: 'err', text: String(j.stderr).replace(/\n$/, '') }]);
        if (j.timedOut) append([{ kind: 'err', text: '⏱️ Command stopped at the 30s limit.' }]);
        if (!j.stdout && !j.stderr && !j.timedOut) append([{ kind: 'info', text: `(no output) — exit code ${j.exitCode}` }]);
      }
    } catch {
      append([{ kind: 'err', text: 'Network error — could not reach the sandbox.' }]);
    } finally {
      setRunning(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [workspaceId, userId, email]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !running) { const c = input; setInput(''); void run(c); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const idx = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx); setInput(history[idx] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx < 0) return;
      const idx = histIdx + 1;
      if (idx >= history.length) { setHistIdx(-1); setInput(''); } else { setHistIdx(idx); setInput(history[idx] ?? ''); }
    }
  };

  const colorFor = (k: Line['kind']) => k === 'cmd' ? 'text-white' : k === 'err' ? 'text-red-400' : k === 'info' ? 'text-[#8b949e]' : 'text-[#4af626]/90';

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-white" onClick={() => inputRef.current?.focus()}>
      {!hideHeader && (
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 shrink-0">
        <span className="text-[10px] font-black uppercase tracking-widest text-[#8b949e] flex items-center gap-1.5">
          <TerminalIcon className="w-3.5 h-3.5 text-indigo-400" />
          Terminal
        </span>
        <div className="flex items-center gap-1">
          {onToggleMaximize && (
            <button onClick={onToggleMaximize} className="p-1 text-[#8b949e] hover:text-white hover:bg-white/5 rounded" aria-label="Toggle maximize">
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
          <button onClick={onClose} className="p-1 text-[#8b949e] hover:text-white hover:bg-white/5 rounded" aria-label="Close terminal">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-2 font-mono text-[11px] leading-relaxed select-text">
        {lines.map((l, i) => (
          <div key={i} className={`${colorFor(l.kind)} whitespace-pre-wrap break-words`}>{l.text}</div>
        ))}
        {running && <div className="flex items-center gap-1.5 text-amber-400 text-[10px] py-0.5"><TirangaLoader className="w-3 h-3" /> running…</div>}
        <div ref={endRef} />
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-white/5 shrink-0 font-mono text-[11px]">
        <span className="text-[#4af626] shrink-0">{PROMPT}</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={running ? '' : 'type a command (e.g. ls, npm run build) and press Enter'}
          className="flex-1 bg-transparent outline-none text-white placeholder-[#484f58] disabled:opacity-50"
        />
      </div>
    </div>
  );
};
