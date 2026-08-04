import { describe, it, expect } from 'vitest';
import {
  parseCssColor, colorFamily, looksLikeDot, parseVisualQuery, findUiElements, formatUiFindings,
  type ScannedElement,
} from './UiElementFinder';

// MITRIFY AUTOPSY 2026-08-04 — the whole reason this module exists. Asked to remove a small green dot
// from the home page, the engine had no pixel→file path, brute-forced Tailwind class names ~30 times
// over 20 minutes, found nothing, then DELETED the app's logo and reported success. 27 minutes, ₹393,
// logo gone, dot still there — and the dot never existed at all.
// These tests lock BOTH halves: find it in one query, and when it is not there, prove absence.

const el = (p: Partial<ScannedElement>): ScannedElement => ({ tag: 'div', ...p });

describe('parseCssColor / colorFamily — read the colour the browser actually computed', () => {
  it('parses rgb and rgba', () => {
    expect(parseCssColor('rgb(34, 197, 94)')).toEqual({ r: 34, g: 197, b: 94, a: 1 });
    expect(parseCssColor('rgba(34, 197, 94, 0.8)')?.a).toBe(0.8);
  });

  it('treats transparent as NO colour — an invisible background must never match "green"', () => {
    expect(parseCssColor('rgba(0, 0, 0, 0)')).toBeNull();
    expect(colorFamily('rgba(34, 197, 94, 0)')).toBeNull();
    expect(parseCssColor('transparent')).toBeNull();
    expect(parseCssColor(undefined)).toBeNull();
  });

  it('parses hex in both lengths', () => {
    expect(parseCssColor('#22c55e')).toEqual({ r: 34, g: 197, b: 94, a: 1 });
    expect(parseCssColor('#0f0')).toEqual({ r: 0, g: 255, b: 0, a: 1 });
  });

  it('names the families a person actually says', () => {
    expect(colorFamily('rgb(34, 197, 94)')).toBe('green');   // tailwind green-500
    expect(colorFamily('rgb(239, 68, 68)')).toBe('red');     // red-500
    expect(colorFamily('rgb(59, 130, 246)')).toBe('blue');   // blue-500
    expect(colorFamily('rgb(255, 255, 255)')).toBe('white');
    expect(colorFamily('rgb(17, 17, 17)')).toBe('black');
    expect(colorFamily('rgb(128, 130, 132)')).toBe('grey');
  });
});

describe('looksLikeDot — what a person means by "dot"', () => {
  it('a small round element is a dot', () => {
    expect(looksLikeDot(el({ rect: { x: 0, y: 0, w: 8, h: 8 }, borderRadius: '9999px' }))).toBe(true);
    expect(looksLikeDot(el({ rect: { x: 0, y: 0, w: 10, h: 10 }, className: 'w-2 h-2 rounded-full bg-green-500' }))).toBe(true);
    expect(looksLikeDot(el({ rect: { x: 0, y: 0, w: 12, h: 12 }, borderRadius: '50%' }))).toBe(true);
  });

  it('a big round thing is not a dot, and a small square is not either', () => {
    expect(looksLikeDot(el({ rect: { x: 0, y: 0, w: 120, h: 120 }, borderRadius: '9999px' }))).toBe(false);
    expect(looksLikeDot(el({ rect: { x: 0, y: 0, w: 10, h: 10 }, borderRadius: '0px' }))).toBe(false);
  });

  it('a thin sliver is not a dot even when rounded', () => {
    expect(looksLikeDot(el({ rect: { x: 0, y: 0, w: 30, h: 4 }, borderRadius: '9999px' }))).toBe(false);
  });

  it('never throws on a missing/zero rect', () => {
    expect(looksLikeDot(el({}))).toBe(false);
    expect(looksLikeDot(el({ rect: { x: 0, y: 0, w: 0, h: 0 } }))).toBe(false);
  });
});

describe('parseVisualQuery — plain language, including the admin\'s own Hinglish', () => {
  it('reads colour + shape out of "green dot"', () => {
    const q = parseVisualQuery('green dot');
    expect(q.colors).toEqual(['green']);
    expect(q.wantsDot).toBe(true);
  });

  it('handles the exact prompt from the reported build ("home page par green dote hatao")', () => {
    const q = parseVisualQuery('home page par green dote hatao');
    expect(q.colors).toEqual(['green']);
    expect(q.wantsDot).toBe(true); // "dote" — the admin's spelling — must not be missed
  });

  it('recognises logos/images and buttons', () => {
    expect(parseVisualQuery('the logo at the top').wantsImage).toBe(true);
    expect(parseVisualQuery('red submit button').wantsButton).toBe(true);
    expect(parseVisualQuery('red submit button').colors).toEqual(['red']);
  });

  it('keeps meaningful words as text terms and drops the noise', () => {
    const q = parseVisualQuery('remove the Checkout button on the home page');
    expect(q.textTerms).toContain('checkout');
    expect(q.textTerms).not.toContain('the');
    expect(q.textTerms).not.toContain('button'); // it is a role, matched as one
    expect(q.textTerms).not.toContain('home');
  });

  it('gray and grey are the same family', () => {
    expect(parseVisualQuery('gray badge').colors).toEqual(['grey']);
  });
});

