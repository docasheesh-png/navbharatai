import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap,
  Copy,
  Download,
  Check,
  Trash2,
  Clipboard,
  ChevronDown,
  ChevronRight,
  History,
  RotateCcw,
  Wand2,
  GitMerge,
  Code2,
} from 'lucide-react';
import { resolveAppSource } from '../../lib/workspaceSource';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CodeMinifierProps {
  generatedCode?: string;
  /** The v5-synced workspace files — the real app source when the preview isn't bundled. */
  files?: Record<string, string>;
  onOptimized?: (code: string) => void;
}

type CodeType = 'html' | 'css' | 'js' | 'all';

interface HTMLOpts {
  removeComments: boolean;
  removeWhitespace: boolean;
  removeEmptyAttributes: boolean;
  inlineCSS: boolean;
  minifyInlineCSS: boolean;
  minifyInlineJS: boolean;
}

interface CSSOptions {
  removeComments: boolean;
  removeWhitespace: boolean;
  collapseShorthand: boolean;
  removeUnusedSelectors: boolean;
  normalizeColors: boolean;
}

interface JSOptions {
  removeComments: boolean;
  removeWhitespace: boolean;
  renameVariables: boolean;
  removeConsoleLog: boolean;
  removeDebugger: boolean;
}

interface AdvancedOptions {
  gzipEstimation: boolean;
  addSourceMapComment: boolean;
}

interface HistoryEntry {
  id: string;
  timestamp: number;
  codeType: CodeType;
  originalSize: number;
  minifiedSize: number;
  reduction: number;
  code: string;
}

// ─── Pure Minification Functions ──────────────────────────────────────────────

function minifyCSS(css: string, opts: CSSOptions): string {
  let out = css;
  if (opts.removeComments) out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  if (opts.removeWhitespace)
    out = out
      .replace(/\s+/g, ' ')
      .replace(/\s*([{}:;,>+~])\s*/g, '$1')
      .replace(/;}/g, '}');
  if (opts.normalizeColors)
    out = out.replace(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g, (_, r, g, b) => {
      const hex = [r, g, b]
        .map((v: string) => parseInt(v).toString(16).padStart(2, '0'))
        .join('');
      return `#${hex}`;
    });
  return out.trim();
}

function minifyJS(js: string, opts: JSOptions): string {
  let out = js;
  if (opts.removeComments) {
    out = out.replace(/\/\/[^\n]*/g, '');
    out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  }
  if (opts.removeConsoleLog) out = out.replace(/console\.\w+\([^)]*\);?/g, '');
  if (opts.removeDebugger) out = out.replace(/debugger;?/g, '');
  if (opts.removeWhitespace)
    out = out
      .replace(/\s+/g, ' ')
      .replace(/\s*([=+\-*/{};:,()])\s*/g, '$1');
  return out.trim();
}

function minifyHTML(html: string, htmlOpts: HTMLOpts, cssOpts: CSSOptions, jsOpts: JSOptions): string {
  let out = html;
  if (htmlOpts.removeComments) out = out.replace(/<!--[\s\S]*?-->/g, '');
  // removeEmptyAttributes — real now (was a no-op checkbox, admin autopsy 2026-07-21): strip
  // attributes whose value is an empty string (e.g. class="" alt='').
  if (htmlOpts.removeEmptyAttributes) out = out.replace(/\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*=(?:""|'')/g, '');
  if (htmlOpts.minifyInlineCSS)
    out = out.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) =>
      `<style>${minifyCSS(css, cssOpts)}</style>`
    );
  if (htmlOpts.minifyInlineJS)
    out = out.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (_, js) =>
      `<script>${minifyJS(js, jsOpts)}</script>`
    );
  if (htmlOpts.removeWhitespace)
    out = out.replace(/\s+/g, ' ').replace(/>\s+</g, '><');
  return out.trim();
}

function autoDetect(code: string): CodeType {
  if (/<html|<!doctype/i.test(code)) return 'html';
  if (/{[\s\S]*?}/.test(code) && !/function|var |let |const |=>/.test(code)) return 'css';
  if (/function|var |let |const |=>|console\./.test(code)) return 'js';
  return 'all';
}

