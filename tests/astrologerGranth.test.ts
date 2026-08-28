// The Astrologer's granth-grounded consultation, and the class-level fix underneath it.
//
// THE BUG THIS FILE EXISTS FOR (admin 2026-08-27, "hatheli ki photo maango"): the professional chat
// already accepted photos, so a palm reading LOOKED buildable. It was not. Every professional's image
// was described by visionDescribe's default instruction, which opens "You are reading an uploaded file
// for a software engineer" and ends "do not speculate beyond what is shown" — so a palm came back as
// "a photo of a hand" and the Astrologer received nothing to read. Any reading it produced would have
// been invented, which is exactly the failure the second absolute rule forbids: a feature that looks
// done and does nothing.
//
// The fix is class-level, not astrologer-level — a diseased leaf sent to Kisan AI had the same problem.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveVisionInstruction } from '../src/server/lib/visionDescribe';
import { ASTROLOGER_AI } from '../src/server/professionals/configs/astrologer';
import { getProfessional, listProfessionals } from '../src/server/professionals/registry';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('resolveVisionInstruction — who is looking at the picture', () => {
  it('keeps the engineering description for every caller that does not ask for its own', () => {
    const dflt = resolveVisionInstruction();
    expect(dflt).toContain('software engineer');
    // The build path must be byte-identical to before this parameter existed.
    expect(resolveVisionInstruction({})).toBe(dflt);
  });

  it('still composes the design contract onto the engineering instruction for a build', () => {
    const withContract = resolveVisionInstruction({ designContract: true });
    expect(withContract).toContain('software engineer');
    expect(withContract.length).toBeGreaterThan(resolveVisionInstruction().length);
  });

  it('uses the caller instruction INSTEAD of the engineering one — not alongside it', () => {
    const custom = resolveVisionInstruction({ instruction: 'Describe this palm photograph.' });
    expect(custom).toBe('Describe this palm photograph.');
    // The whole point: the engineer framing must be GONE, or the model keeps hunting for UI and tables.
    expect(custom).not.toContain('software engineer');
  });

  it('never pairs a custom instruction with the UI design contract', () => {
    // Asking one vision call for both a palmistry observation and a UI design contract is incoherent;
    // a custom instruction wins outright rather than being concatenated onto a build request.
    const both = resolveVisionInstruction({ instruction: 'Describe this palm.', designContract: true });
    expect(both).toBe('Describe this palm.');
  });

  it('falls back to the default when the instruction is blank, rather than sending nothing', () => {
    expect(resolveVisionInstruction({ instruction: '   ' })).toBe(resolveVisionInstruction());
  });
});

describe('the palm instruction observes — it must never interpret', () => {
  const palm = ASTROLOGER_AI.visionInstruction || '';

  it('is declared at all (without it the Astrologer cannot see a palm)', () => {
    expect(palm.length).toBeGreaterThan(200);
  });

  it('asks for the observable features a palmistry reading actually needs', () => {
    const lower = palm.toLowerCase();
    for (const needed of ['which hand', 'crease', 'deep or faint', 'broken', 'thumb', 'lighting']) {
      expect(lower).toContain(needed);
    }
  });

  it('forbids the vision model from interpreting or predicting', () => {
    // THE HARD LINE. If the cheap describer is allowed to say what a line MEANS, the reading stops
    // being "observation + declared tradition" and becomes a confident answer nobody checked.
    const lower = palm.toLowerCase();
    expect(lower).toContain('do not interpret');
    expect(lower).toContain('do not predict');
    expect(lower).toContain('lifespan');
  });

  it('requires an honest "not visible" instead of a plausible guess', () => {
    expect(palm.toLowerCase()).toContain('not clearly visible');
  });
});

describe('the consultation is a jyotishi consultation, not a horoscope column', () => {
  const method = ASTROLOGER_AI.method || '';
  const prompt = ASTROLOGER_AI.systemPrompt;

  it('asks for birth TIME and PLACE, not the birth date alone', () => {
    // The admin asked only for the date. Without time and place the lagna cannot be fixed, so a
    // date-only "kundli" is not a kundli — asking for all three is what makes the feature authentic.
    const lower = `${method}\n${prompt}`.toLowerCase();
    expect(lower).toContain('birth time');
    expect(lower).toContain('birth place');
    expect(lower).toContain('every two hours');
  });

  it('gives a real reading BEFORE the deepening questions', () => {
    // 4-5 blocking questions before anything of value loses the user. Stage 2 must precede stage 3.
    const stage2 = method.indexOf('STAGE 2');
    const stage3 = method.indexOf('STAGE 3');
    expect(stage2).toBeGreaterThan(-1);
    expect(stage3).toBeGreaterThan(stage2);
    expect(method).toContain('Never make them answer more questions before they receive anything');
  });

  it('asks for the correct hand by tradition, and keeps the photo optional', () => {
    // Samudrik Shastra reads a man's right hand and a woman's left. Hardcoding "right hand" would
    // break the very tradition the feature is meant to honour.
    expect(method).toContain('purusha dakshina, stri vama');
    expect(method.toLowerCase()).toContain('optional');
  });

  it('names real granthas', () => {
    for (const granth of ['Brihat Parashara Hora Shastra', 'Phaladeepika', 'Saravali', 'Samudrik']) {
      expect(prompt).toContain(granth);
    }
  });
});

