import React, { useState, useRef, useEffect, useCallback, DragEvent, ChangeEvent, ClipboardEvent } from 'react';
import {
  Upload,
  X,
  Copy,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Check,
  Image as ImageIcon,
  Clipboard,
} from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';

interface ScreenshotToCodeProps {
  /**
   * Hands the screenshot-derived build prompt to the REAL engine (NavBharatAI Pro v5.0): the app
   * switches to the Pro chat with the composer prefilled, and pressing Send builds the real app.
   * Replaced onCodeGenerated, whose old generate-from-image endpoint never existed — the tool used
   * to silently emit a hardcoded fallback page regardless of the screenshot (admin autopsy 2026-07-20).
   */
  onBuildViaV5: (prompt: string) => void;
}

type StyleOption = 'Tailwind CSS' | 'Plain CSS' | 'Bootstrap';
type FrameworkOption = 'Vanilla HTML' | 'React JSX';
type AppStatus = 'idle' | 'ready' | 'generating' | 'done' | 'error';

interface HistoryEntry {
  timestamp: number;
  preview: string;
}

const STORAGE_KEY = 'navbharatai_s2c_history';
const MAX_HISTORY = 5;

// FALLBACK_CODE removed (admin autopsy 2026-07-20): it was a hardcoded page the tool emitted on every
// failure — the whole time its old image endpoint did not exist — so the screenshot was never
// actually used. Failures are now honest and the real path reads the screenshot via vision.

