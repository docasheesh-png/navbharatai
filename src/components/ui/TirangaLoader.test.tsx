import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TirangaLoader, drawInstance, type Instance } from './TirangaLoader';

describe('TirangaLoader — render', () => {
  it('is decorative (aria-hidden) by default and renders a canvas', () => {
    const html = renderToStaticMarkup(<TirangaLoader className="w-4 h-4" />);
    expect(html).toContain('<canvas');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('w-4 h-4'); // size classes are carried onto the wrapper
    expect(html).not.toContain('role="status"');
  });

  it('becomes a live status region when a label is given', () => {
    const html = renderToStaticMarkup(<TirangaLoader label="Loading sessions" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading sessions"');
  });

  it('honours an explicit pixel size (the size-prop drop-in form)', () => {
    const html = renderToStaticMarkup(<TirangaLoader size={14} />);
    // inline width/height in px, whichever serialisation react uses
    expect(html).toMatch(/width:\s*14px/);
    expect(html).toMatch(/height:\s*14px/);
  });
});

// A minimal recording mock of CanvasRenderingContext2D — the node test env has no real canvas.
function mockCtx() {
  const calls: string[] = [];
  const rec = (name: string) => (..._args: unknown[]) => { calls.push(name); };
  const ctx = {
    calls,
    clearRect: rec('clearRect'),
    beginPath: rec('beginPath'),
    arc: rec('arc'),
    stroke: rec('stroke'),
    fill: rec('fill'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    save: rec('save'),
    restore: rec('restore'),
    translate: rec('translate'),
    rotate: rec('rotate'),
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    lineCap: '' as CanvasLineCap,
  };
  return ctx;
}

describe('TirangaLoader — draw logic', () => {
  it('draws the three tiranga arcs + a full 24-spoke chakra at a large size', () => {
    const ctx = mockCtx();
    const inst = { canvas: {} as HTMLCanvasElement, ctx: ctx as unknown as CanvasRenderingContext2D, size: 30, dpr: 2 } as Instance;
    expect(() => drawInstance(inst, 500)).not.toThrow();
    expect(ctx.calls.filter((c) => c === 'clearRect').length).toBe(1);
    // 3 outer arcs + the white backing arc + the chakra rim = 5 arc() strokes, plus 24 spoke lines.
    expect(ctx.calls.filter((c) => c === 'arc').length).toBeGreaterThanOrEqual(5);
    expect(ctx.calls.filter((c) => c === 'lineTo').length).toBe(24); // full chakra spokes
    expect(ctx.calls).toContain('fill'); // the hub
  });

  it('skips the illegible spokes below ~22px (clean ring instead)', () => {
    const ctx = mockCtx();
    const inst = { canvas: {} as HTMLCanvasElement, ctx: ctx as unknown as CanvasRenderingContext2D, size: 14, dpr: 2 } as Instance;
    expect(() => drawInstance(inst, 0)).not.toThrow();
    expect(ctx.calls.filter((c) => c === 'lineTo').length).toBe(0); // no spokes at tiny size
    expect(ctx.calls).toContain('fill'); // hub still drawn
  });
});
