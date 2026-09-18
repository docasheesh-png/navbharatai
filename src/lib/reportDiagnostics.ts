// WHAT THE APP CAN SEE FOR ITSELF WHEN A USER REPORTS A PROBLEM.
//
// ADMIN 2026-09-12, holding a real report: "App is not responsive and sometimes it does not work in
// Mobile phones. Some content goes outside the mobile." — *"problem hi samajh nahi aa rahi fix kya
// karu? … aapne yeh aisa reporting system banaya hai ki user ki problem theek hi nahi ki ja sakti."*
//
// They were right, and the fault is ours rather than the reporter's. Everything that report needed to
// be fixable is knowable BY THE APP at the moment Send is pressed — how wide the screen is, which
// element reaches past its edge, which build is running, whether anything had just thrown. We asked a
// non-technical person to type all of that from memory instead, and then could not act on what they
// typed.
//
// 🔒 THE HONESTY RULE THIS MODULE IS BUILT AROUND: "we looked and found nothing" and "we never looked"
// must never arrive at the admin as the same thing. Every scan reports whether it RAN, separately from
// what it found — because an empty findings list that silently meant "not measured" would send the
// admin hunting for a bug in the wrong place, which is worse than the vague report we started with.

/** One element that reaches past the right edge of the screen. */
export interface OverflowFinding {
  /** A short structural identity — tag, id, a class or two. Never the element's text. */
  element: string;
  /** How far past the viewport's right edge it reaches, in CSS pixels, rounded. */
  overflowPx: number;
}

/** What one element looks like to the scan. Structural, so tests need no DOM. */
export interface ScanElement {
  tagName?: string;
  id?: string;
  className?: unknown;
  parentElement?: ScanElement | null;
  getBoundingClientRect(): { right: number; width: number };
}

export interface ScanRoot {
  querySelectorAll(selector: string): ArrayLike<ScanElement>;
}

export interface OverflowScan {
  /** False means the scan could not run at all — NOT that the page is clean. */
  scanned: boolean;
  /** True when the element budget ran out, so a clean result is not proof of a clean page. */
  truncated: boolean;
  findings: OverflowFinding[];
}

/** Sub-pixel layout rounding routinely puts an element a fraction over the edge. That is not a bug. */
const EDGE_TOLERANCE_PX = 1;

/**
 * 🔴 AN ELEMENT AN ANCESTOR CLIPS IS NOT OFF-SCREEN — IT IS DECORATION (user report 2026-09-15).
 *
 * That report said `div.absolute.-bottom-1/3 — 147px past the edge`. It was true of the element's
 * geometry and FALSE of anything a user could see: the blob sits inside
 * `absolute inset-0 pointer-events-none overflow-hidden`, so the browser clips it and the page
 * gains no scroll at all. A deliberately-oversized blurred background is the single most common
 * shape on any modern landing screen, so without this the scanner reports a ghost on nearly every
 * report — and a finding that is always there is a finding nobody reads.
 *
 * The rule is exact rather than heuristic: if ANY ancestor clips or scrolls horizontally, that
 * ancestor bounds the element, so the element cannot be what widens the page. If the ancestor is
 * itself too wide, it is measured on its own and reported in its own right — nothing is lost.
 *
 * ⚠️ Knowing this needs computed style, which the pure scan deliberately does not have. So it
 * arrives as an OPTIONAL hook: a caller that does not supply it gets exactly today's behaviour,
 * and the DOM collector supplies one backed by `getComputedStyle`.
 */
const CLIPPING_OVERFLOW = /^(hidden|clip|auto|scroll)$/;

/** A phone page has a few hundred elements; the cap only exists so a pathological page cannot hang. */
const DEFAULT_ELEMENT_BUDGET = 4000;

/** More than a handful is noise — the widest few are what gets fixed. */
const DEFAULT_MAX_FINDINGS = 5;

/**
 * A short identity for an element: `div#hero.grid.wide`. PURE.
 *
 * 🔒 Structure only — never `textContent`, never an attribute value. A report travels to the admin
 * screen and is stored, so anything a user typed into the page must not be able to ride along inside
 * what is supposed to be a layout measurement.
 */
export function elementLabel(el: Pick<ScanElement, 'tagName' | 'id' | 'className'>): string {
  const tag = (typeof el.tagName === 'string' ? el.tagName : '').toLowerCase() || 'element';
  const id = typeof el.id === 'string' ? el.id.trim() : '';
  // SVG elements carry an SVGAnimatedString here, not a string — reading `.baseVal` rather than
  // assuming a string is what stops the label becoming "[object SVGAnimatedString]".
  const raw = typeof el.className === 'string'
    ? el.className
    : typeof (el.className as { baseVal?: unknown } | null)?.baseVal === 'string'
      ? String((el.className as { baseVal?: string }).baseVal)
      : '';
  const classes = raw.split(/\s+/).filter(Boolean).slice(0, 2);
  return `${tag}${id ? `#${id}` : ''}${classes.length ? `.${classes.join('.')}` : ''}`.slice(0, 80);
}

