// The free image screen: the attach button is IN the box, the four selectors fold, the "what this
// tier is for" line sits where a first-time user looks, and the Pro price is said once.
//
// Admin, 2026-09-21, four small asks on one screenshot:
//   B. "change my own picture wala button, sirf attach button bana kar, input box ke andar karo"
//   E. "jo 4 dropdown selector hai … in charo ko bhi hide/expand ka button do"
//   F. "[free-tier line] is line ko, niche nahi. upar likhna hai. jahan 'no image yet' likh ke ata hai"
//   G. "₹1 per image, charged only if it arrives (pro mode me already yah likha hai!) … hatao!!"
//
// Source-level, because each of these is a PLACEMENT — where a control or a sentence sits — and
// placement is exactly what `tsc` and a render test cannot see.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FREE = code(read('src/components/ide/AIImageGenerator.tsx'));
const PICKER = code(read('src/components/ide/ReferenceImagePicker.tsx'));
const PRO = code(read('src/components/ide/ImageStudioPro.tsx'));

const freeScreen = FREE.slice(FREE.indexOf('No images yet'));
const dock = FREE.slice(FREE.indexOf('id="nbai-image-options"') > 0 ? FREE.indexOf('aria-controls="nbai-image-options"') : 0);
// Since 2026-09-23 the box is the shared ComposerShell (admin: "sabhi ai … navbharatai free ke jaisa"):
// the attach button is still INSIDE it, now on the right with the other controls, as the free chat has
// it. So "the pill" is the ComposerShell element, from its opening tag to the textarea it wraps.
const pill = dock.slice(dock.indexOf('<ComposerShell'), dock.indexOf('<textarea'));

describe('B — the attach button is inside the input pill', () => {
  it('the box carries an attach button, wired to the picker through openRef', () => {
    expect(dock.indexOf('<ComposerShell')).toBeGreaterThan(-1);
    expect(pill).toContain('aria-label="Attach your own picture to change"');
    expect(pill).toContain('onClick={() => attachRef.current?.()}');
    expect(pill).toContain('<ImagePlus');
    expect(FREE).toMatch(/<ReferenceImagePicker[\s\S]*?openRef=\{attachRef\}/);
  });

  it('the picker no longer renders its own full-width "Change my own picture" bar, but keeps the chooser and the crop', () => {
    expect(PICKER).not.toContain('Change my own picture');
    expect(PICKER).toContain('type="file"');
    expect(PICKER).toContain('<ImageCropEditor');
    // The card for an ATTACHED picture (adjust / remove) is untouched.
    expect(PICKER).toContain('aria-label="Adjust the picture"');
    expect(PICKER).toContain('aria-label="Remove the picture"');
  });

  it('the picker fills the ref and clears it on unmount, and honours disabled', () => {
    expect(PICKER).toMatch(/openRef\.current = \(\) => \{ if \(!disabled\) inputRef\.current\?\.click\(\); \};/);
    expect(PICKER).toMatch(/return \(\) => \{ openRef\.current = null; \};/);
  });
});

describe('E — the four selectors fold, and a folded row still names every setting in force', () => {
  it('the grid is behind optionsOpen and has a real toggle with aria-expanded', () => {
    expect(FREE).toMatch(/\{optionsOpen && \(\s*<div id="nbai-image-options" className="grid grid-cols-2 gap-2">/);
    expect(FREE).toContain('aria-expanded={optionsOpen}');
    expect(FREE).toContain('onClick={() => setOptionsOpen((o) => !o)}');
  });

  it('folded, the summary reads the SAME values the selectors hold — never a stale copy', () => {
    expect(FREE).toMatch(/\[imageType, labelOf\(STYLES, style\), labelOf\(SIZES, size\), labelOf\(COLOR_HINTS, colorHint\)\]/);
  });

  it('the custom-size fields fold with the selectors they belong to', () => {
    expect(FREE).toMatch(/\{optionsOpen && size === CUSTOM_SIZE_ID && \(/);
  });

  it('the fold is remembered per device, and an unreadable store means OPEN', () => {
    expect(FREE).toContain("const OPTIONS_KEY = 'nbai.imagegen.options';");
    expect(FREE).toMatch(/localStorage\.getItem\(OPTIONS_KEY\) !== 'closed'/);
    expect(FREE).toMatch(/catch \{\s*return true;\s*\}/);
  });
});

describe('F — "what the free tier is for" is said in the empty state, not under every send', () => {
  it('the line sits with "No images yet", before the examples', () => {
    const line = freeScreen.indexOf('Free images are made for your app');
    const examples = freeScreen.indexOf('EXAMPLES.map');
    expect(line).toBeGreaterThan(0);
    expect(line).toBeLessThan(examples);
    expect(FREE.split('Free images are made for your app').length).toBe(2);
  });

  it('the Pro pointer is still a REAL control there, and still hidden when Pro cannot serve', () => {
    const block = freeScreen.slice(freeScreen.indexOf('Free images are made for your app'), freeScreen.indexOf('EXAMPLES.map'));
    expect(block).toContain("onClick={() => setChosenTier('pro')}");
    expect(block).toContain('{!proOff && (');
  });

  it('under the input only the attached-picture hint remains, and only while a picture is attached', () => {
    const under = FREE.slice(FREE.indexOf('aria-label="Generate image"'));
    expect(under).not.toContain('Free images are made for your app');
    expect(under).toMatch(/\{reference && \(\s*<p[^>]*>\s*<Wand2[^>]*\/>\s*<span>Only what you ask for changes/);
  });
});

describe('G — the Pro price is said once, not under the input as well', () => {
  it('the studio no longer repeats "charged only if it arrives" under the box', () => {
    expect(PRO).not.toContain('charged only if it arrives');
  });

  it('…but the price is still on the toggle chip and in the Pro empty state', () => {
    expect(FREE).toContain('`Pro ₹${PRO_PRICE_INR}`');
    expect(PRO).toMatch(/₹\{PRICE_INR\} per image/);
  });
});
