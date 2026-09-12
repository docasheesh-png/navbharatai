// The categories that are never allowed, and the one that only needs the 18+ switch.
//
// The tests are written as REAL apps, because the whole risk of this file is false positives: a news
// reader, a pharmacy, a chemistry lesson and a crime game all contain words a naive list would fire
// on. Every "must not fire" case below is an app somebody could legitimately publish tomorrow.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyPublishedText, illegalRefusal, ILLEGAL_RULES, SCAN_TEXT_CAP } from './illegalContentRules';

const cls = (text: string) => classifyPublishedText(text).contentClass;
const ids = (text: string) => classifyPublishedText(text).findings.map((f) => f.id);

describe('🔒 the illegal tier fires on the pairing, not on a word', () => {
  it('CSAM signal — a child word AND an explicitly sexual word', () => {
    expect(cls('<h1>underage porn</h1><p>browse our collection</p>')).toBe('illegal');
    expect(ids('teen section — child nude gallery')).toContain('CSAM_SIGNAL');
  });

  it('non-consensual imagery — undressing a real person from a photo', () => {
    expect(cls('<h1>Nudify AI</h1><p>Upload her photo and see the result</p>')).toBe('illegal');
    expect(ids('deepfake face swap — any picture')).toContain('NON_CONSENSUAL_IMAGERY');
  });

  it('weapon manufacture — the device AND the instructions', () => {
    expect(cls('Pipe bomb: step by step instructions and materials needed')).toBe('illegal');
    expect(ids('How to make a ghost gun — full tutorial')).toContain('WEAPON_MANUFACTURE');
  });

  it('drug marketplace — the substance AND the shop', () => {
    expect(cls('MDMA in stock — discreet shipping, bitcoin only')).toBe('illegal');
    expect(ids('cocaine, escrow accepted')).toContain('DRUG_MARKETPLACE');
  });

  it('🔴 ordinary shop words carry NO signal — this narrowing came from a failing test', () => {
    // "Add to cart" / "buy now" are exactly what a LAWFUL seller of a controlled medicine also has,
    // so they were removed from the context. The pharmacy case below is the one that caught it.
    expect(cls('Cocaine. Add to cart. Buy now.')).toBe('general');
  });
});

describe('🔴 the false positives that would have made this gate worth switching off', () => {
  // Each of these is an app somebody could legitimately publish, and each contains a word a naive
  // list fires on. If any of these ever classifies as illegal, the rule is wrong, not the app.
  const legitimate: Array<[string, string]> = [
    ['a news reader', 'Breaking: pipe bomb found near the station. Police say no children were hurt.'],
    ['a cricket app', 'He bombed that delivery over long-on for six.'],
    ['a pharmacy listing', 'Ketamine injection 50mg — prescription required. Add to cart after uploading your prescription.'],
    ['a de-addiction helpline', 'Struggling with heroin or cocaine? Talk to a counsellor today. Recovery is possible.'],
    ['a school app', 'Children in Class 8 must bring their ID. Parents of minors should sign the form.'],
    ['a photo editor', 'Upload your photo and apply a filter to any picture or selfie.'],
    ['a chemistry lesson', 'A detonator converts electrical energy into a shockwave. Nitrogen compounds are unstable.'],
    ['a crime drama', 'The detective found the improvised explosive in the warehouse.'],
    ['a health app for teens', 'Sexual health advice for young adults. Confidential and free.'],
    ['a code file', 'const bombardElement = () => {}; const nudeColorPalette = ["#e3c4a8"];'],
  ];

  for (const [what, text] of legitimate) {
    it(`${what} is NOT illegal`, () => {
      expect(classifyPublishedText(text).contentClass, text).not.toBe('illegal');
    });
  }

  it('a subject with no context, and a context with no subject, both stay clean', () => {
    expect(cls('pipe bomb')).toBe('general');
    expect(cls('step by step instructions')).toBe('general');
    expect(cls('cocaine')).toBe('general');
    expect(cls('discreet shipping on every order')).toBe('general');
  });
});

describe('the adult tier — lawful, and governed by the 18+ switch rather than blocked', () => {
  it('classifies adult content as `adult`, never `illegal`', () => {
    expect(cls('<h1>Adult videos</h1><p>Browse categories · 18+ only</p>')).toBe('adult');
    expect(ids('premium erotica gallery — subscribe')).toContain('ADULT_CONTENT');
  });

  it('illegal WINS over adult when both are present', () => {
    // An app can be both; only the stricter answer may be acted on.
    const both = 'Adult videos gallery. Also: underage nude section.';
    expect(cls(both)).toBe('illegal');
  });

  it('an ordinary app is `general` and carries no findings at all', () => {
    const r = classifyPublishedText('<h1>Chai Counter</h1><button>Add a cup</button>');
    expect(r.contentClass).toBe('general');
    expect(r.findings).toEqual([]);
  });

  it('nothing to read is general, never a guess', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(classifyPublishedText(empty as string).contentClass).toBe('general');
    }
  });
});

describe('🔒 no matched text ever leaves this module', () => {
  it('a finding carries an id and a description — never the sentence it matched', () => {
    const f = classifyPublishedText('underage porn gallery').findings[0];
    expect(f.id).toBe('CSAM_SIGNAL');
    expect(Object.keys(f).sort()).toEqual(['contentClass', 'description', 'id']);
    expect(JSON.stringify(f)).not.toContain('underage');
  });

  it('and neither does the refusal the creator reads', () => {
    const msg = illegalRefusal(classifyPublishedText('MDMA in stock — discreet shipping').findings[0]);
    expect(msg).not.toContain('MDMA');
    expect(msg.toLowerCase()).toContain('not published');
    // A refusal with no way back is how an honest creator gets silently lost.
    expect(msg).toContain('Grievance');
  });
});

describe('the rules themselves', () => {
  it('every rule needs BOTH halves — a single-signal rule would be the false-positive machine', () => {
    for (const r of ILLEGAL_RULES) {
      expect(r.subject, r.id).toBeInstanceOf(RegExp);
      expect(r.context, r.id).toBeInstanceOf(RegExp);
      expect(r.subject.source, r.id).not.toBe(r.context.source);
      expect(r.description.length, r.id).toBeGreaterThan(20);
    }
  });

  it('every pattern is word-bounded, so it cannot fire inside an identifier', () => {
    for (const r of ILLEGAL_RULES) {
      expect(r.subject.source, r.id).toContain('\\b');
      expect(r.context.source, r.id).toContain('\\b');
    }
  });

  it('scanning is bounded — a giant bundle cannot stall a publish', () => {
    const huge = 'a'.repeat(SCAN_TEXT_CAP + 10_000) + ' underage porn';
    // Past the cap, so it is NOT seen — an honest limit rather than an unbounded scan.
    expect(classifyPublishedText(huge).contentClass).toBe('general');
  });

  it('🔴 the image limit is STATED, not hidden', () => {
    // This reads text. Real CSAM detection is perceptual image hashing we do not have — saying so is
    // rule 6 (an out-of-reach root cause is recorded, never papered over with a cosmetic patch).
    const src = readFileSync(join(__dirname, 'illegalContentRules.ts'), 'utf8');
    expect(src).toContain('cannot see images');
    expect(src).toContain('OPEN ROOT CAUSE');
  });
});
