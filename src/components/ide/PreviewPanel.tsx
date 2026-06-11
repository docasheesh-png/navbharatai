import React, { useState, useEffect, useRef } from 'react';
import {
  Monitor, Smartphone, RefreshCcw,
  ExternalLink, Maximize2, Shield, Globe,
  Search, ChevronLeft, ChevronRight, Download, Package,
  Share2, Copy, Check, X, Wifi, Pen, Eye, ChevronDown, ChevronUp,
  Zap
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { VisualEditor } from './VisualEditor';

interface PreviewPanelProps {
  files: Record<string, string>;
  onRun: () => void;
  generatedCode?: string;
  previewHistory?: { id: string; label: string; ts: Date; html: string }[];
  onRestoreHistory?: (html: string) => void;
  onHtmlChange?: (html: string) => void;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({ files, onRun, generatedCode, previewHistory = [], onRestoreHistory, onHtmlChange }) => {
  const [device, setDevice] = useState<'laptop' | 'mobile' | 'full'>('laptop');
  const [visualMode, setVisualMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [url, setUrl] = useState('preview://navbharat.app/');
  const [containerRef, setContainerRef] = React.useState<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [downloading, setDownloading] = useState(false);
  const [pwaLoading, setPwaLoading] = useState(false);
  const [showPwaModal, setShowPwaModal] = useState(false);
  const [pwaUrl, setPwaUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [footerMinimized, setFooterMinimized] = useState(false);
  const [hotReloadFlash, setHotReloadFlash] = useState(false);
  const prevCodeRef = useRef<string | undefined>(undefined);

  // Hot reload indicator: flash when generatedCode changes
  useEffect(() => {
    if (prevCodeRef.current !== undefined && prevCodeRef.current !== generatedCode) {
      setHotReloadFlash(true);
      const titleMatch = generatedCode?.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch?.[1]?.trim();
      setUrl(title ? `preview://navbharat.app/${encodeURIComponent(title).replace(/%20/g, '-').toLowerCase()}` : 'preview://navbharat.app/');
      setTimeout(() => setHotReloadFlash(false), 1500);
    }
    prevCodeRef.current = generatedCode;
  }, [generatedCode]);

  const openAsPwa = async () => {
    if (!generatedCode || pwaLoading) return;
    setPwaLoading(true);
    try {
      const titleMatch = generatedCode.match(/<title[^>]*>([^<]+)<\/title>/i);
      const name = titleMatch ? titleMatch[1].trim() : 'My NavBharat App';
      const res = await fetch('/api/pwa/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: generatedCode, name })
      });
      const data = await res.json();
      if (data.url) { setPwaUrl(data.url); setShowPwaModal(true); }
    } catch (e) { console.error('PWA save failed', e); }
    finally { setPwaLoading(false); }
  };

  const copyUrl = async () => {
    try { await navigator.clipboard.writeText(pwaUrl); }
    catch { const i = document.createElement('input'); i.value = pwaUrl; document.body.appendChild(i); i.select(); document.execCommand('copy'); document.body.removeChild(i); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const downloadApp = () => {
    if (!generatedCode) return;
    setDownloading(true);
    try {
      const blob = new Blob([generatedCode], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'navbharat-app.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setTimeout(() => setDownloading(false), 1500);
    }
  };

  const downloadZip = async () => {
    if (!files || Object.keys(files).length === 0) return;
    setDownloading(true);
    try {
      // Build a simple ZIP-like structure using data URIs
      // Create an HTML download page listing all files
      const fileEntries = Object.entries(files);
      const parts: string[] = [];
      parts.push(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NavBharat App Files</title>`);
      parts.push(`<style>body{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:2rem}h1{color:#58a6ff}pre{background:#161b22;padding:1rem;border-radius:8px;overflow:auto;border:1px solid #30363d}.file-header{color:#3fb950;margin-top:2rem;font-weight:bold}</style></head><body>`);
      parts.push(`<h1>📦 NavBharat App — Source Files</h1><p>${fileEntries.length} files</p>`);
      for (const [path, content] of fileEntries) {
        parts.push(`<div class="file-header">📄 ${path}</div><pre>${(content as string).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`);
      }
      parts.push(`</body></html>`);
      const blob = new Blob([parts.join('')], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'navbharat-app-source.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setTimeout(() => setDownloading(false), 1500);
    }
  };

  React.useEffect(() => {
    if (!containerRef) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    observer.observe(containerRef);
    return () => observer.disconnect();
  }, [containerRef]);

  const targetWidth = 1440;
  const targetHeight = 900;

  const baseScale = dimensions?.width > 0 
    ? Math.min(dimensions.width / targetWidth, dimensions.height / targetHeight)
    : 1;

  const displayScale = device === 'full' 
    ? baseScale
    : device === 'mobile' && dimensions?.width < 400 && dimensions?.width > 0
      ? (dimensions.width - 32) / 375
      : 1;

  const devices = [
    { id: 'laptop' as const, label: 'Laptop', icon: Monitor, size: 'w-full max-w-[1280px]' },
    { id: 'mobile' as const, label: 'Mobile', icon: Smartphone, size: 'w-[375px]' },
    { id: 'full' as const, label: 'Full Screen', icon: Maximize2, size: 'w-full h-full' },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      {/* Browser-like Header */}
      <div className="h-12 bg-[#161b22] border-b border-white/5 flex items-center px-4 gap-4 shrink-0 transition-all">
        <div className="flex items-center gap-1">
          <button className="p-2 hover:bg-white/5 rounded-full text-[#484f58]"><ChevronLeft className="w-4 h-4" /></button>
          <button className="p-2 hover:bg-white/5 rounded-full text-[#484f58]"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={onRun} className="p-2 hover:bg-indigo-600/20 rounded-full text-indigo-400"><RefreshCcw className="w-4 h-4" /></button>
        </div>

        <div className={cn(
          "flex-1 max-w-xl h-8 bg-black/40 border rounded-full px-4 flex items-center gap-2 group transition-all",
          hotReloadFlash ? "border-emerald-500/50" : "border-white/10 focus-within:border-indigo-500/50"
        )}>
          <Shield className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
          <span className="flex-1 text-[11px] text-[#8b949e] font-mono truncate select-all cursor-text">
            {url}
          </span>
          {hotReloadFlash && <Zap className="w-3 h-3 text-emerald-400 flex-shrink-0 animate-pulse" />}
        </div>

        <div className="flex items-center gap-1 bg-black/20 p-1 rounded-xl border border-white/5">
          {devices.map((d) => (
            <button
              key={d.id}
              onClick={() => setDevice(d.id)}
              title={d.label}
              className={cn(
                "p-2 rounded-lg transition-all flex items-center gap-2",
                device === d.id ? "bg-indigo-600 text-white shadow-lg" : "text-[#484f58] hover:text-[#8b949e]"
              )}
            >
              <d.icon className="w-4 h-4" />
              {device === d.id && <span className="text-[10px] font-bold uppercase tracking-widest hidden lg:block">{d.label}</span>}
            </button>
          ))}
        </div>

        <button
          onClick={() => {
            if (generatedCode) {
              const blob = new Blob([generatedCode], { type: 'text/html' });
              const blobUrl = URL.createObjectURL(blob);
              window.open(blobUrl, '_blank');
              setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            }
          }}
          title="Open in new tab"
          disabled={!generatedCode}
          className="p-2 hover:bg-white/5 rounded-full text-[#484f58] hover:text-white ml-2 disabled:opacity-30 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
        </button>

        {/* Preview History */}
        {previewHistory.length > 0 && (
          <div className="relative ml-1">
            <button
              onClick={() => setShowHistory(p => !p)}
              title="Preview history"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-white/5 hover:bg-white/10 border border-white/10 text-[#484f58] hover:text-white transition-all"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">History ({previewHistory.length})</span>
            </button>
            {showHistory && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-[#161b22] border border-white/10 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden">
                <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] px-3 py-2 border-b border-white/5">Preview History</p>
                {previewHistory.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => { onRestoreHistory?.(h.html); setShowHistory(false); }}
                    className="w-full flex items-start gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left border-b border-white/5 last:border-0"
                  >
                    <div className="w-8 h-6 rounded bg-[#0d1117] border border-white/10 shrink-0 overflow-hidden mt-0.5">
                      <div className="w-full h-full bg-gradient-to-br from-indigo-900/40 to-purple-900/40" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] text-white font-medium truncate">{h.label}</p>
                      <p className="text-[9px] text-[#484f58]">{h.ts instanceof Date ? h.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Visual Editor Toggle */}
        {generatedCode && onHtmlChange && (
          <button
            onClick={() => setVisualMode(v => !v)}
            title={visualMode ? 'Switch to Preview mode' : 'Switch to Visual Edit mode'}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border',
              visualMode
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-900/40'
                : 'bg-indigo-600/10 text-indigo-400 border-indigo-500/20 hover:bg-indigo-600/30'
            )}
          >
            {visualMode ? <Eye className="w-3.5 h-3.5" /> : <Pen className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{visualMode ? 'Preview' : 'Edit'}</span>
          </button>
        )}

        {/* PWA Install Button */}
        <button
          onClick={openAsPwa}
          disabled={!generatedCode || pwaLoading}
          title="Install on Android as PWA"
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ml-1",
            generatedCode && !pwaLoading
              ? "bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 hover:border-indigo-500/60 hover:scale-105"
              : "bg-white/5 text-[#484f58] border border-white/5 cursor-not-allowed opacity-40"
          )}
        >
          <Smartphone className={cn("w-3.5 h-3.5", pwaLoading && "animate-pulse")} />
          <span className="hidden sm:inline">{pwaLoading ? 'Generating...' : 'Install'}</span>
        </button>

        {/* Download Button */}
        <button
          onClick={downloadApp}
          disabled={!generatedCode || downloading}
          title="Download App as HTML"
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ml-1",
            generatedCode && !downloading
              ? "bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/60 hover:scale-105"
              : "bg-white/5 text-[#484f58] border border-white/5 cursor-not-allowed opacity-40"
          )}
        >
          <Download className={cn("w-3.5 h-3.5", downloading && "animate-bounce")} />
          <span className="hidden sm:inline">{downloading ? 'Saving...' : 'Download'}</span>
        </button>
      </div>

      {/* Preview Viewport or Visual Editor */}
      {visualMode && generatedCode && onHtmlChange ? (
        <div className="flex-1 overflow-hidden">
          <VisualEditor html={generatedCode} onHtmlChange={onHtmlChange} />
        </div>
      ) : (
        <div
          ref={setContainerRef}
          className="flex-1 bg-[#1e1e1e] p-4 flex justify-center items-center overflow-hidden relative"
        >
            {/* Hot reload flash */}
            {hotReloadFlash && (
              <div className="absolute top-2 right-2 z-50 flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600/90 rounded-full text-[9px] font-black text-white uppercase tracking-widest shadow-lg animate-pulse">
                <Zap className="w-3 h-3" />
                Updated
              </div>
            )}
            <div
              style={{
                width: device === 'full' ? `${targetWidth}px` : undefined,
                height: device === 'full' ? `${targetHeight}px` : undefined,
                transform: `scale(${displayScale})`,
                transformOrigin: 'center center',
                flexShrink: 0
              }}
              className={cn(
              "h-full bg-white shadow-2xl transition-all duration-300 rounded-lg overflow-hidden border-8 border-black/20",
              device === 'laptop' ? 'w-full max-w-[1280px]' :
              device === 'mobile' ? 'w-[375px]' : ''
           )}>
              {generatedCode ? (
                <iframe
                  title="App Preview"
                  srcDoc={generatedCode}
                  className="w-full h-full bg-white border-none"
                  sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
                />
              ) : (
                <div className="w-full h-full bg-[#fafafa] flex flex-col items-center justify-center p-8 text-center space-y-4 animate-pulse">
                  <Globe className="w-8.5 h-8.5 text-indigo-500 animate-spin" />
                  <p className="text-xs text-gray-500 font-mono tracking-wider">Syncing workspace code...</p>
                  <button
                    onClick={onRun}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-full text-xs font-black uppercase tracking-widest hover:bg-indigo-700 active:scale-95 transition-all shadow-xl shadow-indigo-600/20"
                  >
                    Sync Changes
                  </button>
                </div>
              )}
           </div>
        </div>
      )}

      {/* App Ready Banner */}
      {generatedCode && (
        <div className="shrink-0 border-t border-indigo-500/20">
          {/* Minimized bar — always visible, shows toggle */}
          <div className="bg-gradient-to-r from-indigo-950/80 via-[#161b22] to-emerald-950/80 px-3 py-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-black text-white tracking-wide">App Ready</span>
              {footerMinimized && (
                <span className="text-[9px] text-[#8b949e] hidden sm:inline">· Install on Android ya Download karo</span>
              )}
            </div>
            <button
              onClick={() => setFooterMinimized(p => !p)}
              title={footerMinimized ? 'Expand footer' : 'Minimise footer'}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-[#8b949e] hover:text-white transition-all text-[9px] font-black uppercase tracking-wider"
            >
              {footerMinimized ? <><ChevronUp className="w-3 h-3" /> Expand</> : <><ChevronDown className="w-3 h-3" /> Minimise</>}
            </button>
          </div>

          {/* Expandable action row */}
          {!footerMinimized && (
            <div className="bg-gradient-to-r from-indigo-950/60 via-[#161b22] to-emerald-950/60 px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
                  <Smartphone className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="min-w-0">
                  <span className="text-[11px] font-black text-white tracking-wide">Aapki App Ready Hai!</span>
                  <p className="text-[9px] text-[#8b949e]">Android pe install karo ya download karo</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={openAsPwa}
                  disabled={pwaLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-900/40 disabled:opacity-60"
                >
                  <Share2 className={cn("w-3.5 h-3.5", pwaLoading && "animate-spin")} />
                  {pwaLoading ? 'Wait...' : 'Install on Android'}
                </button>
                <button
                  onClick={downloadApp}
                  disabled={downloading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 active:scale-95 text-[#8b949e] hover:text-white border border-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-60"
                >
                  <Download className={cn("w-3.5 h-3.5", downloading && "animate-bounce")} />
                  Download
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PWA Install Modal */}
      {showPwaModal && (
        <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#161b22] border border-indigo-500/40 rounded-2xl w-full max-w-sm shadow-2xl shadow-indigo-900/30">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                  <Smartphone className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs font-black text-white">Android pe Install Karo</p>
                  <p className="text-[9px] text-indigo-400">PWA — Bilkul native app jaisi!</p>
                </div>
              </div>
              <button onClick={() => setShowPwaModal(false)} className="p-1.5 hover:bg-white/10 rounded-lg text-[#484f58] hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* URL Box */}
            <div className="px-5 pt-4 pb-3">
              <p className="text-[9px] text-[#484f58] font-bold uppercase tracking-widest mb-2">Aapki App Ka Link</p>
              <div className="flex items-center gap-2 bg-black/50 border border-white/10 rounded-xl px-3 py-2.5">
                <code className="text-[10px] text-indigo-300 flex-1 break-all leading-relaxed">{pwaUrl}</code>
                <button
                  onClick={copyUrl}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all shrink-0",
                    copied ? "bg-emerald-600 text-white" : "bg-white/10 hover:bg-white/20 text-[#8b949e]"
                  )}
                >
                  {copied ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                </button>
              </div>
              <p className="text-[9px] text-[#484f58] mt-1.5 flex items-center gap-1">
                <Wifi className="w-3 h-3" /> Link 24 ghante valid hai · Offline bhi kaam karega
              </p>
            </div>

            {/* Steps */}
            <div className="px-5 pb-5">
              <p className="text-[9px] text-[#8b949e] font-bold uppercase tracking-widest mb-3">Android pe Install Kaise Karein:</p>
              <div className="space-y-2.5">
                {[
                  { n: '1', text: 'Yeh link copy karo (upar button se)', sub: 'Ya seedha scan karo agar QR ho' },
                  { n: '2', text: 'Android phone mein Chrome browser kholo' },
                  { n: '3', text: 'Link paste karo aur page load hone do' },
                  { n: '4', text: 'Top-right 3 dots (⋮) tap karo', sub: 'Menu open hoga' },
                  { n: '5', text: '"Add to Home Screen" select karo', sub: 'App icon home screen pe aa jayegi!' },
                ].map(({ n, text, sub }) => (
                  <div key={n} className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-[9px] font-black flex items-center justify-center shrink-0 mt-0.5">{n}</span>
                    <div>
                      <p className="text-[11px] text-[#c9d1d9] font-medium leading-tight">{text}</p>
                      {sub && <p className="text-[9px] text-[#484f58] mt-0.5">{sub}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <div className="h-8 bg-[#161b22] border-t border-white/5 px-4 flex items-center justify-between text-[10px] text-[#484f58] font-bold uppercase tracking-widest">
         <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <div className={cn("w-1.5 h-1.5 rounded-full", generatedCode ? "bg-emerald-500 animate-pulse" : "bg-[#484f58]")} />
              {generatedCode ? 'Preview Live' : 'No Preview'}
            </span>
            <span>{Object.keys(files).length} files</span>
         </div>
         <div className="flex items-center gap-3">
           {generatedCode && (
             <span className="text-[9px] text-emerald-500/70">
               {(new Blob([generatedCode]).size / 1024).toFixed(1)} KB
             </span>
           )}
           <span>Mode: {device.toUpperCase()}</span>
         </div>
      </div>
    </div>
  );
};