function estimateGzip(str: string): number {
  // rough heuristic: gzip is usually ~30-40% of original for code
  return Math.round(str.length * 0.35);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function beautifyCode(code: string, type: CodeType): string {
  // Simple beautifier — expand single-line CSS/JS braces
  if (type === 'css') {
    return code
      .replace(/\s*{\s*/g, ' {\n  ')
      .replace(/;\s*/g, ';\n  ')
      .replace(/\s*}\s*/g, '\n}\n')
      .trim();
  }
  if (type === 'js') {
    return code
      .replace(/;\s*/g, ';\n')
      .replace(/\s*{\s*/g, ' {\n  ')
      .replace(/\s*}\s*/g, '\n}\n')
      .trim();
  }
  // HTML: add newlines after closing tags
  return code.replace(/></g, '>\n<').trim();
}

const HISTORY_KEY = 'navbharatai_minifier_history';

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 5)));
}

// ─── Component ────────────────────────────────────────────────────────────────

export const CodeMinifier: React.FC<CodeMinifierProps> = ({ generatedCode, files, onOptimized }) => {
  // Seed the editor with the REAL app source (admin autopsy 2026-07-21): prefer the bundled preview,
  // else the workspace index.html; the "Waiting for magic…" placeholder is treated as empty so the
  // user starts from their actual code (or a blank editor to paste into) — not the placeholder.
  const initialSource = resolveAppSource(generatedCode, files);
  const [inputCode, setInputCode] = useState(initialSource.html);
  const [outputCode, setOutputCode] = useState('');
  const [codeType, setCodeType] = useState<CodeType>('all');
  const [copied, setCopied] = useState(false);
  const [usedCode, setUsedCode] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  const [htmlOpts, setHtmlOpts] = useState<HTMLOpts>({
    removeComments: true,
    removeWhitespace: true,
    removeEmptyAttributes: true,
    inlineCSS: false,
    minifyInlineCSS: true,
    minifyInlineJS: true,
  });

  const [cssOpts, setCssOpts] = useState<CSSOptions>({
    removeComments: true,
    removeWhitespace: true,
    collapseShorthand: true,
    removeUnusedSelectors: false,
    normalizeColors: true,
  });

  const [jsOpts, setJsOpts] = useState<JSOptions>({
    removeComments: true,
    removeWhitespace: true,
    renameVariables: false,
    removeConsoleLog: true,
    removeDebugger: true,
  });

  const [advOpts, setAdvOpts] = useState<AdvancedOptions>({
    gzipEstimation: false,
    addSourceMapComment: false,
  });

  useEffect(() => {
    const resolved = resolveAppSource(generatedCode, files);
    if (resolved.html) setInputCode(resolved.html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedCode, files]);

  const originalSize = new Blob([inputCode]).size;
  const minifiedSize = outputCode ? new Blob([outputCode]).size : 0;
  const savedBytes = originalSize - minifiedSize;
  const reductionPct = originalSize > 0 ? (savedBytes / originalSize) * 100 : 0;

  const handleMinify = useCallback(() => {
    if (!inputCode.trim()) return;
    const detected = codeType === 'all' ? autoDetect(inputCode) : codeType;
    let result = '';

    if (detected === 'html') result = minifyHTML(inputCode, htmlOpts, cssOpts, jsOpts);
    else if (detected === 'css') result = minifyCSS(inputCode, cssOpts);
    else result = minifyJS(inputCode, jsOpts);


    setOutputCode(result);

    const entry: HistoryEntry = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      codeType: detected,
      originalSize: new Blob([inputCode]).size,
      minifiedSize: new Blob([result]).size,
      reduction: inputCode.length > 0
        ? ((inputCode.length - result.length) / inputCode.length) * 100
        : 0,
      code: result,
    };
    const updated = [entry, ...history].slice(0, 5);
    setHistory(updated);
    saveHistory(updated);
  }, [inputCode, codeType, htmlOpts, cssOpts, jsOpts, advOpts, history]);

  const handleBeautify = useCallback(() => {
    if (!inputCode.trim()) return;
    const detected = codeType === 'all' ? autoDetect(inputCode) : codeType;
    setOutputCode(beautifyCode(inputCode, detected));
  }, [inputCode, codeType]);

  const handleCopy = useCallback(() => {
    if (!outputCode) return;
    navigator.clipboard.writeText(outputCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [outputCode]);

  const handleDownload = useCallback(() => {
    if (!outputCode) return;
    const ext = codeType === 'css' ? 'css' : codeType === 'js' ? 'js' : 'html';
    const blob = new Blob([outputCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `minified.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [outputCode, codeType]);

  const handleUse = useCallback(() => {
    if (outputCode && onOptimized) {
      onOptimized(outputCode);
      setUsedCode(true);
      setTimeout(() => setUsedCode(false), 2000);
    }
  }, [outputCode, onOptimized]);

  const reductionColor =
    reductionPct > 30
      ? 'text-green-400'
      : reductionPct > 10
      ? 'text-amber-400'
      : 'text-gray-400';

  const diffLines = outputCode
    ? {
        original: inputCode.split('\n').slice(0, 20),
        minified: outputCode.split('\n').slice(0, 20),
      }
    : null;

  // ── Checkbox helpers ──────────────────────────────────────────────────────

  function HtmlCheck({ k, label }: { k: keyof HTMLOpts; label: string }) {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={htmlOpts[k]}
          onChange={(e) => setHtmlOpts((p) => ({ ...p, [k]: e.target.checked }))}
          className="accent-indigo-500"
        />
        {label}
      </label>
    );
  }

  function CssCheck({ k, label }: { k: keyof CSSOptions; label: string }) {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={cssOpts[k]}
          onChange={(e) => setCssOpts((p) => ({ ...p, [k]: e.target.checked }))}
          className="accent-indigo-500"
        />
        {label}
      </label>
    );
  }

  function JsCheck({ k, label }: { k: keyof JSOptions; label: string }) {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={jsOpts[k]}
          onChange={(e) => setJsOpts((p) => ({ ...p, [k]: e.target.checked }))}
          className="accent-indigo-500"
        />
        {label}
      </label>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: '#0d1117', color: '#e6edf3' }}
    >
      {/* ── Top Bar ── */}
      <div
        className="flex flex-wrap items-center gap-2 px-4 py-3 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.1)', background: '#161b22' }}
      >
        <Code2 size={18} className="text-indigo-400 shrink-0" />
        <span className="font-semibold text-sm mr-2 shrink-0">Code Minifier & Optimizer</span>

        {/* Type tabs */}
        <div className="flex rounded-md overflow-hidden border" style={{ borderColor: 'rgba(255,255,255,0.15)' }}>
          {(['all', 'html', 'css', 'js'] as CodeType[]).map((t) => (
            <button
              key={t}
              onClick={() => setCodeType(t)}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                codeType === t
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              style={{ background: codeType === t ? undefined : '#0d1117' }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Action buttons */}
        <button
          onClick={handleMinify}
          disabled={!inputCode.trim()}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Zap size={14} />
          Minify Karo
        </button>
        <button
          onClick={handleBeautify}
          disabled={!inputCode.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Wand2 size={14} />
          Beautify
        </button>
        <button
          onClick={() => { setInputCode(''); setOutputCode(''); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-white/10 hover:bg-white/5 transition-colors"
        >
          <RotateCcw size={14} />
          Reset
        </button>
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-white/10 hover:bg-white/5 transition-colors"
        >
          <History size={14} />
          History
        </button>
      </div>

      {/* ── Stats Bar ── */}
      {outputCode && (
        <div
          className="flex flex-wrap items-center gap-3 px-4 py-2 border-b"
          style={{ borderColor: 'rgba(255,255,255,0.1)', background: '#161b22' }}
        >
          {[
            { label: 'Original', value: formatBytes(originalSize), color: 'text-gray-300' },
            { label: 'Minified', value: formatBytes(minifiedSize), color: 'text-indigo-300' },
            { label: 'Saved', value: formatBytes(savedBytes), color: 'text-blue-300' },
            {
              label: 'Reduction',
              value: `${reductionPct.toFixed(1)}%`,
              color: reductionColor,
            },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="flex items-center gap-2 px-3 py-1 rounded-full border text-xs"
              style={{ borderColor: 'rgba(255,255,255,0.1)', background: '#0d1117' }}
            >
              <span className="text-gray-500">{label}:</span>
              <span className={`font-semibold ${color}`}>{value}</span>
            </div>
          ))}
          {advOpts.gzipEstimation && outputCode && (
            <div
              className="flex items-center gap-2 px-3 py-1 rounded-full border text-xs"
              style={{ borderColor: 'rgba(255,255,255,0.1)', background: '#0d1117' }}
            >
              <span className="text-gray-500">~Gzip:</span>
              <span className="font-semibold text-purple-300">
                {formatBytes(estimateGzip(outputCode))}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Main Body ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: Input ── */}
        <div className="flex flex-col flex-1 border-r overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          <div
            className="flex items-center justify-between px-3 py-2 border-b text-xs text-gray-400"
            style={{ borderColor: 'rgba(255,255,255,0.08)', background: '#161b22' }}
          >
            <span className="font-medium text-gray-300">Input</span>
            <div className="flex items-center gap-2">
              <span>{inputCode.split('\n').length} lines</span>
              <span>·</span>
              <span>{inputCode.length} chars</span>
              <button
                onClick={() =>
                  navigator.clipboard.readText().then((t) => setInputCode(t)).catch(() => {})
                }
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-white/10 hover:bg-white/5 transition-colors"
              >
                <Clipboard size={11} />
                Paste
              </button>
              <button
                onClick={() => setInputCode('')}
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-white/10 hover:bg-white/5 transition-colors"
              >
                <Trash2 size={11} />
                Clear
              </button>
            </div>
          </div>
          <textarea
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value)}
            placeholder="Yahan apna HTML / CSS / JS paste karo..."
            spellCheck={false}
            className="flex-1 resize-none p-3 text-xs font-mono leading-relaxed outline-none text-gray-200 placeholder-gray-600"
            style={{ background: '#0d1117' }}
          />
        </div>

        {/* ── Options Panel (middle, collapsible overlay) ── */}
        {/* We render the options as a collapsible in a column between panels only on wide screens; on narrow, it's hidden unless toggled */}

        {/* ── Right: Output ── */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div
            className="flex items-center justify-between px-3 py-2 border-b text-xs text-gray-400"
            style={{ borderColor: 'rgba(255,255,255,0.08)', background: '#161b22' }}
          >
            <span className="font-medium text-gray-300">Output</span>
            {outputCode && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-white/10 hover:bg-white/5 transition-colors"
                >
                  {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-white/10 hover:bg-white/5 transition-colors"
                >
                  <Download size={11} />
                  Download
                </button>
                {onOptimized && (
                  <button
                    onClick={handleUse}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white border-0 transition-colors"
                  >
                    {usedCode ? <Check size={11} /> : <Zap size={11} />}
                    {usedCode ? 'Done!' : 'Use this code'}
                  </button>
                )}
              </div>
            )}
          </div>

          {outputCode ? (
            <pre
              className="flex-1 overflow-auto p-3 text-xs font-mono leading-relaxed text-green-300 whitespace-pre-wrap break-all"
              style={{ background: '#0d1117' }}
            >
              {outputCode}
            </pre>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4" style={{ background: '#0d1117' }}>
              <Zap size={32} className="text-gray-700" />
              <p className="text-sm text-gray-500">
                Left side me code paste karo, phir{' '}
                <span className="text-indigo-400 font-medium">Minify Karo</span> button dabao
              </p>
            </div>
          )}
        </div>

        {/* ── History Sidebar ── */}
        {showHistory && (
          <div
            className="flex flex-col border-l overflow-hidden"
            style={{
              width: 200,
              borderColor: 'rgba(255,255,255,0.1)',
              background: '#161b22',
              minWidth: 200,
            }}
          >
            <div
              className="flex items-center justify-between px-3 py-2 border-b text-xs font-medium text-gray-300"
              style={{ borderColor: 'rgba(255,255,255,0.08)' }}
            >
              <span className="flex items-center gap-1.5">
                <History size={12} />
                History
              </span>
              <button onClick={() => setShowHistory(false)} className="text-gray-500 hover:text-gray-300">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {history.length === 0 ? (
                <p className="text-xs text-gray-600 p-3 text-center">No history yet</p>
              ) : (
                history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => { setOutputCode(h.code); }}
                    className="w-full text-left px-3 py-2 border-b hover:bg-white/5 transition-colors"
                    style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                  >
                    <div className="text-xs text-gray-400 mb-0.5">
                      {new Date(h.timestamp).toLocaleTimeString()}
                    </div>
                    <div className="text-xs text-gray-300 uppercase font-medium mb-0.5">
                      {h.codeType}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatBytes(h.originalSize)} → {formatBytes(h.minifiedSize)}
                    </div>
                    <div
                      className={`text-xs font-semibold ${
                        h.reduction > 30
                          ? 'text-green-400'
                          : h.reduction > 10
                          ? 'text-amber-400'
                          : 'text-gray-400'
                      }`}
                    >
                      -{h.reduction.toFixed(1)}%
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Options (collapsible) ── */}
      <div className="border-t" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        <button
          onClick={() => setShowOptions((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
        >
          {showOptions ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Optimization Options
        </button>
        {showOptions && (
          <div
            className="grid grid-cols-2 gap-x-8 gap-y-4 px-5 py-4 border-t md:grid-cols-4"
            style={{ borderColor: 'rgba(255,255,255,0.08)', background: '#161b22' }}
          >
            {/* HTML */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wide mb-1">HTML</p>
              <HtmlCheck k="removeComments" label="Remove comments" />
              <HtmlCheck k="removeWhitespace" label="Remove whitespace" />
              <HtmlCheck k="removeEmptyAttributes" label="Remove empty attrs" />
              {/* 'Inline CSS' checkbox removed (admin autopsy 2026-07-21): it was a no-op — the
                  minifier never inlined external stylesheets. Honest tools only expose real options. */}
              <HtmlCheck k="minifyInlineCSS" label="Minify inline CSS" />
              <HtmlCheck k="minifyInlineJS" label="Minify inline JS" />
            </div>
            {/* CSS */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-1">CSS</p>
              <CssCheck k="removeComments" label="Remove comments" />
              <CssCheck k="removeWhitespace" label="Remove whitespace" />
              {/* 'Collapse shorthand' + 'Remove unused' checkboxes removed (admin autopsy 2026-07-21):
                  both were no-ops (never applied by minifyCSS). Safe shorthand collapsing / dead-rule
                  removal need real CSS parsing — not shipped as a fake toggle. */}
              <CssCheck k="normalizeColors" label="Normalize colors" />
            </div>
            {/* JS */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wide mb-1">JS</p>
              <JsCheck k="removeComments" label="Remove comments" />
              <JsCheck k="removeWhitespace" label="Remove whitespace" />
              {/* 'Rename variables (aggressive)' removed (admin autopsy 2026-07-21): a no-op, and safe
                  identifier renaming needs a real JS parser (regex renaming would corrupt code). */}
              <JsCheck k="removeConsoleLog" label="Remove console.log" />
              <JsCheck k="removeDebugger" label="Remove debugger" />
            </div>
            {/* Advanced */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-purple-400 uppercase tracking-wide mb-1">Advanced</p>
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={advOpts.gzipEstimation}
                  onChange={(e) => setAdvOpts((p) => ({ ...p, gzipEstimation: e.target.checked }))}
                  className="accent-indigo-500"
                />
                Gzip estimation (approx.)
              </label>
              {/* 'Add source map comment' removed (admin autopsy 2026-07-21): it appended a
                  //# sourceMappingURL=app.js.map pointing at a file that never exists — misleading. */}
            </div>
          </div>
        )}
      </div>

      {/* ── Diff Preview (collapsible) ── */}
      {outputCode && (
        <div className="border-t" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          <button
            onClick={() => setShowDiff((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
          >
            {showDiff ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <GitMerge size={13} />
            {showDiff ? 'Hide diff' : 'Show diff'} (first 20 lines)
          </button>
          {showDiff && diffLines && (
            <div
              className="grid grid-cols-2 overflow-hidden border-t"
              style={{ borderColor: 'rgba(255,255,255,0.08)', maxHeight: 220 }}
            >
              <div
                className="overflow-auto p-3 border-r"
                style={{
                  background: 'rgba(248,81,73,0.07)',
                  borderColor: 'rgba(255,255,255,0.08)',
                }}
              >
                <p className="text-xs text-red-400 font-semibold mb-1">Original</p>
                <pre className="text-xs font-mono text-red-300/80 whitespace-pre-wrap break-all">
                  {diffLines.original.join('\n')}
                </pre>
              </div>
              <div className="overflow-auto p-3" style={{ background: 'rgba(63,185,80,0.07)' }}>
                <p className="text-xs text-green-400 font-semibold mb-1">Minified</p>
                <pre className="text-xs font-mono text-green-300/80 whitespace-pre-wrap break-all">
                  {diffLines.minified.join('\n')}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
