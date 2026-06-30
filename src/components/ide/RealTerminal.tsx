import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal as TerminalIcon, X, Maximize2, Minimize2, Loader2 } from 'lucide-react';
import { auth } from '../../App';

/**
 * REAL Code Studio terminal — runs each command in the user's own warm v3.0 sandbox via
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
}

type Line = { kind: 'cmd' | 'out' | 'err' | 'info'; text: string };

const PROMPT = '$';

export const RealTerminal: React.FC<RealTerminalProps> = ({ workspaceId, userId, email, onClose, isMaximized, onToggleMaximize }) => {
  const [lines, setLines] = useState<Line[]>([
    { kind: 'info', text: 'NavBharatAI terminal — runs real commands in your v3.0 sandbox (e.g. ls, cat package.json, npm run build). Each command is bounded by a 30s timeout.' },
  ]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number>(-1);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines, running]);

  const append = (next: Line[]) => setLines((cur) => [...cur, ...next]);

  const run = useCallback(async (command: string) => {
    const cmd = command.trim();
    if (!cmd) return;
    setHistory((h) => [...h, cmd]);
    setHistIdx(-1);
    append([{ kind: 'cmd', text: `${PROMPT} ${cmd}` }]);
    if (cmd === 'clear') { setLines([]); return; }
    if (!workspaceId || !userId) {
      append([{ kind: 'err', text: 'Sandbox not active — sign in and start a build in NavBharatAI Pro v3.0 to activate the terminal.' }]);
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
        append([{ kind: 'err', text: 'Sandbox not active in this session — start or continue a build in v3.0 to bring it up, then try again.' }]);
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

      <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-2 font-mono text-[11px] leading-relaxed select-text">
        {lines.map((l, i) => (
          <div key={i} className={`${colorFor(l.kind)} whitespace-pre-wrap break-words`}>{l.text}</div>
        ))}
        {running && <div className="flex items-center gap-1.5 text-amber-400 text-[10px] py-0.5"><Loader2 className="w-3 h-3 animate-spin" /> running…</div>}
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