/** Internal shape: one measured element plus where it sits. */
interface Measured {
  el: ScanElement;
  overflowPx: number;
}

/**
 * Find the elements that reach past the right edge — and report the ones that INTRODUCE the overflow,
 * not every ancestor that inherits it. PURE apart from the rects it is handed.
 *
 * WHY THE PARENT FILTER EARNS ITS COMPLEXITY. One too-wide element makes every ancestor up to `<body>`
 * report the same overrun, so a naive scan hands the admin a list headed by `body`, `#root`, `div`,
 * `div` — technically true and useless, because none of those is the thing to change. An element is
 * kept only when no descendant of it overflows by as much: that is the point where the width is
 * actually introduced, and it is the element a fix would touch.
 */
/** Walk up: does any ancestor clip or scroll horizontally, and therefore contain this element? PURE. */
export function isClippedByAncestor(el: ScanElement, clips: (e: ScanElement) => boolean): boolean {
  let parent = el.parentElement ?? null;
  let hops = 0;
  while (parent && hops < 200) {
    try {
      if (clips(parent)) return true;
    } catch {
      /* a style read that throws tells us nothing — keep walking rather than guess */
    }
    parent = parent.parentElement ?? null;
    hops += 1;
  }
  return false;
}

export function scanOverflow(
  root: ScanRoot | null | undefined,
  viewportWidth: number,
  opts: { maxFindings?: number; elementBudget?: number; clipsHorizontally?: (el: ScanElement) => boolean } = {},
): OverflowScan {
  const empty: OverflowScan = { scanned: false, truncated: false, findings: [] };
  if (!root || typeof root.querySelectorAll !== 'function') return empty;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return empty;

  let all: ArrayLike<ScanElement>;
  try {
    all = root.querySelectorAll('*');
  } catch {
    return empty;
  }

  const budget = Math.max(1, opts.elementBudget ?? DEFAULT_ELEMENT_BUDGET);
  const limit = Math.min(all.length, budget);
  const truncated = all.length > budget;

  const measured: Measured[] = [];
  for (let i = 0; i < limit; i += 1) {
    const el = all[i];
    if (!el || typeof el.getBoundingClientRect !== 'function') continue;
    let rect: { right: number; width: number };
    try {
      rect = el.getBoundingClientRect();
    } catch {
      continue;
    }
    // A hidden or collapsed element has no width and cannot be pushing anything off the screen.
    if (!Number.isFinite(rect.width) || rect.width <= 0) continue;
    if (!Number.isFinite(rect.right)) continue;
    const over = rect.right - viewportWidth;
    if (over <= EDGE_TOLERANCE_PX) continue;
    // Clipped by an ancestor ⇒ it cannot widen the page. See CLIPPING_OVERFLOW above (the 147px
    // decorative blob a real report chased). No hook supplied ⇒ nothing is skipped, as before.
    if (opts.clipsHorizontally && isClippedByAncestor(el, opts.clipsHorizontally)) continue;
    measured.push({ el, overflowPx: over });
  }

  if (measured.length === 0) return { scanned: true, truncated, findings: [] };

  const worstByElement = new Map<ScanElement, number>();
  for (const m of measured) {
    const prev = worstByElement.get(m.el);
    if (prev === undefined || m.overflowPx > prev) worstByElement.set(m.el, m.overflowPx);
  }

  // An ancestor whose overrun is fully explained by a descendant is dropped.
  const explained = new Set<ScanElement>();
  for (const m of measured) {
    let parent = m.el.parentElement ?? null;
    let hops = 0;
    while (parent && hops < 200) {
      const parentOver = worstByElement.get(parent);
      if (parentOver !== undefined && m.overflowPx >= parentOver - EDGE_TOLERANCE_PX) explained.add(parent);
      parent = parent.parentElement ?? null;
      hops += 1;
    }
  }

  const findings = [...worstByElement.entries()]
    .filter(([el]) => !explained.has(el))
    .map(([el, overflowPx]) => ({ element: elementLabel(el), overflowPx: Math.round(overflowPx) }))
    .sort((a, b) => b.overflowPx - a.overflowPx)
    .slice(0, Math.max(1, opts.maxFindings ?? DEFAULT_MAX_FINDINGS));

  return { scanned: true, truncated, findings };
}

