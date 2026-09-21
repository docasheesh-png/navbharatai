// The prompt already carried the phone number — so the user should not type it twice.
//
// 🔑 THE ASYMMETRY IS THE DESIGN, and every case below is chosen to test one side of it. A MISSED
// extraction costs one manual retype, which is exactly today's cost, so a miss is free. A WRONG
// extraction pre-fills junk onto somebody's banner — and the worst kind, a number that is nearly
// right, is the kind they are least likely to notice. So the false-positive tests matter more than
// the true-positive ones, and there are deliberately more of them.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  ENGINE_CANNOT_RENDER,
  extractImageText,
  findAddress,
  findPhones,
  findRateList,
  layersFromExtracted,
  noTextDirection,
} from '../src/lib/imageTextFromPrompt';
import { MAX_TEXT_CHARS } from '../src/lib/textOverlay';

let n = 0;
const id = () => `x${++n}`;

describe('a phone number is found as written, and confirmed as dialable', () => {
  it('finds the shapes people type', () => {
    expect(findPhones('phone 98765 43210')).toEqual(['98765 43210']);
    expect(findPhones('call 9876543210 now')).toEqual(['9876543210']);
    expect(findPhones('+91 98765-43210')).toEqual(['+91 98765-43210']);
    expect(findPhones('0 9876543210')).toContain('9876543210');
  });

  it('keeps the user\'s own formatting — a board shows 98765 43210, not +919876543210', () => {
    expect(findPhones('phone 98765 43210')[0]).toBe('98765 43210');
  });

  it('refuses a longer digit run — an order number is not a phone number', () => {
    expect(findPhones('order number 9876543210987')).toEqual([]);
    expect(findPhones('reference 123456789012')).toEqual([]);
  });

  it('refuses a number that could not be dialled here', () => {
    expect(findPhones('call 1234567890')).toEqual([]); // Indian mobiles start 6-9
    expect(findPhones('code 12345')).toEqual([]);
    expect(findPhones('year 2026 and 1947')).toEqual([]);
  });
});

describe('an address needs TWO signals, or an explicit label', () => {
  it('takes a labelled address at its word', () => {
    expect(findAddress('address: Shop 12, Nehru Market, Kanpur 208001')).toBe('Shop 12, Nehru Market, Kanpur 208001');
    expect(findAddress('pata: Gali no 4, Civil Lines, Agra 282001')).toBe('Gali no 4, Civil Lines, Agra 282001');
  });

  it('cuts a labelled address at the phone that follows it', () => {
    // Left in, the address layer carries the number AND the phone rule then skips it as a duplicate,
    // so the user loses the separate, bigger number a shop board actually wants.
    expect(findAddress('address: Shop 12, Nehru Market, Kanpur 208001, phone +91 98765-43210'))
      .toBe('Shop 12, Nehru Market, Kanpur 208001');
  });

  it('accepts an unlabelled clause only when it has a marker AND a PIN', () => {
    expect(findAddress('Shop 5, Rajouri Market, Delhi 110027')).toBe('Shop 5, Rajouri Market, Delhi 110027');
    expect(findAddress('a busy market in Delhi')).toBe('');      // marker, no PIN
    expect(findAddress('poster number 110027 please')).toBe(''); // PIN-shaped, no marker
  });

  it('cuts the address out of a longer sentence without dragging the sentence along', () => {
    // The first marker here is the user talking ABOUT their shop, not the shop's number.
    expect(findAddress('make a poster for my shop, Shop 5, Rajouri Market, Delhi 110027, very colourful'))
      .toBe('Shop 5, Rajouri Market, Delhi 110027');
  });

  it('keeps the proper noun a marker belongs to — "Rajouri Market", not "Market"', () => {
    expect(findAddress('Rajouri Market, Delhi 110027')).toBe('Rajouri Market, Delhi 110027');
    expect(findAddress('MG Road, Bengaluru 560001')).toBe('MG Road, Bengaluru 560001');
  });

  it('handles an address that leads with a marker of its own', () => {
    expect(findAddress('Near Bus Stand, Sector 14, Gurgaon 122001')).toBe('Near Bus Stand, Sector 14, Gurgaon 122001');
  });

  it('finds nothing in an ordinary picture request', () => {
    expect(findAddress('a beautiful sunset over the mountains')).toBe('');
    expect(findAddress('')).toBe('');
  });
});

