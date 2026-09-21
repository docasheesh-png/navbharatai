// One tap, and the board is laid out.
//
// Pieces 1 and 2 gave the editor a rate-card layer and filled it from the user's own prompt. What was
// still missing is the ARRANGEMENT — somebody who did not spell their whole board out in the prompt
// still opened one empty caption and had to invent the layout themselves.
//
// The two rules that matter most here are both about NOT LOSING THINGS: an unfilled slot is kept (or
// the blank page comes back for whoever typed no phone number), and anything extracted that the
// template has no slot for is kept too (or picking "Shop board" would silently delete the menu the
// user had already written).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { BOARD_TEMPLATES, findTemplate, layersFromTemplate } from '../src/lib/imageBoardTemplates';
import { extractImageText } from '../src/lib/imageTextFromPrompt';
import { MAX_LAYERS, MAX_TEXT_CHARS, drawTextLayers, type TextContext } from '../src/lib/textOverlay';

let n = 0;
const id = () => `t${++n}`;
const shop = findTemplate('shop')!;
const rate = findTemplate('rate')!;

describe('a template places named slots, top to bottom', () => {
  it('offers exactly the three boards a shop prints, each with a hint', () => {
    expect(BOARD_TEMPLATES.map((t) => t.id)).toEqual(['shop', 'rate', 'offer']);
    for (const t of BOARD_TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.hint.length).toBeGreaterThan(0);
      expect(t.slots.length).toBeGreaterThan(0);
    }
  });

  it('places the name above the phone above the address', () => {
    const layers = layersFromTemplate(shop, [], id);
    expect(layers.map((l) => l.label)).toEqual(['Shop name', 'Phone', 'Address']);
    expect(layers[0].yPct).toBeLessThan(layers[1].yPct);
    expect(layers[1].yPct).toBeLessThan(layers[2].yPct);
  });

  it('makes the name biggest and the address smallest', () => {
    const [name, phone, address] = layersFromTemplate(shop, [], id);
    expect(name.sizePct).toBeGreaterThan(phone.sizePct);
    expect(phone.sizePct).toBeGreaterThan(address.sizePct);
  });

  it('gives the rate template a real LIST layer', () => {
    const layers = layersFromTemplate(rate, [], id);
    expect(layers.filter((l) => l.kind === 'list')).toHaveLength(1);
  });

  it('gives every layer its own id', () => {
    const layers = layersFromTemplate(shop, [], id);
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length);
  });
});

