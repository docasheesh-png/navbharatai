import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, ShieldCheck, Play, Search, 
  Download, History, AlertTriangle, Info, 
  Bug, Lock, FileCode, CheckCircle2, Loader2,
  RefreshCcw, Globe, Terminal, Shield, ChevronUp, ChevronDown
} from 'lucide-react';
import type { ScanFinding } from '../../server/lib/securityScan';
import { TirangaLoader } from '../ui/TirangaLoader';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { deliverTextFile } from '../../lib/downloadFile';

interface SecurityFinding {
  id: string;
  name: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
  file: string;
  line: number;
  explanation: string;
  threatActorContext: string;
  fix: string;
}

interface SecurityScanProps {
  files: Record<string, string>;
  userKeys?: { gemini: string };
}

export const SecurityScan: React.FC<SecurityScanProps> = ({ files, userKeys }) => {
  const [target, setTarget] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>('');
  const [report, setReport] = useState<string | null>(null);
  const [history, setHistory] = useState<{ date: string; target: string }[]>([]);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  /**
   * THE PROGRESS IS THE SERVER'S, NOT A TIMER (admin 2026-08-21: "isko asli bana do").
   *
   * What was here: five hardcoded strings — "Phase 3: Static Analysis (SAST) Patterns…" — walked on a
   * 1.5s `setInterval`, pushing the bar to 95% while the server did ONE AI call. No static analysis
   * ever ran. A user watching those phases scroll past reasonably believed their code had been
   * scanned; it had not. That is why this was not fixed by relabelling the bar.
   *
   * The route now performs three real stages and streams one event per stage AS IT FINISHES. The bar
   * moves only on those events, so its percentage is a count of work genuinely completed.
   */
  const [stages, setStages] = useState<Array<{ id: string; label: string; state: 'waiting' | 'done' | 'failed'; found?: number; error?: string }>>([]);
  const [findings, setFindings] = useState<ScanFinding[]>([]);
  const [verdict, setVerdict] = useState('');

  const performScan = async () => {
    setIsScanning(true);
    setProgress(0);
    setReport(null);
    setFindings([]);
    setVerdict('');
    setStages([]);
    setStatus('Starting…');

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (userKeys?.gemini) headers['x-gemini-key'] = userKeys.gemini;

      const response = await fetch('/api/security/scan', {
        method: 'POST',
        headers,
        body: JSON.stringify({ target, files }),
      });

      if (!response.ok || !response.body) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Scan failed');
      }

      // Newline-delimited JSON: one event per line, read as it arrives. A partial line is kept in the
      // buffer — a chunk boundary can land in the middle of an event, and parsing that would drop it.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawDone = false;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: any;
          try { ev = JSON.parse(line); } catch { continue; }

          if (ev.type === 'start') {
            setStages(ev.stages.map((s: { id: string; label: string }) => ({ ...s, state: 'waiting' as const })));
            setStatus(ev.stages[0]?.label ?? 'Scanning…');
          } else if (ev.type === 'stage') {
            setStages((prev) => {
              const next = prev.map((s) => s.id === ev.id
                ? { ...s, state: (ev.ok ? 'done' : 'failed') as 'done' | 'failed', found: ev.found, error: ev.error }
                : s);
              const upcoming = next.find((s) => s.state === 'waiting');
              setStatus(upcoming ? upcoming.label : 'Finishing…');
              return next;
            });
            // The ONLY thing that moves the bar: a stage the server says has finished.
            setProgress((ev.done / ev.total) * 100);
          } else if (ev.type === 'done') {
            sawDone = true;
            setFindings(Array.isArray(ev.findings) ? ev.findings : []);
            setVerdict(String(ev.verdict || ''));
            setReport(ev.reviewOk
              ? ev.reply
              : `### ⚠️ The security review could not run\n${ev.reviewError || 'It was unavailable.'}\n\nThe automatic checks above still ran and their findings are real.`);
            setHistory((prev) => [{ date: new Date().toLocaleString(), target }, ...prev].slice(0, 10));
          } else if (ev.type === 'failed') {
            sawDone = true;
            setReport(`### ❌ Security Scan Failed\n${ev.error || 'An error occurred.'}`);
          }
        }
      }

      // The stream ended without a verdict: the connection dropped mid-scan. Say so, rather than
      // leaving a half-filled bar that looks like a finished scan with nothing found.
      if (!sawDone) {
        setReport('### ❌ Security Scan Failed\nThe connection ended before the scan finished. Please try again.');
      }
    } catch (error: any) {
      console.error(error);
      setReport(`### ❌ Security Scan Failed\n${error.message || 'An error occurred while communicating with the Security Auditor.'}`);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className={cn("flex flex-col h-full overflow-hidden transition-colors", theme === 'dark' ? "bg-[#0d1117]" : "bg-gray-50")}>
      {/* Scan Header */}
      <div className={cn(
        "border-b transition-all duration-300 relative overflow-hidden",
        theme === 'dark' ? "border-white/5 bg-[#161b22]" : "border-gray-200 bg-white",
        isHeaderCollapsed ? "p-1 md:p-1.5 px-2.5 md:px-8" : "p-2 md:p-8"
      )}>
        <div className={cn(
          "relative z-10 flex flex-col md:flex-row md:items-center justify-between transition-all duration-300",
          isHeaderCollapsed ? "gap-1" : "gap-2 md:gap-6"
        )}>
          <div className="flex items-center justify-between w-full md:w-auto">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className={cn("text-indigo-500 transition-all", isHeaderCollapsed ? "w-3 h-3 md:w-4 md:h-4" : "w-5 h-5 md:w-8 md:h-8")} />
                <span className={cn("font-bold", theme === 'dark' ? "text-white" : "text-gray-900")}>
                  {!isHeaderCollapsed ? "Security Auditor Hub" : "Auditor"}
                </span>
              </div>
              <button
                  onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
                  className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all shadow-lg", 
                    theme === 'dark' ? "bg-white/5 text-white hover:bg-white/10" : "bg-gray-200 text-gray-900 hover:bg-gray-300"
                  )}
              >{theme === 'dark' ? 'Light' : 'Dark'} Mode</button>
            </div>
            <button 
              onClick={() => setIsHeaderCollapsed(!isHeaderCollapsed)}
              className="p-1 hover:bg-white/5 rounded-lg text-[#8b949e] transition-colors"
            >
              {isHeaderCollapsed ? <ChevronDown className="w-3.5 h-3.5 md:w-5 md:h-5" /> : <ChevronUp className="w-4 h-4 md:w-5 md:h-5" />}
            </button>
          </div>
          
          <div className={cn(
            "flex items-center gap-2 transition-all",
            isHeaderCollapsed ? "md:flex-1 md:justify-end flex-row w-full md:w-auto" : "flex-wrap w-full md:w-auto"
          )}>
            <div className={cn("relative transition-all", isHeaderCollapsed ? "flex-1 md:max-w-[340px]" : "flex-1 md:w-64")}>
              <Globe className={cn("absolute left-2.5 top-1/2 -translate-y-1/2 text-[#484f58]", isHeaderCollapsed ? "w-2.5 h-2.5" : "w-4 h-4")} />
              <input 
                value={target}
                placeholder="Target URL / Domain / System Link to Scan..."
                onChange={(e) => setTarget(e.target.value)}
                className={cn(
                  "w-full border rounded-lg md:rounded-2xl text-[9px] md:text-xs font-bold outline-none focus:border-indigo-500 transition-all placeholder:font-normal",
                  theme === 'dark' ? "bg-black/40 border-white/10 text-white placeholder:text-[#30363d]" : "bg-white border-gray-300 text-gray-900 placeholder:text-gray-400",
                  isHeaderCollapsed ? "py-1 pl-7 pr-2" : "py-2 md:py-3 pl-8 md:pl-11 pr-4"
                )}
              />
            </div>
            <button 
              onClick={performScan}
              disabled={isScanning}
              className={cn(
                "rounded-lg md:rounded-2xl text-[8px] md:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1 border border-white/10",
                isHeaderCollapsed ? "px-2.5 py-1" : "px-4 md:px-8 py-2 md:py-3",
                isScanning ? "bg-indigo-600/50 text-white cursor-not-allowed" : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-600/20 active:scale-95"
              )}
            >
              {isScanning ? <TirangaLoader className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5 fill-current" />}
              <span className={isHeaderCollapsed ? "hidden md:inline" : ""}>
                {isScanning ? 'Scanning...' : 'Start Audit'}
              </span>
            </button>
          </div>
        </div>
        
        {/* Animated Grid Background */}
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-8 space-y-8">
        {/* Progress Display */}
        <AnimatePresence>
          {isScanning && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                   <TirangaLoader className="w-4 h-4" />
                   <span className="text-xs font-black uppercase tracking-widest text-[#8b949e]">{status}</span>
                </div>
                <span className={cn("text-xs font-bold", theme === 'dark' ? "text-white" : "text-gray-900")}>{Math.round(progress)}%</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400"
                />
              </div>

              {/* The REAL stages, named by the server that runs them. A stage says "waiting" until it
                  genuinely finishes — and if it fails, it says that instead of quietly disappearing. */}
              <div className="space-y-1.5">
                {stages.map((st) => (
                  <div key={st.id} className="flex items-center gap-2 text-[11px]">
                    <span className={cn(
                      'w-4 shrink-0 text-center',
                      st.state === 'done' ? 'text-emerald-400' : st.state === 'failed' ? 'text-amber-400' : 'text-white/25',
                    )}>
                      {st.state === 'done' ? '✓' : st.state === 'failed' ? '!' : '·'}
                    </span>
                    <span className={cn(st.state === 'waiting' ? 'text-white/35' : theme === 'dark' ? 'text-white/80' : 'text-gray-700')}>
                      {st.label}
                    </span>
                    {st.state === 'done' && typeof st.found === 'number' && (
                      <span className={cn('ml-auto font-bold', st.found > 0 ? 'text-amber-300' : 'text-emerald-400')}>
                        {st.found > 0 ? `${st.found} found` : 'clear'}
                      </span>
                    )}
                    {st.state === 'failed' && <span className="ml-auto text-amber-300">could not run</span>}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#484f58] flex items-center gap-2">
                Scan Report
              </h3>
              <div className="flex items-center gap-2">
                 {/* WAS TWO DEAD BUTTONS, "JSON" and "PDF" (admin 2026-08-21) — neither had an
                     onClick, so a user who scanned their app and pressed either got nothing.
                     Neither format was honest to offer, which is the deeper reason they were never
                     wired: the scan returns `data.reply`, a MARKDOWN STRING. There is no structured
                     findings object to serialise as JSON (wrapping the same markdown in a JSON
                     envelope names a format without providing one), and nothing here can generate a
                     PDF — that needs a renderer this app does not ship.

                     So the report is offered as what it actually IS: markdown. `deliverTextFile`
                     is the existing iOS-safe path (the `<a download>` trick silently saves nothing
                     on iOS Safari — the admin hit that on iPhone in 2026-07), so this really lands
                     on a phone as well as a desktop. Disabled until a report exists, because there
                     is nothing to save before then. */}
                 <button
                    onClick={() => {
                      if (!report) return;
                      const slug = (target || 'app').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'app';
                      const stamp = new Date().toISOString().slice(0, 10);
                      void deliverTextFile(`security-scan-${slug}-${stamp}.md`, report, 'text/markdown');
                    }}
                    disabled={!report}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 rounded-lg text-[10px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[#8b949e]"
                 >
                    <Download className="w-3.5 h-3.5" /> Download Report
                 </button>
              </div>
            </div>

            {/* THE DETERMINISTIC FINDINGS — shown ABOVE the AI review, and separately from it.
                These come from a scanner that reads the actual files: every one has a real file and
                line, and none of them can be invented. Keeping them apart from the AI's prose is the
                point — a reader can tell which part of this report is a measurement and which part is
                an opinion. The verdict line says how many of the checks completed, so "no issues" from
                a scan that lost a stage can never read like a clean bill of health. */}
            {verdict && !isScanning && (
              <div className={cn('border rounded-3xl p-5 transition-colors', theme === 'dark' ? 'bg-[#161b22] border-white/5' : 'bg-white border-gray-200')}>
                <p className={cn('text-sm font-black', findings.length ? 'text-amber-300' : 'text-emerald-400')}>{verdict}</p>
                {findings.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {findings.slice(0, 40).map((f, i) => (
                      <div key={`${f.file}:${f.line}:${i}`} className="rounded-xl border border-white/5 bg-black/20 p-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn(
                            'text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border',
                            f.severity === 'critical' ? 'border-rose-500/40 text-rose-300'
                              : f.severity === 'high' ? 'border-amber-500/40 text-amber-300'
                              : 'border-white/15 text-white/50',
                          )}>{f.severity}</span>
                          <span className="text-[11px] font-mono text-[#8b949e] break-all">{f.file}:{f.line}</span>
                        </div>
                        <p className={cn('text-xs mt-1.5', theme === 'dark' ? 'text-white' : 'text-gray-900')}>{f.problem}</p>
                        <p className="text-[11px] text-[#8b949e] mt-1">{f.suggestion}</p>
                      </div>
                    ))}
                    {findings.length > 40 && (
                      <p className="text-[11px] text-[#8b949e]">…and {findings.length - 40} more.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {!report && !isScanning ? (
              <div className={cn("border rounded-3xl p-12 text-center space-y-4 transition-colors", theme === 'dark' ? "bg-[#161b22] border-white/5" : "bg-white border-gray-200 shadow-sm")}>
                 <div className={cn("w-16 h-16 rounded-full flex items-center justify-center mx-auto", theme === 'dark' ? "bg-white/5" : "bg-gray-100")}>
                    <ShieldCheck className={cn("w-8 h-8", theme === 'dark' ? "text-[#484f58]" : "text-gray-400")} />
                 </div>
                 <h4 className={cn("font-bold", theme === 'dark' ? "text-white" : "text-gray-900")}>Ready for Audit</h4>
                 <p className={cn("text-sm max-w-xs mx-auto", theme === 'dark' ? "text-[#8b949e]" : "text-gray-600")}>Enter a target URL or project path to start a defensive security audit.</p>
              </div>
            ) : report ? (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("border rounded-3xl p-8 prose prose-invert prose-xs max-w-none transition-colors", 
                  theme === 'dark' ? "bg-[#161b22] border-white/5" : "bg-white border-gray-200"
                )}
              >
                <div className={cn("markdown-body", theme === 'light' && "text-gray-900")}>
                  <Markdown>{report}</Markdown>
                </div>
              </motion.div>
            ) : (
              <div className={cn("border rounded-3xl p-12 text-center space-y-4 transition-colors", theme === 'dark' ? "bg-[#161b22] border-white/5" : "bg-white border-gray-200 shadow-sm")}>
                 <TirangaLoader className="w-12 h-12 mx-auto" />
                 <h4 className={cn("font-bold uppercase tracking-widest", theme === 'dark' ? "text-white" : "text-gray-900")}>Auditing In Progress</h4>
                 <p className="text-[#8b949e] text-[10px] font-black uppercase">Executing Defensive Protocols...</p>
              </div>
            )}
          </div>

          <div className="space-y-8">
            <div className={cn("border rounded-3xl p-6 space-y-6 transition-colors", theme === 'dark' ? "bg-[#161b22] border-white/5" : "bg-white border-gray-200 shadow-sm")}>
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#484f58]">Auditor Status</h3>
              <div className="space-y-4">
                 <div className={cn("flex items-center justify-between p-3 rounded-xl border transition-colors", theme === 'dark' ? "bg-black/40 border-white/5" : "bg-gray-50 border-gray-200")}>
                    <span className="text-[10px] font-black text-[#8b949e] uppercase">Identity</span>
                    <span className="text-xs font-bold text-indigo-400">Security Auditor</span>
                 </div>
                 <div className={cn("flex items-center justify-between p-3 rounded-xl border transition-colors", theme === 'dark' ? "bg-black/40 border-white/5" : "bg-gray-50 border-gray-200")}>
                    <span className="text-[10px] font-black text-[#8b949e] uppercase">Specialization</span>
                    <span className="text-xs font-bold text-emerald-400">Defensive Ops</span>
                 </div>
                 <div className={cn("flex items-center justify-between p-3 rounded-xl border transition-colors", theme === 'dark' ? "bg-black/40 border-white/5" : "bg-gray-50 border-gray-200")}>
                    <span className="text-[10px] font-black text-[#8b949e] uppercase">Mode</span>
                    <span className="text-xs font-bold text-emerald-500">Autonomous</span>
                 </div>
              </div>
            </div>

            <div className={cn("border rounded-3xl p-6 space-y-6 transition-colors", theme === 'dark' ? "bg-[#161b22] border-white/5" : "bg-white border-gray-200 shadow-sm")}>
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#484f58]">Audit History</h3>
              <div className="space-y-3">
                 {history.length > 0 ? history.map((h, i) => (
                    <div key={i} className={cn("flex items-center justify-between p-3 rounded-xl border transition-colors group", theme === 'dark' ? "bg-black/20 border-white/5" : "bg-gray-50 border-gray-200")}>
                       <div className="flex flex-col overflow-hidden">
                          <span className={cn("text-[10px] font-bold truncate", theme === 'dark' ? "text-white" : "text-gray-900")}>{h.target}</span>
                          <span className="text-[8px] text-[#484f58] uppercase font-black">{h.date}</span>
                       </div>
                       <History className="w-3.5 h-3.5 text-[#484f58] group-hover:text-white transition-colors flex-shrink-0" />
                    </div>
                 )) : (
                    <div className="text-center py-4 text-[10px] text-[#484f58] font-bold uppercase">No history found</div>
                 )}
              </div>
            </div>

            <div className="p-6 bg-indigo-600 rounded-3xl relative overflow-hidden group hover:scale-[1.02] transition-transform cursor-pointer">
               <div className="relative z-10 space-y-3">
                  <Shield className="w-8 h-8 text-white/50" />
                  <h4 className="text-white font-black uppercase tracking-tighter">Security Lab</h4>
                  <p className="text-white/80 text-[10px] font-medium leading-relaxed">Learn about defensive security patterns and harden your infrastructure.</p>
               </div>
               <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-white/10 rounded-full group-hover:scale-150 transition-transform"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
