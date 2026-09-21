// Add real text to a generated image (admin-asked 2026-09-21).
//
// The engine draws the picture; the FONT draws the words. That split is the whole feature: an image
// model imitates the shape of text, so a phone number it "writes" is digits that look right and are
// not — and a banner printed with a wrong number is a real loss to a real shopkeeper. Devanagari is
// worse again, because its conjuncts and matras need glyph shaping no diffusion model does.
//
// 🔑 THE PREVIEW AND THE EXPORT CALL THE SAME FUNCTION. `drawTextLayers` renders the on-screen canvas
// and the downloaded file alike, differing only in the pixel dimensions passed to it — and sizes are
// measured against the SHORTER side precisely so those two dimensions agree. A second "preview"
// renderer is the obvious shortcut here and would be the bug: what the user positions would not be
// what they save, and nothing would fail to reveal it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Check, Plus, Trash2, Type, X } from 'lucide-react';
import {
  MAX_LAYERS,
  MAX_SIZE_PCT,
  MAX_TEXT_CHARS,
  MIN_SIZE_PCT,
  composeImage,
  defaultLayer,
  devanagariRendersHere,
  devanagariWarning,
  imagePixels,
  normalizeLayer,
  type TextLayer,
} from '../../lib/textOverlay';

interface Props {
  /** The generated image, as a data URL or an https URL. */
  imageUrl: string;
  /** Called with the composited PNG data URL when the user presses Done. */
  onApply: (dataUrl: string) => void;
  onClose: () => void;
}

// The user's own palette for THEIR picture — deliberately fixed hexes, not theme tokens: a caption
// must look the same in the exported file whatever theme the app is wearing (see `textOverlay.ts`).
const SWATCHES = ['#ffffff', '#000000', '#ffd400', '#ff3b30', '#0a84ff', '#34c759', '#ff9f0a', '#ff2d9b'];
const BAND_CHOICES: Array<{ id: string; label: string; value: string }> = [
  { id: 'none', label: 'None', value: '' },
  { id: 'dark', label: 'Dark bar', value: 'rgba(0,0,0,0.55)' },
  { id: 'light', label: 'Light bar', value: 'rgba(255,255,255,0.82)' },
];

let nextId = 0;
const newId = () => `t${++nextId}`;

