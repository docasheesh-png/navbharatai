// Resize or crop a FINISHED picture into any frame, with black where it does not reach
// (admin-asked 2026-09-21: "image generate ho jane ke bad image ka size badalne / crop karne ka
// option do … agar user image ko frame se chota kar de, to bahat kala background a jaye").
//
// 🔑 WHAT COMES OUT IS EXACTLY WHAT THE FRAME SHOWS, at the chosen pixel size — the same honesty rule
// as the attach-side editor, on a different job. The geometry is `src/lib/imageResize.ts` and is
// pure; this file draws it, and it is deliberately NOT `ImageCropEditor` with a flag: that editor
// keeps a picture covering its frame (a black band there would look like our engine broke), this one
// exists to produce the black band the admin asked for. One rule per job.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Move, Maximize2, Minus, Plus, RotateCcw, Check, X } from 'lucide-react';
import {
  FREE_IDENTITY, FREE_MAX_ZOOM, FREE_MIN_ZOOM, RESIZE_BACKGROUND, clampFreeView, fitZoom, freeDrawRect,
  freeZoomBy, isFreeIdentity, previewPercent, showsBackground, type FreeView, type ResizeMode,
} from '../../lib/imageResize';
import { dragToFrame } from '../../lib/imageCrop';
import { CUSTOM_SIZE_ID, DEFAULT_CUSTOM_SIZE, describeSize, pixelsForSize } from '../../lib/imageSize';
import { ImageOptionSelect, type ImageOption } from './ImageOptionSelect';
import { CustomSizeFields } from './CustomSizeFields';

interface Props {
  /** The finished picture, as a data URL (the generator resolves a link to bytes first). */
  image: string;
  /** The size the picture was made at — the editor opens on it, so "Done" with no change is a no-op. */
  initialSize: string;
  /** The pixels of a picture already resized to a custom pair, so the fields open on them. */
  initialCustom?: { w: number; h: number };
  /** The picker's own size rows, so this sheet and the composer name sizes the same way. */
  sizes: ImageOption[];
  onDone: (dataUrl: string, size: { w: number; h: number }) => void;
  onClose: () => void;
}

