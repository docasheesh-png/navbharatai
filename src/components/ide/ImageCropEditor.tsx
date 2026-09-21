// Arrange the user's own picture inside the size they chose — crop, and make it bigger or smaller
// (admin 2026-09-21: "user kisi image ko apne hisab ke size me crop kar sake, image ko size se chota
// bada bhi kiya ja sake, +/0/- button add karna").
//
// 🔑 WHAT COMES OUT IS EXACTLY WHAT THE FRAME SHOWS, at the request's real pixel size. There is no
// second interpretation step on the server and no "we will fit it for you" — the picture the user
// arranged IS the picture that is sent, which is the only way a crop control can be honest.
//
// The geometry lives in `src/lib/imageCrop.ts` and is pure; this file draws it and nothing more.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, Minus, Plus, RotateCcw, Check, X } from 'lucide-react';
import {
  IDENTITY_VIEW, MAX_ZOOM, MIN_ZOOM, clampView, dragToFrame, drawRect, isIdentityView, zoomBy,
  type CropView,
} from '../../lib/imageCrop';
import { describeSize } from '../../lib/imageSize';

interface Props {
  /** The picture to arrange, as a data URL. */
  image: string;
  /** The exact pixels the request will be made at — the frame's shape AND the output's size. */
  frame: { w: number; h: number };
  /** Called with the cropped picture as a PNG data URL. */
  onDone: (dataUrl: string) => void;
  onClose: () => void;
}

export function ImageCropEditor({ image, frame, onDone, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [view, setView] = useState<CropView>(IDENTITY_VIEW);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const dragging = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Load once. A picture that cannot be decoded here says so rather than leaving an empty box —
  // the second absolute rule: a control that looks alive and does nothing does not exist.
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

  /** Paint the frame at its REAL pixel size, so what is on screen is what will be produced. */
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const el = imgRef.current;
    if (!canvas || !el) return;
    canvas.width = frame.w;
    canvas.height = frame.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, frame.w, frame.h);
    const img = { w: el.naturalWidth || 1, h: el.naturalHeight || 1 };
    const r = drawRect(view, img, frame);
    ctx.drawImage(el, r.dx, r.dy, r.dw, r.dh);
  }, [frame.w, frame.h, view]);

  useEffect(() => { if (ready) repaint(); }, [ready, repaint]);

  // A drag moves the picture inside the frame. The delta is converted from screen pixels into frame
  // pixels, or the same drag would feel different on every size the user picks.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
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
    setView((v) => clampView({ ...v, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy }, natural(), frame));
  };
  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = false;
    last.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  const step = (direction: 1 | -1) => setView((v) => zoomBy(v, direction, natural(), frame));

  const handleDone = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // PNG: the picture is about to be edited, and a re-compressed JPEG would hand the engine
    // artefacts of our own making to work from.
    onDone(canvas.toDataURL('image/png'));
  };

  if (typeof document === 'undefined') return null;

  return createPortal((
    // `nb-sheet-overlay` / `nb-sheet` rather than a bare `vh` cap — the shared sheet geometry, for
    // the reason recorded in index.css: on a phone `vh` is the LARGE viewport, so a tall panel puts
    // its own footer off the bottom of the screen the moment the browser chrome shows.
    <div className="nb-sheet-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-scrim">
      <div className="nb-sheet w-full sm:max-w-lg flex flex-col overflow-y-auto bg-surface sm:rounded-2xl rounded-t-2xl border border-line">

        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 bg-card border-b border-line">
          <div className="flex items-center gap-2 min-w-0">
            <ImageIcon className="w-4 h-4 text-accent-text shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-ink truncate">Fit your picture</h2>
              <p className="text-[11px] text-muted truncate">{describeSize(frame.w, frame.h)} — what you see is what is sent</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDone}
              disabled={!ready || loadFailed}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-medium disabled:opacity-40"
            >
              <Check className="w-3.5 h-3.5" /> Use this
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-raised" aria-label="Close">
              <X className="w-4 h-4 text-muted" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="rounded-xl overflow-hidden border border-line bg-well">
            {loadFailed ? (
              <p className="p-6 text-xs text-warn text-center leading-relaxed">
                This picture could not be opened here. Try a JPG or PNG saved from your gallery.
              </p>
            ) : (
              <canvas
                ref={canvasRef}
                className="w-full h-auto block touch-none cursor-move"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            )}
          </div>

          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={view.zoom <= MIN_ZOOM}
              aria-label="Make the picture smaller"
              className="w-10 h-10 rounded-lg bg-raised border border-line text-body flex items-center justify-center disabled:opacity-40"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setView(IDENTITY_VIEW)}
              disabled={isIdentityView(view)}
              aria-label="Reset the picture"
              className="w-10 h-10 rounded-lg bg-raised border border-line text-body flex items-center justify-center disabled:opacity-40"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={view.zoom >= MAX_ZOOM}
              aria-label="Make the picture bigger"
              className="w-10 h-10 rounded-lg bg-raised border border-line text-body flex items-center justify-center disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <p className="text-[11px] text-faint text-center leading-relaxed">
            Drag the picture to move it. Use − and + to make it smaller or bigger, ⟲ to start again.
          </p>
        </div>
      </div>
    </div>
  ), document.body);
}