describe('a rate list must be declared, never guessed out of prose', () => {
  it('reads a labelled one-line menu', () => {
    expect(findRateList('rate list: Chai 10, Samosa 15, Coffee 25')).toBe('Chai 10\nSamosa 15\nCoffee 25');
    expect(findRateList('menu: Dosa 90, Idli 40')).toBe('Dosa 90\nIdli 40');
  });

  it('reads an unlabelled menu typed on separate lines', () => {
    expect(findRateList('Chai 10\nSamosa 15\nCoffee 25')).toBe('Chai 10\nSamosa 15\nCoffee 25');
  });

  it('🔴 does NOT turn an address into a menu — the first draft sold "Shop" for ₹12', () => {
    const prompt = 'address: Shop 12, Nehru Market, Kanpur 208001, phone +91 98765-43210';
    expect(findRateList(prompt)).toBe('');
  });

  it('refuses prose that merely contains numbers', () => {
    expect(findRateList('birthday poster, 2026 theme, 500 rupees budget')).toBe('');
    expect(findRateList('a poster for 500 rupees')).toBe('');
    expect(findRateList('Sharma Sweets ka banner, phone 98765 43210')).toBe('');
  });

  it('needs two rows — one is just a sentence with a number in it', () => {
    expect(findRateList('menu: Chai 10')).toBe('');
  });

  it('a mixed block of lines is not a menu, even if two of them are rows', () => {
    expect(findRateList('make a poster\nChai 10\nSamosa 15')).toBe('');
  });
});

describe('the whole extraction, on prompts people really write', () => {
  it('pulls name, address and phone out of one sentence, each separately', () => {
    const got = extractImageText('"Gupta Mobile" ke liye poster, address: Shop 12, Nehru Market, Kanpur 208001, phone +91 98765-43210');
    expect(got).toEqual([
      { kind: 'name', text: 'Gupta Mobile' },
      { kind: 'address', text: 'Shop 12, Nehru Market, Kanpur 208001' },
      { kind: 'phone', text: '+91 98765-43210' },
    ]);
  });

  it('pulls just the phone when that is all there is', () => {
    expect(extractImageText('Sharma Sweets ka banner, phone 98765 43210'))
      .toEqual([{ kind: 'phone', text: '98765 43210' }]);
  });

  it('never repeats a phone that is already inside the address', () => {
    const got = extractImageText('Shop 2, MG Road, Pune 411001 98765 43210');
    const phones = got.filter((g) => g.kind === 'phone');
    const address = got.find((g) => g.kind === 'address');
    if (address?.text.includes('98765 43210')) expect(phones).toHaveLength(0);
  });

  it('finds nothing at all in an ordinary picture request', () => {
    for (const p of [
      'a beautiful sunset over the mountains',
      'poster for a market scene in Delhi',
      'make a logo for order number 9876543210987',
      'birthday poster, 2026 theme, 500 rupees budget',
      '3d render of a blue sports car',
      '',
      '   ',
    ]) expect(extractImageText(p)).toEqual([]);
  });

  it('does not duplicate the same finding twice', () => {
    const got = extractImageText('phone 98765 43210 and again 98765 43210');
    expect(got.filter((g) => g.kind === 'phone')).toHaveLength(1);
  });
});