export function TextOverlayEditor({ imageUrl, onApply, onClose }: Props) {
  const [layers, setLayers] = useState<TextLayer[]>(() => [defaultLayer(newId(), '')]);
  const [activeId, setActiveId] = useState<string>(() => layers[0].id);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [devanagariOk, setDevanagariOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragging = useRef(false);

  const active = layers.find((l) => l.id === activeId) ?? layers[0];

  const patch = useCallback((id: string, next: Partial<TextLayer>) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? normalizeLayer({ ...l, ...next }) : l)));
  }, []);

  // Load the picture once. `crossOrigin` is set BEFORE `src` because setting it afterwards does not
  // re-request — and without it a remote (non-data:) image taints the canvas, so `toDataURL` throws
  // at the very end, after the user has done all the work. Data URLs are same-origin and unaffected.
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { if (alive) { setImage(img); setLoadFailed(false); } };
    img.onerror = () => { if (alive) setLoadFailed(true); };
    img.src = imageUrl;
    return () => { alive = false; };
  }, [imageUrl]);

  // Ask the device — once — whether it can actually draw Devanagari, using the same font stack the
  // canvas will use. A measurement, not a user-agent guess.
  useEffect(() => {
    try {
      const probe = document.createElement('canvas').getContext('2d');
      if (probe) setDevanagariOk(devanagariRendersHere(probe));
    } catch { /* no canvas to ask — leave it at "fine", since we cannot show a warning we can't justify */ }
  }, []);

  /**
   * Size the canvas to the picture and hand it to `composeImage`.
   *
   * ⚠️ THE ONLY PLACE THIS COMPONENT DRAWS. Both the live preview and the export go through here, so
   * there is no second renderer that could disagree with the first — `theTextOnAnImageIsRealText`
   * asserts that, because a divergence would be invisible until a user had printed the result.
   */
  const paint = useCallback((canvas: HTMLCanvasElement, img: HTMLImageElement) => {
    const { w, h } = imagePixels(img);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    // Explicit type argument: inference picks the looser `DrawableImage` from the context parameter
    // and then the real `drawImage` no longer matches. Naming the image type settles it.
    composeImage<HTMLImageElement>(ctx, img, layers);
    return true;
  }, [layers]);

  // Repaint whenever the picture or any layer changes. The canvas is sized in CSS to fit the panel,
  // so it is drawn at full resolution and displayed scaled — which is why the export is sharp.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && image) paint(canvas, image);
  }, [image, paint]);

  const warning = useMemo(() => devanagariWarning(layers, devanagariOk), [layers, devanagariOk]);

  /** Turn a pointer event into the active layer's new centre, in image fractions. */
  const moveTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    patch(active.id, {
      xPct: (e.clientX - rect.left) / rect.width,
      yPct: (e.clientY - rect.top) / rect.height,
    });
  };

  const handleDone = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    setBusy(true);
    try {
      // Repaint synchronously before reading, so a pending React render can never let us export a
      // frame that is one edit behind what the user is looking at.
      if (!paint(canvas, image)) throw new Error('no 2d context');
      onApply(canvas.toDataURL('image/png'));
    } catch {
      // A tainted canvas is the realistic failure, and it is ours, not the user's fault — so say
      // what to do rather than "failed".
      setLoadFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const addLayer = () => {
    if (layers.length >= MAX_LAYERS) return;
    const layer = defaultLayer(newId(), '');
    // Offset each new caption upward so a second one is not hidden exactly under the first.
    layer.yPct = Math.max(0.1, 0.82 - layers.length * 0.14);
    setLayers((prev) => [...prev, layer]);
    setActiveId(layer.id);
  };

  const removeLayer = (id: string) => {
    setLayers((prev) => {
      const next = prev.filter((l) => l.id !== id);
      const kept = next.length > 0 ? next : [defaultLayer(newId(), '')];
      if (id === activeId) setActiveId(kept[kept.length - 1].id);
      return kept;
    });
  };

  const hasText = layers.some((l) => l.text.trim().length > 0);

  return (
    // `nb-sheet-overlay` / `nb-sheet` (index.css) rather than a bare `vh` cap: on a phone `vh` is the
    // LARGE viewport, so a 95vh panel is taller than the screen the moment the browser chrome is
    // showing and its own footer becomes unreachable. That bug reached the admin twice from two
    // different files, which is why the repo has one shared geometry and a test that enforces it.
    <div className="nb-sheet-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-scrim">
      <div className="nb-sheet w-full sm:max-w-3xl flex flex-col overflow-y-auto bg-surface sm:rounded-2xl rounded-t-2xl border border-line">

        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 bg-card border-b border-line">
          <div className="flex items-center gap-2 min-w-0">
            <Type className="w-4 h-4 text-accent-text shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-ink truncate">Add text</h2>
              <p className="text-[11px] text-muted truncate">Typed text is always spelled right — Hindi too</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDone}
              disabled={!image || busy || !hasText}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-medium disabled:opacity-40"
            >
              <Check className="w-3.5 h-3.5" /> Done
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-raised" aria-label="Close">
              <X className="w-4 h-4 text-muted" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div className="rounded-xl overflow-hidden border border-line bg-well">
            {loadFailed ? (
              <p className="p-6 text-xs text-warn text-center leading-relaxed">
                This picture could not be opened for editing here. Download it first, then add text — or generate a new one.
              </p>
            ) : (
              <canvas
                ref={canvasRef}
                className="w-full h-auto block touch-none cursor-move"
                onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); moveTo(e); }}
                onPointerMove={(e) => { if (dragging.current) moveTo(e); }}
                onPointerUp={(e) => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }}
                onPointerCancel={() => { dragging.current = false; }}
              />
            )}
          </div>
          <p className="text-[11px] text-faint">Drag on the picture to move the selected text.</p>

          {warning && <p className="text-[11px] text-warn leading-relaxed">{warning}</p>}

          {/* Layer chips — which caption the controls below are editing. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {layers.map((l, i) => (
              <button
                key={l.id}
                onClick={() => setActiveId(l.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
                  l.id === active.id ? 'bg-accent text-on-accent border-transparent' : 'bg-raised text-body border-line'
                }`}
              >
                {l.text.trim().split('\n')[0].slice(0, 14) || `Text ${i + 1}`}
              </button>
            ))}
            <button
              onClick={addLayer}
              disabled={layers.length >= MAX_LAYERS}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] bg-raised text-body border border-line disabled:opacity-40"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
            {layers.length > 1 && (
              <button onClick={() => removeLayer(active.id)} className="p-1.5 rounded-lg hover:bg-raised" aria-label="Delete this text">
                <Trash2 className="w-3.5 h-3.5 text-danger" />
              </button>
            )}
          </div>

          <div>
            <textarea
              value={active.text}
              onChange={(e) => patch(active.id, { text: e.target.value })}
              maxLength={MAX_TEXT_CHARS}
              rows={2}
              placeholder={'Shop name, phone number…\nPress Enter for a new line'}
              className="w-full px-3 py-2 rounded-xl bg-card border border-line text-sm text-ink placeholder:text-faint resize-none focus:outline-none focus:border-accent-text"
            />
            <p className="mt-1 text-[10px] text-faint text-right">{active.text.length}/{MAX_TEXT_CHARS}</p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-[11px] text-muted w-12 shrink-0">Size</label>
              <input
                type="range"
                min={MIN_SIZE_PCT * 1000}
                max={MAX_SIZE_PCT * 1000}
                value={active.sizePct * 1000}
                onChange={(e) => patch(active.id, { sizePct: Number(e.target.value) / 1000 })}
                className="flex-1 accent-[color:var(--accent)]"
              />
            </div>

            <div className="flex items-center gap-3">
              <label className="text-[11px] text-muted w-12 shrink-0">Colour</label>
              <div className="flex flex-wrap gap-1.5">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    onClick={() => patch(active.id, { color: c })}
                    aria-label={`Colour ${c}`}
                    style={{ background: c }}
                    className={`w-6 h-6 rounded-full border-2 ${active.color === c ? 'border-accent-text' : 'border-line'}`}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="text-[11px] text-muted w-12 shrink-0">Style</label>
              <div className="flex items-center gap-1">
                {(['left', 'center', 'right'] as const).map((a) => {
                  const Icon = a === 'left' ? AlignLeft : a === 'right' ? AlignRight : AlignCenter;
                  return (
                    <button
                      key={a}
                      onClick={() => patch(active.id, { align: a })}
                      aria-label={`Align ${a}`}
                      className={`p-1.5 rounded-lg border ${active.align === a ? 'bg-accent text-on-accent border-transparent' : 'bg-raised text-body border-line'}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  );
                })}
                <button
                  onClick={() => patch(active.id, { bold: !active.bold })}
                  aria-label="Bold"
                  className={`p-1.5 rounded-lg border ml-1 ${active.bold ? 'bg-accent text-on-accent border-transparent' : 'bg-raised text-body border-line'}`}
                >
                  <Bold className="w-3.5 h-3.5" />
                </button>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-body">
                <input type="checkbox" checked={active.outline} onChange={(e) => patch(active.id, { outline: e.target.checked })} />
                Outline
              </label>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-[11px] text-muted w-12 shrink-0">Behind</label>
              <div className="flex gap-1.5">
                {BAND_CHOICES.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => patch(active.id, { band: b.value })}
                    className={`px-2.5 py-1 rounded-lg text-[11px] border ${active.band === b.value ? 'bg-accent text-on-accent border-transparent' : 'bg-raised text-body border-line'}`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