describe('findUiElements — one query replaces thirty greps', () => {
  const page: ScannedElement[] = [
    el({ tag: 'header', className: 'flex items-center gap-2 p-4' , rect: { x: 0, y: 0, w: 1280, h: 64 } }),
    el({ tag: 'span', className: 'w-2 h-2 rounded-full bg-green-500', selector: 'header > span:nth-child(2)',
      source: 'client/src/pages/customer-home.tsx:41:12', rect: { x: 120, y: 28, w: 8, h: 8 }, bg: 'rgb(34, 197, 94)', borderRadius: '9999px' }),
    el({ tag: 'img', className: 'h-8 w-auto', src: '/assets/logo.png', selector: 'header > img',
      rect: { x: 24, y: 16, w: 96, h: 32 } }),
    el({ tag: 'button', className: 'px-4 py-2 rounded bg-red-600 text-white', text: 'Delete',
      rect: { x: 900, y: 20, w: 90, h: 36 }, bg: 'rgb(220, 38, 38)' }),
  ];

  it('finds the green dot, top-ranked, with its exact source location', () => {
    const [best] = findUiElements(page, 'green dot');
    expect(best.element.source).toBe('client/src/pages/customer-home.tsx:41:12');
    expect(best.element.className).toContain('bg-green-500');
    expect(best.reasons.join(' ')).toMatch(/green background/);
  });

  it('does NOT return the logo for a "green dot" query — the exact wrong answer that deleted it', () => {
    const ids = findUiElements(page, 'green dot').map((m) => m.element.tag);
    expect(ids).not.toContain('img');
  });

  it('finds the logo when the logo is what was asked for', () => {
    const [best] = findUiElements(page, 'the logo');
    expect(best.element.tag).toBe('img');
    expect(best.element.src).toBe('/assets/logo.png');
  });

  it('finds a button by its visible text', () => {
    const [best] = findUiElements(page, 'the Delete button');
    expect(best.element.text).toBe('Delete');
  });

  it('returns nothing rather than a weak guess when nothing matches', () => {
    expect(findUiElements(page, 'purple sidebar')).toEqual([]);
  });

  it('respects the limit and is deterministic', () => {
    expect(findUiElements(page, 'green dot', 1)).toHaveLength(1);
    expect(findUiElements(page, 'green dot')).toEqual(findUiElements(page, 'green dot'));
  });
});

describe('formatUiFindings — the answer the agent reads', () => {
  const page: ScannedElement[] = [
    el({ tag: 'span', className: 'w-2 h-2 rounded-full bg-green-500', source: 'src/Home.tsx:41:12',
      rect: { x: 120, y: 28, w: 8, h: 8 }, bg: 'rgb(34, 197, 94)', borderRadius: '9999px' }),
  ];

  it('a hit gives the source location and tells the agent to edit THERE', () => {
    const out = formatUiFindings(page, 'green dot');
    expect(out).toContain('src/Home.tsx:41:12');
    expect(out).toContain('exact file:line:col');
  });

  it('without a source stamp it tells the agent to grep the EXACT class, not to guess', () => {
    const noStamp = [el({ tag: 'span', className: 'w-2 h-2 rounded-full bg-green-500', rect: { x: 1, y: 1, w: 8, h: 8 }, bg: 'rgb(34, 197, 94)', borderRadius: '9999px' })];
    const out = formatUiFindings(noStamp, 'green dot');
    expect(out).toContain('bg-green-500');
    expect(out).toMatch(/grep/i);
    expect(out).toContain('Do not guess a different element');
  });

  // THE decisive case: the admin later confirmed there was NO green dot at all. The honest answer is a
  // proof of absence the agent can repeat to the user — never a licence to edit something else.
  describe('the thing does not exist (the real mitrify case)', () => {
    const noGreen: ScannedElement[] = [
      el({ tag: 'img', className: 'h-8', src: '/logo.png', rect: { x: 0, y: 0, w: 96, h: 32 } }),
      el({ tag: 'button', className: 'bg-blue-600', text: 'Sign in', rect: { x: 900, y: 10, w: 80, h: 32 }, bg: 'rgb(37, 99, 235)' }),
    ];

    it('states plainly that it is NOT there, and forbids substituting another edit', () => {
      const out = formatUiFindings(noGreen, 'green dot');
      expect(out).toContain('NOT FOUND');
      expect(out).toContain('do NOT edit some other element');
      expect(out).toContain('NEVER substitute a different change');
    });

    it('proves absence with evidence — which colours DO exist on the page', () => {
      const out = formatUiFindings(noGreen, 'green dot');
      expect(out).toMatch(/No green element exists on this page at all/i);
      expect(out).toContain('blue');
    });

    it('says there are no dot-shaped elements when there are none', () => {
      expect(formatUiFindings(noGreen, 'green dot')).toMatch(/no small round .*elements/i);
    });

    it('points at image/SVG assets and other routes — where it usually actually is', () => {
      const out = formatUiFindings(noGreen, 'green dot');
      expect(out).toMatch(/IMAGE or SVG asset/i);
      expect(out).toMatch(/different route/i);
    });

    it('when the colour exists but not the shape, it says exactly that (no false "not there")', () => {
      const greenButton = [el({ tag: 'button', className: 'bg-green-600', text: 'Submit', rect: { x: 10, y: 10, w: 120, h: 40 }, bg: 'rgb(22, 163, 74)' })];
      const out = formatUiFindings(greenButton, 'green dot');
      expect(out).toContain('NOT FOUND');
      expect(out).toMatch(/green does appear on the page, but not in the shape/i);
    });

    it('never throws on an empty page', () => {
      expect(() => formatUiFindings([], 'green dot')).not.toThrow();
      expect(formatUiFindings([], 'green dot')).toContain('NOT FOUND');
    });
  });
});
