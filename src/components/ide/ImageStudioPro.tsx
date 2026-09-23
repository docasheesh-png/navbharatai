import { draftAfterFailedSend } from '../../lib/draftAfterSend';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ModeButton } from '../chat/ModeButton';
import { ComposerShell, COMPOSER_ICON_CLASS, COMPOSER_SEND_CLASS, COMPOSER_TEXTAREA_CLASS } from '../chat/ComposerShell';
import { Send, Download, ImagePlus, Loader2, Pencil, RefreshCw, Sparkles, Type, X } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { dataUrlToBlob, imageFilename } from '../../lib/imageExport';
import { TextOverlayEditor } from './TextOverlayEditor';
import { ImageOptionSelect, type ImageOption } from './ImageOptionSelect';
import { CustomSizeFields } from './CustomSizeFields';
import { CUSTOM_SIZE_ID, DEFAULT_CUSTOM_SIZE, pixelsForSize, resolveCustomSize } from '../../lib/imageSize';
import { ImageCropEditor } from './ImageCropEditor';
import { extractImageText, layersFromExtracted } from '../../lib/imageTextFromPrompt';
import { imagePromptLimit, imagePromptLimitNote } from '../../lib/imagePromptLimit';

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

/**
 * The size options, in the shape the SHARED selector takes.
 *
 * Admin, 2026-09-21: *"dono same hi hai"* — and until this change they were not. The free tier and
 * this studio each drew their own size control, so a user moving between the two met two different
 * widgets for one decision. One component now, used on both screens, which is also the only way the
 * Escape key, the scrim and the tab-bar reservation stay right in both places at once.
 */
const SIZES: ImageOption[] = [
  { id: 'square', label: '1:1', desc: 'Square, 1024×1024' },
  { id: 'wide', label: '16:9', desc: 'Wide, 1280×720' },
  { id: 'portrait', label: '3:4', desc: 'Portrait, 864×1152' },
  { id: 'icon', label: 'Icon', desc: 'App icon, 1024×1024' },
  { id: CUSTOM_SIZE_ID, label: 'Custom', desc: 'Your own width and height' },
];

/**
 * What one Pro image costs the user, in ₹.
 *
 * ⚠️ A COPY, and the server's `IMAGE_PRO_PRICE_INR` is the authority — this file runs in the browser
 * and must not import server code. `tests/theProPriceIsOneNumber.test.ts` fails CI if the two ever
 * disagree, because a price shown here and charged there are the same promise to the same person.
 */
const PRICE_INR = 1;

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

