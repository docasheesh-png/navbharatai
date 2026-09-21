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
import { createPortal } from 'react-dom';
import { AlignCenter, AlignLeft, AlignRight, Bold, Check, LayoutTemplate, List, Plus, Trash2, Type, X } from 'lucide-react';
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
  rgbaFrom,
  splitFill,
  type LayerKind,
  type TextLayer,
} from '../../lib/textOverlay';
import { DEFAULT_FONT_ID, FONT_CHOICES, fontChoice } from '../../lib/imageFonts';
import { loadImageFont } from '../../lib/imageFontLoader';
import { BOARD_TEMPLATES, layersFromTemplate, type BoardTemplate } from '../../lib/imageBoardTemplates';
import type { ExtractedText } from '../../lib/imageTextFromPrompt';

interface Props {
  /** The generated image, as a data URL or an https URL. */
  imageUrl: string;
  /**
   * Layers to start with, read out of the user's own prompt.
   *
   * A suggestion, never a decision: every one is draggable, editable and deletable before anything is
   * drawn, and the user still has to press Done. What it removes is the blank-page moment — arriving
   * at something nearly right rather than at an empty box holding a number they already typed once.
   */
  initialLayers?: TextLayer[];
  /**
   * What was read out of the prompt, so a template can fill its slots from it.
   *
   * Passed separately from `initialLayers` on purpose: those are already PLACED, and a template's
   * job is to place them differently. Handing it the findings rather than the finished layers is
   * what stops "where does a phone go" existing in two places.
   */
  extracted?: ExtractedText[];
  /** Called with the composited PNG data URL when the user presses Done. */
  onApply: (dataUrl: string) => void;
  onClose: () => void;
}

// The user's own palette for THEIR picture — deliberately fixed hexes, not theme tokens: a caption
// must look the same in the exported file whatever theme the app is wearing (see `textOverlay.ts`).
const SWATCHES = ['#ffffff', '#000000', '#ffd400', '#ff3b30', '#0a84ff', '#34c759', '#ff9f0a', '#ff2d9b'];
/**
 * What each kind is for, in the user's own terms.
 *
 * The placeholder is the whole teaching surface for the list: nobody reads a help page, but everybody
 * reads the grey text inside an empty box. It shows the exact shape — item, space, price, one per
 * line — because that is all the format there is.
 */
const KINDS: Array<{ id: LayerKind; label: string; icon: typeof Type; placeholder: string }> = [
  { id: 'text', label: 'Text', icon: Type, placeholder: 'Shop name, phone number, address…\nPress Enter for a new line' },
  { id: 'list', label: 'Rate list', icon: List, placeholder: 'Chai 10\nSamosa 15\nCoffee 25\n\nOne item per line, price at the end' },
];

/**
 * The opacity a background gets when somebody picks a colour while it is currently off.
 *
 * 0.55, because that is the value `defaultLayer` has always used for its dark bar — a translucent
 * bar reads as part of the photograph, while a solid one reads as a sticker pasted over it. Picking
 * a colour turns the background ON at a sensible strength rather than leaving the user wondering why
 * the swatch they tapped changed nothing.
 */
const DEFAULT_BAND_ALPHA = 0.55;

/**
 * Border widths, as fractions of the FONT size rather than pixels.
 *
 * So a border chosen on a 1024 square looks the same on a 1280 banner — an absolute width would be
 * a hairline on one and a slab on the other, and the user only ever sees one of them while choosing.
 */
const BORDER_CHOICES: Array<{ label: string; value: number }> = [
  { label: 'None', value: 0 },
  { label: 'Thin', value: 0.03 },
  { label: 'Medium', value: 0.06 },
  { label: 'Thick', value: 0.11 },
];

/** `<input type="color">` accepts only `#rrggbb`. Anything else falls back rather than being lost. */
function hexOf(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? '')) ? value : fallback;
}

/**
 * The colour picker — the device's own, wearing a swatch.
 *
 * 🔑 A NATIVE `<input type="color">` IS THE RIGHT ANSWER HERE, not a hand-built HSB square. The OS
 * already draws exactly that picker, it is the one the user knows from every other app on their
 * phone, it is reachable by keyboard and by a screen reader for free, and it cannot drift from the
 * platform. A custom one would be several hundred lines that work worse on a touch screen.
 *
 * The input itself is invisible and covers the whole dot, so the coloured circle IS the button.
 */
