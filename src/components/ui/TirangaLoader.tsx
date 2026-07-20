// TirangaLoader — the app-wide loading indicator (replaces the frozen CSS `animate-spin` spinners).
//
// WHY THIS EXISTS (root cause, not a patch): the old spinners relied on the CSS `animate-spin`
// utility + `@keyframes spin`. In this app that path is fragile — a global `nb-reduce-motion` reset
// (src/index.css) `!important`-zeroes every CSS animation, and a static `transform: translateZ(0)`
// is applied to `.animate-spin`. The net effect users saw was a spinner that never spun. Rather than
// patch one site, this component removes the whole fragile dependency: it is JS-driven (a canvas
// repainted each frame), exactly like the tiranga build-flag that already animates reliably. No CSS
// animation is involved, so nothing global can freeze it.
//
// PERFORMANCE: every mounted instance draws from ONE shared requestAnimationFrame loop, so N loaders
// on screen cost a single frame callback, not N. The loop stops itself when the last loader unmounts.
//
// VISUAL: the tiranga — three rotating arcs (saffron / white / green) around a navy Ashoka Chakra.
// Size-adaptive: below ~22px the 24 chakra spokes are illegible, so it renders a clean ring + hub;
// at larger sizes the full 24-spoke chakra is drawn.

import { useEffect, useRef } from 'react';

const SAFFRON = '#E8811A';
const GREEN = '#1A9130';
const NAVY = '#1A3AA0';

export interface Instance {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  size: number; // CSS px (logical)
  dpr: number;
}

// Module-level shared ticker.
const instances = new Set<Instance>();
let rafId = 0;

// Exported for unit testing (the node test env has no canvas, so the draw path is exercised
// against a mock 2D context rather than through a real mount).
export function drawInstance(inst: Instance, t: number): void {
  const { ctx, size, dpr } = inst;
  const W = size * dpr;
  const cx = W / 2;
  const cy = W / 2;
  const R = W * 0.36;
  ctx.clearRect(0, 0, W, W);

  // ── Outer tiranga arcs (saffron / white / green), rotating together ──
  const base = ((t / 1000) % 1) * Math.PI * 2; // one turn ≈ 1s
  const seg = (Math.PI * 2) / 3;
  const gap = 0.5;
  const arcW = Math.max(1.5, W * 0.085);
  const cols = [SAFFRON, '#FFFFFF', GREEN];
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a0 = base + i * seg + gap / 2;
    const a1 = a0 + seg - gap;
    if (i === 1) {
      // Faint backing so the WHITE arc stays visible on a light background.
      ctx.lineWidth = arcW * 1.3;
      ctx.strokeStyle = 'rgba(120,120,120,0.30)';
      ctx.beginPath();
      ctx.arc(cx, cy, R, a0, a1);
      ctx.stroke();
    }
    ctx.lineWidth = arcW;
    ctx.strokeStyle = cols[i];
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0, a1);
    ctx.stroke();
  }

  // ── Inner navy Ashoka Chakra (slow, opposite feel) ──
  const rC = W * 0.15;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t / 2600);
  ctx.strokeStyle = NAVY;
  ctx.fillStyle = NAVY;
  ctx.lineCap = 'butt';
  ctx.lineWidth = Math.max(1, W * 0.014);
  ctx.beginPath();
  ctx.arc(0, 0, rC, 0, Math.PI * 2);
  ctx.stroke();
  if (size >= 22) {
    // Spokes are only legible above ~22px — below that a clean ring reads better.
    ctx.lineWidth = Math.max(0.75, W * 0.009);
    for (let s = 0; s < 24; s++) {
      const a = s * ((Math.PI * 2) / 24);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(rC * Math.cos(a), rC * Math.sin(a));
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(1.4, W * 0.03), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function tick(t: number): void {
  for (const inst of instances) {
    try {
      drawInstance(inst, t);
    } catch {
      /* a dead canvas must never kill the shared loop */
    }
  }
  rafId = instances.size ? requestAnimationFrame(tick) : 0;
}

export interface TirangaLoaderProps {
  /** Sizing / colour utility classes carried onto the wrapper (e.g. "w-4 h-4"). */
  className?: string;
  /** Explicit pixel size — the drop-in equivalent of the old `<Loader2 size={14} />` form.
   *  When omitted, the rendered size comes from `className` (e.g. "w-4 h-4"). */
  size?: number;
  /** When set, the loader is announced to screen readers as a live status with this label.
   *  Left unset it is decorative (aria-hidden), matching the icons it replaces. */
  label?: string;
  /** Native tooltip text. */
  title?: string;
}

/**
 * The tiranga loading indicator. Drop-in replacement for the old
 * `<Loader2 className="w-4 h-4 animate-spin" />` (or `<Loader2 size={14} />`) spinners —
 * pass the same size classes or `size` prop.
 */
export function TirangaLoader({ className = '', size, label, title }: TirangaLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null; // jsdom / unsupported — render statically, never throw
    }
    if (!ctx) return;

    const dpr = Math.min(3, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    let inst: Instance | null = null;

    const measure = (): void => {
      const rect = canvas.getBoundingClientRect();
      const size = Math.max(8, Math.round(rect.width || rect.height || 16));
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      if (inst) {
        inst.size = size;
        inst.dpr = dpr;
      } else {
        inst = { canvas, ctx: ctx as CanvasRenderingContext2D, size, dpr };
        instances.add(inst);
        if (!rafId) rafId = requestAnimationFrame(tick);
      }
    };

    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(canvas);

    return () => {
      ro?.disconnect();
      if (inst) instances.delete(inst);
      if (!instances.size && rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };
  }, []);

  return (
    <span
      className={`inline-flex ${className}`}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={title}
      style={size ? { width: size, height: size } : undefined}
    >
      <canvas ref={canvasRef} aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }} />
    </span>
  );
}

export default TirangaLoader;