export function ImageResizeEditor({ image, initialSize, initialCustom, sizes, onDone, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [mode, setMode] = useState<ResizeMode>('crop');
  const [size, setSize] = useState(initialSize);
  const [customW, setCustomW] = useState(initialCustom?.w ?? DEFAULT_CUSTOM_SIZE.w);
  const [customH, setCustomH] = useState(initialCustom?.h ?? DEFAULT_CUSTOM_SIZE.h);
  const [view, setView] = useState<FreeView>(FREE_IDENTITY);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const dragging = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const frame = pixelsForSize(size, customW, customH);
  // On-screen size against ONE constant reference, so W+ widens and H+ heightens — see previewPercent.
  const pct = previewPercent(frame);

  useEffect(() => {
    let alive = true;
    const el = new window.Image();
    el.onload = () => { if (alive) { imgRef.current = el; setReady(true); } };
    el.onerror = () => { if (alive) setLoadFailed(true); };
    el.src = image;
    return () => { alive = false; };
  }, [image]);

  const natural = (): { w: number; h: number } => {
    const el = imgRef.current;
    return { w: el?.naturalWidth || 1, h: el?.naturalHeight || 1 };
  };

  /** Paint at the frame's REAL pixels: black first, then the picture where the geometry says. */
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const el = imgRef.current;
    if (!canvas || !el) return;
    canvas.width = frame.w;
    canvas.height = frame.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = RESIZE_BACKGROUND;
    ctx.fillRect(0, 0, frame.w, frame.h);
    const img = { w: el.naturalWidth || 1, h: el.naturalHeight || 1 };
    const r = freeDrawRect(mode, view, img, frame);
    ctx.drawImage(el, r.dx, r.dy, r.dw, r.dh);
  }, [frame.w, frame.h, view, mode]);

  useEffect(() => { if (ready) repaint(); }, [ready, repaint]);
  // A new frame shape makes the old offsets meaningless; re-clamp rather than let the picture sit
  // where the previous frame left it.
  useEffect(() => { setView((v) => clampFreeView(v, natural(), frame)); }, [frame.w, frame.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'crop') return;
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current || !last.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = dragToFrame(e.clientX - last.current.x, rect.width, frame.w);
    const dy = dragToFrame(e.clientY - last.current.y, rect.height, frame.h);
    last.current = { x: e.clientX, y: e.clientY };
    setView((v) => clampFreeView({ ...v, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy }, natural(), frame));
  };
  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = false;
    last.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  const step = (direction: 1 | -1) => setView((v) => freeZoomBy(v, direction, natural(), frame));
  const black = ready && showsBackground(mode, view, natural(), frame);

  const handleDone = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    repaint();
    onDone(canvas.toDataURL('image/png'), { w: frame.w, h: frame.h });
  };

  if (typeof document === 'undefined') return null;

  const modeButton = (m: ResizeMode, label: string, Icon: typeof Move, hint: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      title={hint}
      aria-pressed={mode === m}
      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
        mode === m ? 'bg-accent text-on-accent border-transparent' : 'bg-raised border-line text-body hover:text-ink'
      }`}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );

  return createPortal((
    <div className="nb-sheet-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-scrim">
      <div className="nb-sheet w-full sm:max-w-lg flex flex-col overflow-y-auto bg-surface sm:rounded-2xl rounded-t-2xl border border-line">

        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 bg-card border-b border-line">
          <div className="flex items-center gap-2 min-w-0">
            <Move className="w-4 h-4 text-accent-text shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-ink truncate">Resize or crop</h2>
              <p className="text-[11px] text-muted truncate">{describeSize(frame.w, frame.h)} — what you see is what you get</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDone}
              disabled={!ready || loadFailed}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-medium disabled:opacity-40"
            >
              <Check className="w-3.5 h-3.5" /> Done
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-raised" aria-label="Close">
              <X className="w-4 h-4 text-muted" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            {modeButton('crop', 'Crop', Move, 'Keep the picture’s shape; move and zoom it; black fills the rest')}
            {modeButton('stretch', 'Resize', Maximize2, 'Stretch the picture to fill the new size')}
          </div>

          <ImageOptionSelect
            label="New size"
            heading="What size should it become?"
            options={sizes}
            value={size}
            onChange={setSize}
          />
          {size === CUSTOM_SIZE_ID && (
            <CustomSizeFields
              width={customW}
              height={customH}
              onChange={(w, h) => { setCustomW(w); setCustomH(h); }}
              className="rounded-xl border border-line bg-card px-2.5 py-2"
              idPrefix="nbai-resize"
            />
          )}

          {/* A SQUARE stage; the canvas is sized as a percentage of it on BOTH axes, against one
              constant reference. The old `w-full h-auto` canvas pinned the displayed width to the
              container, so W+ showed as a SHORTER picture and H+ as a taller one — "bas height change
              hoti hai, width nahi". Measured, then fixed; the rule lives in previewPercent. */}
          <div className="rounded-xl overflow-hidden border border-line bg-well aspect-square w-full flex items-center justify-center">
            {loadFailed ? (
              <p className="p-6 text-xs text-warn text-center leading-relaxed">
                This picture could not be opened here. Save it and try again from your gallery.
              </p>
            ) : (
              <canvas
                ref={canvasRef}
                style={{ width: `${pct.w}%`, height: `${pct.h}%` }}
                className={`block touch-none ring-1 ring-line ${mode === 'crop' ? 'cursor-move' : ''}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            )}
          </div>

          {mode === 'crop' ? (
            <>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => step(-1)}
                  disabled={view.zoom <= FREE_MIN_ZOOM}
                  aria-label="Make the picture smaller"
                  className="w-10 h-10 rounded-lg bg-raised border border-line text-body flex items-center justify-center disabled:opacity-40"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setView({ zoom: fitZoom(natural(), frame), offsetX: 0, offsetY: 0 })}
                  title="Show the whole picture inside the frame"
                  className="px-3 h-10 rounded-lg bg-raised border border-line text-body text-xs flex items-center justify-center"
                >
                  Fit
                </button>
                <button
                  type="button"
                  onClick={() => setView(FREE_IDENTITY)}
                  disabled={isFreeIdentity(view)}
                  aria-label="Reset the picture"
                  className="w-10 h-10 rounded-lg bg-raised border border-line text-body flex items-center justify-center disabled:opacity-40"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  disabled={view.zoom >= FREE_MAX_ZOOM}
                  aria-label="Make the picture bigger"
                  className="w-10 h-10 rounded-lg bg-raised border border-line text-body flex items-center justify-center disabled:opacity-40"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-faint text-center leading-relaxed">
                {black
                  ? 'The picture is smaller than the frame — the rest is filled with black, exactly as shown.'
                  : 'Drag to move. − and + make it smaller or bigger; Fit shows all of it; ⟲ starts again.'}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-faint text-center leading-relaxed">
              The picture is stretched to fill {describeSize(frame.w, frame.h)}. Use Crop to keep its shape instead.
            </p>
          )}
        </div>
      </div>
    </div>
  ), document.body);
}