/** Read a File to raw base64 (no data: prefix), for the vision route. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    // ignore storage errors
  }
}

function formatBytes(bytes: number): string {
  return (bytes / 1024).toFixed(1) + ' KB';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) +
    ' · ' + d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

const styleOptions: StyleOption[] = ['Tailwind CSS', 'Plain CSS', 'Bootstrap'];
const frameworkOptions: FrameworkOption[] = ['Vanilla HTML', 'React JSX'];

export const ScreenshotToCode: React.FC<ScreenshotToCodeProps> = ({ onBuildViaV5 }) => {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<StyleOption>('Tailwind CSS');
  const [selectedFramework, setSelectedFramework] = useState<FrameworkOption>('Vanilla HTML');
  const [includeJs, setIncludeJs] = useState(false);
  const [status, setStatus] = useState<AppStatus>('idle');
  const [generatedCode, setGeneratedCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [clipboardSupported] = useState(() =>
    typeof navigator !== 'undefined' && !!(navigator.clipboard as any)?.read
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevImageUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevImageUrlRef.current;
    if (prev && prev !== imageUrl) {
      URL.revokeObjectURL(prev);
    }
    prevImageUrlRef.current = imageUrl;
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const applyFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
    setStatus('ready');
    setGeneratedCode('');
    setErrorMsg('');
  }, []);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) applyFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) applyFile(file);
    e.target.value = '';
  };

  const handlePagePaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement> | Event) => {
      const items: DataTransferItemList | undefined =
        (e as ClipboardEvent<HTMLDivElement>).clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) { applyFile(file); return; }
        }
      }
    },
    [applyFile]
  );

  useEffect(() => {
    const handler = (e: Event) => handlePagePaste(e);
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [handlePagePaste]);

  const handleClipboardRead = async () => {
    try {
      const items = await (navigator.clipboard as any).read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob: Blob = await item.getType(type);
            const file = new File([blob], 'clipboard.png', { type });
            applyFile(file);
            return;
          }
        }
      }
    } catch {
      // user denied or no image in clipboard
    }
  };

  const removeImage = () => {
    setImageFile(null);
    setImageUrl(null);
    setStatus('idle');
    setGeneratedCode('');
    setErrorMsg('');
  };

  const handleGenerate = async () => {
    if (!imageFile) return;
    setStatus('generating');
    setErrorMsg('');
    try {
      const image = await fileToBase64(imageFile);
      // Real vision read → a detailed build prompt (server: /api/screenshot/to-prompt).
      const res = await fetch('/api/screenshot/to-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image,
          imageType: imageFile.type || 'image/png',
          style: selectedStyle,
          framework: selectedFramework,
          includeJs,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.prompt !== 'string') {
        throw new Error((data && data.error) || 'Could not read the screenshot — please try again.');
      }
      setStatus('done');
      setGeneratedCode(data.prompt);
      const entry: HistoryEntry = { timestamp: Date.now(), preview: data.prompt.slice(0, 200) };
      const updated = [entry, ...history].slice(0, MAX_HISTORY);
      setHistory(updated);
      saveHistory(updated);
      // Hand the build spec to the real engine — Send there builds the app.
      onBuildViaV5(data.prompt);
    } catch (e) {
      // Honest failure — no canned page, ever.
      setStatus('error');
      setErrorMsg(e instanceof Error ? e.message : 'Screenshot conversion failed — please try again.');
    }
  };

  const handleCopy = async () => {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const el = document.createElement('textarea');
      el.value = generatedCode;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // handleOpenPreview + renderSyntaxLine removed: the output is now a build spec (text), not
  // renderable HTML — the spec is shown as plain text and handed to Pro v5.0.

  return (
    <div
      className="flex flex-col lg:flex-row gap-4 p-4 h-full overflow-y-auto overscroll-contain"
      style={{ backgroundColor: '#0d1117', color: 'rgb(209 213 219)' }}
    >
      {/* LEFT COLUMN */}
      <div className="flex flex-col gap-4 lg:w-1/2 w-full">
        {/* Drag & Drop Zone */}
        <div
          className={`rounded-xl border-2 border-dashed p-8 flex flex-col items-center justify-center cursor-pointer transition-all min-h-48 ${
            isDragging
              ? 'border-indigo-500 bg-indigo-950/30'
              : 'border-white/10 hover:border-white/25'
          }`}
          style={{ backgroundColor: '#161b22' }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageIcon className="w-10 h-10 text-gray-500 mb-3" />
          <p className="text-gray-400 text-sm text-center leading-relaxed">
            Drop a screenshot here, or click to select
          </p>
          {imageFile && (
            <p className="mt-2 text-xs text-indigo-400 truncate max-w-full px-4">
              {imageFile.name}
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>

        {clipboardSupported && (
          <button
            onClick={(e) => { e.stopPropagation(); handleClipboardRead(); }}
            className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 transition-colors w-fit"
            style={{ backgroundColor: '#161b22' }}
          >
            <Clipboard className="w-4 h-4" />
            Paste from clipboard
          </button>
        )}

        {/* Image Preview */}
        {imageFile && imageUrl && (
          <div
            className="rounded-xl border border-white/10 p-4 flex flex-col gap-3"
            style={{ backgroundColor: '#161b22' }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-1 min-w-0">
                <p className="text-sm text-gray-300 truncate">{imageFile.name}</p>
                <p className="text-xs text-gray-500">{formatBytes(imageFile.size)}</p>
              </div>
              <button
                onClick={removeImage}
                className="text-gray-500 hover:text-red-400 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={imageUrl}
              alt="Preview"
              className="rounded-lg object-contain"
              style={{ maxWidth: '300px', maxHeight: '200px' }}
            />
          </div>
        )}

        {/* Style Options */}
        <div
          className="rounded-xl border border-white/10 p-4 flex flex-col gap-4"
          style={{ backgroundColor: '#161b22' }}
        >
          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Output Style</p>
            <div className="flex flex-wrap gap-2">
              {styleOptions.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setSelectedStyle(opt)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                    selectedStyle === opt
                      ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                      : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-gray-300'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Framework</p>
            <div className="flex flex-wrap gap-2">
              {frameworkOptions.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setSelectedFramework(opt)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                    selectedFramework === opt
                      ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                      : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-gray-300'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={includeJs}
              onChange={(e) => setIncludeJs(e.target.checked)}
              className="w-4 h-4 accent-indigo-500 rounded"
            />
            <span className="text-sm text-gray-400">Include JS</span>
          </label>
        </div>
      </div>

      {/* RIGHT COLUMN */}
      <div className="flex flex-col gap-4 lg:w-1/2 w-full">
        {/* Code Output Card */}
        <div
          className="rounded-xl border border-white/10 flex flex-col flex-1"
          style={{ backgroundColor: '#161b22', minHeight: '320px' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <h2 className="text-sm font-semibold text-gray-300">Build spec (from your screenshot)</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                disabled={!generatedCode}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Code Area */}
          <div className="flex-1 overflow-auto p-4">
            {status === 'idle' && (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
                <Upload className="w-8 h-8 text-gray-600" />
                <p className="text-sm text-gray-500">
                  Upload any website screenshot — AI will build a same-to-same app
                </p>
              </div>
            )}

            {status === 'ready' && (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
                <ImageIcon className="w-8 h-8 text-indigo-500" />
                <p className="text-sm text-gray-400">
                  Image ready — press "Build from Screenshot"
                </p>
              </div>
            )}

            {status === 'generating' && (
              <div className="h-full flex flex-col items-center justify-center gap-3">
                <TirangaLoader className="w-8 h-8" />
                <p className="text-sm text-gray-400">AI is analyzing...</p>
              </div>
            )}

            {status === 'error' && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-950/30 border border-red-800/40">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-400">{errorMsg}</p>
              </div>
            )}

            {status === 'done' && generatedCode && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 text-xs">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  Build spec ready — sent to NavBharatAI Pro v5.0. Press Send there to build your app.
                </div>
                <pre
                  className="text-xs leading-relaxed whitespace-pre-wrap break-words text-gray-300"
                >
                  {generatedCode}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={!imageFile || status === 'generating'}
          className="w-full py-3 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {status === 'generating' ? (
            <>
              <TirangaLoader className="w-4 h-4" />
              Reading screenshot...
            </>
          ) : (
            'Build from Screenshot'
          )}
        </button>

        {/* Honest, intent-aware note — inspired-by is built as asked; only a deceptive real-brand clone is guarded. */}
        <p className="text-[11px] text-amber-300/70 leading-relaxed">
          Want a page in <span className="font-semibold">your own</span> app to just <span className="font-semibold">look like</span> this
          (your brand, your name)? It’s built exactly as you ask. A pixel-perfect clone of a real branded site (login/payment) ships as a
          watermarked, non-original demo — so it can’t be used to impersonate or phish the real site.
        </p>

        {/* History */}
        {history.length > 0 && (
          <div
            className="rounded-xl border border-white/10 overflow-hidden"
            style={{ backgroundColor: '#161b22' }}
          >
            <button
              onClick={() => setHistoryOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-gray-300 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Recent Generations ({history.length})
              </span>
              {historyOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {historyOpen && (
              <div className="border-t border-white/10 divide-y divide-white/5">
                {history.map((entry, i) => (
                  <div key={i} className="px-4 py-3 flex flex-col gap-1">
                    <p className="text-xs text-gray-500">{formatTime(entry.timestamp)}</p>
                    <p className="text-xs text-gray-400 font-mono truncate">{entry.preview}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
