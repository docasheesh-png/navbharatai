import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Download, ImagePlus, Loader2, RefreshCw, Sparkles, Wand2, X } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { dataUrlToBlob, imageFilename } from '../../lib/imageExport';

/**
 * NavBharatAI Pro — the PAID image studio (admin 2026-09-18).
 *
 * "paid ka ui bhi alag hona chahiye! kuch world class ui ho, bhi free jaisa nahi.
 *  google home page jaisa banao, par results inputbox ke upar ane chahiye aur inputbox niche
 *  footer me ho. text to image, image to image, image+text to image yeh sab world class handel kare."
 *
 * WHAT "GOOGLE HOME PAGE JAISA" MEANS HERE, AND WHAT IT DELIBERATELY DOES NOT. The structural idea is
 * taken: one thing on the screen, enormous breathing room, a single pill input, nothing else asking
 * for attention until you have typed. What is NOT taken is the white canvas — this panel opens inside
 * a dark IDE, and a sheet of white would read as a broken frame rather than as a premium one. So the
 * premium signal is space and restraint instead of brightness, which is the same thing Google's page
 * is actually doing.
 *
 * THE INVERSION IS THE ADMIN'S, AND IT IS THE BETTER IDEA: results ABOVE, input pinned to the FOOTER.
 * A search page pushes its input to the top the moment you use it, so the thing you typed ends up far
 * from the thing it produced. Keeping the input where your hands already are — and letting results
 * grow upward out of it — means the second image costs no travel, which is what a studio needs and a
 * search page does not.
 *
 * 🔒 WHITE-LABEL: nothing here names the model or the vendor. To the user this is NavBharatAI Pro.
 */

const SIZES = [
  { id: 'square', label: '1:1', desc: '1024×1024' },
  { id: 'wide', label: '16:9', desc: '1280×720' },
  { id: 'portrait', label: '3:4', desc: '864×1152' },
  { id: 'icon', label: 'Icon', desc: '1024×1024' },
];

const PRICE_INR = 2;

const SUGGESTIONS = [
  'A neon-lit Mumbai street after rain, cinematic',
  'Minimal logo for a chai startup, flat vector',
  'Portrait of a Rajasthani potter, 85mm, golden hour',
  'Isometric illustration of an Indian post office',
];

type Mode = 'text-to-image' | 'image-to-image' | 'image-text-to-image';

interface Result {
  id: string;
  url: string;
  prompt: string;
  mode: Mode;
  size: string;
  chargedInr: number;
  at: number;
}

/** The mode is DERIVED, never chosen — the same rule the server applies, so the badge cannot lie. */
function modeOf(prompt: string, ref: string | null): Mode | null {
  const hasPrompt = prompt.trim().length > 0;
  if (ref && hasPrompt) return 'image-text-to-image';
  if (ref) return 'image-to-image';
  if (hasPrompt) return 'text-to-image';
  return null;
}

const MODE_LABEL: Record<Mode, string> = {
  'text-to-image': 'Text → Image',
  'image-to-image': 'Image → Image',
  'image-text-to-image': 'Image + Text → Image',
};