export function ImageStudioPro({ onImageGenerated, onOpenModePicker, onOpenHistory }: {
  onImageGenerated?: (url: string, prompt: string) => void;
  /** Open the ONE mode picker; undefined on a phone, where the bottom bar carries Mode. */
  onOpenModePicker?: (() => void) | undefined;
  onOpenHistory?: (() => void) | undefined;
}) {
  const [prompt, setPrompt] = useState('');
  const [ref, setRef] = useState<string | null>(null);
  const [size, setSize] = useState('square');
  // Which picture the crop sheet is open on. The ORIGINAL is what it re-opens with, so adjusting
  // twice never cuts a cut — the same rule the free tier's picker follows.
  const [cropping, setCropping] = useState<string | null>(null);
  const [refOriginal, setRefOriginal] = useState<string | null>(null);
  const [customW, setCustomW] = useState(DEFAULT_CUSTOM_SIZE.w);
  const [customH, setCustomH] = useState(DEFAULT_CUSTOM_SIZE.h);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  // Which result the text editor is open on — an id, not a boolean, because this surface shows a
  // whole run of images and "add text" has to mean the one whose button was pressed. Applying
  // REPLACES that result's url in place, so Save and "use as reference" both carry the text
  // forward; appending a second copy would leave two near-identical images in the list and no way
  // to tell which one has the right phone number on it.
  const [textOn, setTextOn] = useState<string | null>(null);
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
    fr.onload = () => { const u = String(fr.result || ''); setRef(u); setRefOriginal(u); setError(''); };
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

  // The server refuses a prompt over its limit, so a send that can only fail is not offered.
  const promptLimit = imagePromptLimit(prompt.trim());

  const generate = async () => {
    if (!mode || busy || promptLimit.over) return;
    // The box empties at send, like every other box in this app, and the words come back only if
    // the send fails — the same rule the free composer follows (`draftAfterFailedSend`).
    const typed = prompt.trim();
    setPrompt('');
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
        body: JSON.stringify({
          prompt: typed,
          size,
          // Already through the server's own clamp, so the picker's number and the generated
          // picture are the same number. Absent for a preset — nothing downstream changes.
          ...(size === CUSTOM_SIZE_ID ? resolveCustomSize(customW, customH) : {}),
          ...(ref ? { initImage: ref } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.image !== 'string') {
        throw new Error((data && typeof data.error === 'string' && data.error) || 'That image could not be generated.');
      }
      const item: Result = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url: data.image,
        prompt: typed,
        mode: (data.mode as Mode) || mode,
        size,
        chargedInr: typeof data.chargedInr === 'number' ? data.chargedInr : PRICE_INR,
        at: Date.now(),
      };
      setResults((r) => [...r, item]);
      if (onImageGenerated) onImageGenerated(data.image, item.prompt);
    } catch (e) {
      // The server's real reason, never a placeholder image and never a cheerful lie. The route
      // guarantees a failure was not charged and says so in its own words. The words come back,
      // unless a new brief is already being typed.
      setPrompt((cur) => draftAfterFailedSend(cur, typed));
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
                  {/* Same editor as the free tier. A paying user must never be the one who loses a
                      capability — and this is the tier whose text is most likely to be a real
                      shop's name and number. */}
                  <button
                    onClick={() => setTextOn(r.id)}
                    className="text-[11px] flex items-center gap-1.5 text-muted hover:text-ink border border-line hover:border-line rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    <Type className="w-3 h-3" /> Add text
                  </button>
                  {/* The studio move a search page has no reason to offer: carry this result straight
                      back into the input as the next request's reference. */}
                  <button
                    onClick={() => { setRef(r.url); setRefOriginal(r.url); taRef.current?.focus(); }}
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
              {/* Crop and resize, the same control the free tier has — admin 2026-09-21: the +/0/−
                  arrangement is asked for on BOTH tiers, so it is one component used twice. */}
              <button
                onClick={() => setCropping(refOriginal || ref)}
                aria-label="Adjust the picture"
                className="shrink-0 text-faint hover:text-ink p-1"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setRef(null); setRefOriginal(null); }}
                aria-label="Remove the picture"
                className="shrink-0 text-faint hover:text-ink p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* The selector sits ABOVE the input, where the free tier's four now sit — "sabse niche
              input box. uske upar selector". This studio has one option to choose, because its mode
              is DERIVED from what you attach rather than picked. */}
          <div className="flex items-center gap-2">
            <div className="w-40 shrink-0">
              <ImageOptionSelect
                label="Size / format"
                heading="What shape do you need?"
                options={SIZES}
                value={size}
                onChange={setSize}
              />
            </div>
            {mode && <span className="text-[11px] text-muted truncate">{MODE_LABEL[mode]}</span>}
          </div>

          {size === CUSTOM_SIZE_ID && (
            <CustomSizeFields
              width={customW}
              height={customH}
              onChange={(w, h) => { setCustomW(w); setCustomH(h); }}
              className="rounded-xl border border-line bg-raised px-2.5 py-2"
            />
          )}

          {/* OUTSIDE the pill, to its left (admin 2026-09-21: "input box se pahle mode button").
              Inside it the button would read as part of the message box; the free chat's composer
              already places it this way, and this is that same shared control. */}
          {/* THE FREE CHAT'S COMPOSER (admin 2026-09-23: "sabhi ai … navbharatai free ke jaisa karo").
              Mode outside on the left; attach and Generate inside on the right, and Generate is the free
              chat's own send button. The ₹1 price is still stated where it always was — on the Pro chip
              and in this button's tooltip — so the colour is not the only thing telling the user. */}
          <ComposerShell
            onOpenHistory={onOpenHistory}
            onOpenMode={onOpenModePicker}
            controls={(
              <>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  title="Attach an image to work from"
                  aria-label="Attach an image to work from"
                  className={COMPOSER_ICON_CLASS}
                >
                  <ImagePlus className="w-4 h-4" />
                </button>
              </>
            )}
            send={(
              <>
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={!mode || busy || promptLimit.over}
                  title={promptLimit.over ? 'Too long to send — please shorten it' : mode ? `Generate — ₹${PRICE_INR}` : 'Describe an image, or attach one'}
                  aria-label={`Generate — ₹${PRICE_INR}`}
                  className={COMPOSER_SEND_CLASS}
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </>
            )}
          >
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
              className={COMPOSER_TEXTAREA_CLASS}
            />
          </ComposerShell>
          {promptLimit.near && (
            <p className={`text-[11px] text-right px-3 ${promptLimit.over ? 'text-danger' : 'text-faint'}`} aria-live="polite">
              {imagePromptLimitNote(promptLimit)}
            </p>
          )}
          {/* The price is on the toggle chip ("Pro ₹1") and in the empty state; a third copy under the
              box only cost a line of a phone screen (admin 2026-09-21: "pro mode me already yah likha
              hai … space khatam ho raha hai, hatao"). "Charged only if it arrives" is still true, and
              still said — on the failure card, where a user who was not charged is the one reading. */}
        </div>
      </div>

      {cropping && (
        <ImageCropEditor
          image={cropping}
          frame={pixelsForSize(size, customW, customH)}
          onClose={() => setCropping(null)}
          onDone={(url) => { setRef(url); setCropping(null); }}
        />
      )}

      {textOn && (() => {
        const target = results.find((r) => r.id === textOn);
        if (!target) return null;
        return (
          <TextOverlayEditor
            imageUrl={target.url}
            // From THAT result's own prompt, not the input bar's current contents: this surface keeps
            // a whole run of images, and the bar has usually moved on to the next request by now.
            initialLayers={layersFromExtracted(extractImageText(target.prompt || ''), () => `p${Date.now()}${Math.random().toString(36).slice(2, 7)}`)}
          extracted={extractImageText(target.prompt || '')}
            onClose={() => setTextOn(null)}
            onApply={(url) => {
              setResults((rs) => rs.map((r) => (r.id === textOn ? { ...r, url } : r)));
              setTextOn(null);
            }}
          />
        );
      })()}
    </div>
  );
}

export default ImageStudioPro;
