import { describe, it, expect } from 'vitest';
import {
  elementLabel, scanOverflow, describeOverflow, collectDiagnostics,
  type ScanElement,
} from '../src/lib/reportDiagnostics';

/**
 * The measurement a vague report was missing.
 *
 * A real report said "Some content goes outside the mobile" and there was nothing to act on. These
 * tests are about the one thing that turns that sentence into work: naming the element, and never
 * letting "we did not look" read as "we looked and it was fine".
 */

/** A fake element tree — no DOM, so the rules are tested rather than jsdom's layout engine. */
function node(
  label: { tag: string; id?: string; cls?: string },
  right: number,
  width = 100,
  parent: ScanElement | null = null,
): ScanElement {
  return {
    tagName: label.tag,
    id: label.id ?? '',
    className: label.cls ?? '',
    parentElement: parent,
    getBoundingClientRect: () => ({ right, width }),
  };
}

const root = (els: ScanElement[]) => ({ querySelectorAll: () => els });

describe('elementLabel — enough to find it, never enough to leak anything', () => {
  it('names tag, id and the first two classes', () => {
    expect(elementLabel({ tagName: 'DIV', id: 'hero', className: 'grid wide extra another' }))
      .toBe('div#hero.grid.wide');
  });

  it('an SVG className is an object, not a string — and must not print as one', () => {
    // Reading `.baseVal` rather than assuming a string is the difference between a usable label and
    // "[object SVGAnimatedString]" on every icon in the app.
    expect(elementLabel({ tagName: 'svg', className: { baseVal: 'icon big' } as unknown }))
      .toBe('svg.icon.big');
  });

  it('survives an element that has nothing', () => {
    expect(elementLabel({})).toBe('element');
  });
});

describe('scanOverflow — which element is actually too wide', () => {
  const VIEWPORT = 390;

  it('reports the element that reaches past the edge', () => {
    const table = node({ tag: 'table', cls: 'prices' }, 431);
    const scan = scanOverflow(root([table]), VIEWPORT);
    expect(scan.scanned).toBe(true);
    expect(scan.findings).toEqual([{ element: 'table.prices', overflowPx: 41 }]);
  });

  it('🔴 blames the CHILD that introduces the overflow, not every ancestor that inherits it', () => {
    // Without this rule the admin's list reads body, #root, div, div — all true, none of them the
    // thing to change. This is the assertion that makes the finding actionable rather than merely
    // correct.
    const body = node({ tag: 'body' }, 431);
    const wrap = node({ tag: 'div', id: 'root' }, 431, 100, body);
    const table = node({ tag: 'table', cls: 'prices' }, 431, 100, wrap);
    const scan = scanOverflow(root([body, wrap, table]), VIEWPORT);
    expect(scan.findings.map((f) => f.element)).toEqual(['table.prices']);
  });

  it('an ancestor that overflows MORE than its child is still reported — it is a separate cause', () => {
    const body = node({ tag: 'body' }, 500);
    const child = node({ tag: 'p', cls: 'note' }, 400, 100, body);
    const scan = scanOverflow(root([body, child]), VIEWPORT);
    expect(scan.findings.map((f) => f.element)).toContain('body');
  });

  it('sub-pixel rounding is not a bug', () => {
    expect(scanOverflow(root([node({ tag: 'div' }, 390.4)]), VIEWPORT).findings).toEqual([]);
  });

  it('a hidden or collapsed element cannot be pushing anything off screen', () => {
    expect(scanOverflow(root([node({ tag: 'div', cls: 'menu' }, 900, 0)]), VIEWPORT).findings).toEqual([]);
  });

  it('worst first, and capped', () => {
    const els = [600, 500, 700, 450, 800, 900].map((r, i) => node({ tag: 'div', id: `n${i}` }, r));
    const scan = scanOverflow(root(els), VIEWPORT, { maxFindings: 3 });
    expect(scan.findings.map((f) => f.overflowPx)).toEqual([510, 410, 310]);
  });

  it('🔒 a page it could not read is NOT a clean page', () => {
    expect(scanOverflow(null, VIEWPORT)).toEqual({ scanned: false, truncated: false, findings: [] });
    expect(scanOverflow(root([]), 0).scanned).toBe(false);
    const throwing = { querySelectorAll: () => { throw new Error('detached'); } };
    expect(scanOverflow(throwing, VIEWPORT).scanned).toBe(false);
  });

  it('a huge page is truncated, and says so rather than reporting a clean bill of health', () => {
    const els = Array.from({ length: 30 }, () => node({ tag: 'div' }, 100));
    const scan = scanOverflow(root(els), VIEWPORT, { elementBudget: 10 });
    expect(scan).toMatchObject({ scanned: true, truncated: true, findings: [] });
    expect(describeOverflow(scan)).toContain('the part of the page we could measure');
  });

  it('an element whose rect throws is skipped, not fatal', () => {
    const bad: ScanElement = {
      tagName: 'div',
      getBoundingClientRect: () => { throw new Error('no layout'); },
    };
    const good = node({ tag: 'img', cls: 'banner' }, 500);
    expect(scanOverflow(root([bad, good]), VIEWPORT).findings.map((f) => f.element)).toEqual(['img.banner']);
  });
});