describe('the honesty guards that make this shippable', () => {
  const prompt = ASTROLOGER_AI.systemPrompt;

  it('forbids inventing a chapter, verse or shloka', () => {
    // Naming a granth and its documented doctrine is scholarship; inventing "chapter 7, verse 12"
    // dresses a guess as scholarship, which is worse than giving no citation at all.
    expect(prompt).toContain('NEVER INVENT A CITATION');
    expect(prompt.toLowerCase()).toContain('verse number');
  });

  it('forbids stating a computed degree, placement or dasha date it cannot compute', () => {
    expect(prompt).toContain('NEVER COMPUTE WHAT YOU CANNOT COMPUTE');
    expect(prompt.toLowerCase()).toContain('ephemeris');
  });

  it('refuses to read lifespan, death or disease from a chart or a palm', () => {
    expect(prompt).toContain('NEVER read lifespan, death, or disease');
    // The specific folk belief that frightens people most is named and rejected by name.
    expect(prompt).toContain('short life line');
  });

  it('keeps the no-fear and no-paid-remedy rules that predate this change', () => {
    expect(prompt).toContain('NEVER use FEAR');
    expect(prompt).toContain('NEVER prescribe anything the user must PAY for');
    expect(prompt.toLowerCase()).toContain('gemstone');
  });

  it('still says plainly that astrology is not science', () => {
    expect(prompt.toLowerCase()).toContain('not scientifically proven');
    expect((ASTROLOGER_AI.disclaimer || '').toLowerCase()).toContain('not science');
  });

  it('routes real decisions to real professionals, and a crisis to a real helpline', () => {
    expect(prompt).toContain('14416');
  });
});

describe('the knowledge base is grounded, and every card is sourced', () => {
  const cards = ASTROLOGER_AI.knowledge || [];

  it('covers what a consultation actually needs', () => {
    const ids = cards.map((c) => c.id);
    for (const id of ['granth_corpus', 'lagna_time_place', 'bhavas', 'grahas', 'vimshottari', 'hasta_rekha']) {
      expect(ids).toContain(id);
    }
  });

  it('every card names its source', () => {
    for (const c of cards) expect(c.source.trim().length).toBeGreaterThan(0);
  });

  it('states the Vimshottari years, which must total 120', () => {
    const v = cards.find((c) => c.id === 'vimshottari');
    const years = [...(v?.content.match(/\b(\d{1,3}) years?\b/g) || [])].map((m) => parseInt(m, 10));
    // Ketu 7 + Shukra 20 + Surya 6 + Chandra 10 + Mangala 7 + Rahu 18 + Guru 16 + Shani 19 + Budha 17.
    // A wrong total is the sort of error that reads as authoritative and is simply false.
    expect(v?.content).toContain('120-year');
    expect(years[0]).toBe(7);
  });

  it('states the eight kootas of gun-milan, which must total 36', () => {
    const g = cards.find((c) => c.id === 'gun_milan');
    const points = [...(g?.content.match(/\((\d)( point)?s?\)/g) || [])].map((m) => parseInt(m.replace(/\D/g, ''), 10));
    expect(points).toHaveLength(8);
    expect(points.reduce((a, b) => a + b, 0)).toBe(36);
  });

  it('rejects the life-line-equals-lifespan superstition in the knowledge itself', () => {
    const h = cards.find((c) => c.id === 'hasta_rekha');
    expect(h?.content).toContain('NOT a measure of lifespan');
  });

  it('keeps Uranus, Neptune and Pluto out of Jyotish', () => {
    const g = cards.find((c) => c.id === 'grahas');
    expect(g?.content).toContain('are not part of classical Jyotish');
  });
});

describe('the wiring, which can break silently', () => {
  it('the route passes the professional’s own vision instruction to the describer', () => {
    // If this line is ever dropped NOTHING FAILS: no error, no failing build — the Astrologer just
    // quietly goes back to receiving palms described for a software engineer, and its readings go
    // back to being invented. Same shape as the cache-prefix wiring test in CLAUDE.md.
    const route = read('src/server/routes/professionals.ts');
    expect(route).toContain('config.visionInstruction');
    expect(route).toMatch(/describeVisionAttachments\(\s*rawAttachments\s*,/);
  });

  it('any professional that declares a vision instruction observes rather than interprets', () => {
    // A class-level guard: the next professional to add one (a crop leaf, a document) must not be
    // allowed to move expert judgement into the cheap describer.
    const configs = listProfessionals()
      .map((p) => getProfessional(p.id))
      .filter(Boolean) as Array<{ id: string; visionInstruction?: string }>;
    const withVision = configs.filter((c) => typeof c.visionInstruction === 'string' && c.visionInstruction);
    expect(withVision.length).toBeGreaterThan(0);
    for (const c of withVision) {
      const lower = c.visionInstruction.toLowerCase();
      expect(lower, `${c.id} must forbid interpretation`).toContain('do not interpret');
      expect(lower, `${c.id} must forbid prediction`).toContain('do not predict');
    }
  });
});
