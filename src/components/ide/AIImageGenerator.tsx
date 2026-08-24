import { useState, useEffect } from 'react';
import { Wand2, Sparkles, Download, Palette, Copy, Trash2, Clock, Star, Check, Image as ImageIcon } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { TirangaLoader } from '../ui/TirangaLoader';
import { dataUrlToBlob, dataUrlToBase64, imageFilename } from '../../lib/imageExport';
import { imageHistoryStore, pruneHistory, type ImageHistoryItem } from '../../lib/imageHistoryStore';
import { auth } from '../../lib/firebase';

type GeneratedImage = ImageHistoryItem;

interface Props {
  onImageGenerated?: (imageUrl: string, prompt: string) => void;
}

const STYLES = [
  // PHOTO IS FIRST, and that placement is the point (admin 2026-08-16: "realistic image banane ke liye
  // jo kuch ho sake karo"). Realism was previously UNREACHABLE — none of the six chips asked for a
  // photograph, so a user wanting one picked "3D" and got the isometric render it promises. First
  // position because it is what most people want most of the time.
  { id: 'photo', label: 'Realistic', desc: 'Real photo look', emoji: '📷' },
  { id: 'minimal', label: 'Minimal', desc: 'Clean & simple', emoji: '⬜' },
  { id: 'vibrant', label: 'Vibrant', desc: 'Bold colors', emoji: '🌈' },
  { id: 'dark', label: 'Dark', desc: 'Dark aesthetic', emoji: '🌑' },
  { id: 'gradient', label: 'Gradient', desc: 'Smooth gradients', emoji: '🌅' },
  { id: 'flat', label: 'Flat', desc: 'Flat design', emoji: '📐' },
  { id: '3d', label: '3D', desc: 'Three dimensional', emoji: '🎯' },
];

// ⚠️ THESE MUST MATCH IMAGE_SIZE_PIXELS ON THE SERVER — a shared test asserts it. They did not
// (2026-08-16): the picker advertised 512×512 while the server generated 1024, and "App Icon 192×192"
// while it generated 512. Every number a user read here was wrong, which is its own small dishonesty
// and made the real fix — raising the resolution — impossible to even see.
const SIZES = [
  { id: 'square', label: 'Square', w: 1280, h: 1280, desc: '1280×1280' },
  { id: 'wide', label: 'Wide / OG', w: 1536, h: 864, desc: '1536×864' },
  { id: 'portrait', label: 'Portrait', w: 960, h: 1280, desc: '960×1280' },
  { id: 'icon', label: 'App Icon', w: 1024, h: 1024, desc: '1024×1024' },
];

// Image types — a compulsory selector (exactly one is always active). The chosen type is
// combined into the real generation request, so it genuinely shapes the output.
const IMAGE_TYPES = [
  'Modern app logo',
  'Website banner',
  'App icon',
  'UI screenshot',
  'Illustration',
  'Avatar',
  'Background',
  'Thumbnail',
];

const COLOR_HINTS = [
  { color: '#6366f1', label: 'Indigo' },
  { color: '#10b981', label: 'Emerald' },
  { color: '#f59e0b', label: 'Amber' },
  { color: '#ef4444', label: 'Red' },
  { color: '#3b82f6', label: 'Blue' },
  { color: '#8b5cf6', label: 'Purple' },
];

const STYLE_ENHANCERS: Record<string, string> = {
  minimal: 'minimalist, clean white background, simple shapes, ',
  vibrant: 'vibrant colors, high contrast, bold, colorful, ',
  dark: 'dark background, neon accents, moody, cinematic, ',
  gradient: 'smooth gradient, colorful gradient background, ',
  flat: 'flat design, 2D, vector style, no shadows, ',
  '3d': '3D render, isometric, depth, shadows, realistic, ',
};

