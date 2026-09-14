/**
 * Copying an admin page as text (admin 2026-09-14).
 *
 * Asked for as *"pure page ka screenshot le kar keyboard pe copy kar lena! pure 100% pages ko"*, and
 * answered with a structured TEXT copy rather than an image — a browser cannot photograph its own
 * window, and every library that claims otherwise re-draws the page and gets it wrong (the refusal
 * `ReportSheet.tsx` already recorded).
 *
 * What is pinned here is not the wording of the outline but the three properties that decide whether
 * the paste is worth reading:
 *   • it must not carry secrets off the device — the admin panel renders a live TOTP secret;
 *   • a truncated page must SAY it was truncated, because a short outline and a short page look
 *     identical in a chat window;
 *   • a table must arrive as rows, not as one line per cell — fifty rows of confetti is not a copy.
 */
import { describe, it, expect } from 'vitest';
import {
  collapse, redactSecrets, isVisible, ownText, describeControl, outlinePage, formatPageSnapshot,
  type SnapNode, type PageOutline,
} from '../src/lib/pageSnapshot';

/** A DOM-ish node with no rects, so these tests describe structure rather than layout. */
function el(tag: string, opts: { attrs?: Record<string, string>; children?: SnapNode[]; text?: string; rect?: { width: number; height: number } } = {}): SnapNode {
  const attrs = opts.attrs ?? {};
  const kids: SnapNode[] = [];
  if (opts.text !== undefined) kids.push({ nodeType: 3, nodeValue: opts.text });
  for (const c of opts.children ?? []) kids.push(c);
  const node: SnapNode = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: kids,
    getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
  };
  if (opts.rect) node.getBoundingClientRect = () => opts.rect!;
  return node;
}

const box = { width: 100, height: 20 };

describe('collapse / redactSecrets', () => {
  it('collapses whitespace and trims', () => {
    expect(collapse('  a \n\t b  ')).toBe('a b');
    expect(collapse(null)).toBe('');
    expect(collapse(undefined)).toBe('');
  });

  it('redacts an otpauth URI wherever it appears', () => {
    const out = redactSecrets('Or paste this URI: otpauth://totp/NavBharatAI?secret=JBSWY3DPEHPK3PXP&issuer=x now');
    expect(out).toContain('otpauth://[hidden]');
    expect(out).not.toContain('JBSWY3DPEHPK3PXP');
    expect(out.endsWith('now')).toBe(true);
  });

  it('leaves ordinary text alone', () => {
    expect(redactSecrets('Revenue ₹1,240 today')).toBe('Revenue ₹1,240 today');
  });
});

describe('isVisible', () => {
  it('treats a node that cannot be measured as visible', () => {
    expect(isVisible({ nodeType: 1, tagName: 'DIV' })).toBe(true);
  });

  it('treats a zero box as not visible — this is how display:none is filtered', () => {
    expect(isVisible(el('div', { rect: { width: 0, height: 0 } }))).toBe(false);
  });

  it('treats a real box as visible', () => {
    expect(isVisible(el('div', { rect: box }))).toBe(true);
  });
});

describe('ownText', () => {
  it('reads only the element’s own text nodes, not its descendants’', () => {
    const node = el('div', { text: 'Label', children: [el('span', { text: 'Value' })] });
    expect(ownText(node)).toBe('Label');
  });

  it('is empty when the element only wraps other elements', () => {
    expect(ownText(el('div', { children: [el('span', { text: 'x' })] }))).toBe('');
  });
});

describe('describeControl', () => {
  it('names the field and shows an ordinary value', () => {
    const out = describeControl(el('input', { attrs: { type: 'text', name: 'search', value: 'paisa' } }));
    expect(out).toContain('[text]');
    expect(out).toContain('search');
    expect(out).toContain('= paisa');
  });

  it('never shows a password value', () => {
    const out = describeControl(el('input', { attrs: { type: 'password', name: 'adminPassword', value: 'hunter2' } }));
    expect(out).not.toContain('hunter2');
    expect(out).toContain('[hidden]');
  });

  it.each(['adminToken', 'api_key', 'totpSecret', 'user-pin'])('masks a field named %s even when its type is text', (name) => {
    const out = describeControl(el('input', { attrs: { type: 'text', name, value: 'S3CR3TVALUE' } }));
    expect(out).not.toContain('S3CR3TVALUE');
    expect(out).toContain('[hidden]');
  });

  it('reports a checkbox by state, not by value', () => {
    expect(describeControl(el('input', { attrs: { type: 'checkbox', name: 'live', checked: 'true' } }))).toContain('= checked');
    expect(describeControl(el('input', { attrs: { type: 'checkbox', name: 'live' } }))).toContain('= unchecked');
  });

  it('says (empty) rather than nothing, so a blank field is distinguishable from a missing one', () => {
    expect(describeControl(el('input', { attrs: { type: 'text', name: 'code' } }))).toContain('= (empty)');
  });
});