function ColourDot({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  return (
    <span className="relative inline-flex w-6 h-6 shrink-0 rounded-full border-2 border-line overflow-hidden" title={label}>
      {/* The rainbow ring says "any colour", which a grey square does not. Decorative only. */}
      <span aria-hidden="true" className="absolute inset-0" style={{ background: 'conic-gradient(#ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' }} />
      <span aria-hidden="true" className="absolute inset-[5px] rounded-full border border-line" style={{ background: value }} />
      <input
        type="color"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </span>
  );
}

let nextId = 0;
const newId = () => `t${++nextId}`;

export function TextOverlayEditor({ imageUrl, initialLayers, extracted, onApply, onClose }: Props) {
  const [layers, setLayers] = useState<TextLayer[]>(() =>
    (initialLayers && initialLayers.length > 0 ? initialLayers : [defaultLayer(newId(), '')]));
  const [activeId, setActiveId] = useState<string>(() => layers[0].id);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [devanagariOk, setDevanagariOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fontState, setFontState] = useState<Record<string, 'loading' | 'ready' | 'failed'>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragging = useRef(false);
  /** Which fonts have already been asked for, so a re-render does not re-request them. */
  const fontsAsked = useRef<Set<string>>(new Set());

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

  /**
   * Fetch every font a layer is using, and record honestly whether it arrived.
   *
   * 🔴 THE CANVAS DOES NOT WAIT FOR CSS. `measureText` with a family the document has not finished
   * loading measures in the FALLBACK face — so the text would be wrapped at one set of widths and
   * repainted at another the moment the real font landed, and what the user positioned would not be
   * what they saved. The repaint below therefore depends on `fontState`, so every frame after a
   * font arrives is measured in the font that is really there.
   */
  useEffect(() => {
    let alive = true;
    for (const id of new Set(layers.map((l) => l.fontId))) {
      if (fontsAsked.current.has(id)) continue;
      fontsAsked.current.add(id);
      setFontState((prev) => ({ ...prev, [id]: 'loading' }));
      void loadImageFont(id).then((ok) => {
        // A failure is forgotten so that choosing the font again really retries it — the commonest
        // cause is a connection that has since come back, not a font that does not exist.
        if (!ok) fontsAsked.current.delete(id);
        if (alive) setFontState((prev) => ({ ...prev, [id]: ok ? 'ready' : 'failed' }));
      });
    }
    return () => { alive = false; };
  }, [layers]);

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
    // `fontState` is a real dependency, not a tidy-up: a font that finishes loading changes the
    // widths every line was measured at, so the frame on screen is stale until this runs again.
  }, [image, paint, fontState]);

  const warning = useMemo(() => devanagariWarning(layers, devanagariOk), [layers, devanagariOk]);

  /**
   * What to say about the ACTIVE layer's font, or nothing when there is nothing to say.
   *
   * A font that could not be fetched is named and the consequence is stated, rather than the picture
   * quietly coming out in a different face — the second absolute rule reaches a dropdown exactly as
   * it reaches a button: the option either works or it says it does not.
   */
  const fontNote = useMemo(() => {
    const state = fontState[active.fontId];
    const name = fontChoice(active.fontId).label;
    if (state === 'loading') return `Loading ${name}…`;
    if (state === 'failed') return `${name} could not be loaded on this device, so this text will use the default font. Check your connection and pick it again to retry.`;
    return null;
  }, [fontState, active.fontId]);

  /** The background, read back into the two controls that edit it. One stored string, two dials. */
  const bg = useMemo(() => splitFill(active.band), [active.band]);

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
      // Wait for every chosen font before the final paint. Cached once loaded, so this is instant on
      // the ordinary path — and on the path that is not, it is the difference between exporting the
      // font the user picked and exporting the fallback that happened to be ready.
      await Promise.all(Array.from(new Set(layers.map((l) => l.fontId))).map((id) => loadImageFont(id)));
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

  /**
   * Replace everything with a template's arrangement.
   *
   * It REPLACES rather than appends, which is what makes it one tap instead of one tap plus a
   * clean-up: a board is a layout, and merging two layouts produces neither. Anything typed so far
   * that the prompt also carried survives, because the template fills its slots from the SAME
   * findings; anything typed by hand does not, which is why the button reads as a fresh start.
   */
  const applyTemplate = (template: BoardTemplate) => {
    const next = layersFromTemplate(template, extracted ?? [], newId);
    if (next.length === 0) return;
    setLayers(next);
    setActiveId(next[0].id);
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

  // 🔒 PORTALLED TO `document.body`, for the reason `ImageOptionSelect` records in full: an ancestor
  // with `backdrop-filter`, `transform` or `filter` becomes the containing block for a `fixed`
  // child, and the sheet then opens inside that element rather than over the screen. This editor
  // happens to work from where it is mounted today — it is portalled anyway, because "works from
  // where it happens to be mounted" is not a property a full-screen sheet should have, and the
  // sibling that did NOT have it was found by a user rather than by us.
  if (typeof document === 'undefined') return null;
  return createPortal((
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

          {/* One tap lays the whole board out. Shown above the chips because it REPLACES them — a
              control that rearranges everything belongs before the thing it rearranges. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted flex items-center gap-1 mr-0.5">
              <LayoutTemplate className="w-3 h-3" /> Layout
            </span>
            {BOARD_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => applyTemplate(t)}
                title={t.hint}
                className="px-2.5 py-1 rounded-lg text-[11px] bg-raised text-body border border-line hover:border-accent-text transition-colors"
              >
                {t.label}
              </button>
            ))}
          </div>

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
                {l.text.trim().split('\n')[0].slice(0, 14) || l.label || `Text ${i + 1}`}
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
            {/* Caption or rate card. Switching kind re-reads the SAME text, so somebody who typed a
                menu into a caption gets their menu laid out rather than having to type it again. */}
            <div className="flex items-center gap-1.5 mb-2">
              {KINDS.map((k) => {
                const Icon = k.icon;
                return (
                  <button
                    key={k.id}
                    onClick={() => patch(active.id, { kind: k.id, align: k.id === 'list' ? 'left' : active.align })}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border ${
                      active.kind === k.id ? 'bg-accent text-on-accent border-transparent' : 'bg-raised text-body border-line'
                    }`}
                  >
                    <Icon className="w-3 h-3" /> {k.label}
                  </button>
                );
              })}
            </div>
            <textarea
              value={active.text}
              onChange={(e) => patch(active.id, { text: e.target.value })}
              maxLength={MAX_TEXT_CHARS}
              rows={active.kind === 'list' ? 5 : 2}
              placeholder={KINDS.find((k) => k.id === active.kind)?.placeholder}
              className="w-full px-3 py-2 rounded-xl bg-card border border-line text-sm text-ink placeholder:text-faint resize-none focus:outline-none focus:border-accent-text"
            />
            <p className="mt-1 text-[10px] text-faint text-right">{active.text.length}/{MAX_TEXT_CHARS}</p>
          </div>

          <div className="space-y-3">
            {/* ── FONT ────────────────────────────────────────────────────────────────────────
                A native <select> on purpose: 45 options on a phone is a scroll wheel the OS already
                draws better than any list we could build, and it is reachable by keyboard and by a
                screen reader for free. The two groups are "will my Hindi work?", which is the
                question a NavBharatAI user is really asking — not serif versus sans. */}
            <div className="flex items-center gap-3">
              <label htmlFor="nbai-text-font" className="text-[11px] text-muted w-[4.5rem] shrink-0">Font</label>
              <select
                id="nbai-text-font"
                value={active.fontId}
                onChange={(e) => patch(active.id, { fontId: e.target.value })}
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-card border border-line text-xs text-ink focus:outline-none focus:border-accent-text"
              >
                <option value={DEFAULT_FONT_ID}>Default</option>
                <optgroup label="Hindi + English">
                  {FONT_CHOICES.filter((f) => f.devanagari && f.id !== DEFAULT_FONT_ID).map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </optgroup>
                <optgroup label="English only">
                  {FONT_CHOICES.filter((f) => !f.devanagari).map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            {fontNote && <p className="text-[11px] text-warn leading-relaxed">{fontNote}</p>}

            <div className="flex items-center gap-3">
              <label className="text-[11px] text-muted w-[4.5rem] shrink-0">Size</label>
              <input
                type="range"
                aria-label="Text size"
                min={MIN_SIZE_PCT * 1000}
                max={MAX_SIZE_PCT * 1000}
                value={active.sizePct * 1000}
                onChange={(e) => patch(active.id, { sizePct: Number(e.target.value) / 1000 })}
                className="flex-1 accent-[color:var(--accent)]"
              />
            </div>

            <div className="flex items-center gap-3">
              <label className="text-[11px] text-muted w-[4.5rem] shrink-0">Colour</label>
              <div className="flex flex-wrap items-center gap-1.5">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    onClick={() => patch(active.id, { color: c })}
                    aria-label={`Colour ${c}`}
                    style={{ background: c }}
                    className={`w-6 h-6 rounded-full border-2 ${active.color === c ? 'border-accent-text' : 'border-line'}`}
                  />
                ))}
                {/* The picker sits at the END of the row, where the admin asked for it: the swatches
                    are the eight answers most people want, and this is the one for everyone else. */}
                <ColourDot value={hexOf(active.color, '#ffffff')} onChange={(c) => patch(active.id, { color: c })} label="Pick any text colour" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="text-[11px] text-muted w-[4.5rem] shrink-0">Style</label>
              <div className="flex items-center gap-1">
                {/* A list sets its own two edges, so an alignment control there would be a button
                    that does nothing — which the second absolute rule forbids. Bold still applies. */}
                {(active.kind === 'list' ? [] : (['left', 'center', 'right'] as const)).map((a) => {
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

            {/* ── BACKGROUND ──────────────────────────────────────────────────────────────────
                Was three fixed chips (None / Dark bar / Light bar). Any colour now, at any
                strength — and the OPACITY slider is also the on/off: at 0 the layer stores an
                empty fill, which is exactly what "no background" already meant everywhere else in
                this module. A separate on/off toggle beside the slider would be a second way to
                say one thing, and the two would drift the first time either was touched. */}
            <div className="flex items-center gap-3">
              <label className="text-[11px] text-muted w-[4.5rem] shrink-0">Background</label>
              <div className="flex flex-wrap items-center gap-1.5">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    onClick={() => patch(active.id, { band: rgbaFrom(c, bg.alpha > 0 ? bg.alpha : DEFAULT_BAND_ALPHA) })}
                    aria-label={`Background ${c}`}
                    style={{ background: c }}
                    className={`w-6 h-6 rounded-full border-2 ${bg.alpha > 0 && bg.hex === c ? 'border-accent-text' : 'border-line'}`}
                  />
                ))}
                <ColourDot
                  value={bg.hex}
                  onChange={(c) => patch(active.id, { band: rgbaFrom(c, bg.alpha > 0 ? bg.alpha : DEFAULT_BAND_ALPHA) })}
                  label="Pick any background colour"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-[11px] text-muted w-[4.5rem] shrink-0">Opacity</label>
              <input
                type="range"
                aria-label="Background opacity"
                min={0}
                max={100}
                value={Math.round(bg.alpha * 100)}
                onChange={(e) => patch(active.id, { band: rgbaFrom(bg.hex, Number(e.target.value) / 100) })}
                className="flex-1 accent-[color:var(--accent)]"
              />
              <span className="text-[11px] text-faint w-10 text-right shrink-0">
                {bg.alpha > 0 ? `${Math.round(bg.alpha * 100)}%` : 'None'}
              </span>
            </div>

            {/* ── BORDER ──────────────────────────────────────────────────────────────────────
                A frame around that same box. It shares `bandRect` with the background rather than
                measuring its own, so the two can never sit a few pixels apart; the widths are
                fractions of the FONT, so a border that looks right on a square looks the same on a
                wide banner. "None" is the remove. */}
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-[11px] text-muted w-[4.5rem] shrink-0">Border</label>
              <div className="flex items-center gap-1.5">
                {BORDER_CHOICES.map((b) => (
                  <button
                    key={b.label}
                    onClick={() => patch(active.id, { borderPct: b.value })}
                    className={`px-2.5 py-1 rounded-lg text-[11px] border ${
                      Math.abs(active.borderPct - b.value) < 0.001 ? 'bg-accent text-on-accent border-transparent' : 'bg-raised text-body border-line'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
                {active.borderPct > 0 && (
                  <ColourDot
                    value={hexOf(active.borderColor, '#ffffff')}
                    onChange={(c) => patch(active.id, { borderColor: c })}
                    label="Pick the border colour"
                  />
                )}
              </div>
            </div>

            {/* ── TABLE WIDTH — a rate card only ──────────────────────────────────────────────
                This was a "Width" slider on every layer, and it is gone from captions on purpose
                (admin: "Width ki jagah background karo"). A caption wraps at a sensible share of
                the picture and needs no dial. A RATE LIST does: the width is the span its two
                columns are set against, so it decides where the prices line up — deleting it there
                would take away a real capability rather than a confusing control. */}
            {active.kind === 'list' && (
              <div className="flex items-center gap-3">
                <label className="text-[11px] text-muted w-[4.5rem] shrink-0">Table width</label>
                <input
                  type="range"
                  aria-label="Table width"
                  min={20}
                  max={100}
                  value={Math.round(active.widthPct * 100)}
                  onChange={(e) => patch(active.id, { widthPct: Number(e.target.value) / 100 })}
                  className="flex-1 accent-[color:var(--accent)]"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