describe('describeOverflow — the line a non-technical reader acts on', () => {
  it('🔒 "not measured" and "measured, nothing found" are DIFFERENT sentences', () => {
    const notMeasured = describeOverflow({ scanned: false, truncated: false, findings: [] });
    const clean = describeOverflow({ scanned: true, truncated: false, findings: [] });
    expect(notMeasured).toContain('not measured');
    expect(clean).toContain('nothing reaches past');
    expect(notMeasured).not.toBe(clean);
  });

  it('names the worst offender and how many others there are', () => {
    const line = describeOverflow({
      scanned: true,
      truncated: false,
      findings: [{ element: 'table.prices', overflowPx: 41 }, { element: 'pre.code', overflowPx: 12 }],
    });
    expect(line).toContain('table.prices');
    expect(line).toContain('41px');
    expect(line).toContain('1 more');
  });

  it('a missing scan reads as not measured rather than crashing', () => {
    expect(describeOverflow(null)).toContain('not measured');
  });
});

describe('collectDiagnostics — reading a real browser without trusting it', () => {
  const win = (over: Record<string, unknown> = {}) => ({
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 3,
    document: { body: root([node({ tag: 'table', cls: 'prices' }, 431)]), documentElement: { clientWidth: 390 } },
    navigator: { onLine: true, language: 'hi-IN', connection: { effectiveType: '4g' } },
    ...over,
  });

  it('captures the facts a layout complaint needs', () => {
    expect(collectDiagnostics(win())).toMatchObject({
      viewport: '390x844',
      dpr: 3,
      online: true,
      language: 'hi-IN',
      connection: '4g',
      overflowScanned: true,
      overflow: [{ element: 'table.prices', overflowPx: 41 }],
    });
  });

  it('⚠️ measures against clientWidth, not innerWidth — a scrollbar would forgive real overflow', () => {
    // innerWidth includes the vertical scrollbar; an element overhanging by 10px inside a 17px
    // scrollbar would measure as clean against it and the complaint would look imaginary.
    const scrollbar = win({
      innerWidth: 407,
      document: { body: root([node({ tag: 'div', cls: 'row' }, 400)]), documentElement: { clientWidth: 390 } },
    });
    expect(collectDiagnostics(scrollbar).overflow).toEqual([{ element: 'div.row', overflowPx: 10 }]);
  });

  it('a browser that answers nothing still lets the report be sent', () => {
    expect(collectDiagnostics({})).toEqual({ overflowScanned: false });
    expect(collectDiagnostics(null)).toEqual({});
  });

  it('a missing Network Information API is an absence, never a guess', () => {
    const out = collectDiagnostics(win({ navigator: { onLine: false, language: 'en' } }));
    expect(out.connection).toBeUndefined();
    expect(out.online).toBe(false);
  });
});
