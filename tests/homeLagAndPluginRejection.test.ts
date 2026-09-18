import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanOverflow, isClippedByAncestor, type ScanElement } from '../src/lib/reportDiagnostics';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
/** JSX block comments carry the reasoning; the CODE is what these assertions are about. */
const codeOnly = (src: string) => src.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * ONE user report, 2026-09-15, app build 117, Android 16 WebView, 360x524 on 4g:
 *   "Aapki home screen bahut leg maarta hai"
 *   + `"PlayBilling.then()" is not implemented on android @ unhandled promise`
 *   + `div.absolute.-bottom-1/3 — 147px past the edge`
 * Three findings: one real cause of the lag, one real unhandled rejection, one false alarm.
 */
describe('the lag: no perpetual animation on the home screen', () => {
  const home = codeOnly(read('src/components/home/HomeView.tsx'));

  it('nothing on the home screen animates for ever', () => {
    // A blurred layer that never moves is rasterised once; one that scales or rotates is
    // re-rasterised through a 100px Gaussian every frame. Two of those were the whole bug.
    expect(home).not.toMatch(/repeat:\s*Infinity/);
  });

  it('the blobs are still there — the look is kept, only the motion is gone', () => {
    expect(home).toContain('bg-indigo-600/20 rounded-full blur-[100px]');
    expect(home).toContain('bg-orange-500/15 rounded-full blur-[100px]');
  });

  it('they are plain divs now, not animated ones', () => {
    const ambient = home.slice(home.indexOf('absolute inset-0 pointer-events-none overflow-hidden'));
    expect(ambient.slice(0, 400)).not.toContain('motion.div');
  });
});

describe('the unhandled rejection: a plugin proxy is never a promise\'s value', () => {
  for (const f of ['src/lib/playBillingNative.ts', 'src/lib/deviceIntegrityNative.ts']) {
    const src = read(f);
    it(`${f} hands the proxy back inside a wrapper`, () => {
      expect(src).toContain('return { api: cached };');
    });
    it(`${f} never returns the bare proxy from an async function`, () => {
      // `return cached;` is the exact line that made the async machinery probe `.then` on the
      // proxy, which Capacitor dispatched as a native call to a method Android does not have.
      expect(src).not.toMatch(/^\s*return cached;\s*$/m);
    });
    it(`${f} declares the wrapper in its signature`, () => {
      expect(src).toMatch(/async function plugin\(\): Promise<\{ api: \w+ \} \| null>/);
    });
  }

  it('the sibling was hunted, not just the reported file', () => {
    // deviceIntegrityNative would have said "DeviceIntegrity.then()" — same class, never reported.
    expect(read('src/lib/deviceIntegrityNative.ts')).toContain('return { api: cached };');
  });
});

describe('the false alarm: a clipped element is not off-screen', () => {
  const el = (over: number, parent: ScanElement | null): ScanElement => ({
    tagName: 'DIV',
    className: 'absolute -bottom-1/3',
    parentElement: parent,
    getBoundingClientRect: () => ({ right: 360 + over, width: 270 }),
  });
  const clipper: ScanElement = {
    tagName: 'DIV',
    className: 'absolute inset-0 overflow-hidden',
    parentElement: null,
    getBoundingClientRect: () => ({ right: 360, width: 360 }),
  };
  const root = (kids: ScanElement[]) => ({ querySelectorAll: () => kids });

  it('the reported blob is dropped when an ancestor clips it', () => {
    const blob = el(147, clipper);
    const scan = scanOverflow(root([blob]), 360, { clipsHorizontally: (e) => e === clipper });
    expect(scan.scanned).toBe(true);
    expect(scan.findings).toEqual([]);
  });

  it('a genuinely overflowing element is still reported', () => {
    const wide = el(147, null);
    const scan = scanOverflow(root([wide]), 360, { clipsHorizontally: () => false });
    expect(scan.findings.length).toBe(1);
    expect(scan.findings[0].overflowPx).toBe(147);
  });

  it('with NO hook supplied, behaviour is exactly what it was before', () => {
    const blob = el(147, clipper);
    expect(scanOverflow(root([blob]), 360).findings.length).toBe(1);
  });

  it('a style read that throws never hides a real finding', () => {
    const blob = el(147, clipper);
    const scan = scanOverflow(root([blob]), 360, { clipsHorizontally: () => { throw new Error('no style'); } });
    expect(scan.findings.length).toBe(1);
  });

  it('the walk is bounded and handles a detached element', () => {
    expect(isClippedByAncestor(el(10, null), () => true)).toBe(false);
  });

  it('the DOM collector actually supplies the hook — otherwise the fix is dead code', () => {
    expect(read('src/lib/reportDiagnostics.ts')).toContain('{ clipsHorizontally }');
  });
});
