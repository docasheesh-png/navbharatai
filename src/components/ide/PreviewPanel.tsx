import React, { useState, useEffect, useRef } from 'react';
import {
  Monitor, Smartphone, RefreshCcw,
  ExternalLink, Maximize2, Shield, Globe,
  Search, Download, Package,
  Share2, Copy, Check, X, Wifi, Pen, Eye, ChevronDown, ChevronUp,
  Zap, Tag, Camera
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
  onGoPro?: () => void;
  onEditWithAI?: (hint?: string) => void;
}

// ── NBTag overlay: injected into iframe when Tag Mode is ON ──────────────────
// Scans all interactive/structural elements, assigns stable IDs (BTN-001 etc.),
// renders floating violet badges. Clicking a badge posts a message to the parent
// window so the AI chat can be pre-filled with the exact element reference.
// This script is NEVER stored in the generated HTML — only injected for preview.
const NBT_OVERLAY_SCRIPT = `<script id="__nbt_script__">
(function(){
  if(document.getElementById('__nbt_ov__'))return;
  var M={button:'BTN',input:'INP',select:'SEL',textarea:'TXA',a:'LNK',
         h1:'HDG',h2:'HDG',h3:'HDG',img:'IMG',form:'FRM',
         nav:'NAV',header:'BAR',footer:'FTR',section:'SEC',li:'LIT'};
  var c={},T=Object.keys(M);
  T.forEach(function(t){
    document.querySelectorAll(t).forEach(function(el){
      var p=M[t];c[p]=(c[p]||0)+1;
      if(!el._nbt)el._nbt=p+'-'+String(c[p]).padStart(3,'0');
    });
  });
  var ov=document.createElement('div');
  ov.id='__nbt_ov__';
  ov.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden;';
  document.body.appendChild(ov);
  function draw(){
    ov.innerHTML='';
    T.forEach(function(t){
      document.querySelectorAll(t).forEach(function(el){
        if(!el._nbt)return;
        var r=el.getBoundingClientRect();
        if(r.width<2&&r.height<2)return;
        var b=document.createElement('span');
        b.textContent=el._nbt;
        b.title='Click to reference in AI chat';
        b.style.cssText='position:fixed;background:#7c3aed;color:#fff;font:800 8px/1 monospace;'
          +'padding:2px 4px 2px;border-radius:0 0 4px 0;cursor:pointer;pointer-events:all;'
          +'white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.7);user-select:none;'
          +'transition:background .12s,transform .1s;';
        b.style.top=Math.max(0,r.top)+'px';
        b.style.left=Math.max(0,r.left)+'px';
        b.addEventListener('mouseenter',function(){b.style.transform='scale(1.15)';});
        b.addEventListener('mouseleave',function(){b.style.transform='scale(1)';});
        b.addEventListener('click',function(e){
          e.stopPropagation();e.preventDefault();
          ov.querySelectorAll('span').forEach(function(x){x.style.background='#7c3aed';});
          b.style.background='#059669';
          window.parent.postMessage({
            type:'nbtag-select',
            tag:el._nbt,
            el:el.tagName.toLowerCase(),
            txt:(el.textContent||el.getAttribute('placeholder')||el.getAttribute('alt')||'').trim().slice(0,50),
            id:el.id||'',
            cls:Array.from(el.classList).filter(function(c){return!c.startsWith('__nbt')}).slice(0,3).join(' ')
          },'*');
        });
        ov.appendChild(b);
      });
    });
  }
  draw();
  document.addEventListener('scroll',draw,true);
  window.addEventListener('resize',draw);
  // Re-draw after dynamic rendering (React, etc.)
  var t;
  new MutationObserver(function(){clearTimeout(t);t=setTimeout(draw,250);})
    .observe(document.body,{childList:true,subtree:true});
})();
</script>`;

function injectTagOverlay(html: string): string {
  if (!html) return html;
  const idx = html.lastIndexOf('</body>');
  return idx !== -1
    ? html.slice(0, idx) + NBT_OVERLAY_SCRIPT + html.slice(idx)
    : html + NBT_OVERLAY_SCRIPT;
}