export function AIImageGenerator({ onImageGenerated }: Props) {
  const [prompt, setPrompt] = useState('');
  const [imageType, setImageType] = useState(IMAGE_TYPES[0]); // compulsory — always one selected
  const [style, setStyle] = useState('minimal');
  const [size, setSize] = useState('square');
  const [isLoading, setIsLoading] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [imageError, setImageError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [copied, setCopied] = useState(false);
  const [craftNotes, setCraftNotes] = useState<string[]>([]);
  const [actionNote, setActionNote] = useState(''); // honest fallback message for copy/download

  // REAL generation (admin autopsy 2026-07-20): images come from NavBharatAI's own server route
  // (/api/image/generate) on our configured image engine — the old code hot-linked a third-party
  // free image site from the browser (no server side at all; unreliable and outside our control).
  // History is PERSISTED in IndexedDB (admin 2026-07-24: "history save honi chahiye") — a generated
  // image is a multi-MB data URL that overflows localStorage, so IndexedDB holds up to 50 recents that
  // survive reload / tab close / app restart (per-device). Loaded on mount below.
  // The compulsory image type is always folded into what actually gets generated, so a selected
  // type shapes the output even when the free-text prompt is empty (type alone is a valid request).

  // Load the saved history once, on mount, so the user's past images are there after a reload.
  useEffect(() => {
    let alive = true;
    imageHistoryStore.getAll().then((items) => { if (alive) setHistory(items); }).catch(() => { /* store unavailable → empty */ });
    return () => { alive = false; };
  }, []);

  const buildEffectivePrompt = () =>
    `${imageType}${prompt.trim() ? ` — ${prompt.trim()}` : ''}`;

  const handleGenerate = async () => {
    const effectivePrompt = buildEffectivePrompt();
    if (!effectivePrompt.trim() || isLoading) return;
    setGeneratedUrl('');
    setImageError(false);
    setErrorMsg('');
    setCraftNotes([]);
    setIsLoading(true);
    try {
      // Send the Firebase auth token — /api/image/generate requires a real account (per-image billing),
      // so WITHOUT this header the server saw an anonymous caller and asked the (already logged-in) user
      // to sign in. Root-caused 2026-07-31: the fetch previously sent no Authorization header.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const tok = await auth.currentUser?.getIdToken();
        if (tok) headers.Authorization = `Bearer ${tok}`;
      } catch { /* token optional here — the server still returns an honest sign-in prompt if truly anon */ }
      const res = await fetch('/api/image/generate', {
        method: 'POST',
        headers,
        // `type` goes as its OWN field (2026-08-14). It used to survive only as a prefix inside the
        // prompt string, so the server could not tell the selected type from the user's own words —
        // and that is precisely the signal the art-direction layer needs to know whether this must
        // read at 48px, leave room for a headline, or survive a circular crop.
        body: JSON.stringify({ prompt: effectivePrompt, style, size, type: imageType }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.image !== 'string') {
        throw new Error((data && typeof data.error === 'string' && data.error)
          || 'Image generation failed — please try again.');
      }
      setGeneratedUrl(data.image);
      // Honest caveats from the server — a style chip that was overruled, or the warning that image
      // engines cannot spell. Shown, never swallowed: a user who knows their shop name may come out
      // garbled can shorten it, where a silent misspelling just wastes a generation.
      setCraftNotes(Array.isArray(data.notes) ? data.notes.filter((n: unknown) => typeof n === 'string') : []);
      const newItem: GeneratedImage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url: data.image,
        prompt: prompt.trim(),
        type: imageType,
        style,
        size,
        timestamp: Date.now(),
      };
      // Persist to IndexedDB so it survives reloads, then reflect it in the UI (newest-first, bounded).
      setHistory((h) => pruneHistory([newItem, ...h]));
      void imageHistoryStore.save(newItem).catch(() => { /* persistence is best-effort — never blocks generation */ });
      if (onImageGenerated) onImageGenerated(data.image, effectivePrompt);
    } catch (e) {
      // Honest failure — the real reason from the server, never a placeholder image.
      setImageError(true);
      setErrorMsg(e instanceof Error ? e.message : 'Image generation failed — please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnhance = () => {
    const enhancer = STYLE_ENHANCERS[style] || '';
    if (!prompt.startsWith(enhancer)) {
      setPrompt(enhancer + prompt);
    }
  };

  // Resolve the generated image to a real Blob. It is almost always a data: URL (the server returns
  // `data:<mime>;base64,<...>`), but fall back to fetch for any http(s) URL so both cases work.
  const resolveBlob = async (url: string): Promise<Blob> => {
    if (url.startsWith('data:')) return dataUrlToBlob(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not fetch the image');
    return res.blob();
  };

  // The clipboard image API only accepts PNG in most browsers — convert anything else via a canvas.
  const toPngBlob = async (blob: Blob): Promise<Blob> => {
    if (blob.type === 'image/png') return blob;
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new window.Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image decode failed'));
        el.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 512;
      canvas.height = img.naturalHeight || 512;
      const ctx = canvas.getContext('2d');
      if (!ctx) return blob;
      ctx.drawImage(img, 0, 0);
      return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b || blob), 'image/png'));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const flashNote = (msg: string) => {
    setActionNote(msg);
    setTimeout(() => setActionNote(''), 3500);
  };

  // COPY THE ACTUAL IMAGE (not the URL). Puts a real PNG on the clipboard so it pastes as a picture
  // into any app. Falls back to copying the link only if the browser can't do image clipboard.
  const handleCopyImage = async () => {
    if (!generatedUrl) return;
    setActionNote('');
    try {
      const hasClipboardImage = typeof navigator !== 'undefined' && !!navigator.clipboard
        && typeof (window as unknown as { ClipboardItem?: unknown }).ClipboardItem !== 'undefined';
      if (!hasClipboardImage) throw new Error('no image clipboard');
      // Pass a Promise<Blob> into ClipboardItem (not an already-awaited Blob): Safari/iOS WebView keeps
      // the user-gesture alive across the async decode this way, so image copy works there too.
      const pngPromise = (async () => toPngBlob(await resolveBlob(generatedUrl)))();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Honest fallback — tell the user we copied the link (not the image) so they know what they got.
      try { await navigator.clipboard.writeText(generatedUrl); } catch { /* clipboard fully blocked */ }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      flashNote('This device can’t copy the image itself — the image link was copied instead. Use Download to save the picture.');
    }
  };

  // Raw base64 for a native file write: prefer the data URL's own payload, else read the Blob.
  const toBase64 = async (url: string, blob: Blob): Promise<string> => {
    if (url.startsWith('data:')) {
      try { return dataUrlToBase64(url); } catch { /* fall through to FileReader */ }
    }
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const s = String(reader.result || '');
        resolve(s.slice(s.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(blob);
    });
  };

  // ONE-TAP Save to Photos on the native app: write a temp file (Filesystem), then hand its file URI to
  // the media plugin (savePhoto → the device Photo gallery). Plugins are dynamically imported so the web
  // bundle never loads native code. Throws on any failure so the caller falls back to the share sheet.
  const saveToPhotosNative = async (base64: string, filename: string): Promise<void> => {
    const [{ Filesystem, Directory }, { Media }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor-community/media'),
    ]);
    const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    try {
      await Media.savePhoto({ path: written.uri });
    } finally {
      try { await Filesystem.deleteFile({ path: filename, directory: Directory.Cache }); } catch { /* best-effort cleanup */ }
    }
  };

  // DOWNLOAD / SAVE the image. Native: ONE-TAP Save to Photos (media plugin) → OS share sheet fallback.
  // Web: a blob-URL download (far more reliable than a data: href, which just opens a tab).
  const handleDownload = async () => {
    if (!generatedUrl) return;
    setActionNote('');
    try {
      const blob = await resolveBlob(generatedUrl);
      const filename = imageFilename(prompt, blob.type);

      if (Capacitor.isNativePlatform()) {
        // 1) Primary: save straight to the Photos gallery, one tap.
        try {
          const base64 = await toBase64(generatedUrl, blob);
          await saveToPhotosNative(base64, filename);
          flashNote('Saved to your Photos ✓');
          return;
        } catch { /* permission denied / plugin error → fall through to the share sheet */ }
        // 2) Fallback: OS share sheet (Save Image / Save to Files).
        try {
          const file = new File([blob], filename, { type: blob.type });
          const nav = navigator as Navigator & { canShare?: (d?: unknown) => boolean };
          if (nav.canShare && nav.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: filename });
            return;
          }
        } catch (e) {
          if ((e as { name?: string })?.name === 'AbortError') return; // user cancelled the share sheet
          // else fall through to the blob-URL download
        }
      }

      // Web (and native final fallback): trigger a real file download from a blob URL.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      flashNote('Could not save the image automatically — long-press the image to save it.');
    }
  };

  const handleClearHistory = () => {
    setHistory([]);
    setGeneratedUrl('');
    void imageHistoryStore.clear().catch(() => { /* best-effort — the UI is already cleared */ });
  };

  const relativeTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  const selectedSize = SIZES.find(s => s.id === size) || SIZES[0];

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#161b22]">
        <div className="w-10 h-10 bg-violet-600/20 rounded-xl flex items-center justify-center">
          <Wand2 className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h2 className="font-semibold text-white text-base">AI Image Generator</h2>
          <p className="text-xs text-white/40">Write a prompt to generate images — logos, banners, icons</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] bg-violet-500/20 text-violet-300 px-2 py-1 rounded-full border border-violet-500/30">NavBharatAI</span>
          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-1 rounded-full border border-emerald-500/30">Free</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        <div className="w-[60%] flex flex-col gap-4 p-5 overflow-y-auto border-r border-white/5">
          {/* Image Type — compulsory: exactly one is always selected (comes first, above the prompt) */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Image Type</label>
            <div className="flex flex-wrap gap-1.5">
              {IMAGE_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => setImageType(t)}
                  aria-pressed={imageType === t}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    imageType === t
                      ? 'border-violet-500/60 bg-violet-500/20 text-violet-200 font-medium'
                      : 'border-white/5 bg-[#161b22] text-white/50 hover:border-white/10 hover:text-white/70'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Prompt</label>
            <textarea
              className="w-full bg-[#161b22] border border-white/10 rounded-xl p-3 text-sm text-white placeholder-white/20 resize-none focus:outline-none focus:border-violet-500/50 transition-colors"
              rows={4}
              placeholder="Add details for your Modern app logo, banner, icon... e.g. 'with blue gradient and rupee symbol'"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
            />
            <div className="flex items-center justify-end mt-2">
              <button
                onClick={handleEnhance}
                className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 shrink-0"
              >
                <Sparkles className="w-3 h-3" /> Enhance
              </button>
            </div>
          </div>

          {/* Style */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Style</label>
            <div className="grid grid-cols-3 gap-2">
              {STYLES.map(s => (
                <button
                  key={s.id}
                  onClick={() => setStyle(s.id)}
                  className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${
                    style === s.id
                      ? 'border-violet-500/60 bg-violet-500/10'
                      : 'border-white/5 bg-[#161b22] hover:border-white/10'
                  }`}
                >
                  <span className="text-lg">{s.emoji}</span>
                  <div>
                    <div className="text-xs font-medium text-white">{s.label}</div>
                    <div className="text-[10px] text-white/30">{s.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Size */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Size / Format</label>
            <div className="grid grid-cols-4 gap-2">
              {SIZES.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSize(s.id)}
                  className={`flex flex-col items-center p-2.5 rounded-xl border text-center transition-all ${
                    size === s.id
                      ? 'border-violet-500/60 bg-violet-500/10'
                      : 'border-white/5 bg-[#161b22] hover:border-white/10'
                  }`}
                >
                  <div className={`mb-1 border border-white/20 ${
                    s.id === 'wide' ? 'w-8 h-4' : s.id === 'portrait' ? 'w-4 h-7' : 'w-5 h-5'
                  } rounded-sm`} />
                  <div className="text-[10px] font-medium text-white">{s.label}</div>
                  <div className="text-[9px] text-white/30">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Color Hints */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block flex items-center gap-1.5">
              <Palette className="w-3 h-3" /> Color Hints
            </label>
            <div className="flex gap-2">
              {COLOR_HINTS.map(c => (
                <button
                  key={c.color}
                  onClick={() => setPrompt(p => p + ` in ${c.label.toLowerCase()} tones`)}
                  title={`Add ${c.label}`}
                  className="w-7 h-7 rounded-full border-2 border-white/20 hover:scale-110 transition-transform"
                  style={{ backgroundColor: c.color }}
                />
              ))}
              <span className="text-xs text-white/30 self-center ml-1">Click to add to prompt</span>
            </div>
          </div>

          {/* Generate Button — pinned at the very bottom of the left column */}
          <button
            onClick={handleGenerate}
            disabled={isLoading}
            className="w-full py-3.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors mt-2"
          >
            {isLoading ? (
              <><TirangaLoader className="w-4 h-4" /> Generating...</>
            ) : (
              <><Wand2 className="w-4 h-4" /> Generate Image</>
            )}
          </button>
        </div>

        {/* Right Panel */}
        <div className="flex-1 flex flex-col gap-4 p-5 overflow-y-auto">
          {/* Generated Image */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Generated Image</label>
            <div className="relative bg-[#161b22] border border-white/5 rounded-xl overflow-hidden" style={{ minHeight: '240px' }}>
              {isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <TirangaLoader className="w-12 h-12" />
                  <p className="text-xs text-white/40">Generating AI image...</p>
                  <p className="text-[10px] text-white/20">Size: {selectedSize.w}×{selectedSize.h}</p>
                </div>
              )}
              {!isLoading && imageError && (
                <div className="flex flex-col items-center justify-center h-60 gap-2 px-4 text-center">
                  <ImageIcon className="w-10 h-10 text-white/10" />
                  <p className="text-xs text-red-400">{errorMsg || 'Image could not be generated. Retry or change the prompt.'}</p>
                  <button onClick={handleGenerate} className="text-xs text-violet-400 hover:underline">Retry</button>
                </div>
              )}
              {!isLoading && !imageError && !generatedUrl && (
                <div className="flex flex-col items-center justify-center h-60 gap-2">
                  <Wand2 className="w-10 h-10 text-white/10" />
                  <p className="text-xs text-white/30">Pick a type, add details, then press Generate</p>
                </div>
              )}
              {!isLoading && !imageError && generatedUrl && (
                <>
                  <img
                    src={generatedUrl}
                    alt="Generated"
                    className="w-full object-cover rounded-xl"
                    onError={() => { setImageError(true); setGeneratedUrl(''); }}
                  />
                  <div className="absolute bottom-2 right-2 flex gap-1.5">
                    <button
                      onClick={handleCopyImage}
                      className="p-1.5 bg-black/60 hover:bg-black/80 rounded-lg transition-colors"
                      title="Copy image"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-white/70" />}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="p-1.5 bg-black/60 hover:bg-black/80 rounded-lg transition-colors"
                      title="Download image"
                    >
                      <Download className="w-3.5 h-3.5 text-white/70" />
                    </button>
                  </div>
                </>
              )}
            </div>
            {/* Honest fallback note (e.g. device can't copy the raw image, or save needs a long-press). */}
            {actionNote && (
              <p className="mt-2 text-[11px] text-amber-300/80 leading-relaxed">{actionNote}</p>
            )}
            {/* Art-direction notes from the server: a style chip that was overruled by the user's own
                wording, or the warning that no image engine spells reliably. These are shown BESIDE
                the finished image, where the user can act on them — a spelling warning after the fact
                is what saves the next generation, not a silent bad result. */}
            {craftNotes.length > 0 && (
              <ul className="mt-2 space-y-1">
                {craftNotes.map((n, i) => (
                  <li key={i} className="text-[11px] text-sky-300/80 leading-relaxed flex gap-1.5">
                    <span aria-hidden="true">•</span><span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Recent History */}
          {history.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3 h-3" /> Recent ({history.length})
                </label>
                <button onClick={handleClearHistory} className="text-[10px] text-white/30 hover:text-red-400 flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {history.map(item => (
                  <button
                    key={item.id}
                    onClick={() => { setGeneratedUrl(item.url); setPrompt(item.prompt); setImageType(item.type || IMAGE_TYPES[0]); setStyle(item.style); setSize(item.size); }}
                    className="group relative rounded-lg overflow-hidden border border-white/5 hover:border-violet-500/40 transition-all aspect-square bg-[#161b22]"
                  >
                    <img src={item.url} alt={item.prompt} className="w-full h-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-1">
                      <p className="text-[8px] text-white text-center line-clamp-2">{item.prompt}</p>
                      <p className="text-[7px] text-white/50">{relativeTime(item.timestamp)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tips */}
          <div className="bg-violet-500/5 border border-violet-500/10 rounded-xl p-3">
            <p className="text-xs text-violet-300 font-medium mb-1.5 flex items-center gap-1.5">
              <Star className="w-3 h-3" /> Pro Tips
            </p>
            <ul className="text-[10px] text-white/40 space-y-1">
              <li>• Specific prompts = better results ("blue gradient tech logo" not just "logo")</li>
              <li>• Style + Color hints add extra quality</li>
              <li>• "Enhance" button adds style-specific keywords automatically</li>
              <li>• You can use the image URL directly in an img tag</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