describe('the found text becomes placed layers, top to bottom', () => {
  it('places a name high and an address low', () => {
    const layers = layersFromExtracted(extractImageText('"Gupta Mobile" ke liye poster, address: Shop 12, Nehru Market, Kanpur 208001'), id);
    const name = layers[0];
    const address = layers[layers.length - 1];
    expect(name.yPct).toBeLessThan(address.yPct);
    expect(name.sizePct).toBeGreaterThan(address.sizePct);
  });

  it('makes a rate list a LIST layer, not a caption', () => {
    const layers = layersFromExtracted(extractImageText('menu: Chai 10, Samosa 15'), id);
    expect(layers).toHaveLength(1);
    expect(layers[0].kind).toBe('list');
    expect(layers[0].text).toBe('Chai 10\nSamosa 15');
  });

  it('gives every layer its own id', () => {
    const layers = layersFromExtracted(extractImageText('"A" poster, address: Shop 1, MG Road, Pune 411001, phone 98765 43210'), id);
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length);
  });

  it('returns nothing when nothing was found — the editor then opens empty, as before', () => {
    expect(layersFromExtracted([], id)).toEqual([]);
  });

  it('never exceeds the text cap', () => {
    const long = 'x'.repeat(MAX_TEXT_CHARS + 200);
    expect(layersFromExtracted([{ kind: 'name', text: long }], id)[0].text).toHaveLength(MAX_TEXT_CHARS);
  });
});

describe('the engine is told to leave alone only what it cannot do', () => {
  it('names the three it cannot render', () => {
    expect(ENGINE_CANNOT_RENDER).toEqual(['phone', 'address', 'list']);
  });

  it('a shop NAME is deliberately not on that list — 1-5 words is what engines are good at', () => {
    expect(ENGINE_CANNOT_RENDER).not.toContain('name');
    expect(noTextDirection([{ kind: 'name', text: 'Gupta Mobile' }])).toBe('');
  });

  it('says nothing when there is nothing to leave alone', () => {
    expect(noTextDirection([])).toBe('');
  });

  it('names exactly the categories found, and asks for clean space', () => {
    const line = noTextDirection([{ kind: 'phone', text: '98765 43210' }, { kind: 'list', text: 'a 1\nb 2' }]);
    expect(line).toContain('phone numbers');
    expect(line).toContain('price or menu lists');
    expect(line).not.toContain('addresses');
    expect(line).toContain('clean');
  });
});


describe('the extraction is actually wired to both tiers and to the brief', () => {
  // Source-level: nothing in `tsc` or a behavioural test can see a prop that stopped being passed,
  // and the failure would be silent — the editor would simply open empty again, exactly as before,
  // which is indistinguishable from "the prompt had nothing in it".
  const code = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');

  const FREE = 'src/components/ide/AIImageGenerator.tsx';
  const PRO = 'src/components/ide/ImageStudioPro.tsx';
  const ROUTE = 'src/server/routes/imageGen.ts';
  const EDITOR = 'src/components/ide/TextOverlayEditor.tsx';

  it('the free generator pre-fills the editor from the prompt', () => {
    expect(/initialLayers=\{layersFromExtracted\(extractImageText\(/.test(code(FREE))).toBe(true);
  });

  it('the Pro studio pre-fills from THAT result\'s prompt', () => {
    const src = code(PRO);
    expect(/initialLayers=\{layersFromExtracted\(extractImageText\(/.test(src)).toBe(true);
    expect(src).toContain('target.prompt');
  });

  it('the editor actually uses what it is given, rather than accepting a dead prop', () => {
    const src = code(EDITOR);
    expect(src).toContain('initialLayers');
    expect(/initialLayers\s*&&\s*initialLayers\.length\s*>\s*0/.test(src)).toBe(true);
  });

  it('the engine is told to leave those categories alone', () => {
    const src = code(ROUTE);
    expect(src).toContain('noTextDirection(extractImageText(');
    // And the direction must reach the prompt that is actually sent, not sit in an unused variable.
    expect(/leaveAlone\s*\?/.test(src)).toBe(true);
  });
});