const PreviewUrlBar: React.FC<{ url: string; hotReloadFlash: boolean; tagMode: boolean }> = ({ url, hotReloadFlash, tagMode }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn(
      "flex-1 min-w-[10rem] max-w-xl h-8 bg-black/40 border rounded-full px-4 flex items-center gap-2 group transition-all",
      hotReloadFlash ? "border-emerald-500/50" : tagMode ? "border-violet-500/50" : "border-white/10 focus-within:border-indigo-500/50"
    )}>
      <Shield className={cn("w-3.5 h-3.5 flex-shrink-0", tagMode ? "text-violet-400" : "text-emerald-500")} />
      <span className="flex-1 text-[11px] text-[#8b949e] font-mono truncate select-all cursor-text">{url}</span>
      {hotReloadFlash && <Zap className="w-3 h-3 text-emerald-400 flex-shrink-0 animate-pulse" />}
      {tagMode && !hotReloadFlash && <Tag className="w-3 h-3 text-violet-400 flex-shrink-0 animate-pulse" />}
      <button
        onClick={() => { navigator.clipboard.writeText(url).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="text-[#484f58] hover:text-white transition-colors flex-shrink-0"
        title="Copy preview URL"
      >
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
};

export const PreviewPanel: React.FC<PreviewPanelProps> = ({ files, onRun, generatedCode, previewHistory = [], onRestoreHistory, onHtmlChange, onGoPro, onEditWithAI }) => {
  const isMobileScreen = typeof window !== 'undefined' && window.innerWidth < 768;
  const [device, setDevice] = useState<'laptop' | 'mobile' | 'full'>(isMobileScreen ? 'full' : 'laptop');
  // H4: Device frame toggle (phone bezel around mobile preview)
  const [showDeviceFrame, setShowDeviceFrame] = useState(false);
  // H18: Landscape/portrait rotation for mobile preview
  const [isLandscape, setIsLandscape] = useState(false);
  const [visualMode, setVisualMode] = useState(false);
  const [tagMode, setTagMode] = useState(false);
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

  // BUG G1 FIX: Reset prevCodeRef on mount/remount to prevent false "content changed"
  // that would incorrectly trigger the hot reload flash on the first render after remount.
  useEffect(() => {
    prevCodeRef.current = generatedCode;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Hot reload indicator
  useEffect(() => {
    if (prevCodeRef.current !== undefined && prevCodeRef.current !== generatedCode) {
      setHotReloadFlash(true);
      setTagMode(false); // reset tag mode on new build
      const titleMatch = generatedCode?.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch?.[1]?.trim();
      setUrl(title ? `preview://navbharat.app/${encodeURIComponent(title).replace(/%20/g, '-').toLowerCase()}` : 'preview://navbharat.app/');
      setTimeout(() => setHotReloadFlash(false), 1500);
    }
    prevCodeRef.current = generatedCode;
  }, [generatedCode]);

  // Listen for tag badge clicks from iframe
  useEffect(() => {
    const handleMsg = (e: MessageEvent) => {
      if (e.data?.type === 'nbtag-select') {
        const { tag, el, txt, id, cls } = e.data;
        const parts: string[] = [el];
        if (id) parts.push('#' + id);
        if (cls) parts.push('.' + cls.split(' ').filter(Boolean).join('.'));
        if (txt) parts.push(`"${txt}"`);
        const hint = `[${tag} — ${parts.join(' ')}] `;
        onEditWithAI?.(hint);
        return;
      }
      if (e.data?.type === 'nb-ai-fix') {
        // Error overlay's "Fix Bug" button — auto-fill the AI-generated fix prompt into chat
        onEditWithAI?.(e.data.prompt as string);
        return;
      }
      if (e.data?.type === 'nb-code-bug') {
        // Error overlay's "Coding Bug" button — already copied to clipboard inside the iframe;
        // re-copy from the parent context too since some sandboxed iframes block clipboard access.
        const report = e.data.report as string;
        if (report && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(report).catch(() => {});
        }
        return;
      }
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, [onEditWithAI]);

  const openAsPwa = async () => {
    if (!generatedCode || pwaLoading) return;
    setPwaLoading(true);
    try {
      const titleMatch = generatedCode.match(/<title[^>]*>([^<]+)<\/title>/i);
      const name = titleMatch ? titleMatch[1].trim() : 'My NavBharat App';
      // Hosting is durable now (Firestore-backed) so the save endpoint requires a signed-in user.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const { auth } = await import('../../lib/firebase');
        const tok = await auth.currentUser?.getIdToken();
        if (tok) headers.Authorization = `Bearer ${tok}`;
      } catch { /* best-effort; the server answers 401 with an honest message */ }
      const res = await fetch('/api/pwa/save', {
        method: 'POST',
        headers,
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
      // C16: Filter out build artifacts and generated directories
      const EXCLUDED = /^(node_modules|__pycache__|\.git|dist\/|build\/|\.DS_Store)/;
      const filteredEntries = Object.entries(files).filter(([p]) => !EXCLUDED.test(p));
      // C15: Ensure .env.example is included if .env exists
      const hasEnv = filteredEntries.some(([p]) => p === '.env' || p.endsWith('.env'));
      const hasEnvExample = filteredEntries.some(([p]) => p === '.env.example');
      if (hasEnv && !hasEnvExample) {
        const envVars = (files['.env'] || '').split('\n')
          .filter(l => l.includes('=') && !l.startsWith('#'))
          .map(l => `${l.split('=')[0]}=`)
          .join('\n');
        filteredEntries.push(['.env.example', `# Copy to .env and fill in values\n${envVars}`]);
      }
      const parts: string[] = [];
      parts.push(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NavBharat App Files</title>`);
      parts.push(`<style>body{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:2rem}h1{color:#58a6ff}pre{background:#161b22;padding:1rem;border-radius:8px;overflow:auto;border:1px solid #30363d}.file-header{color:#3fb950;margin-top:2rem;font-weight:bold}</style></head><body>`);
      parts.push(`<h1>📦 NavBharat App — Source Files</h1><p>${filteredEntries.length} files</p>`);
      for (const [path, content] of filteredEntries) {
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

  const previewSrc = tagMode && generatedCode ? injectTagOverlay(generatedCode) : generatedCode;

  // Write iframe content imperatively so device/zoom state changes never reload it.
  // Only actual content changes (new build, tag mode toggle) should reload.
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const writtenSrcRef = useRef<string>('');
  // H13: fade state for smooth preview refresh transition
  const [previewOpacity, setPreviewOpacity] = useState(1);
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || previewSrc === writtenSrcRef.current) return;
    // H13: fade out, then write, then fade in
    setPreviewOpacity(0);
    const write = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(previewSrc || '');
          doc.close();
          writtenSrcRef.current = previewSrc || '';
          // H19: scroll preview to top after rebuild
          try { iframe.contentWindow?.scrollTo(0, 0); } catch { /* cross-origin */ }
          requestAnimationFrame(() => setPreviewOpacity(1));
        }
      } catch { /* cross-origin guard */ }
    };
    // Short delay so the fade-out renders before content is replaced
    const t = setTimeout(write, 80);
    // If the doc wasn't ready (write didn't take), retry once when the fresh
    // iframe fires its load event.
    if (writtenSrcRef.current !== (previewSrc || '')) {
      iframe.addEventListener('load', write, { once: true });
      return () => { clearTimeout(t); iframe.removeEventListener('load', write); };
    }
    return () => clearTimeout(t);
  }, [previewSrc]);

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      {/* Browser-like Header — horizontally swipe-scrollable so every control
          stays reachable on mobile instead of being cropped off-screen. */}
      <div
        className="h-12 bg-[#161b22] border-b border-white/5 flex items-center px-4 gap-4 shrink-0 transition-all overflow-x-auto no-scrollbar [&>*]:shrink-0"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="flex items-center gap-1">
          {/* The back/forward chevrons were REMOVED here (admin 2026-08-21). Neither had an onClick,
              so they were browser-style navigation that never navigated. They also could not be
              wired: the preview runs in a CROSS-ORIGIN iframe, and the browser blocks a parent page
              from reading or stepping that frame's history — `contentWindow.history` throws. Faking
              it (reloading the src, keeping our own URL stack) would move the frame somewhere the
              user did not ask for and call it "back". Refresh below is real and stays. */}
          <button onClick={onRun} className="p-2 hover:bg-indigo-600/20 rounded-full text-indigo-400"><RefreshCcw className="w-4 h-4" /></button>
        </div>

        {/* H5: Preview URL bar with copy button */}
        <PreviewUrlBar url={url} hotReloadFlash={hotReloadFlash} tagMode={tagMode} />

        <div className="flex items-center gap-1 bg-black/20 p-1 rounded-xl border border-white/5">
          {devices.map((d) => (
            <button
              key={d.id}
              onClick={() => setDevice(d.id)}
              title={d.label}
              aria-label={`Preview in ${d.label} mode`}
              className={cn(
                "p-2 rounded-lg transition-all flex items-center gap-2",
                device === d.id ? "bg-indigo-600 text-white shadow-lg" : "text-[#484f58] hover:text-[#8b949e]"
              )}
            >
              <d.icon className="w-4 h-4" />
              {device === d.id && <span className="text-[10px] font-bold uppercase tracking-widest hidden lg:block">{d.label}</span>}
            </button>
          ))}
          {/* H4: Phone frame toggle */}
          {device === 'mobile' && (
            <button
              onClick={() => setShowDeviceFrame(f => !f)}
              title={showDeviceFrame ? 'Hide phone frame' : 'Show phone frame'}
              aria-label="Toggle phone device frame"
              className={cn(
                "p-2 rounded-lg transition-all text-[10px] font-black uppercase tracking-widest ml-0.5",
                showDeviceFrame ? "bg-slate-700 text-white" : "text-[#484f58] hover:text-[#8b949e]"
              )}
            >
              📱
            </button>
          )}
          {/* H18: Rotate device (landscape/portrait) */}
          {device === 'mobile' && (
            <button
              onClick={() => setIsLandscape(l => !l)}
              title={isLandscape ? 'Switch to portrait' : 'Switch to landscape'}
              aria-label="Rotate device orientation"
              className={cn(
                "p-2 rounded-lg transition-all ml-0.5",
                isLandscape ? "bg-slate-700 text-white" : "text-[#484f58] hover:text-[#8b949e]"
              )}
            >
              <RefreshCcw className="w-4 h-4" />
            </button>
          )}
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

        {/* H10: Print / Save as PDF / Screenshot */}
        <button
          onClick={() => {
            const iframe = document.querySelector('iframe[title="App Preview"]') as HTMLIFrameElement | null;
            try { iframe?.contentWindow?.print(); } catch { window.print(); }
          }}
          title="Print / Save as PDF (screenshot)"
          disabled={!generatedCode}
          className="p-2 hover:bg-white/5 rounded-full text-[#484f58] hover:text-white disabled:opacity-30 transition-colors"
        >
          <Camera className="w-4 h-4" />
        </button>

        <button
          onClick={() => {
            const el = document.documentElement;
            if (!document.fullscreenElement) {
              el.requestFullscreen?.().catch(() => {});
            } else {
              document.exitFullscreen?.().catch(() => {});
            }
          }}
          title="Toggle fullscreen"
          className="p-2 hover:bg-white/5 rounded-full text-[#484f58] hover:text-white transition-colors lg:hidden"
        >
          <Maximize2 className="w-4 h-4" />
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

        {/* Tag Mode — element reference badges for precision AI edits */}
        {generatedCode && (
          <button
            onClick={() => setTagMode(v => !v)}
            title={tagMode
              ? 'Turn off Tag Mode'
              : 'Tag Mode — badges appear on all elements. Click a badge to reference it in AI chat for precision editing.'}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ml-1 border",
              tagMode
                ? "bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-900/30 hover:bg-violet-500"
                : "bg-violet-600/10 text-violet-400 border-violet-500/20 hover:bg-violet-600/30"
            )}
          >
            <Tag className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Tag</span>
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
            "flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ml-1 border",
            generatedCode && !downloading
              ? "bg-emerald-600/15 hover:bg-emerald-600/30 text-emerald-400 border-emerald-500/30 hover:border-emerald-400/60 hover:scale-105 active:scale-95"
              : "bg-white/5 text-[#484f58] border-white/5 cursor-not-allowed opacity-40"
          )}
        >
          <Download className={cn("w-3 h-3", downloading && "animate-bounce")} />
          <span>{downloading ? 'Saving' : '↓'}</span>
        </button>

        {/* Edit with AI — always visible in header */}
        {(onEditWithAI || onGoPro) && (
          <button
            onClick={() => onEditWithAI ? onEditWithAI() : onGoPro?.()}
            title="Edit this app with AI"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ml-1 border bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 hover:scale-105 active:scale-95 shadow-lg shadow-indigo-900/30"
          >
            <Pen className="w-3.5 h-3.5" />
            <span>Edit</span>
          </button>
        )}
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

          {/* Tag mode hint bar */}
          {tagMode && !hotReloadFlash && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3 py-1.5 bg-violet-700/95 backdrop-blur-sm rounded-lg text-[9px] font-black text-white uppercase tracking-widest shadow-xl border border-violet-400/30 pointer-events-none">
              <Tag className="w-3 h-3" />
              Tag Mode ON — click any badge → reference in AI chat
            </div>
          )}

          <div
            style={{
              width: device === 'full' ? `${targetWidth}px` : device === 'mobile' ? (isLandscape ? '667px' : '375px') : undefined,
              height: device === 'full' ? `${targetHeight}px` : device === 'mobile' ? (isLandscape ? '375px' : undefined) : undefined,
              transform: `scale(${displayScale})`,
              transformOrigin: 'center center',
              flexShrink: 0
            }}
            className={cn(
              "h-full bg-white shadow-2xl transition-all duration-300 overflow-hidden",
              showDeviceFrame && device === 'mobile'
                ? "rounded-[3rem] border-[12px] border-slate-800 shadow-[0_0_0_4px_#1e293b,0_20px_60px_rgba(0,0,0,0.6)]"
                : "rounded-lg border-8",
              !showDeviceFrame && (tagMode ? "border-violet-500/40" : "border-black/20"),
              device === 'laptop' ? 'w-full max-w-[1280px]' : ''
            )}>
            {generatedCode ? (
              <iframe
                ref={iframeRef}
                key={tagMode ? 'tag' : 'preview'}
                title="App Preview"
                className="w-full h-full bg-white border-none"
                style={{ opacity: previewOpacity, transition: 'opacity 0.15s ease' }}
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
        <div className={cn("shrink-0 border-t", tagMode ? "border-violet-500/30" : "border-indigo-500/20")}>
          {/* Minimized bar */}
          <div className={cn(
            "px-3 py-1.5 flex items-center justify-between gap-2",
            tagMode
              ? "bg-gradient-to-r from-violet-950/80 via-[#161b22] to-violet-950/60"
              : "bg-gradient-to-r from-indigo-950/80 via-[#161b22] to-emerald-950/80"
          )}>
            <div className="flex items-center gap-1.5">
              <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", tagMode ? "bg-violet-400" : "bg-emerald-400")} />
              <span className="text-[10px] font-black text-white tracking-wide">
                {tagMode ? 'Tag Mode Active' : 'App Ready'}
              </span>
              {footerMinimized && !tagMode && (
                <span className="text-[9px] text-[#8b949e] hidden sm:inline">· Install on Android or Download</span>
              )}
              {footerMinimized && tagMode && (
                <span className="text-[9px] text-violet-300/70 hidden sm:inline">· Click badges to reference elements in AI chat</span>
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
            <div className={cn(
              "px-4 py-2.5 flex flex-col gap-2.5",
              tagMode
                ? "bg-gradient-to-r from-violet-950/40 via-[#161b22] to-violet-950/30"
                : "bg-gradient-to-r from-indigo-950/60 via-[#161b22] to-emerald-950/60"
            )}>
              {/* Tag mode info card */}
              {tagMode && (
                <div className="flex items-start gap-3 px-3 py-2.5 bg-violet-600/10 border border-violet-500/25 rounded-xl">
                  <Tag className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-black text-violet-300 uppercase tracking-wide mb-0.5">Precision Edit Mode</p>
                    <p className="text-[9px] text-violet-300/60 leading-relaxed">
                      Every element has a badge (BTN-001, INP-002…). Click a badge → the tag is auto-inserted in AI chat.
                      Then type what to change. Tags are never visible in the published app.
                    </p>
                  </div>
                  <button
                    onClick={() => setTagMode(false)}
                    className="p-1 hover:bg-violet-500/20 rounded text-violet-400/60 hover:text-violet-300 transition-colors shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Edit with AI — primary CTA + quick chips */}
              {(onEditWithAI || onGoPro) && (
                <>
                  <button
                    onClick={() => onEditWithAI ? onEditWithAI() : onGoPro?.()}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.98] text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-900/40"
                  >
                    <Pen className="w-3.5 h-3.5" />
                    ✏️ Edit with AI / Improve
                  </button>
                  <div className="flex flex-wrap gap-1.5">
                    {['Add dark mode', 'Improve UI design', 'Add more features', 'Fix bugs', 'Make mobile-friendly'].map(chip => (
                      <button
                        key={chip}
                        onClick={() => onEditWithAI ? onEditWithAI(chip) : onGoPro?.()}
                        className="px-2.5 py-1 bg-white/5 hover:bg-indigo-600/20 border border-white/10 hover:border-indigo-500/30 text-[#8b949e] hover:text-indigo-300 text-[9px] font-bold rounded-full transition-all active:scale-95"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
                    <Smartphone className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[11px] font-black text-white tracking-wide">Your App is Ready!</span>
                    <p className="text-[9px] text-[#8b949e]">Install on Android or download</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={openAsPwa}
                    disabled={pwaLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-900/40 disabled:opacity-60"
                  >
                    <Share2 className={cn("w-3.5 h-3.5", pwaLoading && "animate-spin")} />
                    {pwaLoading ? 'Wait...' : 'Install'}
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
            </div>
          )}
        </div>
      )}

      {/* PWA Install Modal */}
      {showPwaModal && (
        <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#161b22] border border-indigo-500/40 rounded-2xl w-full max-w-sm shadow-2xl shadow-indigo-900/30">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                  <Smartphone className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs font-black text-white">Install on Android</p>
                  <p className="text-[9px] text-indigo-400">PWA — Works like a native app!</p>
                </div>
              </div>
              <button onClick={() => setShowPwaModal(false)} className="p-1.5 hover:bg-white/10 rounded-lg text-[#484f58] hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 pt-4 pb-3">
              <p className="text-[9px] text-[#484f58] font-bold uppercase tracking-widest mb-2">Your App Link</p>
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
                <Wifi className="w-3 h-3" /> Link valid for 24 hours · Works offline too
              </p>
            </div>

            <div className="px-5 pb-5">
              <p className="text-[9px] text-[#8b949e] font-bold uppercase tracking-widest mb-3">How to Install on Android:</p>
              <div className="space-y-2.5">
                {[
                  { n: '1', text: 'Copy the link (button above)', sub: 'Or scan QR code if available' },
                  { n: '2', text: 'Open Chrome on your Android phone' },
                  { n: '3', text: 'Paste the link and let the page load' },
                  { n: '4', text: 'Tap the 3 dots (⋮) at top-right', sub: 'Opens the menu' },
                  { n: '5', text: 'Select "Add to Home Screen"', sub: 'App icon will appear on your home screen!' },
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
          {tagMode && (
            <span className="flex items-center gap-1 text-violet-400">
              <Tag className="w-3 h-3" />
              Tag Mode
            </span>
          )}
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