describe('outlinePage', () => {
  it('reports scanned:false for a missing root — never an empty page', () => {
    const out = outlinePage(null);
    expect(out.scanned).toBe(false);
    expect(out.lines).toEqual([]);
  });

  it('reads headings, text and buttons in page order, indented by depth', () => {
    const root = el('div', {
      rect: box,
      children: [
        el('h1', { text: 'Monitor', rect: box }),
        el('div', { rect: box, children: [el('p', { text: 'Builds today: 12', rect: box })] }),
        el('button', { text: 'Refresh', rect: box }),
      ],
    });
    const out = outlinePage(root);
    expect(out.scanned).toBe(true);
    expect(out.lines.map((l) => l.trim())).toEqual(['# Monitor', 'Builds today: 12', '[button] Refresh']);
    // Nesting shows up as indentation, which is what makes the paste readable as a page.
    expect(out.lines[1].startsWith('    ')).toBe(true);
  });

  it('skips an element carrying data-nb-no-copy, and everything inside it', () => {
    const root = el('div', {
      rect: box,
      children: [
        el('p', { text: 'visible', rect: box }),
        el('div', { attrs: { 'data-nb-no-copy': '' }, rect: box, children: [el('code', { text: 'JBSWY3DPEHPK3PXP', rect: box })] }),
      ],
    });
    const text = outlinePage(root).lines.join('\n');
    expect(text).toContain('visible');
    expect(text).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('honours data-nb-no-copy on a table cell too — the row path is a separate reader', () => {
    const row = el('tr', {
      rect: box,
      children: [
        el('td', { text: 'code', rect: box }),
        el('td', { attrs: { 'data-nb-no-copy': '' }, rect: box, children: [el('code', { text: 'TOPSECRET', rect: box })] }),
      ],
    });
    const text = outlinePage(el('table', { rect: box, children: [row] })).lines.join('\n');
    expect(text).toContain('code');
    expect(text).not.toContain('TOPSECRET');
  });

  it('emits nothing from a zero-box element but still reads its children (display:contents)', () => {
    const root = el('div', {
      rect: box,
      children: [
        el('div', { text: 'ghost', rect: { width: 0, height: 0 }, children: [el('span', { text: 'real', rect: box })] }),
      ],
    });
    const lines = outlinePage(root).lines.map((l) => l.trim());
    expect(lines).toContain('real');
    expect(lines).not.toContain('ghost');
  });

  it('turns a table row into ONE line of cells', () => {
    const row = el('tr', {
      rect: box,
      children: [
        el('td', { text: 'NBAI10', rect: box }),
        el('td', { text: '5000', rect: box }),
        el('td', { rect: box, children: [el('span', { text: 'Active', rect: box })] }),
      ],
    });
    const root = el('table', { rect: box, children: [el('tbody', { rect: box, children: [row] })] });
    const lines = outlinePage(root).lines.map((l) => l.trim()).filter(Boolean);
    expect(lines).toEqual(['| NBAI10 | 5000 | Active |']);
  });

  it('describes an image by its alt text', () => {
    const root = el('div', { rect: box, children: [el('img', { attrs: { alt: 'Revenue chart' }, rect: box })] });
    expect(outlinePage(root).lines.join('')).toContain('[image] Revenue chart');
  });

  it('keeps an icon-only button by its aria-label — a pressable thing is part of the page', () => {
    const root = el('div', { rect: box, children: [el('button', { attrs: { 'aria-label': 'Delete promo' }, rect: box })] });
    expect(outlinePage(root).lines.join('')).toContain('[button] Delete promo');
  });

  it('never reads script or style content', () => {
    const root = el('div', {
      rect: box,
      children: [
        el('script', { text: 'window.token="abc"', rect: box }),
        el('style', { text: '.a{color:red}', rect: box }),
        el('p', { text: 'kept', rect: box }),
      ],
    });
    expect(outlinePage(root).lines.map((l) => l.trim())).toEqual(['kept']);
  });

  it('redacts an otpauth URI that reaches the outline by any other route', () => {
    const root = el('div', { rect: box, children: [el('p', { text: 'otpauth://totp/x?secret=ZZZZ', rect: box })] });
    const text = outlinePage(root).lines.join('\n');
    expect(text).not.toContain('secret=ZZZZ');
    expect(text).toContain('otpauth://[hidden]');
  });

  it('marks truncation when the line budget runs out, rather than returning a quiet short page', () => {
    const kids = Array.from({ length: 40 }, (_, i) => el('p', { text: `row ${i}`, rect: box }));
    const out = outlinePage(el('div', { rect: box, children: kids }), { maxLines: 5 });
    expect(out.lines.length).toBe(5);
    expect(out.truncated).toBe(true);
  });

  it('marks truncation when the character budget runs out', () => {
    const kids = Array.from({ length: 40 }, () => el('p', { text: 'x'.repeat(100), rect: box }));
    const out = outlinePage(el('div', { rect: box, children: kids }), { maxChars: 300 });
    expect(out.truncated).toBe(true);
    expect(out.lines.join('\n').length).toBeLessThanOrEqual(400);
  });

  it('does not mark truncation for a page that fits', () => {
    const out = outlinePage(el('div', { rect: box, children: [el('p', { text: 'small', rect: box })] }));
    expect(out.truncated).toBe(false);
    expect(out.elementsSeen).toBeGreaterThan(0);
  });
});

describe('formatPageSnapshot', () => {
  const outline: PageOutline = { scanned: true, lines: ['# Monitor', '[button] Refresh'], truncated: false, elementsSeen: 9 };

  it('says what it is in its first line, so a reader never guesses', () => {
    const text = formatPageSnapshot({ page: 'Monitor', outline });
    expect(text.split('\n')[0]).toContain('text, not an image');
    expect(text).toContain('Page: Monitor');
  });

  it('carries the facts a fix needs', () => {
    const text = formatPageSnapshot({
      page: 'Revenue',
      capturedAt: '2026-09-14T10:00:00.000Z',
      frontendBuild: '2026-09-14T09:00:00Z',
      appBuild: '91',
      viewport: '412x915',
      dpr: 2.63,
      platform: 'android',
      language: 'en-IN',
      online: true,
      connection: '4g',
      userAgent: 'Mozilla/5.0 (Linux; Android 14)',
      overflowLine: 'Off-screen: div.grid reaches 24px past the right edge',
      outline,
    });
    expect(text).toContain('2026-09-14T10:00:00.000Z');
    expect(text).toContain('frontend 2026-09-14T09:00:00Z');
    expect(text).toContain('app 91');
    expect(text).toContain('412x915');
    expect(text).toContain('@2.63x');
    expect(text).toContain('android');
    expect(text).toContain('4g');
    expect(text).toContain('Off-screen: div.grid reaches 24px');
    expect(text).toContain('# Monitor');
  });

  it('says "none" for errors rather than leaving the section out', () => {
    expect(formatPageSnapshot({ page: 'Users', outline })).toContain('Recent errors in this tab: none');
  });

  it('lists recent errors and redacts a secret inside one', () => {
    const text = formatPageSnapshot({ page: 'Users', errors: ['TypeError: x @ chunk.js:2', 'failed otpauth://totp/a?secret=QQQQ'], outline });
    expect(text).toContain('Recent errors in this tab (2)');
    expect(text).toContain('TypeError: x @ chunk.js:2');
    expect(text).not.toContain('secret=QQQQ');
  });

  it('marks OFFLINE loudly — it explains half the bugs on its own', () => {
    expect(formatPageSnapshot({ page: 'Users', online: false, outline })).toContain('OFFLINE');
  });

  it('says so when the page could not be read, instead of showing an empty body', () => {
    const text = formatPageSnapshot({ page: 'Users', outline: { scanned: false, lines: [], truncated: false, elementsSeen: 0 } });
    expect(text).toContain('could not be read');
  });

  it('distinguishes an unreadable page from a genuinely empty one', () => {
    const text = formatPageSnapshot({ page: 'Users', outline: { scanned: true, lines: [], truncated: false, elementsSeen: 3 } });
    expect(text).toContain('read as empty');
    expect(text).not.toContain('could not be read');
  });

  it('warns when the copy is only the top of the page', () => {
    const text = formatPageSnapshot({ page: 'Users', outline: { ...outline, truncated: true } });
    expect(text).toContain('not all of it');
  });
});