describe('it fills what the prompt already answered', () => {
  const found = extractImageText('"Gupta Mobile" poster, address: Shop 12, Nehru Market, Kanpur 208001, phone +91 98765-43210');

  it('puts each finding in its own slot', () => {
    const layers = layersFromTemplate(shop, found, id);
    expect(layers[0].text).toBe('Gupta Mobile');
    expect(layers[1].text).toBe('+91 98765-43210');
    expect(layers[2].text).toBe('Shop 12, Nehru Market, Kanpur 208001');
  });

  it('never uses the same finding for two slots', () => {
    const twoPhones = extractImageText('call 98765 43210 or 98765 43211');
    const layers = layersFromTemplate(shop, twoPhones, id);
    const texts = layers.map((l) => l.text).filter(Boolean);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe('🔴 nothing is ever silently lost', () => {
  it('KEEPS an unfilled slot as an empty, labelled box — that is the blank page it removes', () => {
    const layers = layersFromTemplate(shop, extractImageText('phone 98765 43210'), id);
    expect(layers).toHaveLength(3);
    const empty = layers.filter((l) => !l.text);
    expect(empty.length).toBeGreaterThan(0);
    for (const l of empty) expect(l.label).toBeTruthy();
  });

  it('an empty slot draws NOTHING until it is typed into', () => {
    const calls: string[] = [];
    const ctx: TextContext = {
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: '', textAlign: '', textBaseline: '',
      save() {}, restore() {},
      measureText: (t: string) => ({ width: t.length * 10 }),
      fillText: (t: string) => { calls.push(t); },
      strokeText: (t: string) => { calls.push(t); },
      fillRect: () => {},
      // Added with the border (2026-09-21): tests sit outside `tsconfig`'s include, so a fake
      // missing an interface method compiles and only throws when that method is really called.
      strokeRect: () => {},
    };
    drawTextLayers(ctx, layersFromTemplate(shop, [], id), 1000, 1000);
    expect(calls).toEqual([]);
  });

  it('KEEPS a finding the template has no slot for — picking "Shop board" must not delete the menu', () => {
    const withMenu = extractImageText('menu: Chai 10, Samosa 15');
    expect(withMenu.some((f) => f.kind === 'list')).toBe(true);
    const layers = layersFromTemplate(shop, withMenu, id); // shop has NO list slot
    expect(layers.some((l) => l.kind === 'list' && l.text.includes('Chai 10'))).toBe(true);
  });

  it('never returns more layers than the editor can hold', () => {
    const many = extractImageText(['"A" poster, address: Shop 1, MG Road, Pune 411001',
      'call 98765 43210', 'call 98765 43211', 'call 98765 43212', 'call 98765 43213',
      'call 98765 43214', 'call 98765 43215', 'call 98765 43216'].join('\n'));
    expect(layersFromTemplate(shop, many, id).length).toBeLessThanOrEqual(MAX_LAYERS);
  });

  it('never exceeds the text cap', () => {
    const long = [{ kind: 'name' as const, text: 'x'.repeat(MAX_TEXT_CHARS + 200) }];
    expect(layersFromTemplate(shop, long, id)[0].text).toHaveLength(MAX_TEXT_CHARS);
  });
});

describe('the label is a UI hint and must never reach the picture', () => {
  it('is not drawn even though the layer carries it', () => {
    const drawn: string[] = [];
    const ctx: TextContext = {
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: '', textAlign: '', textBaseline: '',
      save() {}, restore() {},
      measureText: (t: string) => ({ width: t.length * 10 }),
      fillText: (t: string) => { drawn.push(t); },
      strokeText: () => {},
      fillRect: () => {},
      // Added with the border (2026-09-21): tests sit outside `tsconfig`'s include, so a fake
      // missing an interface method compiles and only throws when that method is really called.
      strokeRect: () => {},
    };
    const layers = layersFromTemplate(shop, extractImageText('phone 98765 43210'), id);
    drawTextLayers(ctx, layers, 1000, 1000);
    // Exactly one thing was typed, so exactly one thing is drawn — and it is that, not a slot name.
    expect(drawn).toEqual(['98765 43210']);
    expect(layers.some((l) => !!l.label)).toBe(true);
    for (const l of layers) if (l.label) expect(drawn).not.toContain(l.label);
  });
});

describe('an unknown template is refused rather than guessed', () => {
  it('returns null', () => {
    expect(findTemplate('nope')).toBeNull();
    expect(findTemplate('')).toBeNull();
  });
});

describe('the templates are reachable from both tiers', () => {
  const code = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');

  const EDITOR = 'src/components/ide/TextOverlayEditor.tsx';

  it('the editor renders a button per template and applies it', () => {
    const src = code(EDITOR);
    expect(/BOARD_TEMPLATES\.map\(/.test(src)).toBe(true);
    expect(/onClick=\{\(\) => applyTemplate\(t\)\}/.test(src)).toBe(true);
    expect(src).toContain('layersFromTemplate(');
  });

  it('both tiers hand the editor the findings a template fills from', () => {
    // ⚠️ REPOINTED 2026-09-21, and the reason is worth keeping: the free generator became a THREAD,
    // so it hoists the findings into one `const found = extractImageText(target.prompt)` and feeds
    // both props from it instead of calling the extractor twice inline. The property this case
    // exists to guard did not change — the editor is handed findings taken from THAT image's own
    // request — so it is now asserted directly rather than through one call shape.
    for (const f of ['src/components/ide/AIImageGenerator.tsx', 'src/components/ide/ImageStudioPro.tsx']) {
      const src = code(f);
      expect(src, `${f} does not pass an extracted prop`).toMatch(/extracted=\{/);
      // `\b` rather than a closing paren: the paid studio writes `target.prompt || ''`, and the
      // property being guarded is WHICH prompt is read, not how it is defaulted.
      expect(src, `${f} does not extract from that image's own prompt`).toMatch(/extractImageText\(target\.prompt\b/);
    }
  });

  it('an empty slot shows its label in the chips instead of "Text 3"', () => {
    expect(code(EDITOR)).toContain('l.label');
  });
});