/**
 * One line an admin can read without knowing what any of it means. PURE.
 *
 * Says "not measured" when nothing was measured, which is the whole point — a blank line and a clean
 * page must not look alike.
 */
export function describeOverflow(scan: Pick<OverflowScan, 'scanned' | 'truncated' | 'findings'> | null | undefined): string {
  if (!scan || !scan.scanned) return 'Off-screen check: not measured';
  if (scan.findings.length === 0) {
    return scan.truncated
      ? 'Off-screen check: nothing found in the part of the page we could measure'
      : 'Off-screen check: nothing reaches past the edge';
  }
  const worst = scan.findings[0];
  const rest = scan.findings.length - 1;
  const tail = rest > 0 ? ` (and ${rest} more)` : '';
  return `Off-screen: ${worst.element} reaches ${worst.overflowPx}px past the right edge${tail}`;
}

// ── Collecting it from a real browser ────────────────────────────────────────

/** Everything the collector touches, named so a test can hand it plain objects. */
export interface DiagnosticsWindow {
  innerWidth?: number;
  innerHeight?: number;
  devicePixelRatio?: number;
  document?: { body?: ScanRoot | null; documentElement?: { clientWidth?: number } | null } | null;
  navigator?: {
    onLine?: boolean;
    language?: string;
    connection?: { effectiveType?: string } | null;
  } | null;
}

export interface CollectedDiagnostics {
  viewport?: string;
  dpr?: number;
  online?: boolean;
  connection?: string;
  language?: string;
  overflow?: OverflowFinding[];
  overflowScanned?: boolean;
  overflowTruncated?: boolean;
}

/**
 * Read what this device can tell us about itself. Never throws — a report must be sendable from a
 * browser that refuses every one of these.
 *
 * ⚠️ THE WIDTH USED FOR THE SCAN IS `documentElement.clientWidth`, NOT `innerWidth`, and the
 * difference is the whole measurement. `innerWidth` INCLUDES the vertical scrollbar on a desktop
 * browser, so comparing element edges against it silently forgives up to ~17px of real overflow —
 * exactly the size of the overhang that produces a complaint. `clientWidth` is the space content
 * actually has. `innerWidth` is kept only as a fallback for the rare environment without a document.
 */
export function collectDiagnostics(win: DiagnosticsWindow | null | undefined): CollectedDiagnostics {
  const out: CollectedDiagnostics = {};
  if (!win) return out;

  try {
    const w = Number(win.innerWidth);
    const h = Number(win.innerHeight);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      out.viewport = `${Math.round(w)}x${Math.round(h)}`;
    }
    const dpr = Number(win.devicePixelRatio);
    if (Number.isFinite(dpr) && dpr > 0) out.dpr = Math.round(dpr * 100) / 100;
  } catch { /* a browser that hides its own size still gets to send a report */ }

  try {
    const nav = win.navigator;
    if (nav) {
      if (typeof nav.onLine === 'boolean') out.online = nav.onLine;
      if (typeof nav.language === 'string' && nav.language) out.language = nav.language.slice(0, 20);
      const eff = nav.connection?.effectiveType;
      if (typeof eff === 'string' && eff) out.connection = eff.slice(0, 20);
    }
  } catch { /* Network Information API is not everywhere, and its absence is not a failure */ }

  try {
    const contentWidth = Number(win.document?.documentElement?.clientWidth);
    const width = Number.isFinite(contentWidth) && contentWidth > 0 ? contentWidth : Number(win.innerWidth);
    // The clipping hook (see CLIPPING_OVERFLOW). Best-effort by construction: any browser without
    // getComputedStyle, or any style read that throws, simply yields `false` and the scan behaves
    // exactly as it did before this existed — a ghost finding is better than a lost one.
    const getStyle = (win as { getComputedStyle?: (e: unknown) => { overflowX?: string } | null }).getComputedStyle;
    const clipsHorizontally = typeof getStyle === 'function'
      ? (el: ScanElement) => {
          try {
            const ox = getStyle.call(win, el)?.overflowX;
            return typeof ox === 'string' && CLIPPING_OVERFLOW.test(ox.trim().toLowerCase());
          } catch { return false; }
        }
      : undefined;
    const scan = scanOverflow(win.document?.body ?? null, width, { clipsHorizontally });
    out.overflowScanned = scan.scanned;
    if (scan.truncated) out.overflowTruncated = true;
    if (scan.findings.length > 0) out.overflow = scan.findings;
  } catch {
    out.overflowScanned = false;
  }

  return out;
}