export function ImageStudioPro({ onImageGenerated }: { onImageGenerated?: (url: string, prompt: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [ref, setRef] = useState<string | null>(null);
  const [size, setSize] = useState('square');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const mode = modeOf(prompt, ref);

  // Newest result sits at the BOTTOM, closest to the input — so a new image appears exactly where the
  // eye already is, rather than at the far end of a scroll.
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [results.length, busy]);

  // The input grows with the text instead of scrolling inside a fixed box — a two-line brief should
  // be readable while it is being written.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [prompt]);

  const attach = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image. Attach a PNG or JPEG to work from.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('That image is over 8 MB — please attach a smaller one.');
      return;
    }
    const fr = new FileReader();
    fr.onload = () => { setRef(String(fr.result || '')); setError(''); };
    fr.onerror = () => setError('That image could not be read. Please try another one.');
    fr.readAsDataURL(file);
  }, []);

  // Paste and drop, because a reference image almost never arrives through a file dialog.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from<File>(e.clipboardData?.files || []).find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); attach(f); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [attach]);

  const generate = async () => {
    if (!mode || busy) return;
    setBusy(true);
    setError('');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const tok = await auth.currentUser?.getIdToken();
        if (tok) headers.Authorization = `Bearer ${tok}`;
      } catch { /* the server still answers with an honest sign-in prompt if truly anonymous */ }
      const res = await fetch('/api/image/pro/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: prompt.trim(), size, ...(ref ? { initImage: ref } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.image !== 'string') {
        throw new Error((data && typeof data.error === 'string' && data.error) || 'That image could not be generated.');
      }
      const item: Result = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url: data.image,
        prompt: prompt.trim(),
        mode: (data.mode as Mode) || mode,
        size,
        chargedInr: typeof data.chargedInr === 'number' ? data.chargedInr : PRICE_INR,
        at: Date.now(),
      };
      setResults((r) => [...r, item]);
      setPrompt('');
      if (onImageGenerated) onImageGenerated(data.image, item.prompt);
    } catch (e) {
      // The server's real reason, never a placeholder image and never a cheerful lie. The route
      // guarantees a failure was not charged and says so in its own words.
      setError(e instanceof Error ? e.message : 'That image could not be generated.');
    } finally {
      setBusy(false);
    }
  };

  const download = async (r: Result) => {
    try {
      const blob = r.url.startsWith('data:') ? dataUrlToBlob(r.url) : await (await fetch(r.url)).blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = imageFilename(r.prompt || 'navbharatai-pro');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1500);
    } catch {
      setError('Could not save that image automatically — long-press it to save.');
    }
  };

  const empty = results.length === 0 && !busy;

  return (
    <div
      className="h-full flex flex-col bg-surface text-ink overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = Array.from<File>(e.dataTransfer.files || []).find((x) => x.type.startsWith('image/'));
        if (f) attach(f);
      }}
    >
      {/* ── The canvas: results grow upward out of the input ───────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {empty ? (
          // The Google-homepage moment: one wordmark, one line, four suggestions, nothing else.
          <div className="h-full flex flex-col items-center justify-center px-6 text-center select-none">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400/20 to-fuchsia-500/20 border border-line flex items-center justify-center mb-6 text-on-accent">
              <Sparkles className="w-7 h-7 text-warn" />
            </div>
            <h1 className="text-[30px] sm:text-[38px] font-semibold tracking-tight bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent">
              NavBharatAI Pro
            </h1>
            <p className="mt-3 text-sm text-faint max-w-md">
              Describe an image, or attach one to work from. Sharper, more faithful results — ₹{PRICE_INR} per image.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2 max-w-2xl">
              {SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  onClick={() => { setPrompt(sug); taRef.current?.focus(); }}
                  className="text-xs text-muted hover:text-ink bg-raised hover:bg-raised-hover border border-line rounded-full px-3.5 py-2 transition-colors min-w-0 max-w-full truncate"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-10">
            {results.map((r) => (
              <figure key={r.id} className="space-y-3">
                <div className="flex items-center gap-2 text-[11px] text-faint min-w-0">
                  <span className="shrink-0 rounded-full border border-line bg-raised px-2 py-0.5">{MODE_LABEL[r.mode]}</span>
                  {r.prompt && <span className="truncate" title={r.prompt}>{r.prompt}</span>}
                </div>
                <div className="rounded-2xl overflow-hidden border border-line bg-well">
                  <img src={r.url} alt={r.prompt || 'Generated image'} className="w-full h-auto block" />
                </div>
                <figcaption className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => void download(r)}
                    className="text-[11px] flex items-center gap-1.5 text-muted hover:text-ink border border-line hover:border-line rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    <Download className="w-3 h-3" /> Save
                  </button>
                  {/* The studio move a search page has no reason to offer: carry this result straight
                      back into the input as the next request's reference. */}
                  <button
                    onClick={() => { setRef(r.url); taRef.current?.focus(); }}
                    className="text-[11px] flex items-center gap-1.5 text-muted hover:text-ink border border-line hover:border-line rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    <ImagePlus className="w-3 h-3" /> Use as reference
                  </button>
                  <button
                    onClick={() => { setPrompt(r.prompt); setSize(r.size); taRef.current?.focus(); }}
                    className="text-[11px] flex items-center gap-1.5 text-muted hover:text-ink border border-line hover:border-line rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" /> Try again
                  </button>
                  {/* Real money, shown on the thing it bought — never a running total the user has to
                      reconstruct from a bill later. */}
                  <span className="text-[11px] text-faint ml-auto shrink-0">
                    {r.chargedInr > 0 ? `₹${r.chargedInr}` : 'No charge'}
                  </span>
                </figcaption>
              </figure>
            ))}
            {busy && (
              <div className="rounded-2xl border border-line bg-raised aspect-square flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-6 h-6 text-warn animate-spin" />
                <p className="text-xs text-faint">Working on your image…</p>
              </div>
            )}
            <div ref={feedEndRef} />
          </div>
        )}
      </div>

      {/* ── The footer input ───────────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-line bg-surface backdrop-blur px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto space-y-2.5">
          {error && (
            <div className="flex items-start gap-2 text-[11px] text-danger bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
              <span className="min-w-0 flex-1">{error}</span>
              <button onClick={() => setError('')} className="shrink-0 text-danger hover:text-danger"><X className="w-3 h-3" /></button>
            </div>
          )}

          {ref && (
            <div className="flex items-center gap-2.5 bg-raised border border-line rounded-xl p-2 w-fit max-w-full">
              <img src={ref} alt="Reference" className="w-10 h-10 rounded-lg object-cover shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] text-body truncate">Working from this image</div>
                <div className="text-[10px] text-faint truncate">
                  {prompt.trim() ? 'Your words will direct the edit' : 'Add words to direct it, or send as-is'}
                </div>
              </div>
              <button onClick={() => setRef(null)} className="shrink-0 text-faint hover:text-ink p-1"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          <div className="flex items-end gap-2 bg-raised border border-line focus-within:border-amber-400/40 rounded-[26px] pl-2 pr-2 py-2 transition-colors">
            <button
              onClick={() => fileRef.current?.click()}
              title="Attach an image to work from"
              className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-raised transition-colors"
            >
              <ImagePlus className="w-4.5 h-4.5" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = ''; }}
            />
            <textarea
              ref={taRef}
              rows={1}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line — the convention every chat input uses, and
                // the reason the box grows rather than scrolls.
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void generate(); }
              }}
              placeholder={ref ? 'Describe the change, or press send to re-imagine…' : 'Describe the image you want…'}
              className="flex-1 min-w-0 bg-transparent resize-none text-sm text-ink placeholder-faint focus:outline-none py-2 leading-6"
            />
            <button
              onClick={() => void generate()}
              disabled={!mode || busy}
              title={mode ? `Generate — ₹${PRICE_INR}` : 'Describe an image, or attach one'}
              className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-amber-400 text-black disabled:bg-raised disabled:text-faint hover:bg-amber-300 transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {SIZES.map((s) => (
              <button
                key={s.id}
                onClick={() => setSize(s.id)}
                title={s.desc}
                className={`text-[11px] rounded-full px-2.5 py-1 border transition-colors min-w-0 ${
                  size === s.id
                    ? 'border-amber-400/50 bg-amber-400/10 text-warn'
                    : 'border-line text-faint hover:text-body hover:border-line'
                }`}
              >
                {s.label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-faint flex items-center gap-1.5 shrink-0">
              {mode ? <span className="text-muted">{MODE_LABEL[mode]}</span> : null}
              <span aria-hidden>·</span>
              <Wand2 className="w-3 h-3" /> ₹{PRICE_INR} per image
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ImageStudioPro;
